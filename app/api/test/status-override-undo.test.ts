import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Fake Redis + mockovi (ruta se testira kroz POST, kao u produkciji) ─────────
const store = new Map<string, string>();
let seq = 0;
const afterJobs: Promise<unknown>[] = [];
const undoSpy = vi.fn(async () => true);
const recordSpy = vi.fn(async () => {});

vi.mock('@/lib/redis', () => {
  const client = {
    set: async (k: string, v: string, ..._a: unknown[]) => { if (_a.includes('NX') && store.has(k)) return null; store.set(k, v); return 'OK'; },
    eval: async (_s: string, _n: number, k: string) => { store.delete(k); return 1; },
    incr: async () => ++seq,
  };
  return {
    safeRedisGet: async (k: string) => store.get(k) ?? null,
    safeRedisGetStrict: async (k: string) => ({ ok: true, value: store.get(k) ?? null }),
    safeRedisSet: async (k: string, v: string) => { store.set(k, v); return true; },
    getRedisClient: () => client,
  };
});
vi.mock('@/lib/ably-server', () => ({ publishToChannel: vi.fn(async () => {}) }));
vi.mock('@/lib/admin-auth', () => ({ requireAdmin: vi.fn(async () => ({ session: { username: 'test' }, error: null })) }));
vi.mock('@/lib/assignments-service', () => ({ invalidateAssignmentsCache: vi.fn() }));
vi.mock('@/lib/assignment-learning-server', () => ({ recordAssignmentLearning: recordSpy, undoAssignmentLearning: undoSpy }));
vi.mock('next/server', async () => {
  const actual = await vi.importActual<typeof import('next/server')>('next/server');
  return { ...actual, after: (fn: () => unknown) => { afterJobs.push(Promise.resolve().then(fn)); } };
});

const flush = async () => { await Promise.all(afterJobs.splice(0)); };
const post = (route: { POST: (r: Request) => Promise<Response> }, body: unknown) =>
  route.POST(new Request('http://x/api', { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }));

beforeEach(() => { store.clear(); seq = 0; undoSpy.mockClear(); recordSpy.mockClear(); afterJobs.length = 0; });

describe.each([
  ['desk', 'deskNumber', () => import('./desk-status-override/route')],
  ['gate', 'gateNumber', () => import('./gate-status-override/route')],
] as const)('%s-status-override: poništavanje učenja pri brzom uklanjanju/zamjeni', (kind, idKey, load) => {
  const open = (route: Awaited<ReturnType<typeof load>>, id: string, flight: string) => post(route, { [idKey]: id, action: 'open', flightNumber: flight });

  it('prva dodjela uči; ne poništava ništa', async () => {
    const route = await load();
    expect((await open(route, '4', 'JU681')).status).toBe(200);
    await flush();
    expect(recordSpy).toHaveBeenCalledTimes(1);
    expect(undoSpy).not.toHaveBeenCalled();
  });

  it('clear postojeće dodjele → poništava učenje (sa letom i setAt)', async () => {
    const route = await load();
    await open(route, '4', 'JU681'); await flush(); recordSpy.mockClear();
    expect((await post(route, { [idKey]: '4', action: 'clear' })).status).toBe(200);
    await flush();
    expect(undoSpy).toHaveBeenCalledTimes(1);
    const arg = (undoSpy.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    expect(arg).toMatchObject({ kind, resourceId: '4', flightNumber: 'JU681' });
    expect(typeof arg.setAt).toBe('number');
    expect(recordSpy).not.toHaveBeenCalled();
  });

  it('clear na praznom resursu → ništa (nema šta da se poništi)', async () => {
    const route = await load();
    await post(route, { [idKey]: '9', action: 'clear' }); await flush();
    expect(undoSpy).not.toHaveBeenCalled();
  });

  it('zamjena leta na istom resursu → prvo poništi stari, tek onda upiše novi (redoslijed)', async () => {
    const route = await load();
    await open(route, '4', 'JU681'); await flush(); recordSpy.mockClear();
    const order: string[] = [];
    undoSpy.mockImplementationOnce(async () => { order.push('undo'); return true; });
    recordSpy.mockImplementationOnce(async () => { order.push('record'); });
    await open(route, '4', 'TK1085'); await flush();
    expect(order).toEqual(['undo', 'record']);
    expect((undoSpy.mock.calls[0] as unknown[])[0]).toMatchObject({ flightNumber: 'JU681' });
    expect((recordSpy.mock.calls[0] as unknown[])[0]).toMatchObject({ flightNumber: 'TK1085' });
  });

  it('ponovno otvaranje ISTOG leta (retry) ne uči dvaput i ne poništava', async () => {
    const route = await load();
    await open(route, '4', 'JU681'); await flush(); recordSpy.mockClear();
    await open(route, '4', 'JU681'); await flush();
    expect(recordSpy).not.toHaveBeenCalled();
    expect(undoSpy).not.toHaveBeenCalled();
  });

  it('setClass i closed ne diraju učenje', async () => {
    const route = await load();
    await open(route, '4', 'JU681'); await flush(); recordSpy.mockClear();
    await post(route, { [idKey]: '4', action: 'setClass', classType: 'BUSINESS' });
    await post(route, { [idKey]: '4', action: 'closed', flightNumber: 'JU681' });
    await flush();
    expect(undoSpy).not.toHaveBeenCalled();
    expect(recordSpy).not.toHaveBeenCalled();
  });
});
