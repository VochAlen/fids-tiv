import { describe, it, expect, vi, beforeEach } from 'vitest';

const requestToken = vi.fn();
vi.mock('@/lib/ably-server', () => ({ getAblyRest: () => ({ auth: { requestToken } }) }));
vi.mock('@/lib/redis', () => ({ getRedisClient: () => ({ incr: async () => 1, expire: async () => 1, ttl: async () => 60 }) }));

import { GET } from './route';

const call = (qs: string) => GET(new Request(`http://x/api/ably-token?${qs}`));

beforeEach(() => { requestToken.mockReset(); requestToken.mockResolvedValue({ token: 'tok', expires: Date.now() + 12 * 3600_000 }); });

describe('GET /api/ably-token', () => {
  it('nevažeća uloga → 400', async () => {
    expect((await call('role=hacker')).status).toBe(400);
  });
  it('vraća TokenDetails sa role-scoped capability i CDN kešom', async () => {
    const r = await call('role=gate');
    expect(r.status).toBe(200);
    expect((await r.json()).token).toBe('tok');
    expect(r.headers.get('cache-control')).toContain('s-maxage=600');
    expect(requestToken.mock.calls[0][0].capability).toEqual({ 'flights:combined': ['subscribe'], 'assignments:gates': ['subscribe'] });
  });
  it('drugi zahtjev iste uloge koristi token iz memorije (bez novog poziva ka Ably-ju)', async () => {
    await call('role=checkin'); await call('role=checkin');
    expect(requestToken).toHaveBeenCalledTimes(1);
  });
});