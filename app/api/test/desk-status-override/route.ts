// app/api/test/desk-status-override/route.ts
import { NextResponse } from 'next/server';
import { safeRedisHGetAll, safeRedisHGet, safeRedisHSet, safeRedisHDel, safeRedisExpire } from '@/lib/redis';
import { createHash } from 'crypto';
import { revalidateTag } from 'next/cache';

// ── FIX — RACE CONDITION (isti problem kao u gate-status-override, vidi pun
// komentar tamo i u lib/redis.ts iznad safeRedisHSet): ALL_KEY je bio JEDAN
// JSON string; POST je čitao cijeli objekat, mijenjao samo svoj desk, i
// upisivao cijeli objekat nazad. Dva istovremena zahtjeva za RAZLIČITE
// deskove su se mogla sudariti — drugi write tiho prepiše izmjenu prvog.
// Sad je ALL_KEY Redis HASH (HSET po polju) — atomarno po desku. ──────────

export const revalidate = 30;
// FIX (garantovano ≤15s da se klasa/status vidi na check-in ekranu, po
// zahtjevu, BEZ značajnog dodatnog Vercel Active CPU troška): isti
// princip kao GATE_STATUS_CACHE_CONTROL u gate-status-override/route.ts
// — sitan payload, kraći keš je jeftin trade-off. Checkin brzi poll radi
// na 10-12s kadenci.
const DESK_STATUS_CACHE_CONTROL =
  'public, max-age=2, s-maxage=2, stale-while-revalidate=3';


const MAX_AGE_MS = 4 * 60 * 60 * 1000; // 4 sata
const TTL_SECONDS = 4 * 60 * 60;       // 4h
const ALL_KEY = 'test:desk-status:all';

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
};

function parseHashEntries(raw: Record<string, string> | null): Record<string, DeskEntry> {
  if (!raw) return {};
  const out: Record<string, DeskEntry> = {};
  for (const [field, json] of Object.entries(raw)) {
    try {
      out[field] = JSON.parse(json) as DeskEntry;
    } catch {
      // izolovano oštećeno polje — preskoči, ne ruši ostatak
    }
  }
  return out;
}

async function readAll(): Promise<Record<string, DeskEntry>> {
  const raw = await safeRedisHGetAll(ALL_KEY);
  return parseHashEntries(raw);
}

async function touchExpiry(): Promise<void> {
  await safeRedisExpire(ALL_KEY, TTL_SECONDS);
}

// Piše TAČNO JEDNO polje (jedan desk) — atomarno, ne dira ostale deskove.
async function writeOne(deskNumber: string, entry: DeskEntry): Promise<void> {
  await safeRedisHSet(ALL_KEY, deskNumber, JSON.stringify(entry));
  await touchExpiry();
}

async function deleteOne(deskNumber: string): Promise<void> {
  await safeRedisHDel(ALL_KEY, deskNumber);
}

// Briše SAMO stara polja — pojedinačni HDEL po polju, ne prepisuje cijeli hash.
async function cleanupStale(fields: string[]): Promise<void> {
  await Promise.all(fields.map(f => safeRedisHDel(ALL_KEY, f)));
}

async function readAllCached(): Promise<Record<string, DeskEntry>> {
  const now = Date.now();

  if (cachedAll && now < cachedAllExpiry) {
    return cachedAll;
  }

  if (cacheRefreshing && cachedAll) {
    return cachedAll;
  }

  cacheRefreshing = true;
  try {
    const fresh = await readAll();
    cachedAll = fresh;
    cachedAllExpiry = now + CACHE_TTL_MS;
    return fresh;
  } finally {
    cacheRefreshing = false;
  }
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const deskNumber = searchParams.get('deskNumber');
    const now = Date.now();

    const all = await readAllCached();

    // ── ČIŠĆENJE STARIH ZAPISA — sad HDEL po polju (vidi cleanupStale) ──
    const staleFields: string[] = [];
    for (const key of Object.keys(all)) {
      const entry = all[key];
      if (entry.setAt && now - entry.setAt > MAX_AGE_MS) {
        delete all[key];
        staleFields.push(key);
      }
    }
    if (staleFields.length > 0) {
      await cleanupStale(staleFields);
      cachedAll = all;
      cachedAllExpiry = Date.now() + CACHE_TTL_MS;
      console.log(`[desk-cleanup] Total cleaned: ${staleFields.length} old desk-status keys`);
    }

    // ── IZRAČUNAVANJE ETag ──────────────────────────────────
    const payload = deskNumber
      ? { deskNumber, entry: all[deskNumber] ?? { status: null, flightNumber: '', classType: null, setAt: null } }
      : { all };
    const hash = createHash('md5')
      .update(JSON.stringify(payload))
      .digest('hex')
      .substring(0, 16);
    const etag = `"${hash}"`;

    // ── PROVJERA If-None-Match ──────────────────────────────
    const ifNoneMatch = request.headers.get('if-none-match');
    if (ifNoneMatch && ifNoneMatch === etag) {
      return new NextResponse(null, {
        status: 304,
        headers: {
          'ETag': etag,
          'Cache-Control': DESK_STATUS_CACHE_CONTROL,
          'CDN-Cache-Control': DESK_STATUS_CACHE_CONTROL,
          'Vercel-CDN-Cache-Control': DESK_STATUS_CACHE_CONTROL,
        },
      });
    }

    // ── NORMALAN ODGOVOR ────────────────────────────────────
    const headers = {
      'Cache-Control': DESK_STATUS_CACHE_CONTROL,
      'CDN-Cache-Control': DESK_STATUS_CACHE_CONTROL,
      'Vercel-CDN-Cache-Control': DESK_STATUS_CACHE_CONTROL,
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

export async function POST(request: Request) {
  const { deskNumber, action, flightNumber, classType } = await request.json();
  if (!deskNumber) {
    return NextResponse.json({ error: 'deskNumber required' }, { status: 400 });
  }

  // ── FIX (race condition): čitamo SAMO polje ovog deska (HGET), pišemo
  // SAMO njega nazad (HSET) — vidi objašnjenje na vrhu fajla.
  const existingRaw = await safeRedisHGet(ALL_KEY, deskNumber);
  let existing: DeskEntry | undefined;
  if (existingRaw) {
    try { existing = JSON.parse(existingRaw) as DeskEntry; } catch { existing = undefined; }
  }

  if (action === 'open' && flightNumber) {
    const entry: DeskEntry = {
      status: 'open',
      flightNumber,
      classType: existing?.classType ?? null,
      setAt: Date.now(),
    };
    await writeOne(deskNumber, entry);
  } else if (action === 'closed') {
    const entry: DeskEntry = {
      status: 'closed',
      flightNumber: flightNumber || '',
      classType: existing?.classType ?? null,
      setAt: Date.now(),
    };
    await writeOne(deskNumber, entry);
  } else if (action === 'clear') {
    await deleteOne(deskNumber);
  } else if (action === 'setClass') {
    if (!existing) return NextResponse.json({ error: 'No active assignment' }, { status: 400 });
    const entry: DeskEntry = { ...existing, classType: classType ?? null };
    await writeOne(deskNumber, entry);
  } else {
    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  }

  // Invalidiraj lokalni in-process keš odmah — sljedeći GET u ISTOJ
  // serverless instanci mora vidjeti svježu vrijednost.
  cachedAll = null;
  cachedAllExpiry = 0;

  revalidateTag('flight-status');
  return NextResponse.json({ success: true });
}
