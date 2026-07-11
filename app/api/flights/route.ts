// app/api/flights/route.ts
// import { NextResponse } from 'next/server';
// import { getCurrentFlightData } from '@/lib/flight-data-service';

// export async function GET(): Promise<NextResponse> {
//   const data = await getCurrentFlightData();

//   const isCritical = data.error === 'All data sources unavailable.';
//   const isEmergency = data.source === 'emergency' && !isCritical;
//   const isBackupLike = data.source === 'backup' || data.source === 'auto-processed';

  // const cacheControl = isCritical
  //   ? 'no-cache, no-store, must-revalidate'
  //   : isEmergency
  //     ? 'public, s-maxage=15, stale-while-revalidate=30'
  //     : isBackupLike
  //       ? 'public, s-maxage=30, stale-while-revalidate=30'
  //       : 'public, s-maxage=90, stale-while-revalidate=30';

//   const cacheControl = isCritical
//   ? 'no-cache, no-store, must-revalidate'
//   : isEmergency
//     ? 'public, max-age=10, s-maxage=15, stale-while-revalidate=30'
//     : isBackupLike
//       ? 'public, max-age=15, s-maxage=30, stale-while-revalidate=30'
//       : 'public, max-age=20, s-maxage=90, stale-while-revalidate=30';

//   const headers: Record<string, string> = {
//     'Cache-Control': cacheControl,
//     'X-Data-Source': data.source ?? 'unknown',
//     'X-Total-Flights': data.totalFlights.toString(),
//   };

//   if (data.departures) headers['X-Departures'] = data.departures.length.toString();
//   if (data.arrivals) headers['X-Arrivals'] = data.arrivals.length.toString();
//   if (data.isOfflineMode) headers['X-Offline-Mode'] = 'true';

//   return NextResponse.json(data, {
//     status: 200,
//     headers,
//   });
// }

// app/api/flights/route.ts
// app/api/flights/route.ts
import { NextResponse } from 'next/server';
import { getCurrentFlightData } from '@/lib/flight-data-service';

export async function GET(): Promise<NextResponse> {
  try {
    const data = await getCurrentFlightData();
    const isCritical = data.error === 'All data sources unavailable.';
    const isEmergency = data.source === 'emergency' && !isCritical;
    const isBackupLike = data.source === 'backup' || data.source === 'auto-processed';

    const cacheControl = isCritical
      ? 'no-cache, no-store, must-revalidate'
      : isEmergency
        ? 'public, max-age=10, s-maxage=15, stale-while-revalidate=30'
        : isBackupLike
          ? 'public, max-age=15, s-maxage=30, stale-while-revalidate=30'
          : 'public, max-age=20, s-maxage=90, stale-while-revalidate=30';

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
  } catch (err) {
    // Krajnja zaštita: ako getCurrentFlightData() ili bilo šta iznad neočekivano
    // baci grešku (mrežni problem, parsiranje, Redis, itd.), ne rušimo funkciju
    // (što bi Vercel brojao kao Error) — vraćamo prazan ali validan odgovor
    // da checkin/gate/combined ekrani imaju šta da parsiraju i padnu na svoj
    // vlastiti fallback (cache/prazan prikaz) umjesto na network error.
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

// NAPOMENA: 'export const revalidate = 120' je namjerno UKLONJEN.
// Taj segment-level ISR postavka je u sukobu sa ručno postavljenim
// 'Cache-Control: no-store' u isCritical grani (Next.js baca
// "Invariant: invalid Cache-Control duration provided: 0 < 1"),
// što je bio pravi uzrok Error Rate skokova na ovoj ruti.
// Pošto svaki mogući ishod već ima svoj eksplicitan Cache-Control header
// gore, segment-level revalidate nije ni potreban.