import { describe, it, expect, vi, beforeEach } from 'vitest';

const store: { ok: boolean; value: string | null } = { ok: true, value: null };
vi.mock('@/lib/redis', () => ({ safeRedisGetStrict: async () => store }));

import { GET } from './route';

const call = (qs: string) => GET(new Request(`http://x/api/test/assignment-truth?${qs}`));

beforeEach(() => { store.ok = true; store.value = null; });

describe('GET /api/test/assignment-truth', () => {
  it('loši parametri → 400', async () => {
    expect((await call('type=foo&key=1')).status).toBe(400);
    expect((await call('type=desk&key=../x')).status).toBe(400);
  });
  it('vraća unos i no-store', async () => {
    store.value = JSON.stringify({ '5': { status: 'open', flightNumber: 'JU1', seq: 9, setAt: 1, classType: null } });
    const r = await call('type=desk&key=5');
    const j = await r.json();
    expect(j.ok).toBe(true);
    expect(j.entry.flightNumber).toBe('JU1');
    expect(r.headers.get('cache-control')).toContain('no-store');
  });
  it('nema unosa → entry null', async () => {
    expect((await (await call('type=gate&key=7')).json()).entry).toBeNull();
  });
  it('Redis nepouzdan ili korumpiran JSON → ok:false (klijent ignoriše)', async () => {
    store.ok = false;
    expect((await (await call('type=desk&key=5')).json()).ok).toBe(false);
    store.ok = true; store.value = '{nije json';
    expect((await (await call('type=desk&key=5')).json()).ok).toBe(false);
  });
});
