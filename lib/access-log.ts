// lib/access-log.ts
//
// Istorija pristupa admin dijelu: ko se prijavio / pokušao prijaviti / otvorio admin stranicu, sa koje IP adrese, iz koje
// države i grada, sa kojim operativnim sistemom i pregledačem. Čista logika (testirana); Redis I/O je u access-log-server.ts.
import { getClientIp } from '@/lib/get-client-ip';
import { parseUserAgent } from '@/lib/ua-parse';

export type AccessEventType = 'login_ok' | 'login_fail' | 'login_blocked' | 'open';

export interface AccessEvent {
  t: number;
  e: AccessEventType;
  ip: string;
  /** ISO država iz IP adrese (Vercel zaglavlje), npr. 'ME'. */
  cc: string;
  city: string;
  os: string;
  br: string;
  dev: 'mobile' | 'desktop';
  /** Korisničko ime — samo za prepoznate korisnike (nikad upisana lozinka ni nepoznato ime). */
  u?: string;
  /** Putanja stranice (za 'open'). */
  p?: string;
}

export const ACCESS_LOG_KEY = 'fids:access-log';
export const ACCESS_LOG_MAX = 2000;
export const ACCESS_LOG_TTL_SEC = 31 * 24 * 3600;   // 30 dana (+1 rezerva); i sam ključ ima istek pa ne ostaje trajno

const safeDecode = (s: string) => { try { return decodeURIComponent(s); } catch { return s; } };
const clean = (s: string, max: number) => s.replace(/[\u0000-\u001f\u007f<>"'`\\]/g, '').slice(0, max);

/** Iz zahtjeva pravi zapis (IP, država/grad iz Vercel zaglavlja, OS i pregledač iz User-Agent-a). */
export function buildAccessEvent(headers: Headers, e: AccessEventType, extra: { u?: string; p?: string } = {}, now: number = Date.now()): AccessEvent {
  const ua = parseUserAgent(headers.get('user-agent'), headers.get('sec-ch-ua-platform'));
  return {
    t: now,
    e,
    ip: clean(getClientIp(headers) ?? 'nepoznata', 45),
    cc: clean((headers.get('x-vercel-ip-country') ?? '').toUpperCase(), 2) || '??',
    city: clean(safeDecode(headers.get('x-vercel-ip-city') ?? ''), 40),
    os: ua.os,
    br: ua.browser,
    dev: ua.device,
    ...(extra.u ? { u: clean(extra.u, 40) } : {}),
    ...(extra.p ? { p: clean(extra.p, 80) } : {}),
  };
}

export function parseAccessEvents(raw: readonly string[]): AccessEvent[] {
  const out: AccessEvent[] = [];
  for (const r of raw) {
    try {
      const e = JSON.parse(r) as AccessEvent;
      if (e && typeof e.t === 'number' && typeof e.e === 'string' && typeof e.ip === 'string') out.push(e);
    } catch { /* oštećen unos se preskače */ }
  }
  return out;
}

export const EVENT_LABEL: Record<AccessEventType, string> = {
  login_ok: 'Prijava', login_fail: 'Neuspjela prijava', login_blocked: 'Blokiran (previše pokušaja)', open: 'Otvorena stranica',
};
