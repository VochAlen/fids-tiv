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
// INSTALACIJA:
//   1. Kopiraj u app/api/flights-cached/route.ts
//   2. lib/flight-service.ts već ima: const FLIGHT_API_URL = '/api/flights-cached'

import { NextResponse } from 'next/server';
import { safeRedisGet } from '@/lib/redis';
import { getRedisClient } from '@/lib/redis';

// ── Konfiguracija ────────────────────────────────────────────
const REDIS_KEY      = 'cache:flights';
const FRESH_SECONDS  = 45;   // 45s — vrati iz Redisa bez vanjskog poziva
const STALE_SECONDS  = 90;   // 90s — vrati stale + revaliduj u pozadini
const FETCH_TIMEOUT  = 8_000; // 8s  — maks čekanje na /api/flights

// ── BaseUrl helper ───────────────────────────────────────────
function getBaseUrl(): string {
  const raw = process.env.NEXT_PUBLIC_BASE_URL || '';
  if (raw.startsWith('http://') || raw.startsWith('https://')) return raw.replace(/\/$/, '');
  if (raw) return `https://${raw.replace(/\/$/, '')}`;
  return 'http://localhost:3000';
}

// ── Fetch od vanjskog /api/flights sa timeoutom ──────────────
async function fetchFromSource(): Promise<unknown> {
  const controller = new AbortController();
  const timeout    = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
  try {
    const res = await fetch(`${getBaseUrl()}/api/flights`, {
      signal:  controller.signal,
      cache:   'no-store',
      headers: { 'Cache-Control': 'no-cache' },
    });
    if (!res.ok) throw new Error(`/api/flights returned ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timeout);
  }
}

// ── Revalidacija u pozadini (ne blokira response) ────────────
function revalidateInBackground(): void {
  fetchFromSource()
    .then(async (data) => {
      try {
        const client = getRedisClient();
        await client.set(
          REDIS_KEY,
          JSON.stringify({ data, fetchedAt: Date.now() }),
          'EX',
          STALE_SECONDS * 2  // Redis TTL = 3 minute (duplo od stale)
        );
      } catch (err) {
        console.error('[flights-cached] Redis write failed:', err);
      }
    })
    .catch((err) => {
      console.error('[flights-cached] Background revalidation failed:', err.message);
    });
}

// ── GET handler ──────────────────────────────────────────────
export async function GET() {
  const now = Date.now();

  // Pokušaj dohvatiti iz Redisa
  try {
    const raw = await safeRedisGet(REDIS_KEY);

    if (raw) {
      const cached = JSON.parse(raw) as { data: unknown; fetchedAt: number };
      const ageMs  = now - cached.fetchedAt;
      const ageSec = Math.round(ageMs / 1000);

      // FRESH — vrati odmah
      if (ageMs < FRESH_SECONDS * 1000) {
        return NextResponse.json(cached.data, {
          headers: { 'X-Cache': 'HIT', 'X-Cache-Age': `${ageSec}s` },
        });
      }

      // STALE — vrati stari podatak, revaliduj u pozadini
      if (ageMs < STALE_SECONDS * 1000) {
        revalidateInBackground();
        return NextResponse.json(cached.data, {
          headers: { 'X-Cache': 'STALE', 'X-Cache-Age': `${ageSec}s` },
        });
      }

      // EXPIRED u Redisu ali postoji — koristi kao fallback dok fetchujemo
      // (ovo se dešava ako Redis TTL još nije istekao ali naš soft-stale jeste)
      revalidateInBackground();
      return NextResponse.json(cached.data, {
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

    // Sačuvaj u Redis asinhorno (ne čekamo)
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
        source:       'fallback',
        error:        msg,
        isOfflineMode: true,
      },
      { status: 503 }
    );
  }
}