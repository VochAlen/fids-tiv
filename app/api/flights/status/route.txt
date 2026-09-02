// app/api/flights/status/route.ts
import { NextResponse } from 'next/server';
import { safeRedisGet } from '@/lib/redis';
import { getRawAssignments, buildSimpleMaps } from '@/lib/assignments-service';
import { createHash } from 'crypto';
import { isNightHours } from '@/lib/night-hours';

// ── force-dynamic OSTAJE. Next.js App Router može statički optimizovati
// rute koje ne pozivaju next/headers eksplicitno, čak i ako čitaju
// request.headers direktno — to ponašanje zna varirati po verziji. Bez
// ove linije, postoji realan rizik da Next.js zamrzne odgovor iz build
// trenutka i servira ga svim korisnicima zauvijek, što bi bilo tiho i
// katastrofalno pogrešno za rutu koja mora odražavati trenutni status
// leta/šaltera/gate-a. CDN keš (Cache-Control header ispod) i dalje radi
// normalno UZ force-dynamic — jedno ne isključuje drugo.
export const dynamic = 'force-dynamic';

const FLIGHT_META_KEY = 'cache:flights:meta';

// ── In-memory keš za Meta ──────────────────────────────────────
let cachedMeta: { hash?: string; count?: number; lastModified?: string; source?: string } | null = null;
let cachedMetaExpiry = 0;
const META_CACHE_TTL_MS = 15_000;

// ── In-memory keš za Assignments — raw i simple maps zajedno u jednom
// kešu, tako da deskEntries/gateEntries u finalnom odgovoru UVIJEK
// dolaze iz istog trenutka kao desks/gates mapa (bez ovoga bi jedno
// moglo biti svježije od drugog, ovisno o tajmingu). ──────────────────
let cachedAssignments: (ReturnType<typeof buildSimpleMaps> & { raw: Awaited<ReturnType<typeof getRawAssignments>> }) | null = null;
let cachedAssignmentsExpiry = 0;
const ASSIGNMENTS_CACHE_TTL_MS = 15_000;

// ── CDN keš — bezbjedan na 60s JER admin POST rute (/api/test/desk-status-override,
// /api/test/gate-status-override) eksplicitno zovu revalidateTag('flight-status')
// i probijaju keš ODMAH čim osoblje nešto promijeni. Sva tri Cache-Control
// varijanta se šalju dosljedno — CDN-Cache-Control i Vercel-CDN-Cache-Control
// ciljaju Vercel Edge specifično, sprečavajući da obični Cache-Control header
// (kojeg i browser tumači) zadrži stariji odgovor u browser kešu duže nego
// namjeravano.
// const CDN_CACHE_CONTROL = 'public, s-maxage=60, stale-while-revalidate=30';
const CDN_CACHE_CONTROL = 'public, s-maxage=15, stale-while-revalidate=10';
const CACHE_TAG = 'flight-status';

export async function GET(request: Request) {
  try {
    const now = Date.now();
    const nightNow = isNightHours();

    // ── 1. META KEŠ ────────────────────────────────────────────
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

    // ── 2. RAW ASSIGNMENTS + SIMPLE MAPS (keširani zajedno) ─────
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

    // ── 3. JEFTIN ETag ───────────────────────────────────────────
    const etagSource = `${meta.hash || 'x'}|${assignmentsFingerprint || 'none'}`;
    const etagHash = createHash('md5')
      .update(etagSource)
      .digest('hex')
      .substring(0, 16);
    const etag = `"${etagHash}"`;

    const ifNoneMatch = request.headers.get('if-none-match');
    if (ifNoneMatch && ifNoneMatch === etag) {
      return new NextResponse(null, {
        status: 304,
        headers: {
          'ETag': etag,
          'Cache-Control': CDN_CACHE_CONTROL,
          'CDN-Cache-Control': CDN_CACHE_CONTROL,
          'Vercel-CDN-Cache-Control': CDN_CACHE_CONTROL,
          'Cache-Tag': CACHE_TAG,
        },
      });
    }

    // ── 4. ODGOVOR ──────────────────────────────────────────────
    return NextResponse.json(
      {
        hash: meta.hash || null,
        count: meta.count || 0,
        lastModified: meta.lastModified || null,
        source: meta.source || 'unknown',
        timestamp: new Date().toISOString(),
        isNightMode: nightNow,
        desks,
        gates,
        deskEntries: rawAssignments.desks,
        gateEntries: rawAssignments.gates,
      },
      {
        headers: {
          'Cache-Control': CDN_CACHE_CONTROL,
          'CDN-Cache-Control': CDN_CACHE_CONTROL,
          'Vercel-CDN-Cache-Control': CDN_CACHE_CONTROL,
          'Cache-Tag': CACHE_TAG,
          'ETag': etag,
        },
      }
    );
  } catch (error) {
    console.error('Status endpoint error:', error);
    return NextResponse.json(
      {
        hash: null,
        count: 0,
        lastModified: null,
        source: 'error',
        timestamp: new Date().toISOString(),
        desks: {},
        gates: {},
        isNightMode: isNightHours(),
      },
      { status: 200, headers: { 'Cache-Control': 'no-cache' } }
    );
  }
}