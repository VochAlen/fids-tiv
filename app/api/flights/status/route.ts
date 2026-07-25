// app/api/flights/status/route.ts
import { NextResponse } from 'next/server';
import { getRedisClient } from '@/lib/redis';
import { getRawAssignments, buildSimpleMaps } from '@/lib/assignments-service';
import { createHash } from 'crypto';
import { isNightHours } from '@/lib/night-hours';

export const dynamic = 'force-dynamic';

const FLIGHT_META_KEY = 'cache:flights:meta';

let cachedMeta: { hash?: string; count?: number; lastModified?: string; source?: string } | null = null;
let cachedMetaExpiry = 0;
const CACHE_TTL_MS = 10_000;

// ── CDN cache prozor — usklađen sa tipičnim poll intervalom klijenata (~12-25s).
// Duži prozor = manje Function Invocations, ali sporija propagacija admin izmjena.
// 10s je dobar balans: max ~10s dodatnog kašnjenja iznad postojećeg client polla. ──
const CDN_CACHE_CONTROL = 'public, max-age=6, s-maxage=6, stale-while-revalidate=12';

export async function GET(request: Request) {
  try {
    const now = Date.now();
    const nightNow = isNightHours();

    let meta: { hash?: string; count?: number; lastModified?: string; source?: string };

    if (cachedMeta && now < cachedMetaExpiry) {
      meta = cachedMeta;
    } else {
      const client = getRedisClient();
      const raw = await client.get(FLIGHT_META_KEY);
      meta = raw ? JSON.parse(raw) : {};

      cachedMeta = {
        hash: meta.hash,
        count: meta.count || 0,
        lastModified: meta.lastModified,
        source: meta.source || 'unknown',
      };
      cachedMetaExpiry = now + CACHE_TTL_MS;
    }

    const rawAssignments = await getRawAssignments();
    const { desks, gates } = buildSimpleMaps(rawAssignments);

    const etagPayload = {
      hash: meta.hash || '',
      desks,
      gates,
      deskEntries: rawAssignments.desks,
      gateEntries: rawAssignments.gates,
    };
    const etagHash = createHash('md5')
      .update(JSON.stringify(etagPayload))
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
        },
      });
    }

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