// app/api/flights/status/route.ts
import { NextResponse } from 'next/server';
import { getRedisClient } from '@/lib/redis';
import { getRawAssignments, buildSimpleMaps } from '@/lib/assignments-service';
import { createHash } from 'crypto';
import { isNightHours } from '@/lib/night-hours';   // ← DODANO

export const revalidate = 45;

const FLIGHT_META_KEY = 'cache:flights:meta';

let cachedMeta: { hash?: string; count?: number; lastModified?: string; source?: string } | null = null;
let cachedMetaExpiry = 0;
const CACHE_TTL_MS = 10_000;

export async function GET(request: Request) {
  try {
    const now = Date.now();
    const nightNow = isNightHours();   // ← DODANO — jednom po requestu, pouzdan server sat

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

    // ── Dohvati dodjele ──────────────────────────────────────
    const rawAssignments = await getRawAssignments();
    const { desks, gates } = buildSimpleMaps(rawAssignments);

    // ── Izračunaj ETag (hash + dodjele + noćni status) ──────
    // isNightMode MORA biti u ETag payload-u — inače bi tranzicija
    // dan→noć (ili noć→dan) mogla ostati "zarobljena" iza 304 odgovora
    // sve dok se hash/desks/gates ne promijene iz nekog drugog razloga.
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

    // ── Provjeri If-None-Match ──────────────────────────────
    const ifNoneMatch = request.headers.get('if-none-match');
    if (ifNoneMatch && ifNoneMatch === etag) {
      return new NextResponse(null, {
        status: 304,
        headers: {
          'ETag': etag,
          'Cache-Control': 'private, no-cache',   // ← promijenjeno
        },
      });
    }

    // ── Normalan odgovor sa ETag ────────────────────────────
return NextResponse.json(
  {
    hash: meta.hash || null,
    count: meta.count || 0,
    lastModified: meta.lastModified || null,
    source: meta.source || 'unknown',
    timestamp: new Date().toISOString(),
    desks,
    gates,
    // ── Pune verzije (status/flightNumber/classType po broju šaltera/gate-a) —
    // potrebno GatePageClient.tsx-u za tačnu Redis-baziranu dodjelu,
    // ne samo pojednostavljenu flightNumber→broj mapu. ──────────
    deskEntries: rawAssignments.desks,
    gateEntries: rawAssignments.gates,
  },
  {
    headers: {
       'Cache-Control': 'private, no-cache',   // ← promijenjeno
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
        isNightMode: isNightHours(),   // ← DODANO — čak i u error grani, sigurnosti radi
      },
      { status: 200, headers: { 'Cache-Control': 'no-cache' } }
    );
  }
}