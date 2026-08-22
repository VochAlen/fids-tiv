// app/api/test/gate-status-override/route.ts
import { NextResponse } from 'next/server';
import { safeRedisGet, safeRedisSet } from '@/lib/redis';
import { createHash } from 'crypto';
import { revalidateTag } from 'next/cache';

//  export const dynamic = 'force-dynamic';

const MAX_AGE_MS = 6 * 60 * 60 * 1000; // 6 sati
const TTL_SECONDS = 21_600;            // 6h
const ALL_KEY = 'test:gate-status:all';
let cachedAll: Record<string, GateEntry> | null = null;
let cachedAllExpiry = 0;
let cacheRefreshing = false;
const CACHE_TTL_MS = 10_000;

// ── AŽURIRANO (optimizacija Edge Requests): klijentski "brzi poll"
// koji je gađao ovu rutu na svakih 2-4s je UKLONJEN iz
// GatePageClient.tsx (vidi komentar "UKLONJENO" u tom fajlu) — gate
// override podatak sad stiže isključivo kroz gateEntries polje u
// odgovoru glavnog /api/flights poziva. Ova GET ruta trenutno nema
// aktivnog klijenta (provjereno grep-om kroz cijeli repo), ali je
// ostavljena netaknuta funkcionalno (samo je keš prozor produžen sa
// 2s na 10s) za slučaj da se u budućnosti ponovo poveže neki
// dashboard/admin prikaz na nju. Ako se to desi, GATE_STATUS_CACHE_
// CONTROL treba uskladiti sa stvarnim interval-om tog novog klijenta,
// isto kao što je ranije bilo usklađeno sa FAST_POLL_BASE_MS.
const GATE_STATUS_CACHE_CONTROL =
  'public, max-age=10, s-maxage=10, stale-while-revalidate=15';


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

// ── 2) Dodaj ODMAH ISPOD postojeće readAll() funkcije ──
 
async function readAllCached(): Promise<Record<string, GateEntry>> {
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
 

async function writeAll(data: Record<string, GateEntry>): Promise<void> {
  await safeRedisSet(ALL_KEY, JSON.stringify(data), TTL_SECONDS);
}


export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const gateNumber = searchParams.get('gateNumber');
    const now = Date.now();

const all = await readAllCached();

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
        headers: {
          'ETag': etag,
          // I u 304 grani i u normalnom odgovoru, sve tri header linije:
          'Cache-Control': GATE_STATUS_CACHE_CONTROL,
          'CDN-Cache-Control': GATE_STATUS_CACHE_CONTROL,
          'Vercel-CDN-Cache-Control': GATE_STATUS_CACHE_CONTROL,
        },
      });
    }

    // ── NORMALAN ODGOVOR ────────────────────────────────────
    const headers: Record<string, string> = {
      // I u 304 grani i u normalnom odgovoru, sve tri header linije:
      'Cache-Control': GATE_STATUS_CACHE_CONTROL,
      'CDN-Cache-Control': GATE_STATUS_CACHE_CONTROL,
      'Vercel-CDN-Cache-Control': GATE_STATUS_CACHE_CONTROL,

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

  // ── Odmah probij CDN keš na /api/flights/status — isti razlog kao
  // kod desk-status-override.
  //
  // NAPOMENA: ovo NE utiče na CDN keš OVOG GET handlera (onaj koristi
  // sirova HTTP Cache-Control zaglavlja / Vercel Edge keš, ne Next-ov
  // Data Cache sistem tagova koji revalidateTag() cilja). To znači da
  // nakon admin akcije, /api/test/gate-status-override i dalje može
  // servirati keširan odgovor do isteka gornjeg GATE_STATUS_CACHE_CONTROL
  // prozora (sad ~4s) — to je namjerno i očekivano, ne bug. Ako ikad
  // zatreba INSTANT propagacija bez ikakvog čekanja, trebalo bi ili
  // dodatno pozvati Vercel-ov CDN purge API za ovu specifičnu putanju,
  // ili prebaciti ovaj GET na Next-ov tag-based cache (unstable_cache +
  // revalidateTag) umjesto sirovih headera — veća promjena, po potrebi.
  revalidateTag('flight-status');

  const ttl = action === 'clear' ? undefined : TTL_SECONDS;
  return NextResponse.json({ success: true, ...(ttl ? { ttl } : {}) });
}