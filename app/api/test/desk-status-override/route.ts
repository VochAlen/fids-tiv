// app/api/test/desk-status-override/route.ts
//
// v3 FIX (2026-08-24):
// ─────────────────────────────────────────────────────────────
// 1. REDIS LOCK — ranije read-modify-write nad 'test:desk-status:all'
//    blobom je otvarao race condition: dva istovremena POST-a bi
//    oboje pročitala isto stanje, izmijenila i prepisali — drugi
//    write tiho briše prvi. Sad: SET lock:desk-status NX EX 5
//    oko cijelog read-modify-write ciklusa.
//
// 2. CLEANUP PREMJESTEN — ranije je GET handler radio writeAll() ako
//    nađe stare unose (starije od 4h), što je:
//      a) write na read-only putanji (CPU na GET-u)
//      b) još jedna trka ako dva GET-a istovremeno pokušaju cleanup
//    Sad: cleanup se radi samo u POST handleru, pod lock-om.
//
// 3. FIRE-AND-FORGET PUBLISH — publish na Ably ide preko .catch(),
//    response se vraća odmah, ne čeka se Ably round-trip.
// ─────────────────────────────────────────────────────────────

import { NextResponse, after } from 'next/server';
import { safeRedisGet, safeRedisSet, getRedisClient } from '@/lib/redis';
import { createHash } from 'crypto';
import { publishToChannel } from '@/lib/ably-server';
import { invalidateAssignmentsCache } from '@/lib/assignments-service';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const MAX_AGE_MS = 4 * 60 * 60 * 1000;   // 4 sata — unosi stariji se brišu
const TTL_SECONDS = 4 * 60 * 60;          // 4h — TTL na blob ključu
// FIX (KRITIČNO — pravi, konačan uzrok prijavljenog "neki letovi se
// ne otvaraju na check-in/gate, radi tek nakon zaobilaznice"):
// glavni (polling, ne-Ably) FIDS sistem koristi IDENTIČNO ime ključa
// ('test:desk-status:all'), ali kao Redis HASH (HSET po polju), dok
// ovaj (Ably) sistem koristi STRING (JSON blob preko GET/SET). Ako
// oba sistema dijele istu Redis bazu, svaki upis jednog sistema
// prepisuje tip podatka koji drugi očekuje — otud ponavljajuća
// "WRONGTYPE" greška i naizgled nasumično "neki letovi rade, neki ne"
// (u stvari čista slučajnost tajminga koji je sistem poslednji pisao).
// Ključ je preimenovan da NIKAD ne može da se sudari sa glavnim
// sistemom, bez obzira da li dijele Redis bazu.
const ALL_KEY = 'ably-fids:desk-status:all';
const LOCK_KEY = 'ably-fids:lock:desk-status:override';
const LOCK_TTL_SECONDS = 5;
const LOCK_WAIT_POLL_MS = 200;
const LOCK_WAIT_MAX_MS = 2_000;

// ── KEŠ SA "STALE-WHILE-REVALIDATE" ──────────────────────
let cachedAll: Record<string, DeskEntry> | null = null;
let cachedAllExpiry = 0;
let cacheRefreshing = false;
const CACHE_TTL_MS = 30_000;

type DeskEntry = {
  status: 'open' | 'closed' | null;
  flightNumber: string;
  classType: string | null;
  setAt: number | null;
  // FIX (KRITIČNO — pravi uzrok prijavljenog "brzo uklonim pa odmah
  // dodijelim novi let, novi se ne prikaže"): setAt (Date.now()) se
  // hvata NEZAVISNO na svakom serverless pozivu — ako "ukloni" (poslat
  // PRVI od strane korisnika) završi na SPORIJOJ funkcijskoj instanci
  // (cold start i sl.) od "dodijeli" (poslat DRUGI), setAt za "ukloni"
  // može ispasti KASNIJI od setAt za "dodijeli" — mergeOne na klijentu
  // (hooks/useRealtimeAssignments.ts) bi tad POGREŠNO prihvatio
  // "ukloni" kao noviji i tiho obrisao upravo dodijeljen let. seq je
  // STROGO rastući brojač, dodijeljen UNUTAR lock-om zaštićene sekcije
  // (vidi mutateAll niže) — garantovano prati STVARAN redosled kojim
  // su operacije NA OVOM RESURSU obrađene, imun na varijacije u brzini
  // obrade između poziva. Klijent sad poredi po seq, ne po setAt.
  seq: number;
};

type DeskMap = Record<string, DeskEntry>;

async function readAllUncached(): Promise<DeskMap> {
  const raw = await safeRedisGet(ALL_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as DeskMap;
    // ── Ne čistimo ovdje — cleanup je u POST-u pod lock-om. Samo
    // filtriramo starije od MAX_AGE da klijent ne vidi zastarjele unose.
    const now = Date.now();
    const result: DeskMap = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (v?.setAt && now - v.setAt > MAX_AGE_MS) continue;
      result[k] = v;
    }
    return result;
  } catch {
    return {};
  }
}

async function readAllCached(): Promise<DeskMap> {
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

async function writeAll(data: DeskMap): Promise<void> {
  await safeRedisSet(ALL_KEY, JSON.stringify(data), TTL_SECONDS);
}

// ── Token + unlock skripta ──
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
      console.warn('[desk-status-override] lock acquire error:', err instanceof Error ? err.message : err);
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
    console.warn('[desk-status-override] lock release error:', e instanceof Error ? (e as Error).message : e);
  }
}

// ── Atomic read-modify-write pod lock-om ──
// FIX (vidi opširan komentar uz DeskEntry.seq iznad): atomski,
// strogo-rastući brojač preko Redis INCR — nezavisan od Date.now(),
// pa nije podložan varijaciji u brzini obrade između serverless
// poziva. Jedan dijeljen ključ za sve šaltere (ne treba per-desk
// preciznost, samo GLOBALNI, strogo rastući redosled operacija).
const SEQ_KEY = 'ably-fids:seq:desk-status';
async function nextSeq(): Promise<number> {
  const client = getRedisClient();
  return client.incr(SEQ_KEY);
}

async function mutateAll(
  mutate: (all: DeskMap) => { changed: boolean; publishedEntry?: { deskNumber: string; entry: DeskEntry } | null } | null
): Promise<{ success: boolean; conflict?: boolean; cleanedCount?: number; publishedEntry?: { deskNumber: string; entry: DeskEntry } | null; cleanedEntries?: { deskNumber: string; entry: DeskEntry }[] }> {
  const token = await acquireLock();
  if (!token) {
    return { success: false, conflict: true };
  }

  try {
    const all = await readAllUncached();

    // Cleanup starih unosa pod lock-om
    // FIX (KRITIČNO — pravi uzrok prijavljenog "check-in šalter se ne
    // može zatvoriti, kiosk i dalje prikazuje let"): ovaj cleanup je
    // RANIJE tiho brisao istekle unose iz Redis-a (npr. šalter otvoren
    // duže od MAX_AGE_MS, 4h za desk) BEZ da o tome ikad obavijesti
    // kiosk ekrane preko Ably-a — kiosk je ostajao zauvijek zaglavljen
    // na starom, vizuelno "otvorenom" prikazu, jer nikad nije primio
    // poruku da se stanje promijenilo. Kad bi osoblje kasnije ručno
    // kliknulo "ukloni" na već (automatski, tiho) obrisan šalter,
    // `existing` je bio undefined, `action: 'clear'` je vraćao
    // `{changed: false}` BEZ publishedEntry — ručna akcija je izgledala
    // uspješna u adminu, ali nikad nije poslala Ably poruku, pa je
    // kiosk ostajao zaglavljen. Sad se svaki automatski očišćen unos
    // PRIKUPLJA i objavljuje (isto kao ručna 'clear' akcija) — vidi
    // pozivno mjesto u POST handleru.
    const now = Date.now();
    const cleanedEntries: { deskNumber: string; entry: DeskEntry }[] = [];
    for (const k of Object.keys(all)) {
      const v = all[k];
      if (v?.setAt && now - v.setAt > MAX_AGE_MS) {
        delete all[k];
        cleanedEntries.push({
          deskNumber: k,
          entry: { status: null, flightNumber: '', classType: null, setAt: Date.now(), seq: 0 },
        });
      }
    }
    const cleaned = cleanedEntries.length;

    // Dodijeli prave seq vrijednosti očišćenim unosima (isti razlog
    // kao za glavni publishedEntry ispod — vidi komentar uz
    // DeskEntry.seq).
    for (const c of cleanedEntries) {
      c.entry.seq = await nextSeq();
    }

    const result = mutate(all);
    if (!result) {
      if (cleaned > 0) await writeAll(all);
      return { success: true, cleanedCount: cleaned, cleanedEntries };
    }

    // FIX (vidi opširan komentar uz DeskEntry.seq): entry objekat je
    // ISTI po referenci i u all[deskNumber] i u result.publishedEntry
    // (mutate callback-ovi ispod rade `all[x] = entry; return
    // {publishedEntry: {..., entry}}`) — postavljanje seq ovdje ga
    // ažurira NA OBA MJESTA odjednom, bez potrebe da se mijenja
    // potpis/logika svake pojedinačne grane (open/closed/clear/
    // setClass) iznad.
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

// ============================================================
// GET — bez izmjena, samo čitanje + ETag
// ============================================================
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const deskNumber = searchParams.get('deskNumber');

    const all = await readAllCached();

    // ── IZRAČUNAVANJE ETag ──────────────────────────────────
    const payload = deskNumber
      ? { deskNumber, entry: all[deskNumber] ?? { status: null, flightNumber: '', classType: null, setAt: null } }
      : { all };

    const hash = createHash('md5')
      .update(JSON.stringify(payload))
      .digest('hex')
      .substring(0, 16);
    const etag = `"${hash}"`;

    const cacheControl = 'public, max-age=90, s-maxage=100, stale-while-revalidate=180';

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

    // ── NORMALAN ODGOVOR ────────────────────────────────────
    const headers: Record<string, string> = {
      'Cache-Control': cacheControl,
      'CDN-Cache-Control': cacheControl,
      'Vercel-CDN-Cache-Control': cacheControl,
      'ETag': etag,
    };

    if (deskNumber) {
      const entry = all[deskNumber] ?? { status: null, flightNumber: '', classType: null, setAt: null };
      return NextResponse.json(entry, { headers });
    }

    return NextResponse.json(all, { headers });
  } catch (err) {
    console.error('[desk-status-override] GET error:', err instanceof Error ? err.message : err);
    return NextResponse.json({}, { status: 200, headers: { 'Cache-Control': 'no-cache' } });
  }
}

// ============================================================
// POST — sa Redis lock-om i fire-and-forget Ably publish-om
// ============================================================
// FIX (po zahtjevu — strict TypeScript, bez any): pravi tip umjesto
// `any` za tijelo zahtjeva — polja odgovaraju onome što se stvarno
// destrukturira ispod. Svako polje je opciono na ulazu (JSON od
// klijenta se ne provjerava strukturno prije parsiranja) — validacija
// da li su OBAVEZNA polja prisutna i dalje se radi eksplicitno ispod
// (npr. `if (!deskNumber)`), nepromijenjeno.
interface DeskStatusRequestBody {
  deskNumber?: string;
  action?: 'open' | 'closed' | 'clear' | 'setClass';
  flightNumber?: string;
  classType?: string | null;
}

export async function POST(request: Request) {
  let body: DeskStatusRequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { deskNumber, action, flightNumber, classType } = body;
  if (!deskNumber) {
    return NextResponse.json({ error: 'deskNumber required' }, { status: 400 });
  }

  try {
    const result = await mutateAll((all) => {
      const existing = all[deskNumber];
      let entry: DeskEntry;

      // ── AŽURIRANJE ──────────────────────────────────────────
      if (action === 'open' && flightNumber) {
        entry = { status: 'open', flightNumber, classType: existing?.classType ?? null, setAt: Date.now(), seq: 0 }; // seq: mutateAll postavlja pravu vrijednost
        all[deskNumber] = entry;
        return { changed: true, publishedEntry: { deskNumber, entry } };
      }

      if (action === 'closed') {
        entry = { status: 'closed', flightNumber: flightNumber || '', classType: existing?.classType ?? null, setAt: Date.now(), seq: 0 }; // seq: mutateAll postavlja pravu vrijednost
        all[deskNumber] = entry;
        return { changed: true, publishedEntry: { deskNumber, entry } };
      }

      if (action === 'clear') {
        if (!existing) return { changed: false };
        delete all[deskNumber];
        entry = { status: null, flightNumber: '', classType: null, setAt: Date.now(), seq: 0 }; // seq: mutateAll postavlja pravu vrijednost
        return { changed: true, publishedEntry: { deskNumber, entry } };
      }

      if (action === 'setClass') {
        if (!existing) return { changed: false };
        entry = { ...existing, classType: classType ?? null };
        all[deskNumber] = entry;
        return { changed: true, publishedEntry: { deskNumber, entry } };
      }

      return null;
    });

    if (result.conflict) {
      return NextResponse.json(
        { error: 'Concurrent modification — please retry in a moment', retryable: true },
        { status: 503 }
      );
    }

    if (result.cleanedCount && result.cleanedCount > 0) {
      console.log(`[desk-status-override] Cleanup: removed ${result.cleanedCount} expired entries (during ${action} on ${deskNumber})`);
    }

    // Invalidiraj in-process GET cache (ova ruta)
    cachedAll = null;
    // FIX (po zahtjevu — vidi opširan komentar uz
    // invalidateAssignmentsCache u lib/assignments-service.ts): ovaj
    // keš je SASVIM ODVOJEN od cachedAll iznad — koristi ga
    // /api/test/assignments (glavni izvor stanja pri mount-u/reload-u
    // kiosk ekrana). Bez ove linije, ta ruta bi mogla vratiti stare
    // podatke ako pogodi istu, toplu instancu koja je nedavno
    // keširala staro stanje — čak i kad je Redis već ispravno ažuriran.
    invalidateAssignmentsCache();

    // ── 📡 ABLY PUBLISH — fire-and-forget, ALI garantovano dovršen
    // (after() — vidi objašnjenje u gate-status-override/route.ts).
    // Response se vraća odmah. Ako publish ipak padne, kiosci će
    // dobiti promjenu preko fallback polling-a.
    if (result.publishedEntry) {
      after(() =>
        publishToChannel('assignments:desks', 'update', result.publishedEntry).catch(err =>
          console.error('[desk-status-override] Ably publish (assignments:desks) failed:', err)
        )
      );
    }

    // FIX (po zahtjevu — vidi opširan komentar uz cleanedEntries u
    // mutateAll): automatski očišćeni (istekli) unosi MORAJU se
    // TAKOĐE objaviti, inače kiosk ekran za taj šalter nikad ne sazna
    // da se njegovo stanje promijenilo — ostaje zaglavljen na starom
    // prikazu zauvijek (dok se ne desi neka DRUGA, ručna promjena na
    // ISTOM šalteru koja bi to "slučajno" ispravila).
    if (result.cleanedEntries && result.cleanedEntries.length > 0) {
      for (const cleanedEntry of result.cleanedEntries) {
        after(() =>
          publishToChannel('assignments:desks', 'update', cleanedEntry).catch(err =>
            console.error('[desk-status-override] Ably publish (cleanup) failed:', err)
          )
        );
      }
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[desk-status-override] POST error:', err instanceof Error ? err.message : err);
    return NextResponse.json(
      { error: 'Failed to update desk status — try again in a few seconds', retryable: true },
      { status: 503 }
    );
  }
}
