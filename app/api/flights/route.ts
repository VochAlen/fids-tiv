// // app/api/flights/route.ts
// import { NextResponse } from 'next/server';
// import { getCurrentFlightDataSafe } from '@/lib/flight-data-service';
// import type { FlightData } from '@/types/flight';
// import { createHash } from 'crypto';

// export const dynamic = 'force-dynamic';
// export const maxDuration = 60;
// // export const revalidate = 60;

// export async function GET(request: Request): Promise<NextResponse> {
//   try {
//     const { searchParams } = new URL(request.url);
//     const type = searchParams.get('type');
//     const ifNoneMatch = request.headers.get('if-none-match');

//     // ── KRITIČNO: getCurrentFlightDataSafe() se UVIJEK poziva, bez
//     // ikakve prečice ispred nje. Ona sama interno provjerava TTL
//     // (in-process 60s, Redis 240s danju / 1h noću) i sama odlučuje da
//     // li treba svjež live fetch prema aerodromskom API-ju. Ako se ovaj
//     // poziv ikad preskoči (npr. zbog "laganog" ETag prečaca prije
//     // njega), Redis meta hash se zamrzne zauvijek na prvoj snimljenoj
//     // vrijednosti — sistem prestaje da osvježava podatke jer ništa
//     // više ne pokreće provjeru svježine. Ovaj poziv je već jeftin kad
//     // je cache svjež (samo Redis GET), pa nema potrebe za prečicom. ──
//     const data = await getCurrentFlightDataSafe();

//     // ── IZRAČUNAJ ETag na osnovu STVARNO dobijenih podataka ──────────
//     const hashPayload = {
//       dCount: data.departures?.length || 0,
//       aCount: data.arrivals?.length || 0,
//       source: data.source,
//       lastUpdated: data.lastUpdated,
//     };
//     const hash = createHash('md5')
//       .update(JSON.stringify(hashPayload))
//       .digest('hex')
//       .substring(0, 16);
//     const etag = `"${hash}"`;

//     // ── PROVJERI If-None-Match — TEK NAKON što je svježina provjerena ──
//     if (ifNoneMatch && ifNoneMatch === etag) {
//       return new NextResponse(null, {
//         status: 304,
//         headers: {
//           'ETag': etag,
//           'Cache-Control':
//             'public, max-age=30, s-maxage=60, stale-while-revalidate=120',
//           'CDN-Cache-Control':
//             'public, max-age=30, s-maxage=60, stale-while-revalidate=120',
//           'Vercel-CDN-Cache-Control':
//             'public, max-age=30, s-maxage=60, stale-while-revalidate=120',
//         },
//       });
//     }

//     // ── Filtriranje po smjeru ────────────────────────────────────
//     const responseData: FlightData =
//       type === 'departures'
//         ? { ...data, arrivals: [] }
//         : type === 'arrivals'
//         ? { ...data, departures: [] }
//         : data;

//     const isCritical = data.error === 'All data sources unavailable.';
//     const isEmergency = data.source === 'emergency' && !isCritical;
//     const isBackupLike = data.source === 'backup' || data.source === 'auto-processed';

//     const cacheControl = isCritical
//       ? 'no-cache, no-store, must-revalidate'
//       : isEmergency
//         ? 'public, max-age=15, s-maxage=20, stale-while-revalidate=40'
//         : isBackupLike
//           ? 'public, max-age=20, s-maxage=40, stale-while-revalidate=80'
//           : 'public, max-age=60, s-maxage=180, stale-while-revalidate=300';

//     const headers: Record<string, string> = {
//       'Cache-Control': cacheControl,
//       'CDN-Cache-Control': cacheControl,           // ← DODANO
//       'Vercel-CDN-Cache-Control': cacheControl,    // ← DODANO
//       'ETag': etag,
//       'X-Data-Source': data.source ?? 'unknown',
//       'X-Total-Flights': data.totalFlights.toString(),
//     };
//     if (responseData.departures) headers['X-Departures'] = responseData.departures.length.toString();
//     if (responseData.arrivals) headers['X-Arrivals'] = responseData.arrivals.length.toString();
//     if (data.isOfflineMode) headers['X-Offline-Mode'] = 'true';
//     if (type) headers['X-Filtered-By'] = type;

//     return NextResponse.json(responseData, { status: 200, headers });
//   } catch (err) {
//     console.error('[api/flights] Unhandled error:', err instanceof Error ? err.message : err);
//     return NextResponse.json(
//       {
//         departures: [],
//         arrivals: [],
//         totalFlights: 0,
//         lastUpdated: new Date().toISOString(),
//         source: 'emergency',
//         isOfflineMode: true,
//         error: 'Route handler caught unexpected error.',
//       },
//       { status: 200, headers: { 'Cache-Control': 'no-cache, no-store, must-revalidate' } }
//     );
//   }
// }



// app/api/flights/route.ts
import { NextResponse } from 'next/server';
import { getCurrentFlightDataSafe } from '@/lib/flight-data-service';
import type { FlightData } from '@/types/flight';
import { createHash } from 'crypto';
import { isNightHours, secondsUntilNightEnds } from '@/lib/night-hours';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type');
    const ifNoneMatch = request.headers.get('if-none-match');

    // ── KRITIČNO: getCurrentFlightDataSafe() se UVIJEK poziva, bez
    // ikakve prečice ispred nje. Ona sama interno provjerava TTL
    // (in-process 60s, Redis 240s danju / 1h noću) i sama odlučuje da
    // li treba svjež live fetch prema aerodromskom API-ju. Ako se ovaj
    // poziv ikad preskoči (npr. zbog "laganog" ETag prečaca prije
    // njega), Redis meta hash se zamrzne zauvijek na prvoj snimljenoj
    // vrijednosti — sistem prestaje da osvježava podatke jer ništa više
    // ne pokreće provjeru svježine. Ovaj poziv je već jeftin kad je
    // cache svjež (samo Redis GET), pa nema potrebe za prečicom.
    const data = await getCurrentFlightDataSafe();

    // ── IZRAČUNAJ ETag na osnovu STVARNO dobijenih podataka ──────────
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

    // ── NOĆNI REŽIM — provjeren JEDNOM, korišten i za 304 granu ispod
    // i za punu response granu. isNightHours() se poziva svježe (ne
    // data.isNightMode) jer ovdje odlučujemo o CDN TTL-u koji gleda
    // UNAPRIJED od trenutka odgovora — bitno je stvarno "sada" na
    // serveru, ne stanje u trenutku kad su podaci generisani (što može
    // biti do 1h unazad noću, zbog Redis keša).
    const nightNow = isNightHours();

    // ── DINAMIČKI NOĆNI TTL — ističe TAČNO na granici noć→dan ─────────
    // Backend (flight-data-service.ts) drži Redis keš 1h noću
    // (NIGHT_CACHE_TTL_SECONDS), i ima eksplicitnu zaštitu od jutarnjeg
    // prelaza (getCurrentFlightData provjerava `cached.isNightMode &&
    // !nightNow` i odbacuje stari noćni zapis čim padne dan) — ALI ta
    // zaštita se izvršava UNUTAR funkcije. Ako CDN servira odgovor
    // direktno sa ivice mreže (cache hit), zahtjev nikad ne stigne do
    // funkcije, pa se ta zaštita preskoči. Fiksni dug s-maxage bi značio
    // da CDN može servirati noćni odgovor kioscima i do 1h NAKON
    // stvarnog početka dana.
    //
    // Rješenje: secondsUntilNightEnds() vraća TAČAN broj sekundi do
    // kraja tekućeg noćnog prozora (iz night-hours.ts, ista IATA
    // sezonska logika koja određuje sam prozor). CDN TTL se postavlja
    // na taj broj — čim prozor istekne, CDN mora revalidirati, i
    // funkcija (koja zna za jutarnji prelaz) preuzima kontrolu odmah.
    //
    // Min/max limiti su zaštita, ne primarni mehanizam:
    //   - MIN (30s): sprečava degenerisan TTL blizu 0 tačno pred kraj
    //     prozora, što bi izazvalo nalet Function Invocations umjesto
    //     glatkog prelaza.
    //   - MAX (600s): gornja granica za slučaj neočekivane greške u
    //     izračunu (npr. secondsUntilNightEnds vrati iznenađujuće velik
    //     broj) — CDN nikad ne čeka duže od 10 min bez revalidacije,
    //     bez obzira šta se desi.
    //
    // NAPOMENA: ovo NE utiče na broj Edge Requests (CDN cache hit se
    // svejedno broji), samo na Function Invocations/Fluid CPU trošak.
    const NIGHT_CDN_MIN_S_MAXAGE = 30;
    const NIGHT_CDN_MAX_S_MAXAGE = 600;
    const NIGHT_CDN_SWR = 120; // kratak SWR rep — čim s-maxage istekne na granici, želimo brzu, ne odloženu, revalidaciju

    const computeNightSMaxAge = (): number => {
      const secondsLeft = secondsUntilNightEnds();
      // secondsLeft === null bi teorijski značilo da je isNightHours()
      // i secondsUntilNightEnds() nekonzistentni (ne bi smjelo da se
      // desi, obje čitaju isti window preko iste getWindowCached logike)
      // — siguran fallback na MIN vrijednost umjesto pucanja.
      if (secondsLeft === null) return NIGHT_CDN_MIN_S_MAXAGE;
      return Math.min(
        NIGHT_CDN_MAX_S_MAXAGE,
        Math.max(NIGHT_CDN_MIN_S_MAXAGE, secondsLeft)
      );
    };

    const nightSMaxAge = nightNow ? computeNightSMaxAge() : null;

    // ── PROVJERI If-None-Match — TEK NAKON što je svježina provjerena ──
    if (ifNoneMatch && ifNoneMatch === etag) {
      const cacheControl304 =
        nightNow && nightSMaxAge !== null
          ? `public, max-age=30, s-maxage=${nightSMaxAge}, stale-while-revalidate=${NIGHT_CDN_SWR}`
          : 'public, max-age=30, s-maxage=240, stale-while-revalidate=300';

      return new NextResponse(null, {
        status: 304,
        headers: {
          'ETag': etag,
          'Cache-Control': cacheControl304,
          'CDN-Cache-Control': cacheControl304,
          'Vercel-CDN-Cache-Control': cacheControl304,
        },
      });
    }

    // ── Filtriranje po smjeru ─────────────────────────────────────
    const responseData: FlightData =
      type === 'departures'
        ? { ...data, arrivals: [] }
        : type === 'arrivals'
          ? { ...data, departures: [] }
          : data;

    const isCritical = data.error === 'All data sources unavailable.';
    const isEmergency = data.source === 'emergency' && !isCritical;
    const isBackupLike =
      data.source === 'backup' || data.source === 'auto-processed';

    // ── CACHE STRATEGIJA ──────────────────────────────────────────
    //
    // LIVE (dan):
    //   Browser: 30s | Vercel CDN: 240s | Stale: 300s
    //   240s CDN TTL je namjerno usklađen sa
    //   FLIGHT_CACHE_TTL_SECONDS = 240 u flight-data-service.ts.
    //
    // LIVE/BACKUP (noć):
    //   Browser: 30s | Vercel CDN: DINAMIČKI (30-600s, ističe tačno na
    //   granici noć→dan) | Stale: 120s
    //   Vidi detaljno objašnjenje kod computeNightSMaxAge() iznad.
    //
    // BACKUP (dan):
    //   Browser: 20s | Vercel CDN: 240s | Stale: 300s
    //
    // EMERGENCY:
    //   Browser: 15s | Vercel CDN: 30s | Stale: 60s
    //   (kratko namjerno — sistem treba brzo da se oporavi/otkrije
    //   povratak live podataka)
    //
    // CRITICAL:
    //   Bez cache-a.
    const cacheControl = isCritical
      ? 'no-cache, no-store, must-revalidate'
      : isEmergency
        ? 'public, max-age=15, s-maxage=30, stale-while-revalidate=60'
        : nightNow && nightSMaxAge !== null
          ? `public, max-age=30, s-maxage=${nightSMaxAge}, stale-while-revalidate=${NIGHT_CDN_SWR}`
          : isBackupLike
            ? 'public, max-age=20, s-maxage=240, stale-while-revalidate=300'
            : 'public, max-age=30, s-maxage=240, stale-while-revalidate=300';

    const headers: Record<string, string> = {
      'Cache-Control': cacheControl,
      'CDN-Cache-Control': cacheControl,
      'Vercel-CDN-Cache-Control': cacheControl,
      'ETag': etag,
      'X-Data-Source': data.source ?? 'unknown',
      'X-Total-Flights': data.totalFlights.toString(),
      'X-Night-Mode': nightNow ? 'true' : 'false',
    };

    if (responseData.departures) {
      headers['X-Departures'] = responseData.departures.length.toString();
    }

    if (responseData.arrivals) {
      headers['X-Arrivals'] = responseData.arrivals.length.toString();
    }

    if (data.isOfflineMode) {
      headers['X-Offline-Mode'] = 'true';
    }

    if (type) {
      headers['X-Filtered-By'] = type;
    }

    return NextResponse.json(responseData, {
      status: 200,
      headers,
    });
  } catch (err) {
    console.error(
      '[api/flights] Unhandled error:',
      err instanceof Error ? err.message : err
    );

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
        headers: {
          'Cache-Control': 'no-cache, no-store, must-revalidate',
        },
      }
    );
  }
}