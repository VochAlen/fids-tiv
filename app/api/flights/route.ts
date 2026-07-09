// app/api/flights/route.ts
import { NextResponse } from 'next/server';
import { getCurrentFlightData } from '@/lib/flight-data-service';

export async function GET(): Promise<NextResponse> {
  const data = await getCurrentFlightData();

  const isCritical = data.error === 'All data sources unavailable.';
  const isEmergency = data.source === 'emergency' && !isCritical;
  const isBackupLike = data.source === 'backup' || data.source === 'auto-processed';

  const cacheControl = isCritical
    ? 'no-cache, no-store, must-revalidate'
    : isEmergency
      ? 'public, s-maxage=15, stale-while-revalidate=30'
      : isBackupLike
        ? 'public, s-maxage=30, stale-while-revalidate=30'
        : 'public, s-maxage=90, stale-while-revalidate=30';

  const headers: Record<string, string> = {
    'Cache-Control': cacheControl,
    'X-Data-Source': data.source ?? 'unknown',
    'X-Total-Flights': data.totalFlights.toString(),
  };

  if (data.departures) headers['X-Departures'] = data.departures.length.toString();
  if (data.arrivals) headers['X-Arrivals'] = data.arrivals.length.toString();
  if (data.isOfflineMode) headers['X-Offline-Mode'] = 'true';

  return NextResponse.json(data, {
    status: 200,
    headers,
  });
}

export const revalidate = 120;