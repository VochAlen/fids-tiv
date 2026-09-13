// app/api/desk-status/[deskNumber]/route.ts
import { NextResponse } from 'next/server';
import { getRedisClient, safeRedisSet, safeRedisDel } from '@/lib/redis';

const TTL_SECONDS = 8 * 60 * 60; // 8h

// ── In-memory keš (isti obrazac kao u desk-status-override ruti) ──────────
// Cilj: smanjiti broj Redis poziva I omogućiti CDN/browser keširanje kroz
// Cache-Control header, umjesto dosadašnjeg 'no-store' na svaki zahtjev.
type CachedEntry = {
  status: string | null;
  flightNumber: string | null;
  setAt?: string;
};

const CACHE_TTL_MS = 5_000; // 5s — kratko, da promjene stižu skoro odmah
const cache = new Map<string, { data: CachedEntry; expiry: number }>();
const refreshing = new Set<string>();

async function readDeskStatus(deskNumber: string): Promise<CachedEntry> {
  const client = getRedisClient();
  const redisKey = `desk-status:${deskNumber}`;
  const value = await client.get(redisKey);

  if (!value) return { status: null, flightNumber: null };

  try {
    const data = JSON.parse(value);
    return {
      status: data.status,
      flightNumber: data.flightNumber ?? null,
      setAt: data.setAt,
    };
  } catch {
    // Stari format (samo string "open" / "closed")
    return { status: value, flightNumber: null };
  }
}

async function readDeskStatusCached(deskNumber: string): Promise<CachedEntry> {
  const now = Date.now();
  const cached = cache.get(deskNumber);

  // 1. Keš važi → vrati odmah, bez Redis poziva
  if (cached && now < cached.expiry) {
    return cached.data;
  }

  // 2. Keš ne važi, ali se već osvježava → vrati staru vrijednost (stale)
  if (refreshing.has(deskNumber) && cached) {
    return cached.data;
  }

  // 3. Osvježi (samo jedan zahtjev po deskNumber ulazi ovdje istovremeno)
  refreshing.add(deskNumber);
  try {
    const fresh = await readDeskStatus(deskNumber);
    cache.set(deskNumber, { data: fresh, expiry: now + CACHE_TTL_MS });
    return fresh;
  } finally {
    refreshing.delete(deskNumber);
  }
}

function invalidateCache(deskNumber: string, data: CachedEntry): void {
  cache.set(deskNumber, { data, expiry: Date.now() + CACHE_TTL_MS });
}

export async function GET(
  request: Request,
  { params }: { params: { deskNumber: string } }
) {
  try {
    const { deskNumber } = params;
    const entry = await readDeskStatusCached(deskNumber);

    return NextResponse.json(entry, {
      headers: {
        // Kratak public keš + stale-while-revalidate — CDN može da posluži
        // keširan odgovor umjesto da svaki poll ide do funkcije/Redisa.
        'Cache-Control': 'public, s-maxage=5, stale-while-revalidate=10',
      },
    });
  } catch (error) {
    console.error('[desk-status GET] Redis error:', error);
    return NextResponse.json(
      { status: null, flightNumber: null },
      { headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' } }
    );
  }
}

// ── POST ─────────────────────────────────────────────────────────────────────
// Body: { status: 'open' | 'closed' | null; flightNumber?: string | null }
export async function POST(
  request: Request,
  { params }: { params: { deskNumber: string } }
) {
  try {
    const { deskNumber } = params;
    const client = getRedisClient();
    const redisKey = `desk-status:${deskNumber}`;
    const body = await request.json();
    const { status, flightNumber = null } = body as {
      status: 'open' | 'closed' | null;
      flightNumber?: string | null;
    };

    // null status = clear override
    if (status === null) {
      await safeRedisDel(redisKey);
      invalidateCache(deskNumber, { status: null, flightNumber: null });
      return NextResponse.json({ ok: true, action: 'cleared' });
    }

    if (status !== 'open' && status !== 'closed') {
      return NextResponse.json(
        { error: 'status must be open, closed, or null' },
        { status: 400 }
      );
    }

    const setAt = new Date().toISOString();
    const payload = JSON.stringify({
      status,
      flightNumber: flightNumber ?? null,
      setAt,
    });
    await safeRedisSet(redisKey, payload, TTL_SECONDS);

    // Odmah osvježi keš da GET odmah nakon POST-a ne vrati staru vrijednost
    invalidateCache(deskNumber, { status, flightNumber: flightNumber ?? null, setAt });

    return NextResponse.json({
      ok: true,
      action: status,
      flightNumber: flightNumber ?? null,
    });
  } catch (error) {
    console.error('[desk-status POST] Redis error:', error);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}