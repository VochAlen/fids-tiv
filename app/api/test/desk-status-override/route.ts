// app/api/test/desk-status-override/route.ts
import { NextResponse } from 'next/server';
import { safeRedisGet, safeRedisSet } from '@/lib/redis';
import { createHash } from 'crypto'; // ← DODANO
import { revalidatePath } from 'next/cache';


export const revalidate = 30;

const MAX_AGE_MS = 4 * 60 * 60 * 1000; // 4 sata
const ALL_KEY = 'test:desk-status:all';

// ── KEŠ SA "STALE-WHILE-REVALIDATE" ──────────────────────
let cachedAll: Record<string, DeskEntry> | null = null;
let cachedAllExpiry = 0;
let cacheRefreshing = false;
const CACHE_TTL_MS = 30_000; // ← povećano sa 10s na 30s

type DeskEntry = {
  status: 'open' | 'closed' | null;
  flightNumber: string;
  classType: string | null;
  setAt: number | null;
};

async function readAll(): Promise<Record<string, DeskEntry>> {
  const raw = await safeRedisGet(ALL_KEY);
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function writeAll(data: Record<string, DeskEntry>): Promise<void> {
  await safeRedisSet(ALL_KEY, JSON.stringify(data), 4 * 60 * 60);
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

    // ── ČIŠĆENJE STARIH ZAPISA (ostavljeno nepromijenjeno) ──
    let changed = false;
    for (const key of Object.keys(all)) {
      const entry = all[key];
      if (entry.setAt && now - entry.setAt > MAX_AGE_MS) {
        delete all[key];
        changed = true;
      }
    }
    if (changed) {
await writeAll(all);

cachedAll = all;
cachedAllExpiry = Date.now() + CACHE_TTL_MS;


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
'Cache-Control': 'public, max-age=10, s-maxage=10, stale-while-revalidate=8',
'CDN-Cache-Control': 'public, max-age=10, s-maxage=10, stale-while-revalidate=8',
'Vercel-CDN-Cache-Control': 'public, max-age=10, s-maxage=10, stale-while-revalidate=8',
    },
  });
}

    // ── NORMALAN ODGOVOR ────────────────────────────────────
const headers = {
'Cache-Control': 'public, max-age=10, s-maxage=10, stale-while-revalidate=8',
'CDN-Cache-Control': 'public, max-age=10, s-maxage=10, stale-while-revalidate=8',
'Vercel-CDN-Cache-Control': 'public, max-age=10, s-maxage=10, stale-while-revalidate=8',

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

  const all = await readAll();
  const existing = all[deskNumber];

  if (action === 'open' && flightNumber) {
    all[deskNumber] = {
      status: 'open',
      flightNumber,
      classType: existing?.classType ?? null,
      setAt: Date.now(),
    };
  } else if (action === 'closed') {
    all[deskNumber] = {
      status: 'closed',
      flightNumber: flightNumber || '',
      classType: existing?.classType ?? null,
      setAt: Date.now(),
    };
  } else if (action === 'clear') {
    delete all[deskNumber];
  } else if (action === 'setClass') {
    if (!existing) return NextResponse.json({ error: 'No active assignment' }, { status: 400 });
    all[deskNumber] = { ...existing, classType: classType ?? null };
  } else {
    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  }

await writeAll(all);
cachedAll = all;
cachedAllExpiry = Date.now() + CACHE_TTL_MS;

return NextResponse.json({ success: true });
}