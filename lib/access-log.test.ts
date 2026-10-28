import { describe, it, expect } from 'vitest';
import { buildAccessEvent, parseAccessEvents } from '@/lib/access-log';
import { parseUserAgent } from '@/lib/ua-parse';

const W7 = 'Mozilla/5.0 (Windows NT 6.1; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/109.0.0.0 Safari/537.36';
const W11 = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0';
const AND = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';
const IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const ELEC = 'Mozilla/5.0 (Windows NT 6.1; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) fids/1.0 Chrome/109.0.5414.120 Electron/23.1.0 Safari/537.36';

describe('parseUserAgent', () => {
  it('Windows 7 + Chrome', () => expect(parseUserAgent(W7)).toEqual({ os: 'Windows 7', browser: 'Chrome 109', device: 'desktop' }));
  it('Windows 10/11 + Edge (Edge prije Chrome-a)', () => expect(parseUserAgent(W11)).toMatchObject({ os: 'Windows 10/11', browser: 'Edge 130' }));
  it('Android mobilni', () => expect(parseUserAgent(AND)).toEqual({ os: 'Android 14', browser: 'Chrome 130', device: 'mobile' }));
  it('iPhone Safari', () => expect(parseUserAgent(IOS)).toEqual({ os: 'iOS 17.5', browser: 'Safari 17', device: 'mobile' }));
  it('Electron prije Chrome-a', () => expect(parseUserAgent(ELEC)).toMatchObject({ os: 'Windows 7', browser: 'Electron 23' }));
  it('prazno → Nepoznat', () => expect(parseUserAgent('')).toEqual({ os: 'Nepoznat', browser: 'Nepoznat', device: 'desktop' }));
});

describe('buildAccessEvent', () => {
  it('uzima IP (zadnji XFF unos), državu i grad, ne upisuje lozinku', () => {
    const h = new Headers({ 'x-forwarded-for': '6.6.6.6, 85.10.20.30', 'x-vercel-ip-country': 'me', 'x-vercel-ip-city': 'Tivat', 'user-agent': W7 });
    const e = buildAccessEvent(h, 'login_ok', { u: 'bora' }, 123);
    expect(e).toMatchObject({ t: 123, e: 'login_ok', ip: '85.10.20.30', cc: 'ME', city: 'Tivat', os: 'Windows 7', br: 'Chrome 109', u: 'bora' });
  });
  it('bez zaglavlja: država ??, IP nepoznata; grad se dekodira', () => {
    const e = buildAccessEvent(new Headers({ 'x-vercel-ip-city': 'Nik%C5%A1i%C4%87' }), 'open', { p: '/admin/health' });
    expect(e).toMatchObject({ ip: 'nepoznata', cc: '??', p: '/admin/health' });
    expect(e.city).toBe('Nikšić');
  });
  it('parseAccessEvents preskače oštećene', () => {
    expect(parseAccessEvents(['{"t":1,"e":"open","ip":"1.1.1.1"}', 'x'])).toHaveLength(1);
  });
});
