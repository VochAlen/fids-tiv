// app/api/test/gate-status-override/route.ts
//
// v3 FIX (2026-08-24):
// ─────────────────────────────────────────────────────────────
// 1. REDIS LOCK — ranije read-modify-write nad 'test:gate-status:all'
//    blobom je otvarao race condition: dva istovremena POST-a bi
//    oboje pročitala isto stanje, izmijenila i prepisali — drugi
//    write tiho briše prvi. Sad: SET lock:test:gate-status NX EX 5
//    oko cijelog read-modify-write ciklusa.
//
// 2. CLEANUP PREMJESTEN — ranije je GET handler radio writeAll() ako
//    nađe stare unose (starije od 6h), što je:
//      a) write na read-only putanji (CPU na GET-u)
//      b) još jedna trka ako dva GET-a istovremeno pokušaju cleanup
//    Sad: cleanup se radi samo u POST handleru, pod lock-om.
//
// 3. FIRE-AND-FORGET PUBLISH — publish na Ably ide preko .then()/.catch(),
//    response se vraća odmah, ne čeka se Ably round-trip. Ako publish
//    padne (Ably outage), kiosci će dobiti promjenu preko fallback
//    polling-a na 20s (vidi useRealtimeAssignments hook).
// ─────────────────────────────────────────────────────────────

import { NextResponse, after } from 'next/server';
import { safeRedisGet, safeRedisSet, getRedisClient } from '@/lib/redis';
import { createHash } from 'crypto';
import { publishToChannel } from '@/lib/ably-server';
import { invalidateAssignmentsCache } from '@/lib/assignments-service';
import { applyResourceAction, computeCleanup, type ResourceEntry, type ResourceAction } from '@/lib/resource-mutations';

export const dynamic = 'force-dynamic';

const MAX_AGE_MS = 6 * 60 * 60 * 1000;   // 6 sati — unosi stariji se brišu
const TTL_SECONDS = 21_600;              // 6h — TTL na blob ključu
// FIX (isti uzrok kao app/api/test/desk-status-override/route.ts —
// vidi opširan komentar tamo za pun kontekst): preimenovano da nikad
// ne kolidira sa glavnim (polling) sistemom.
const ALL_KEY = 'ably-fids:gate-status:all';
const LOCK_KEY = 'ably-fids:lock:gate-status:override';
const LOCK_TTL_SECONDS = 5;
const LOCK_WAIT_POLL_MS = 200;
const LOCK_WAIT_MAX_MS = 2_000;

// ── In-process cache za GET — sprečava da paralelni GET-ovi svi
// udare Redis. 30s je dovoljno kratko da admin akcija propagira
// unutar istog ciklusa (POST invalidira cache), a dovoljno dugo da
// pokrije N kioska koji istovremeno pingaju ovu rutu.
let cachedAll: Record<string, GateEntry> | null = null;
let cachedAllExpiry = 0;
let cacheRefreshing = false;
const CACHE_TTL_MS = 30_000;

type GateEntry = {
  status: 'open' | 'closed' | null;
  flightNumber: string;
  classType: string | null;
  setAt: number | null;
  // FIX (isti uzrok kao app/api/test/desk-status-override/route.ts —
  // vidi opširan komentar tamo za pun kontekst): strogo rastući
  // brojač, imun na varijacije u brzini obrade između serverless
  // poziva.
  seq: number;
};

type GateMap = Record<string, GateEntry>;

async function readAllUncached(): Promise<GateMap> {
  const raw = await safeRedisGet(ALL_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as GateMap;
    // ── Ne čistimo ovdje — cleanup je u POST-u pod lock-om. Samo
    // filtriramo starije od MAX_AGE da klijent ne vidi zastarjele unose.
    const now = Date.now();
    const result: GateMap = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (v?.setAt && now - v.setAt > MAX_AGE_MS) continue;
      result[k] = v;
    }
    return result;
  } catch {
    return {};
  }
}

async function readAllCached(): Promise<GateMap> {
  const now = Date.now();
  if (cachedAll && now < cachedAllExpiry) return cachedAll;
  if (cacheRefreshing && cachedAll) return cachedAll;

  cacheRefreshing = true;
  try {
    const fresh = await readAllUncached();
    cachedAll = fresh;
    cachedAllExpiry = now + CACHE_TTL_MS;
    return fresh;
  } finally {
    cacheRefreshing = false;
  }
}

async function writeAll(data: GateMap): Promise<void> {
  await safeRedisSet(ALL_KEY, JSON.stringify(data), TTL_SECONDS);
}

// ── Token + unlock skripta — spriječi brisanje tuđeg lock-a ──
function generateLockToken(): string {
  return `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

const UNLOCK_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end
`;

async function acquireLock(): Promise<string | null> {
  const client = getRedisClient();
  const token = generateLockToken();
  const deadline = Date.now() + LOCK_WAIT_MAX_MS;

  while (Date.now() < deadline) {
    try {
      const got = await client.set(LOCK_KEY, token, 'EX', LOCK_TTL_SECONDS, 'NX');
      if (got === 'OK') return token;
    } catch (err) {
      console.warn('[gate-status-override] lock acquire error:', err instanceof Error ? err.message : err);
      return null;
    }
    await new Promise(r => setTimeout(r, LOCK_WAIT_POLL_MS));
  }
  return null;
}

async function releaseLock(token: string): Promise<void> {
  try {
    const client = getRedisClient();
    await client.eval(UNLOCK_SCRIPT, 1, LOCK_KEY, token);
  } catch (e) {
    // Nekritično — lock će isteći sam kroz LOCK_TTL_SECONDS
    console.warn('[gate-status-override] lock release error:', e instanceof Error ? (e as Error).message : e);
  }
}

// ── Atomic read-modify-write pod lock-om ──
// FIX (vidi opširan komentar uz GateEntry.seq iznad).
const SEQ_KEY = 'ably-fids:seq:gate-status';
async function nextSeq(): Promise<number> {
  const client = getRedisClient();
  return client.incr(SEQ_KEY);
}

async function mutateAll(
  mutate: (all: GateMap) => { changed: boolean; publishedEntry?: { gateNumber: string; entry: GateEntry } | null } | null
): Promise<{ success: boolean; conflict?: boolean; cleanedCount?: number; publishedEntry?: { gateNumber: string; entry: GateEntry } | null; cleanedEntries?: { gateNumber: string; entry: GateEntry }[] }> {
  const token = await acquireLock();
  if (!token) {
    return { success: false, conflict: true };
  }

  try {
    const all = await readAllUncached();

    // Cleanup starih unosa pod lock-om
    // FIX (KRITIČNO — isti razlog kao u desk-status-override/route.ts,
    // vidi opširan komentar tamo): automatski očišćeni (istekli) unosi
    // se sad PRIKUPLJAJU i objavljuju preko Ably-a, inače kiosk gate
    // ekran nikad ne sazna da se stanje automatski promijenilo —
    // ostaje zaglavljen na starom prikazu.
    const now = Date.now();
    // NOVO — cleanup logika sad dolazi iz lib/resource-mutations.ts.
    const cleanedRaw = computeCleanup(all as unknown as Record<string, ResourceEntry>, now, MAX_AGE_MS);
    const cleanedEntries: { gateNumber: string; entry: GateEntry }[] =
      cleanedRaw.map(c => ({ gateNumber: c.key, entry: c.entry as GateEntry }));
    const cleaned = cleanedEntries.length;

    for (const c of cleanedEntries) {
      c.entry.seq = await nextSeq();
    }

    const result = mutate(all);
    if (!result) {
      if (cleaned > 0) await writeAll(all);
      return { success: true, cleanedCount: cleaned, cleanedEntries };
    }

    // FIX (vidi opširan komentar uz GateEntry.seq).
    if (result.changed && result.publishedEntry) {
      result.publishedEntry.entry.seq = await nextSeq();
    }

    if (result.changed || cleaned > 0) {
      await writeAll(all);
    }
    return { success: true, cleanedCount: cleaned, publishedEntry: result.publishedEntry, cleanedEntries };
  } finally {
    await releaseLock(token);
  }
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const gateNumber = searchParams.get('gateNumber');

    const all = await readAllCached();

    // ── IZRAČUNAVANJE ETag ──────────────────────────────────
    const payload = gateNumber
      ? { gateNumber, entry: all[gateNumber] ?? { status: null, flightNumber: null, classType: null, setAt: null } }
      : { all };

    const hash = createHash('md5')
      .update(JSON.stringify(payload))
      .digest('hex')
      .substring(0, 16);
    const etag = `"${hash}"`;

    const cacheControl = 'public, max-age=30, s-maxage=40, stale-while-revalidate=90';

    // ── PROVJERA If-None-Match ──────────────────────────────
    const ifNoneMatch = request.headers.get('if-none-match');
    if (ifNoneMatch && ifNoneMatch === etag) {
      return new NextResponse(null, {
        status: 304,
        headers: {
          'ETag': etag,
          'Cache-Control': cacheControl,
          'CDN-Cache-Control': cacheControl,
          'Vercel-CDN-Cache-Control': cacheControl,
        },
      });
    }

    const headers: Record<string, string> = {
      'Cache-Control': cacheControl,
      'CDN-Cache-Control': cacheControl,
      'Vercel-CDN-Cache-Control': cacheControl,
      'ETag': etag,
    };

    if (gateNumber) {
      const entry = all[gateNumber] ?? { status: null, flightNumber: null, classType: null, setAt: null };
      return NextResponse.json(entry, { headers });
    }

    return NextResponse.json(all, { headers });
  } catch (err) {
    console.error('[gate-status-override] GET error:', err instanceof Error ? err.message : err);
    return NextResponse.json({}, { status: 200, headers: { 'Cache-Control': 'no-cache' } });
  }
}

// FIX (po zahtjevu — strict TypeScript, bez any): vidi isti obrazac i
// obrazloženje u app/api/test/desk-status-override/route.ts.
interface GateStatusRequestBody {
  gateNumber?: string;
  action?: 'open' | 'closed' | 'clear' | 'setClass';
  flightNumber?: string;
  classType?: string | null;
}

export async function POST(request: Request) {
  let body: GateStatusRequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { gateNumber, action, flightNumber, classType } = body;

  if (!gateNumber) {
    return NextResponse.json({ error: 'gateNumber required' }, { status: 400 });
  }

  try {
    const result = await mutateAll((all) => {
      const now = Date.now();
      // NOVO — odlučivačka logika sad dolazi iz lib/resource-mutations.ts.
      const outcome = applyResourceAction(
        all as unknown as Record<string, ResourceEntry>,
        gateNumber,
        (action as ResourceAction) ?? 'clear',
        flightNumber,
        classType,
        now
      );
      if (!outcome.changed || !outcome.publishedEntry) {
        return outcome.changed ? { changed: true } : null;
      }
      return {
        changed: true,
        publishedEntry: { gateNumber: outcome.publishedEntry.key, entry: outcome.publishedEntry.entry as GateEntry },
      };
    });

    if (result.conflict) {
      return NextResponse.json(
        { error: 'Concurrent modification — please retry in a moment', retryable: true },
        { status: 503 }
      );
    }

    // FIX (po zahtjevu — isti razlog kao desk-status-override/route.ts,
    // vidi opširan komentar tamo).
    if (action === 'setClass' && !result.publishedEntry) {
      return NextResponse.json(
        { error: 'Gate nije pronađen — možda je u međuvremenu zatvoren/obrisan', retryable: false },
        { status: 409 }
      );
    }

    if (result.cleanedCount && result.cleanedCount > 0) {
      console.log(`[gate-status-override] Cleanup: removed ${result.cleanedCount} expired entries (during ${action} on ${gateNumber})`);
    }

    // Invalidiraj in-process GET cache (ova ruta) — novi GET će pročitati svježi blob.
    cachedAll = null;
    // FIX (po zahtjevu — isti razlog kao u desk-status-override/route.ts,
    // vidi opširan komentar tamo i uz invalidateAssignmentsCache u
    // lib/assignments-service.ts).
    invalidateAssignmentsCache();

    // ── 📡 ABLY PUBLISH — fire-and-forget, ALI garantovano dovršen.
    // after() kazuje Vercel runtime-u da ne zamrzava/gasi funkciju dok
    // se ovaj posao ne završi — bez toga postoji rizik da Vercel
    // prekine izvršavanje čim se response pošalje, tiho odbacujući
    // publish koji je još "u letu" (poznat gotcha kod fire-and-forget
    // na serverless platformama). Response se i dalje vraća odmah
    // (after() ne blokira response). Ako publish ipak padne (Ably
    // outage), kiosci će dobiti promjenu preko fallback polling-a na
    // 20s (vidi useRealtimeAssignments hook).
    if (result.publishedEntry) {
      after(() =>
        publishToChannel('assignments:gates', 'update', result.publishedEntry)
          .then(() => {
            console.log(`📤 Ably (assignments:gates): gate ${gateNumber} -> ${result.publishedEntry?.entry.flightNumber || 'CLOSED'}`);
          })
          .catch(err => {
            console.error('[gate-status-override] Ably publish to assignments:gates failed:', err);
          })
      );
    }

    // FIX (po zahtjevu — vidi opširan komentar uz cleanedEntries u
    // mutateAll iznad): automatski očišćeni (istekli) gate unosi
    // MORAJU se takođe objaviti, inače taj gate ekran nikad ne sazna
    // da se stanje promijenilo — ostaje zaglavljen na starom prikazu.
    if (result.cleanedEntries && result.cleanedEntries.length > 0) {
      for (const cleanedEntry of result.cleanedEntries) {
        after(() =>
          publishToChannel('assignments:gates', 'update', cleanedEntry).catch(err =>
            console.error('[gate-status-override] Ably publish (cleanup) failed:', err)
          )
        );
      }
    }

    const ttl = action === 'clear' ? undefined : TTL_SECONDS;
    return NextResponse.json({ success: true, ...(ttl ? { ttl } : {}) });
  } catch (err) {
    console.error('[gate-status-override] POST error:', err instanceof Error ? err.message : err);
    return NextResponse.json(
      { error: 'Failed to update gate status — try again in a few seconds', retryable: true },
      { status: 503 }
    );
  }
}
