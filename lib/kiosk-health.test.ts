import { describe, it, expect } from 'vitest';
import { classifyKiosks, parseStoredKiosks, type OpenTruth } from './kiosk-health';
import type { StoredKiosk } from './kiosk-beacon';
import { dailyJitterMinutes, inDailyWindow } from '@/hooks/useKioskSupervisor';

const NOW = 1_800_000_000_000;
const k = (o: Partial<StoredKiosk>): StoredKiosk => ({
  id: 'checkin-4', view: 'idle', flight: '', build: 'B1', client: 'chrome', pageAgeSec: 3600, err: '', dataAgeSec: -1, canRestart: false, seen: NOW - 60_000, ...o,
});
const base = { now: NOW, night: false, minutesSinceDayStart: 600, currentBuild: 'B1' };
const open = (o: Partial<OpenTruth>): OpenTruth => ({ type: 'desk', resourceId: '4', flightNumber: 'JU681', openSinceMinutesAgo: 30, ...o });

describe('classifyKiosks', () => {
  it('svjež monitor bez dodjele je ok', () => {
    expect(classifyKiosks([k({})], [], base)[0].status).toBe('ok');
  });
  it('monitor koji se ne javlja >17 min je silent; noću nikad', () => {
    const old = k({ seen: NOW - 18 * 60_000 });
    expect(classifyKiosks([old], [], base)[0].status).toBe('silent');
    expect(classifyKiosks([old], [], { ...base, night: true, minutesSinceDayStart: null })[0].status).toBe('night');
  });
  it('odmah poslije kraja noći ima grejs period od 15 min', () => {
    const old = k({ seen: NOW - 5 * 3_600_000 });
    expect(classifyKiosks([old], [], { ...base, minutesSinceDayStart: 5 })[0].status).toBe('ok');
    expect(classifyKiosks([old], [], { ...base, minutesSinceDayStart: 20 })[0].status).toBe('silent');
  });
  it('idle monitor, a u bazi je dodjela otvorena davno prije izvještaja = mismatch (ovo je prijavljeni slučaj)', () => {
    const r = classifyKiosks([k({ view: 'idle' })], [open({})], base)[0];
    expect(r.status).toBe('mismatch');
    expect(r.expected).toBe('JU681');
  });
  it('prikazuje drugi let od onoga u bazi = mismatch; isti let (druga forma zapisa) = ok', () => {
    expect(classifyKiosks([k({ view: 'open', flight: 'TK1085' })], [open({})], base)[0].status).toBe('mismatch');
    expect(classifyKiosks([k({ view: 'open', flight: 'JU681' })], [open({ flightNumber: 'JU 681' })], base)[0].status).toBe('ok');
  });
  it('trka: dodjela otvorena TEK prije izvještaja nije mismatch', () => {
    expect(classifyKiosks([k({ view: 'idle' })], [open({ openSinceMinutesAgo: 1 })], base)[0].status).toBe('ok');
    expect(classifyKiosks([k({ view: 'idle', seen: NOW - 5 * 60_000 })], [open({ openSinceMinutesAgo: 6 })], base)[0].status).toBe('ok');
  });
  it('monitor koji se javlja, a podaci o letovima su stariji od 20 min = stale; svjež ili nepoznat = ok', () => {
    expect(classifyKiosks([k({ dataAgeSec: 21 * 60 })], [], base)[0].status).toBe('stale');
    expect(classifyKiosks([k({ dataAgeSec: 21 * 60 })], [], base)[0].dataAgeMin).toBe(21);
    expect(classifyKiosks([k({ dataAgeSec: 120 })], [], base)[0].status).toBe('ok');
    expect(classifyKiosks([k({ dataAgeSec: -1 })], [], base)[0].dataAgeMin).toBeNull();
  });
  it('loading nikad nije mismatch; gate-ovi se uparuju sa gate dodjelama', () => {
    expect(classifyKiosks([k({ view: 'loading' })], [open({})], base)[0].status).toBe('ok');
    const g = classifyKiosks([k({ id: 'gate-5', view: 'idle' })], [open({ type: 'gate', resourceId: '5', flightNumber: 'TK1085' })], base)[0];
    expect(g.status).toBe('mismatch');
    // šalter 5 nije gate 5
    expect(classifyKiosks([k({ id: 'gate-5', view: 'idle' })], [open({ type: 'desk', resourceId: '5' })], base)[0].status).toBe('ok');
  });
  it('stara verzija se označava, dev se ne poredi', () => {
    expect(classifyKiosks([k({ build: 'OLD' })], [], base)[0].buildCurrent).toBe(false);
    expect(classifyKiosks([k({ build: 'OLD' })], [], { ...base, currentBuild: 'dev' })[0].buildCurrent).toBe(true);
  });
  it('sortira: silent, mismatch, ok, night', () => {
    const list = classifyKiosks([
      k({ id: 'checkin-1' }), k({ id: 'checkin-2', seen: NOW - 20 * 60_000 }), k({ id: 'checkin-4', view: 'idle' }),
    ], [open({})], base);
    expect(list.map(x => x.status)).toEqual(['silent', 'mismatch', 'ok']);
  });
});

describe('parseStoredKiosks', () => {
  it('preskače oštećene unose', () => {
    const r = parseStoredKiosks({ a: JSON.stringify(k({})), b: '{broken', c: '{"id":1}' });
    expect(r).toHaveLength(1);
  });
});

describe('dnevni samoreload', () => {
  it('pomak je stabilan i u opsegu 0–20; prozor traje 10 min od 04:00 + pomak', () => {
    const j = dailyJitterMinutes('checkin-4');
    expect(j).toBeGreaterThanOrEqual(0); expect(j).toBeLessThanOrEqual(20);
    expect(dailyJitterMinutes('checkin-4')).toBe(j);
    const start = 240 + j;
    expect(inDailyWindow(start - 1, 'checkin-4')).toBe(false);
    expect(inDailyWindow(start, 'checkin-4')).toBe(true);
    expect(inDailyWindow(start + 9, 'checkin-4')).toBe(true);
    expect(inDailyWindow(start + 10, 'checkin-4')).toBe(false);
  });
});
