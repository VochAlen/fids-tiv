import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';

const requireAdmin = vi.fn();
vi.mock('@/lib/admin-auth', () => ({ requireAdmin: (...a: unknown[]) => requireAdmin(...a) }));

const redis = {
  ping: vi.fn(async () => 'PONG'),
  info: vi.fn(async () => '# Server\r\nredis_version:7.2.4\r\nuptime_in_seconds:3600\r\nconnected_clients:3\r\nused_memory:1048576\r\nmaxmemory:2097152\r\nkeyspace_hits:90\r\nkeyspace_misses:10\r\nevicted_keys:0\r\n'),
  dbsize: vi.fn(async () => 42),
  hgetall: vi.fn(async (_key?: string): Promise<Record<string, string>> => ({})),
  hlen: vi.fn(async () => 7),
};
vi.mock('@/lib/redis', () => ({
  getRedisClient: () => redis, isCircuitOpen: () => false, getCircuitFailureCount: () => 0,
}));
const ablyTime = vi.fn(async () => 123);
vi.mock('@/lib/ably-server', () => ({ getAblyRest: () => ({ time: ablyTime }) }));
const flights = vi.fn();
vi.mock('@/lib/flight-data-service', () => ({ getCurrentFlightDataSafe: () => flights() }));
vi.mock('@/lib/assignments-service', () => ({
  getRawAssignments: async () => ({
    ok: true,
    desks: { '3': { status: 'open', flightNumber: 'JU681', classType: null, setAt: Date.now() - 5 * 3_600_000, seq: 1 } },
    gates: { '5': { status: 'open', flightNumber: 'TK1085', classType: null, setAt: Date.now() - 10 * 60_000, seq: 1 } },
  }),
}));

import { GET } from './route';

describe('GET /api/admin/health', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ABLY_API_KEY = 'x.y:z';
    requireAdmin.mockResolvedValue({ session: { username: 'a' }, error: null });
    flights.mockResolvedValue({
      source: 'live', isOfflineMode: false, lastUpdated: new Date(Date.now() - 2 * 60_000).toISOString(),
      departures: [{}, {}], arrivals: [{}], warning: null,
    });
  });

  it('bez admin sesije vraća 401 i ne dira Redis', async () => {
    requireAdmin.mockResolvedValue({ session: null, error: NextResponse.json({ error: 'x' }, { status: 401 }) });
    const res = await GET();
    expect(res.status).toBe(401);
    expect(redis.ping).not.toHaveBeenCalled();
  });

  it('vraća Redis/Ably/letove/dodjele, zaglavljene dodjele i upozorenje', async () => {
    const body = await (await GET()).json();
    expect(body.checks.redis).toMatchObject({ ok: true, version: '7.2.4', keys: 42, hitRate: 0.9, connectedClients: 3 });
    expect(body.checks.ably).toMatchObject({ ok: true, configured: true });
    expect(body.checks.flightData).toMatchObject({ totalFlights: 3, departures: 2, arrivals: 1, ok: true });
    expect(body.checks.assignments.openDesks).toBe(1);
    expect(body.checks.assignments.openGates).toBe(1);
    expect(body.checks.assignments.staleAssignments).toHaveLength(1); // šalter 5 h > 4 h
    expect(body.status).toBe('degraded');
    expect(body.issues.some((i: { title: string }) => /otvoreno predugo/.test(i.title))).toBe(true);
    expect(body.checks.learning.exampleCount).toBe(7);
  });

  it('Ably pad → greška u issues; INFO zabranjen → Redis i dalje radi', async () => {
    ablyTime.mockRejectedValueOnce(new Error('network'));
    redis.info.mockRejectedValueOnce(new Error('NOPERM'));
    const body = await (await GET()).json();
    expect(body.checks.ably.ok).toBe(false);
    expect(body.checks.redis.ok).toBe(true);
    expect(body.checks.redis.version).toBeNull();
    expect(body.issues.some((i: { severity: string; title: string }) => i.severity === 'error' && /Ably/.test(i.title))).toBe(true);
  });

  it('Redis ping pada → status down', async () => {
    redis.ping.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const body = await (await GET()).json();
    expect(body.status).toBe('down');
    expect(body.checks.learning).toBeNull();
  });

  it('monitori: prijavljuje one koji se ne javljaju i one sa razlikom prema bazi, u issues i checks.kiosks', async () => {
    const now = Date.now();
    const rec = (o: Record<string, unknown>) => JSON.stringify({ view: 'idle', flight: '', build: 'dev', client: 'chrome', pageAgeSec: 100, err: '', seen: now - 60_000, ...o });
    redis.hgetall.mockImplementation(async (key?: string): Promise<Record<string, string>> => key === 'fids:kiosks' ? {
      'checkin-3': rec({ id: 'checkin-3' }),                              // šalter 3 je u bazi otvoren 5 h → razlika
      'checkin-9': rec({ id: 'checkin-9', seen: now - 40 * 60_000 }),     // ne javlja se 40 min
      'gate-5': rec({ id: 'gate-5', view: 'open', flight: 'TK1085' }),    // ok
    } : {});
    const body = await (await GET()).json();
    const byId = Object.fromEntries(body.checks.kiosks.map((k: { id: string; status: string }) => [k.id, k.status]));
    if (body.system.isNight) {
      expect(Object.values(byId).every(v => v === 'night')).toBe(true); // noću nema alarma zbog tišine
    } else {
      expect(byId['checkin-9']).toBe('silent');
      expect(byId['checkin-3']).toBe('mismatch');
      expect(byId['gate-5']).toBe('ok');
      expect(body.issues.some((i: { severity: string; title: string }) => i.severity === 'error' && i.title.includes('checkin-9'))).toBe(true);
      expect(body.issues.some((i: { severity: string; title: string }) => i.severity === 'warn' && i.title.includes('checkin-3'))).toBe(true);
    }
    expect(typeof body.system.build).toBe('string');
    redis.hgetall.mockImplementation(async () => ({}));
  });
});
