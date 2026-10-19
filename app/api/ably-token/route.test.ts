import { describe, it, expect, vi, beforeEach } from 'vitest';

const requestToken = vi.fn();
const createTokenRequest = vi.fn();
vi.mock('@/lib/ably-server', () => ({ getAblyRest: () => ({ auth: { requestToken, createTokenRequest } }) }));
vi.mock('@/lib/redis', () => ({ getRedisClient: () => ({ incr: async () => 1, expire: async () => 1, ttl: async () => 60 }) }));

import { GET } from './route';

const call = (qs: string) => GET(new Request(`http://x/api/ably-token?${qs}`));

beforeEach(() => { requestToken.mockReset(); createTokenRequest.mockReset(); createTokenRequest.mockResolvedValue({ keyName: 'k', nonce: 'n', mac: 'm' }); requestToken.mockResolvedValue({ token: 'tok', issued: Date.now(), expires: Date.now() + 12 * 3600_000 }); });

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

  it('neispravan TokenDetails (bez token/issued) → fallback na TokenRequest, bez keširanja', async () => {
    requestToken.mockResolvedValue({ expires: Date.now() + 12 * 3600_000 });
    const r = await call('role=arrivals');
    expect(createTokenRequest).toHaveBeenCalledTimes(1);
    expect((await r.json()).keyName).toBe('k');
    expect(r.headers.get('cache-control')).toBe('no-store');
  });

  it('requestToken baci grešku → fallback na TokenRequest (ne 500)', async () => {
    requestToken.mockRejectedValue(new Error('ably down'));
    const r = await call('role=board');
    expect(r.status).toBe(200);
    expect(createTokenRequest).toHaveBeenCalledTimes(1);
  });
});
