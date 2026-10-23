import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';

const requireAdmin = vi.fn();
vi.mock('@/lib/admin-auth', () => ({ requireAdmin: (...a: unknown[]) => requireAdmin(...a) }));
const publish = vi.fn(async (_c: string, _e: string, _d: unknown): Promise<void> => {});
vi.mock('@/lib/ably-server', () => ({ publishToChannel: (c: string, e: string, d: unknown) => publish(c, e, d) }));

import { POST } from './route';

const req = (body: unknown) => new Request('http://x/api/admin/kiosk-command', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) });

describe('POST /api/admin/kiosk-command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAdmin.mockResolvedValue({ session: { username: 'a' }, error: null });
  });

  it('bez admin sesije 401 i ništa se ne objavljuje', async () => {
    requireAdmin.mockResolvedValue({ session: null, error: NextResponse.json({ error: 'x' }, { status: 401 }) });
    expect((await POST(req({ id: 'checkin-4', cmd: 'restart' }))).status).toBe(401);
    expect(publish).not.toHaveBeenCalled();
  });

  it('valjana komanda ide na flights:combined kao događaj kiosk-cmd (ne "update"), sa id-em, ts i nonce', async () => {
    const res = await POST(req({ id: 'Checkin-4', cmd: 'restart' }));
    expect(res.status).toBe(200);
    expect(publish).toHaveBeenCalledTimes(1);
    const [channel, event, data] = publish.mock.calls[0] as unknown as [string, string, { id: string; cmd: string; ts: number; nonce: string }];
    expect(channel).toBe('flights:combined');
    expect(event).toBe('kiosk-cmd');
    expect(event).not.toBe('update'); // postojeći klijenti slušaju samo 'update' i ovo ignorišu
    expect(data.id).toBe('checkin-4');
    expect(data.cmd).toBe('restart');
    expect(typeof data.ts).toBe('number');
    expect(data.nonce.length).toBeGreaterThan(3);
  });

  it('odbija nepoznat id, nepoznatu komandu i neispravan JSON', async () => {
    expect((await POST(req({ id: 'evil', cmd: 'restart' }))).status).toBe(400);
    expect((await POST(req({ id: 'checkin-4', cmd: 'rm -rf' }))).status).toBe(400);
    expect((await POST(req('not json'))).status).toBe(400);
    expect(publish).not.toHaveBeenCalled();
  });

  it('kad Ably padne vraća 502', async () => {
    publish.mockRejectedValueOnce(new Error('down'));
    expect((await POST(req({ id: 'gate-2', cmd: 'restart' }))).status).toBe(502);
  });
});
