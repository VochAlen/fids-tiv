// app/api/flights/route.ts
import { NextResponse } from 'next/server';
import { getCurrentFlightDataSafe } from '@/lib/flight-data-service';
import { getRedisClient } from '@/lib/redis';
import type { FlightData } from '@/types/flight';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const FLIGHT_META_KEY = 'cache:flights:meta';

async function getMetaHash(): Promise<string | null> {
  try {
    const client = getRedisClient();
    const rawMeta = await client.get(FLIGHT_META_KEY);
    if (!rawMeta) return null;
    const meta = JSON.parse(rawMeta);
    return meta?.hash ?? null;
  } catch {
    return null;
  }
}

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type');
    const ifNoneMatch = request.headers.get('if-none-match');

    // ── 1. LAGANI META-CHECK PRVO — jedan mali Redis GET, bez parsiranja punog bloba ──
    const metaHash = await getMetaHash();
    const metaEtag = metaHash ? `"${metaHash}"` : null;

    if (ifNoneMatch && metaEtag && ifNoneMatch === metaEtag) {
      return new NextResponse(null, {
        status: 304,
        headers: {
          'ETag': metaEtag,
          'Cache-Control': 'public, max-age=30, s-maxage=60, stale-while-revalidate=120',
        },
      });
    }

    // ── 2. PUN FETCH — samo kad je stvarno promijenjeno (ili meta nedostupna/prvi poziv) ──
    const data = await getCurrentFlightDataSafe();

    // Koristimo ISTI hash izvor kao u koraku 1 (meta.hash), da 304-logika
    // ubuduće stvarno pogađa. Ako meta iz nekog razloga nije bila dostupna
    // u koraku 1 (npr. race sa upisom), probaj ponovo ovdje pošto je data
    // sad garantovano svježe/keširano.
    const finalHash = metaHash ?? (await getMetaHash()) ?? data.lastUpdated; // krajnji fallback, nikad prazan etag
    const etag = `"${finalHash}"`;

    if (ifNoneMatch && ifNoneMatch === etag) {
      return new NextResponse(null, {
        status: 304,
        headers: {
          'ETag': etag,
          'Cache-Control': 'public, max-age=30, s-maxage=60, stale-while-revalidate=120',
        },
      });
    }

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
          : 'public, max-age=60, s-maxage=180, stale-while-revalidate=300';

    const headers: Record<string, string> = {
      'Cache-Control': cacheControl,
      'ETag': etag,
      'X-Data-Source': data.source ?? 'unknown',
      'X-Total-Flights': data.totalFlights.toString(),
    };
    if (responseData.departures) headers['X-Departures'] = responseData.departures.length.toString();
    if (responseData.arrivals) headers['X-Arrivals'] = responseData.arrivals.length.toString();
    if (data.isOfflineMode) headers['X-Offline-Mode'] = 'true';
    if (type) headers['X-Filtered-By'] = type;

    return NextResponse.json(responseData, { status: 200, headers });
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
      { status: 200, headers: { 'Cache-Control': 'no-cache, no-store, must-revalidate' } }
    );
  }
}