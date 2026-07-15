// app/api/flights/route.ts
import { NextResponse } from 'next/server';
import { getCurrentFlightDataSafe } from '@/lib/flight-data-service';
import type { FlightData } from '@/types/flight';

// ── KRITIČNO: sprečava Next.js da ovu rutu tretira kao statičku i
// zamrzne odgovor (npr. onaj iz noćnog perioda) do sljedećeg deploya.
// Redis već kontroliše TTL/svježinu podataka (240s danju / 3600s noću u
// flight-data-service.ts) — ova ruta MORA biti dinamička na svaki
// request, inače Next.js Data Cache može "pregaziti" sve naše
// noćne/dnevne TTL popravke i zaglaviti klijenta na starom odgovoru.
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type'); // 'departures' | 'arrivals' | null

    const data = await getCurrentFlightDataSafe();

    // ── Filtriranje po smjeru — SAMO za payload koji ide klijentu.
    // Keš u Redisu i hash u saveFlightDataAndMetadata() i dalje rade
    // nad punim setom, ovo je čisto view-layer optimizacija. ──────
    const responseData: FlightData =
      type === 'departures'
        ? { ...data, arrivals: [] }
        : type === 'arrivals'
        ? { ...data, departures: [] }
        : data;

    const isCritical = data.error === 'All data sources unavailable.';
    const isEmergency = data.source === 'emergency' && !isCritical;
    const isBackupLike = data.source === 'backup' || data.source === 'auto-processed';

    // ── CDN/edge keš namjerno usklađen sa Redis TTL ritmom iz
    // flight-data-service.ts — dovoljno kratak da ne "zaglavi" odgovor
    // preko prelaza noć/dan ili live/backup, ali i dalje dovoljno dug
    // da apsorbuje frontend polling (80s interval) bez gađanja origin-a
    // na svaki request → drži Vercel Edge Requests i Redis load nisko.
    const cacheControl = isCritical
      ? 'no-cache, no-store, must-revalidate'
      : isEmergency
        ? 'public, max-age=15, s-maxage=20, stale-while-revalidate=40'
        : isBackupLike
          ? 'public, max-age=20, s-maxage=40, stale-while-revalidate=80'
          : 'public, max-age=30, s-maxage=60, stale-while-revalidate=120';

    const headers: Record<string, string> = {
      'Cache-Control': cacheControl,
      'X-Data-Source': data.source ?? 'unknown',
      'X-Total-Flights': data.totalFlights.toString(),
    };
    if (responseData.departures) headers['X-Departures'] = responseData.departures.length.toString();
    if (responseData.arrivals) headers['X-Arrivals'] = responseData.arrivals.length.toString();
    if (data.isOfflineMode) headers['X-Offline-Mode'] = 'true';
    if (type) headers['X-Filtered-By'] = type;

    return NextResponse.json(responseData, {
      status: 200,
      headers,
    });
  } catch (err) {
    console.error('[api/flights] Unhandled error:', err instanceof Error ? err.message : err);

    return NextResponse.json(
      {
        departures: [],
        arrivals: [],
        totalFlights: 0,
        lastUpdated: new Date().toISOString(),
        source: 'emergency',
        isOfflineMode: true,
        error: 'Route handler caught unexpected error.',
      },
      {
        status: 200,
        headers: { 'Cache-Control': 'no-cache, no-store, must-revalidate' },
      }
    );
  }
}