import { NextRequest, NextResponse } from 'next/server';
import { getRedisClient } from '@/lib/redis';

// ── IN-PROCESS CACHE (izbjegava Redis GET na svaki request) ──
type CacheEntry<T> = { data: T; expiry: number };
const CACHE_TTL_MS = 15_000; // 15s je dovoljno za admin panel

const assignmentsCache = new Map<string, CacheEntry<{ desks: Record<string, string>; gates: Record<string, string> }>>();
const dailyStatsCache  = new Map<string, CacheEntry<{ desks: Record<string, unknown>; gates: Record<string, unknown> }>>();

// TTL za "aktivnu" dodjelu — ako se 'end' akcija nikad ne pozove
// (browser se ugasi, override se očisti na drugi način, itd.), ključ
// sam istekne umjesto da zauvijek ostane u Redisu.
const ACTIVE_ASSIGNMENT_TTL_SECONDS = 24 * 60 * 60; // 24h — sigurna gornja granica

type DeskOrGateEntry = {
  status: 'open' | 'closed' | null;
  flightNumber: string;
  classType: string | null;
  setAt: number | null;
};

const sortIds = (ids: string[]) =>
  [...ids].sort((a, b) => {
    const na = parseInt(a, 10), nb = parseInt(b, 10);
    if (!isNaN(na) && !isNaN(nb)) return na - nb;
    return a.localeCompare(b);
  });

// ── Čita direktno iz jedan-ključ šeme (test:desk-status:all / test:gate-status:all) ──
async function readAssignments(): Promise<{ desks: Record<string, string>; gates: Record<string, string> }> {
  const cached = assignmentsCache.get('current');
  if (cached && Date.now() < cached.expiry) return cached.data;

  const client = getRedisClient();
  const [deskRaw, gateRaw] = await Promise.all([
    client.get('test:desk-status:all'),
    client.get('test:gate-status:all'),
  ]);

  const deskAll: Record<string, DeskOrGateEntry> = deskRaw ? JSON.parse(deskRaw) : {};
  const gateAll: Record<string, DeskOrGateEntry> = gateRaw ? JSON.parse(gateRaw) : {};

  const deskMap: Record<string, string[]> = {};
  const gateMap: Record<string, string[]> = {};

  for (const [deskId, entry] of Object.entries(deskAll)) {
    if (entry.flightNumber && entry.status === 'open') {
      (deskMap[entry.flightNumber] ??= []).push(deskId);
    }
  }
  for (const [gateId, entry] of Object.entries(gateAll)) {
    if (entry.flightNumber && entry.status === 'open') {
      (gateMap[entry.flightNumber] ??= []).push(gateId);
    }
  }

  const desks: Record<string, string> = {};
  const gates: Record<string, string> = {};
  Object.entries(deskMap).forEach(([fn, ids]) => { desks[fn] = sortIds(ids).join(', '); });
  Object.entries(gateMap).forEach(([fn, ids]) => { gates[fn] = sortIds(ids).join(', '); });

  const result = { desks, gates };
  assignmentsCache.set('current', { data: result, expiry: Date.now() + CACHE_TTL_MS });
  return result;
}

async function readDailyStats(date: string): Promise<{ desks: Record<string, unknown>; gates: Record<string, unknown> }> {
  const cached = dailyStatsCache.get(date);
  if (cached && Date.now() < cached.expiry) return cached.data;

  const client = getRedisClient();
  const raw = await client.get(`tiv-daily-stats:${date}`);
  const data = raw ? JSON.parse(raw) : { desks: {}, gates: {} };

  dailyStatsCache.set(date, { data, expiry: Date.now() + CACHE_TTL_MS });
  return data;
}

export async function GET(req: NextRequest) {
  const date = req.nextUrl.searchParams.get('date')
             || new Date().toISOString().split('T')[0];
  const type = req.nextUrl.searchParams.get('type');

  try {
    if (type === 'assignments') {
      const result = await readAssignments();
      return NextResponse.json(result, {
        headers: { 'Cache-Control': 'public, s-maxage=15, stale-while-revalidate=20' },
      });
    }

    const data = await readDailyStats(date);
    return NextResponse.json(data, {
      headers: { 'Cache-Control': 'public, s-maxage=15, stale-while-revalidate=20' },
    });
  } catch (err) {
    // Krajnja zaštita: Redis greška ne ruši funkciju kao 500 (što bi
    // Vercel brojao kao Error i uticalo na Error Rate) — vraćamo prazan
    // ali validan odgovor, isti princip kao u api/flights.
    console.error('[api/test/stats GET] Unhandled error:', err instanceof Error ? err.message : err);

    const fallback = type === 'assignments'
      ? { desks: {}, gates: {} }
      : { desks: {}, gates: {} };

    return NextResponse.json(fallback, {
      status: 200,
      headers: { 'Cache-Control': 'no-cache, no-store, must-revalidate' },
    });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { action, type, resourceId, flight } = await req.json();
    const client = getRedisClient();

    if (action === 'start') {
      await client.set(
        `tiv-stat-active:${type}:${resourceId}`,
        JSON.stringify({
          flight:      flight.FlightNumber,
          destination: flight.DestinationCityName || flight.DestinationAirportCode || '',
          assignedAt:  new Date().toISOString(),
        }),
        'EX', ACTIVE_ASSIGNMENT_TTL_SECONDS,
      );
    }

    if (action === 'end') {
      const raw = await client.get(`tiv-stat-active:${type}:${resourceId}`);
      if (raw) {
        const active  = JSON.parse(raw);
        const now     = new Date();
        const from    = new Date(active.assignedAt);
        const minutes = Math.max(1, Math.round((now.getTime() - from.getTime()) / 60_000));
        const fmt     = (d: Date) =>
          d.toLocaleTimeString('sr-Latn-RS', { hour: '2-digit', minute: '2-digit' });

        const today    = now.toISOString().split('T')[0];
        const statsKey = `tiv-daily-stats:${today}`;
        const existing = await client.get(statsKey);
        const data     = existing ? JSON.parse(existing) : { desks: {}, gates: {} };
        const group    = type === 'desk' ? data.desks : data.gates;

        if (!group[resourceId]) group[resourceId] = [];
        group[resourceId].push({
          flight:      active.flight,
          destination: active.destination,
          from:        fmt(from),
          to:          fmt(now),
          minutes,
        });

        await client.set(statsKey, JSON.stringify(data));
        await client.del(`tiv-stat-active:${type}:${resourceId}`);

        // Invalidiraj keš za današnji datum odmah, da admin panel vidi promjenu bez čekanja TTL-a
        dailyStatsCache.delete(today);
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[api/test/stats POST] Unhandled error:', err instanceof Error ? err.message : err);
    return NextResponse.json({ ok: false, error: 'Internal error' }, { status: 500 });
  }
}

// NAPOMENA: 'export const revalidate = 20' je namjerno UKLONJEN — isti
// razlog kao u api/flights. Ova ruta je inherentno dinamička (čita
// searchParams), i svaka grana već vraća eksplicitan Cache-Control
// header, pa je segment-level revalidate suvišan i rizičan (neusklađena
// vrijednost 20 vs s-maxage=15 je tačno obrazac koji je ranije izazvao
// "Invariant: invalid Cache-Control duration" grešku na /api/flights).