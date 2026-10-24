import { describe, it, expect, vi, beforeEach } from 'vitest';

const hset = vi.fn(async () => 1);
let circuit = false;
vi.mock('@/lib/redis', () => ({ getRedisClient: () => ({ hset }), isCircuitOpen: () => circuit }));

import { parseBeacon, KIOSK_HASH_KEY } from './kiosk-beacon';
import { recordKioskBeacon } from './kiosk-beacon-server';

const q = (s: string) => new URLSearchParams(s);

describe('parseBeacon', () => {
  it('prihvata valjan izvještaj i normalizuje polja', () => {
    const r = parseBeacon(q('k=checkin-4&s=open&f=ju681&b=dpl_abc&u=e&a=125.6&e=console.error%3A%20boom'));
    expect(r).toEqual({ id: 'checkin-4', view: 'open', flight: 'JU681', build: 'dpl_abc', client: 'electron', pageAgeSec: 126, err: 'console.error: boom', dataAgeSec: -1, entry: '', canRestart: false });
    expect(parseBeacon(q('k=checkin-4&r=1'))!.canRestart).toBe(true);
  });
  it('odbija nepoznat id (zaštita prostora ključeva)', () => {
    expect(parseBeacon(q('k=evil-1&s=idle'))).toBeNull();
    expect(parseBeacon(q('k=checkin-4444444&s=idle'))).toBeNull();
    expect(parseBeacon(q('k=../../x&s=idle'))).toBeNull();
    expect(parseBeacon(q(''))).toBeNull();
  });
  it('odbija nevaljan broj leta, nepoznato stanje postaje "other"', () => {
    expect(parseBeacon(q('k=gate-2&f=<script>'))).toBeNull();
    expect(parseBeacon(q('k=gate-2&s=hack'))?.view).toBe('other');
  });
  it('čisti opasne znakove u poruci greške i skraćuje je', () => {
    const r = parseBeacon(q('k=gate-2&e=' + encodeURIComponent('<b>"x"</b>' + 'a'.repeat(200))));
    expect(r!.err).not.toMatch(/[<>"]/);
    expect(r!.err.length).toBeLessThanOrEqual(80);
  });
  it('nevaljani brojevi starosti postaju 0, klijent default je chrome', () => {
    const r = parseBeacon(q('k=checkin-1&a=abc'))!;
    expect(r.pageAgeSec).toBe(0);
    expect(r.client).toBe('chrome');
  });
});

describe('recordKioskBeacon', () => {
  beforeEach(() => { vi.clearAllMocks(); circuit = false; });
  it('upisuje JSON u hash pod id-em monitora (jedna komanda)', async () => {
    await recordKioskBeacon(q('k=checkin-4&s=idle'));
    expect(hset).toHaveBeenCalledTimes(1);
    const [key, field, val] = hset.mock.calls[0] as unknown as [string, string, string];
    expect(key).toBe(KIOSK_HASH_KEY);
    expect(field).toBe('checkin-4');
    const parsed = JSON.parse(val);
    expect(parsed.view).toBe('idle');
    expect(typeof parsed.seen).toBe('number');
  });
  it('ne radi ništa za nevaljan izvještaj ili otvoren circuit breaker', async () => {
    await recordKioskBeacon(q('k=nope'));
    circuit = true;
    await recordKioskBeacon(q('k=checkin-4'));
    expect(hset).not.toHaveBeenCalled();
  });
  it('nikad ne baca grešku ni kad Redis padne', async () => {
    hset.mockRejectedValueOnce(new Error('down'));
    await expect(recordKioskBeacon(q('k=checkin-4'))).resolves.toBeUndefined();
  });
});
