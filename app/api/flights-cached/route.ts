// app/api/flights-cached/route.ts
//
// Redis-backed cache za flight podatke.
//
// ZAŠTO REDIS UMJESTO global.__flightCache:
//   Vercel serverless = svaki request može biti nova instanca.
//   global varijabla živi samo u jednoj instanci — cache promašuje.
//   Redis je zajednički za SVE instance → cache uvijek radi.
//
// REZULTAT:
//   • 20 kiosaka × refresh 60s → 1 vanjski API poziv/45s umjesto 20/min
//   • Kad vanjski API pukne → svi ekrani vide zadnje podatke iz Redisa
//   • Nema localStorage grešaka — sve je server-side
//

import { NextResponse } from 'next/server';
import { safeRedisGet } from '@/lib/redis';
import { getRedisClient } from '@/lib/redis';
import type { Flight, FlightData } from '@/types/flight';

// ── Konfiguracija ────────────────────────────────────────────
const REDIS_KEY      = 'cache:flights';
const FRESH_SECONDS  = 60;   // 45s — vrati iz Redisa bez vanjskog poziva
const STALE_SECONDS  = 120;   // 90s — vrati stale + revaliduj u pozadini
const FETCH_TIMEOUT     = 8_000;  // za normalne requeste
const BG_FETCH_TIMEOUT  = 15_000; // za background — ima više vremena

// ── BaseUrl helper ───────────────────────────────────────────
function getBaseUrl(): string {
  const raw = process.env.NEXT_PUBLIC_BASE_URL || '';
  if (raw.startsWith('http://') || raw.startsWith('https://')) return raw.replace(/\/$/, '');
  if (raw) return `https://${raw.replace(/\/$/, '')}`;
  return 'http://localhost:3000';
}

// ── Osiguraj da svaki flight ima _sortTime ───────────────────
function ensureSortTime(data: FlightData): FlightData {
  const processFlights = (flights: Flight[]): Flight[] => {
    return flights.map(flight => ({
      ...flight,
    _sortTime: flight._sortTime != null ? flight._sortTime : undefined,
    }));
  };
  
  return {
    ...data,
    departures: processFlights(data.departures || []),
    arrivals:   processFlights(data.arrivals || []),
  };
}

// ── Fetch od vanjskog /api/flights sa timeoutom ──────────────
// Povećaj timeout za background revalidaciju


async function fetchFromSource(timeoutMs = FETCH_TIMEOUT): Promise<FlightData> {
  const controller = new AbortController();
  const timeout    = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${getBaseUrl()}/api/flights`, {
      signal:  controller.signal,
      cache:   'no-store',
      headers: { 'Cache-Control': 'no-cache' },
    });
    if (!res.ok) throw new Error(`/api/flights returned ${res.status}`);
    const data = await res.json() as FlightData;
    return ensureSortTime(data);
  } finally {
    clearTimeout(timeout);
  }
}

function revalidateInBackground(): void {
  fetchFromSource(BG_FETCH_TIMEOUT)
    .then(async (data) => {
      try {
        const client = getRedisClient();
        await Promise.race([
          client.set(
            REDIS_KEY,
            JSON.stringify({ data, fetchedAt: Date.now() }),
            'EX',
            STALE_SECONDS * 2
          ),
          // ✅ Redis write timeout — ne čekaj beskonačno
          new Promise<void>((_, reject) => 
            setTimeout(() => reject(new Error('Redis write timeout')), 3_000)
          ),
        ]);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[flights-cached] Redis write failed:', msg);
      }
    })
    .catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      // ✅ Ne logiraj "aborted" kao error — to je normalno ponašanje
      if (msg.includes('aborted') || msg.includes('abort')) {
        console.log('[flights-cached] Background revalidation cancelled (normal)');
      } else {
        console.error('[flights-cached] Background revalidation failed:', msg);
      }
    });
}

// ── GET handler ──────────────────────────────────────────────
export async function GET() {
  const now = Date.now();

  // Pokušaj dohvatiti iz Redisa
  try {
    const raw = await safeRedisGet(REDIS_KEY);

    if (raw) {
      const cached = JSON.parse(raw) as { data: FlightData; fetchedAt: number };
      const ageMs  = now - cached.fetchedAt;
      const ageSec = Math.round(ageMs / 1000);
      
      // ✅ Osiguraj da cached data ima _sortTime
      const data = ensureSortTime(cached.data);

      // FRESH — vrati odmah
      if (ageMs < FRESH_SECONDS * 1000) {
        return NextResponse.json(data, {
          headers: { 'X-Cache': 'HIT', 'X-Cache-Age': `${ageSec}s` },
        });
      }

      // STALE — vrati stari podatak, revaliduj u pozadini
      if (ageMs < STALE_SECONDS * 1000) {
        revalidateInBackground();
        return NextResponse.json(data, {
          headers: { 'X-Cache': 'STALE', 'X-Cache-Age': `${ageSec}s` },
        });
      }

      // EXPIRED — koristi kao fallback dok fetchujemo
      revalidateInBackground();
      return NextResponse.json(data, {
        headers: { 'X-Cache': 'EXPIRED', 'X-Cache-Age': `${ageSec}s` },
      });
    }
  } catch (err) {
    // Redis nedostupan — nastavi na direktni fetch
    console.warn('[flights-cached] Redis read failed, fetching directly:', err);
  }

  // MISS — nema cache-a, dohvati direktno i sačuvaj
  try {
    const data = await fetchFromSource();

    // Sačuvaj u Redis asinhrono (ne čekamo)
    try {
      const client = getRedisClient();
      client.set(
        REDIS_KEY,
        JSON.stringify({ data, fetchedAt: Date.now() }),
        'EX',
        STALE_SECONDS * 2
      ).catch((err) => console.error('[flights-cached] Redis write failed:', err));
    } catch { /* Redis nedostupan — nastavi bez cache-a */ }

    return NextResponse.json(data, { headers: { 'X-Cache': 'MISS' } });

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[flights-cached] Direct fetch failed:', msg);


return NextResponse.json(
  {
    departures:   [],
    arrivals:     [],
    totalFlights: 0,
    lastUpdated:  new Date().toISOString(),  // ← DODAJ OVO
    source:       'fallback',
    error:        msg,
    isOfflineMode: true,
  } as FlightData,
  { status: 503 }
);
  }
}