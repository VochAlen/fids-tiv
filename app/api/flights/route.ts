// app/api/flights/route.ts
import { NextResponse } from 'next/server';
import { getCurrentFlightDataSafe } from '@/lib/flight-data-service';
import type { FlightData } from '@/types/flight';
import { createHash } from 'crypto';
import { safeRedisGet } from '@/lib/redis';
import { getRawAssignments, buildSimpleMaps } from '@/lib/assignments-service';
import { isNightHours } from '@/lib/night-hours';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const FLIGHT_META_KEY = 'cache:flights:meta';

// ── In-memory keš za Meta (preuzeto iz starog /api/flights/status) ──
let cachedMeta: { hash?: string; count?: number; lastModified?: string; source?: string } | null = null;
let cachedMetaExpiry = 0;
const META_CACHE_TTL_MS = 15_000;

// ── In-memory keš za Assignments — raw i simple maps zajedno, da desks/gates
// i deskEntries/gateEntries u finalnom odgovoru UVIJEK dolaze iz istog
// trenutka (preuzeto iz starog /api/flights/status). ──────────────────
let cachedAssignments: (ReturnType<typeof buildSimpleMaps> & { raw: Awaited<ReturnType<typeof getRawAssignments>> }) | null = null;
let cachedAssignmentsExpiry = 0;
const ASSIGNMENTS_CACHE_TTL_MS = 15_000;

// ── CDN keš — PODIGNUT sa 15s na 45s (optimizacija Edge Requests/CPU).
// Admin POST rute (/api/test/desk-status-override, /api/test/gate-status-override)
// i dalje zovu revalidateTag('flight-status') i probijaju keš ODMAH čim
// osoblje nešto promijeni — s-maxage je samo fallback gornja granica za
// redovno osvježavanje rasporeda letova (koje se dešava na nivou minuta,
// ne sekundi). Svi klijenti (gate/checkin/departures/combined) sad polluju
// na 30-90s+ intervalima (nakon ranijih fix-eva), što je iznad ovog TTL-a
// pa i dalje svaki od njih redovno dobija svjež odgovor — samo se broj
// STVARNIH function invocation-a (CPU) na ovoj najprometnijoj ruti smanjuje
// otprilike 3x, jer više zahtjeva unutar istog prozora dijeli isti CDN cache.
const CDN_CACHE_CONTROL = 'public, s-maxage=45, stale-while-revalidate=30';
const CACHE_TAG = 'flight-status';

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type');
    const ifNoneMatch = request.headers.get('if-none-match');
    const now = Date.now();
    const nightNow = isNightHours();

    // ── 1. LETOVI — UVIJEK se poziva, bez prečice ispred (isti razlog kao
    // ranije: getCurrentFlightDataSafe() sama odlučuje da li treba svjež
    // fetch; preskakanje ovog poziva bi zamrznulo podatke zauvijek). ──
    const data = await getCurrentFlightDataSafe();

    // ── 2. META (desk/gate meta hash) ────────────────────────────
    let meta: { hash?: string; count?: number; lastModified?: string; source?: string };
    if (cachedMeta && now < cachedMetaExpiry) {
      meta = cachedMeta;
    } else {
      const raw = await safeRedisGet(FLIGHT_META_KEY);
      try {
        meta = raw ? JSON.parse(raw) : {};
      } catch {
        meta = {};
      }
      cachedMeta = {
        hash: meta.hash,
        count: meta.count || 0,
        lastModified: meta.lastModified,
        source: meta.source || 'unknown',
      };
      cachedMetaExpiry = now + META_CACHE_TTL_MS;
    }

    // ── 3. RAW ASSIGNMENTS + SIMPLE MAPS ─────────────────────────
    let rawAssignments: Awaited<ReturnType<typeof getRawAssignments>>;
    let desks: ReturnType<typeof buildSimpleMaps>['desks'];
    let gates: ReturnType<typeof buildSimpleMaps>['gates'];
    let assignmentsFingerprint: ReturnType<typeof buildSimpleMaps>['fingerprint'];

    if (cachedAssignments && now < cachedAssignmentsExpiry) {
      rawAssignments = cachedAssignments.raw;
      desks = cachedAssignments.desks;
      gates = cachedAssignments.gates;
      assignmentsFingerprint = cachedAssignments.fingerprint;
    } else {
      rawAssignments = await getRawAssignments();
      const simple = buildSimpleMaps(rawAssignments);
      desks = simple.desks;
      gates = simple.gates;
      assignmentsFingerprint = simple.fingerprint;
      cachedAssignments = { ...simple, raw: rawAssignments };
      cachedAssignmentsExpiry = now + ASSIGNMENTS_CACHE_TTL_MS;
    }

    // ── 4. KOMBINOVANI ETag — mijenja se ako se promijeni BILO raspored
    // letova (dCount/aCount/source/lastUpdated) ILI desk/gate dodjela
    // (meta.hash + assignmentsFingerprint). Jedan ETag pokriva sve. ──
    const hashPayload = {
      dCount: data.departures?.length || 0,
      aCount: data.arrivals?.length || 0,
      source: data.source,
      lastUpdated: data.lastUpdated,
      metaHash: meta.hash || 'x',
      assignments: assignmentsFingerprint || 'none',
    };
    const hash = createHash('md5')
      .update(JSON.stringify(hashPayload))
      .digest('hex')
      .substring(0, 16);
    const etag = `"${hash}"`;

// ============================================================
// PATCH za app/api/flights/route.ts
// Zamijeni ovaj blok (unutar GET funkcije, prije provjere ETag-a):
// ============================================================
 
    const responseHeadersBase: Record<string, string> = {
      'Cache-Control': CDN_CACHE_CONTROL,
      'CDN-Cache-Control': CDN_CACHE_CONTROL,
      'Vercel-CDN-Cache-Control': CDN_CACHE_CONTROL,
      'Cache-Tag': CACHE_TAG,
      // ← NOVO: ovo je ime header-a koje Vercel CDN stvarno prepoznaje
      // za tag-based invalidaciju (revalidateTag / invalidateByTag).
      // Stari 'Cache-Tag' ostaje radi kompatibilnosti, ali sam po sebi
      // ne pokreće purge na Vercel-ovom CDN sloju.
      'Vercel-Cache-Tag': CACHE_TAG,
      'ETag': etag,
    };
 

    // ── 5. PROVJERI If-None-Match — TEK NAKON što je svježina provjerena ──
    if (ifNoneMatch && ifNoneMatch === etag) {
      return new NextResponse(null, { status: 304, headers: responseHeadersBase });
    }

    // ── 6. Filtriranje letova po smjeru (isto kao ranije) ────────
    const responseData: FlightData =
      type === 'departures'
        ? { ...data, arrivals: [] }
        : type === 'arrivals'
        ? { ...data, departures: [] }
        : data;

    const isCritical = data.error === 'All data sources unavailable.';

    const headers: Record<string, string> = isCritical
      ? { ...responseHeadersBase, 'Cache-Control': 'no-cache, no-store, must-revalidate' }
      : { ...responseHeadersBase };

    headers['X-Data-Source'] = data.source ?? 'unknown';
    headers['X-Total-Flights'] = data.totalFlights.toString();
    if (responseData.departures) headers['X-Departures'] = responseData.departures.length.toString();
    if (responseData.arrivals) headers['X-Arrivals'] = responseData.arrivals.length.toString();
    if (data.isOfflineMode) headers['X-Offline-Mode'] = 'true';
    if (type) headers['X-Filtered-By'] = type;

    // ── 7. ODGOVOR — spojena struktura: podaci o letovima (kao ranije)
    // + desk/gate status (ranije samo u /api/flights/status). ──
    return NextResponse.json(
      {
        ...responseData,
        // Polja preuzeta iz starog /api/flights/status:
        hash: meta.hash || null,
        count: meta.count || 0,
        lastModified: meta.lastModified || null,
        timestamp: new Date().toISOString(),
        isNightMode: nightNow,
        desks,
        gates,
        deskEntries: rawAssignments.desks,
        gateEntries: rawAssignments.gates,
      },
      { status: 200, headers }
    );
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
        // Fallback za desk/gate polja da kiosk-strana ne puca na undefined
        hash: null,
        count: 0,
        lastModified: null,
        timestamp: new Date().toISOString(),
        isNightMode: isNightHours(),
        desks: {},
        gates: {},
        deskEntries: {},
        gateEntries: {},
      },
      { status: 200, headers: { 'Cache-Control': 'no-cache, no-store, must-revalidate' } }
    );
  }
}