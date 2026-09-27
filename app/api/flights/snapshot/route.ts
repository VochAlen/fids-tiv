// app/api/flights/snapshot/route.ts
import { NextResponse } from 'next/server';
import { getCurrentFlightDataSafe } from '@/lib/flight-data-service';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const data = await getCurrentFlightDataSafe(); // koristi postojeći in-process/Redis cache, ništa novo
    return NextResponse.json(data, {
      headers: { 'Cache-Control': 'public, max-age=10, s-maxage=20' },
    });
  } catch (err) {
    console.error('[flights/snapshot] error:', err);
    return NextResponse.json(
      { departures: [], arrivals: [], totalFlights: 0, lastUpdated: new Date().toISOString(), source: 'emergency', isOfflineMode: true },
      { status: 200 }
    );
  }
}