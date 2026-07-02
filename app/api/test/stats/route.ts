import Redis from 'ioredis';
import { NextRequest, NextResponse } from 'next/server';

const getClient = () => new Redis(process.env.FIDS_REDIS_URL!);

export async function GET(req: NextRequest) {
  const date = req.nextUrl.searchParams.get('date')
             || new Date().toISOString().split('T')[0];
  const type = req.nextUrl.searchParams.get('type');
  const client = getClient();

  try {
    // ── Dodjele za departures board ──────────────────────
if (type === 'assignments') {
  const [deskKeys, gateKeys] = await Promise.all([
    client.keys('test:desk-status:*'),
    client.keys('test:gate-status:*'),
  ]);

  const sortIds = (ids: string[]) =>
    [...ids].sort((a, b) => {
      const na = parseInt(a, 10), nb = parseInt(b, 10);
      if (!isNaN(na) && !isNaN(nb)) return na - nb;
      return a.localeCompare(b);
    });

  const deskMap: Record<string, string[]> = {};
  const gateMap: Record<string, string[]> = {};

  if (deskKeys.length > 0) {
    const vals = await Promise.all(deskKeys.map(k => client.get(k)));
    deskKeys.forEach((key, i) => {
      try {
        const v = JSON.parse(vals[i] || '{}');
        if (v.flightNumber && v.status === 'open') {
          const deskId = key.replace('test:desk-status:', '');
          (deskMap[v.flightNumber] ??= []).push(deskId);
        }
      } catch {}
    });
  }

  if (gateKeys.length > 0) {
    const vals = await Promise.all(gateKeys.map(k => client.get(k)));
    gateKeys.forEach((key, i) => {
      try {
        const v = JSON.parse(vals[i] || '{}');
        if (v.flightNumber && v.status === 'open') {
          const gateId = key.replace('test:gate-status:', '');
          (gateMap[v.flightNumber] ??= []).push(gateId);
        }
      } catch {}
    });
  }

  const desks: Record<string, string> = {};
  const gates: Record<string, string> = {};
  Object.entries(deskMap).forEach(([fn, ids]) => { desks[fn] = sortIds(ids).join(', '); });
  Object.entries(gateMap).forEach(([fn, ids]) => { gates[fn] = sortIds(ids).join(', '); });

  return NextResponse.json({ desks, gates }, {
    headers: {
      'Cache-Control': 'public, s-maxage=20, stale-while-revalidate=20',
    },
  });
}

    // ── Dnevna statistika (nepromijenjeno) ───────────────
    const raw = await client.get(`tiv-daily-stats:${date}`);
    return NextResponse.json(raw ? JSON.parse(raw) : { desks: {}, gates: {} });

  } finally {
    client.disconnect();
  }
}

export async function POST(req: NextRequest) {
  const { action, type, resourceId, flight } = await req.json();
  const client = getClient();
  try {
    if (action === 'start') {
      await client.set(
        `tiv-stat-active:${type}:${resourceId}`,
        JSON.stringify({
          flight:      flight.FlightNumber,
          destination: flight.DestinationCityName || flight.DestinationAirportCode || '',
          assignedAt:  new Date().toISOString(),
        }),
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
      }
    }

    return NextResponse.json({ ok: true });
  } finally {
    client.disconnect();
  }
}
// na kraju app/api/test/stats/route.ts
export const revalidate = 20; // dodjele se rijetko mijenjaju u odnosu na 20s prozor