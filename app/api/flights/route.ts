// app/api/flights/route.ts
import { NextResponse } from 'next/server';
import { getCurrentFlightDataSafe } from '@/lib/flight-data-service';
import type { FlightData } from '@/types/flight';
import { createHash } from 'crypto'; // ⬅️ DODAJ OVO

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type');

    const data = await getCurrentFlightDataSafe();

    // ── IZRAČUNAJ ETag (hash) ──────────────────────────────────
    const hashPayload = {
      dCount: data.departures?.length || 0,
      aCount: data.arrivals?.length || 0,
      source: data.source,
      lastUpdated: data.lastUpdated,
    };
    const hash = createHash('md5')
      .update(JSON.stringify(hashPayload))
      .digest('hex')
      .substring(0, 16);
    const etag = `"${hash}"`;

    // ── PROVJERI If-None-Match ──────────────────────────────────
    const ifNoneMatch = request.headers.get('if-none-match');
    if (ifNoneMatch && ifNoneMatch === etag) {
      // Vrati 304 – nema promjene, bez tijela
      return new NextResponse(null, {
        status: 304,
        headers: {
          'ETag': etag,
          'Cache-Control': 'public, max-age=30, s-maxage=60, stale-while-revalidate=120',
        },
      });
    }

    // ── Filtriranje po smjeru ────────────────────────────────────
    const responseData: FlightData =
      type === 'departures'
        ? { ...data, arrivals: [] }
        : type === 'arrivals'
        ? { ...data, departures: [] }
        : data;

    const isCritical = data.error === 'All data sources unavailable.';
    const isEmergency = data.source === 'emergency' && !isCritical;
    const isBackupLike = data.source === 'backup' || data.source === 'auto-processed';

const cacheControl = isCritical
  ? 'no-cache, no-store, must-revalidate'
  : isEmergency
    ? 'public, max-age=30, s-maxage=45, stale-while-revalidate=90'
    : isBackupLike
      ? 'public, max-age=30, s-maxage=60, stale-while-revalidate=120'
      : 'public, max-age=60, s-maxage=180, stale-while-revalidate=300'; // ← povećano

    const headers: Record<string, string> = {
      'Cache-Control': cacheControl,
      'ETag': etag, // ⬅️ DODAJ OVO
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