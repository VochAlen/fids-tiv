// app/api/flights/status/route.ts
import { NextResponse } from 'next/server';
import { safeRedisGet } from '@/lib/redis';
import { getRawAssignments, buildSimpleMaps } from '@/lib/assignments-service';
import { createHash } from 'crypto';
import { isNightHours } from '@/lib/night-hours';

export const dynamic = 'force-dynamic';
export const revalidate = 20;

const FLIGHT_META_KEY = 'cache:flights:meta';

let cachedMeta: { hash?: string; count?: number; lastModified?: string; source?: string } | null = null;
let cachedMetaExpiry = 0;
const CACHE_TTL_MS = 10_000;

// ── CDN cache prozor — usklađen sa tipičnim poll intervalom klijenata (~12-25s).
// Duži prozor = manje Function Invocations, ali sporija propagacija admin izmjena.
// 10s je dobar balans: max ~10s dodatnog kašnjenja iznad postojećeg client polla. ──

const CDN_CACHE_CONTROL = 'public, max-age=20, s-maxage=20, stale-while-revalidate=15';// umjesto stale-while-revalidate=12 → najgori slučaj sad ~10s, ne ~18s
export async function GET(request: Request) {
  try {
    const now = Date.now();
    const nightNow = isNightHours();

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
      cachedMetaExpiry = now + CACHE_TTL_MS;
    }

    const rawAssignments = await getRawAssignments();
    const { desks, gates, fingerprint: assignmentsFingerprint } = buildSimpleMaps(rawAssignments);

    // ── JEFTIN ETag ─────────────────────────────────────────────
    // Ranije: JSON.stringify() nad { hash, desks, gates, deskEntries,
    // gateEntries } (puno ugniježđeno stablo, do ~48 desk/gate unosa
    // sa po 4 polja) + MD5 nad tim — na SVAKI request, čak i onaj koji
    // rezultuje 304. To je bilo skupo iz tri razloga:
    //   1) desks/gates su izvedeni iz deskEntries/gateEntries — hešuju
    //      se i sirovi podaci i njihov derivat, iako derivat ne nosi
    //      dodatnu informaciju o promjeni.
    //   2) JSON.stringify hoda kroz ugniježđeno stablo i escape-uje
    //      stringove — skuplje od rada sa već-ravnim stringom.
    //   3) buildSimpleMaps() već računa fingerprint interno (za svoju
    //      memoization provjeru) — prije se taj rad bacao i računao
    //      iznova, drugačijim (skupljim) putem.
    // Sad: samo konkatenacija dva već gotova, jeftina identifikatora
    // (meta.hash i assignmentsFingerprint), pa MD5 nad kratkim
    // ravnim stringom umjesto nad serijalizovanim stablom. Isti nivo
    // korektnosti — svaka promjena u raw assignments mijenja
    // fingerprint, svaka promjena u flight meta mijenja hash — samo
    // bez nepotrebnog JSON.stringify i duplog hešovanja izvedenih
    // podataka.
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