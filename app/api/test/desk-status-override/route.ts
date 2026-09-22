// app/api/test/desk-status-override/route.ts
import { NextResponse } from 'next/server';
import { safeRedisHGetAll, safeRedisHGet, safeRedisHSet, safeRedisHDel, safeRedisExpire } from '@/lib/redis';
import { invalidateRawAssignmentsCache } from '@/lib/assignments-service';
import { createHash } from 'crypto';
import { revalidateTag } from 'next/cache';

// ── FIX — RACE CONDITION (isti problem kao u gate-status-override, vidi pun
// komentar tamo i u lib/redis.ts iznad safeRedisHSet): ALL_KEY je bio JEDAN
// JSON string; POST je čitao cijeli objekat, mijenjao samo svoj desk, i
// upisivao cijeli objekat nazad. Dva istovremena zahtjeva za RAZLIČITE
// deskove su se mogla sudariti — drugi write tiho prepiše izmjenu prvog.
// Sad je ALL_KEY Redis HASH (HSET po polju) — atomarno po desku. ──────────

export const revalidate = 30;
// FIX (Vercel Edge Requests/Active CPU trošak na 18 check-in monitora ×
// 10-12s poll = ~4.24M poziva/mjesec, GOTOVO SVI stvarna izvršavanja
// funkcije): identičan problem i identično rješenje kao
// GATE_STATUS_CACHE_CONTROL u app/api/test/gate-status-override/route.ts
// — pun kontekst i rollback uputstvo su tamo, ne duplira se ovdje.
// VAŽNA RAZLIKA: CheckInPageClient.tsx je do sad slao `cache: 'no-store'`
// na fetch() poziv ove rute, što je poništavalo bilo kakvu korist od
// ovog Cache-Control header-a (browser/CDN keš se eksplicitno
// zaobilazio) — ta linija je uklonjena da bi produženi keš prozor
// stvarno imao efekta, isto kao što GatePageClient.tsx već radi.
//
// FIX (po zahtjevu — analiza Vercel računa, avg-sep 2026): ponovo
// udvostručeno (20s → 40s), isti razlog i rollback uputstvo kao u
// GATE_STATUS_CACHE_CONTROL — vidi tamo za pun kontekst.
// FIX (po zahtjevu — brzina prikaza MORA biti ≤20s): s-maxage MORA
// biti ≤20s bez obzira na poll interval — ako CDN keš traje duže od
// 20s, promjena se NE VIDI do isteka tog keša, ČAK I AKO klijent
// poluje svakih par sekundi (CDN keš je deljen između SVIH klijenata,
// ne po-klijentu). 15s garantuje svježinu unutar zahtijevane granice,
// uz malu marginu.
const DESK_STATUS_CACHE_CONTROL =
  'public, max-age=2, s-maxage=15, stale-while-revalidate=10';


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
// FIX (assign-checkin ne prikazuje dodijeljene šaltere — isti bug kao na
// gate-status-override): vraća boolean iz safeRedisHSet — ako Redis
// circuit breaker otvori ili komanda padne, vraćamo false, pa POST handler
// može vratiti 503 i admin zna da treba ponovo kliknuti. Bez ovog,
// admin bi vidio success toast a zapis ne bi bio u Redis-u — poslije
// /api/test/assignments i check-in monitori ne bi vidjeli dodjelu.
async function writeOne(deskNumber: string, entry: DeskEntry): Promise<boolean> {
  const ok = await safeRedisHSet(ALL_KEY, deskNumber, JSON.stringify(entry));
  if (!ok) return false;
  await safeRedisExpire(ALL_KEY, TTL_SECONDS);
  return true;
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
          // FIX (klasa/status vidljiviji na check-in ekranu): isto kao na
          // gate-status-override ruti — bez ovog tag-a, revalidateTag(
          // 'flight-status') iz POST handlera nije probijao CDN keš ove
          // rute, pa je check-in monitor čekao do 5s da vidi novu dodjelu/
          // klasu iako je server već znao za nju.
          'Cache-Tag': 'flight-status',
          'Vercel-Cache-Tag': 'flight-status',
        },
      });
    }

    // ── NORMALAN ODGOVOR ────────────────────────────────────
    const headers = {
      'Cache-Control': DESK_STATUS_CACHE_CONTROL,
      'CDN-Cache-Control': DESK_STATUS_CACHE_CONTROL,
      'Vercel-CDN-Cache-Control': DESK_STATUS_CACHE_CONTROL,
      'ETag': etag,
      // FIX (vidi komentar gore kod 304 grane): tag-based invalidacija
      // CDN keša — bez ovoga, check-in monitori ne bi vidjeli promjene
      // klase/statusa do isteka max-age=2 s-maxage=2 SWR=3 (max 5s).
      'Cache-Tag': 'flight-status',
      'Vercel-Cache-Tag': 'flight-status',
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
    if (!(await writeOne(deskNumber, entry))) {
      return NextResponse.json(
        { error: 'Redis write failed — pokušajte ponovo za nekoliko sekundi' },
        { status: 503 }
      );
    }
  } else if (action === 'closed') {
    const entry: DeskEntry = {
      status: 'closed',
      flightNumber: flightNumber || '',
      classType: existing?.classType ?? null,
      setAt: Date.now(),
    };
    if (!(await writeOne(deskNumber, entry))) {
      return NextResponse.json(
        { error: 'Redis write failed — pokušajte ponovo za nekoliko sekundi' },
        { status: 503 }
      );
    }
  } else if (action === 'clear') {
    await deleteOne(deskNumber);
  } else if (action === 'setClass') {
    if (!existing) return NextResponse.json({ error: 'No active assignment' }, { status: 400 });
    const entry: DeskEntry = { ...existing, classType: classType ?? null };
    if (!(await writeOne(deskNumber, entry))) {
      return NextResponse.json(
        { error: 'Redis write failed — pokušajte ponovo za nekoliko sekundi' },
        { status: 503 }
      );
    }
  } else {
    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  }

  // FIX (assign-checkin ne prikazuje dodijeljene šaltere — vidi komentar
  // u app/api/test/gate-status-override/route.ts za potpuni kontekst):
  // invalidate i assignments-service modul-level keš — bez ovoga,
  // /api/test/assignments vraća STARI cachedRaw do 8s (RAW_CACHE_TTL_MS)
  // nakon dodjele, pa assign-checkin panel ne prikazuje novu dodjelu.
  cachedAll = null;
  cachedAllExpiry = 0;
  invalidateRawAssignmentsCache();

  revalidateTag('flight-status');
  return NextResponse.json({ success: true });
}
