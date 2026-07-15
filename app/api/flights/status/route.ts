// app/api/flights/status/route.ts
import { NextResponse } from 'next/server';
import { getRedisClient } from '@/lib/redis';
import { getRawAssignments, buildSimpleMaps } from '@/lib/assignments-service';

export const revalidate = 45;

const FLIGHT_META_KEY = 'cache:flights:meta';

let cachedMeta: { hash?: string; count?: number; lastModified?: string; source?: string } | null = null;
let cachedMetaExpiry = 0;
const CACHE_TTL_MS = 20_000;

export async function GET() {
  try {
    const now = Date.now();

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

    // ── NOVO: dodjele šaltera/gate-ova idu u ISTI odgovor — koristi
    // isti 10s in-process keš kao /api/test/assignments, tako da ovo
    // NE dodaje mjerljiv trošak, a FlightBoard više nikad ne mora
    // zvati /api/test/assignments posebno. ──────────────────────────
    const rawAssignments = await getRawAssignments();
    const { desks, gates } = buildSimpleMaps(rawAssignments);

    return NextResponse.json({
      hash: meta.hash || null,
      count: meta.count || 0,
      lastModified: meta.lastModified || null,
      source: meta.source || 'unknown',
      timestamp: new Date().toISOString(),
      desks,
      gates,
            gateEntries: rawAssignments.gates, // ← NOVO: puni gate zapisi (status, classType, setAt) po broju gate-a

    }, {
      headers: { 'Cache-Control': 'public, max-age=20, s-maxage=45, stale-while-revalidate=30' },
    });

  } catch (error) {
    console.error('Status endpoint error:', error);
    return NextResponse.json({
      hash: null, count: 0, lastModified: null, source: 'error',
      timestamp: new Date().toISOString(), desks: {}, gates: {},
    }, { status: 200, headers: { 'Cache-Control': 'no-cache' } });
  }
}