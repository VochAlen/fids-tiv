// app/api/test/gate-status-override/route.ts
import { NextResponse } from 'next/server';
import { safeRedisGet, safeRedisSet } from '@/lib/redis';
import { createHash } from 'crypto'; // ← DODANO

//  export const dynamic = 'force-dynamic';

const MAX_AGE_MS = 6 * 60 * 60 * 1000; // 6 sati
const TTL_SECONDS = 21_600;            // 6h
const ALL_KEY = 'test:gate-status:all';


type GateEntry = {
  status: 'open' | 'closed' | null;
  flightNumber: string;
  classType: string | null;
  setAt: number | null;
};

async function readAll(): Promise<Record<string, GateEntry>> {
  const raw = await safeRedisGet(ALL_KEY);
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function writeAll(data: Record<string, GateEntry>): Promise<void> {
  await safeRedisSet(ALL_KEY, JSON.stringify(data), TTL_SECONDS);
}


export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const gateNumber = searchParams.get('gateNumber');
    const now = Date.now();

const all = await readAll();

    // ── ČIŠĆENJE STARIH ZAPISA (ostavljeno nepromijenjeno) ──
    let changed = false;
    let cleanedCount = 0;
    for (const key of Object.keys(all)) {
      const entry = all[key];
      if (entry.setAt && now - entry.setAt > MAX_AGE_MS) {
        delete all[key];
        changed = true;
        cleanedCount++;
      }
    }
    if (changed) {
await writeAll(all);

console.log(
  `[gate-cleanup] Total cleaned: ${cleanedCount} old gate-status keys`
);
    }

    // ── IZRAČUNAVANJE ETag ──────────────────────────────────
    const payload = gateNumber
      ? { gateNumber, entry: all[gateNumber] ?? { status: null, flightNumber: null, classType: null, setAt: null } }
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
// headers: {
//   'ETag': etag,
// // I u 304 grani i u normalnom odgovoru, sve tri header linije:
// 'Cache-Control': 'public, max-age=6, s-maxage=6, stale-while-revalidate=12',
// 'CDN-Cache-Control': 'public, max-age=6, s-maxage=6, stale-while-revalidate=12',
// 'Vercel-CDN-Cache-Control': 'public, max-age=6, s-maxage=6, stale-while-revalidate=12',
// },
headers: {
  'ETag': etag,
// I u 304 grani i u normalnom odgovoru, sve tri header linije:
'Cache-Control': 'public, max-age=10, s-maxage=10, stale-while-revalidate=8',
'CDN-Cache-Control': 'public, max-age=10, s-maxage=10, stale-while-revalidate=8',
'Vercel-CDN-Cache-Control': 'public, max-age=10, s-maxage=10, stale-while-revalidate=8',
},
      });

    }

    // ── NORMALAN ODGOVOR ────────────────────────────────────
// const headers: Record<string, string> = {
// // I u 304 grani i u normalnom odgovoru, sve tri header linije:
// 'Cache-Control': 'public, max-age=6, s-maxage=6, stale-while-revalidate=12',
// 'CDN-Cache-Control': 'public, max-age=6, s-maxage=6, stale-while-revalidate=12',
// 'Vercel-CDN-Cache-Control': 'public, max-age=6, s-maxage=6, stale-while-revalidate=12',

// 'ETag': etag,

// };
const headers: Record<string, string> = {
// I u 304 grani i u normalnom odgovoru, sve tri header linije:
'Cache-Control': 'public, max-age=10, s-maxage=10, stale-while-revalidate=8',
'CDN-Cache-Control': 'public, max-age=10, s-maxage=10, stale-while-revalidate=8',
'Vercel-CDN-Cache-Control': 'public, max-age=10, s-maxage=10, stale-while-revalidate=8',

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

export async function POST(request: Request) {
  const { gateNumber, action, flightNumber, classType } = await request.json();

  if (!gateNumber) {
    return NextResponse.json({ error: 'gateNumber required' }, { status: 400 });
  }

  const all = await readAll();
  const existing = all[gateNumber];

  if (action === 'open' && flightNumber) {
    all[gateNumber] = {
      status: 'open',
      flightNumber,
      classType: existing?.classType ?? null,
      setAt: Date.now(),
    };
  } else if (action === 'closed') {
    all[gateNumber] = {
      status: 'closed',
      flightNumber: flightNumber || '',
      classType: existing?.classType ?? null,
      setAt: Date.now(),
    };
  } else if (action === 'clear') {
    delete all[gateNumber];
  } else if (action === 'setClass') {
    if (!existing) {
      return NextResponse.json({ error: 'No active assignment' }, { status: 400 });
    }
    all[gateNumber] = { ...existing, classType: classType ?? null };
  } else {
    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  }

  await writeAll(all);



  const ttl = action === 'clear' ? undefined : TTL_SECONDS;
  return NextResponse.json({ success: true, ...(ttl ? { ttl } : {}) });
}