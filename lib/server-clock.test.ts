import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { noteServerDate, nowMs, getClockOffsetMs, __resetServerClock, CLOCK_SKEW_WARN_MS } from './server-clock';

beforeEach(() => __resetServerClock());
afterEach(() => { vi.useRealTimers(); });

describe('server-clock', () => {
  it('bez uzorka nowMs ≈ Date.now()', () => {
    expect(Math.abs(nowMs() - Date.now())).toBeLessThan(50);
  });

  it('računar kasni 3 h → offset ≈ +3 h i nowMs ispravlja', () => {
    const real = Date.parse('2026-10-16T12:00:10Z');
    const localSent = real - 3 * 3_600_000 - 200;
    noteServerDate(new Date(real).toUTCString(), localSent, localSent + 400);
    expect(Math.abs(getClockOffsetMs() - 3 * 3_600_000)).toBeLessThan(1_500);
    expect(getClockOffsetMs()).toBeGreaterThan(CLOCK_SKEW_WARN_MS);
  });

  it('računar žuri 25 min → negativan offset', () => {
    const real = Date.parse('2026-10-16T12:00:00Z');
    const localSent = real + 25 * 60_000;
    noteServerDate(new Date(real).toUTCString(), localSent, localSent + 100);
    expect(getClockOffsetMs()).toBeLessThan(-24 * 60_000);
  });

  it('uzorak sa najmanjim RTT-om pobjeđuje', () => {
    const real = Date.parse('2026-10-16T12:00:00Z');
    noteServerDate(new Date(real).toUTCString(), real - 60_000, real - 60_000 + 4_000); // spor, grub
    const exact = real - 120_000;
    noteServerDate(new Date(real).toUTCString(), exact, exact + 40);                    // brz, tačan
    expect(Math.abs(getClockOffsetMs() - 120_000)).toBeLessThan(1_500);
  });

  it('ignoriše nevažeće zaglavlje i sumnjiv RTT', () => {
    noteServerDate(null, 0, 10);
    noteServerDate('nije datum', 0, 10);
    noteServerDate(new Date().toUTCString(), 1000, 500);      // negativan RTT
    noteServerDate(new Date().toUTCString(), 0, 20_000);      // preveliki RTT
    expect(getClockOffsetMs()).toBe(0);
  });
});

import { airportTimeToMs, isNightHours } from './night-hours';

describe('airportTimeToMs / isNightHours sa ispravljenim satom', () => {
  it('HH:MM u zoni aerodroma (CEST = UTC+2 u oktobru prije 25.10.)', () => {
    const now = Date.parse('2026-10-16T10:00:00Z'); // 12:00 Podgorica
    expect(airportTimeToMs(14, 30, now)).toBe(Date.parse('2026-10-16T12:30:00Z'));
  });
  it('više od 3 h u prošlosti → sutra', () => {
    const now = Date.parse('2026-10-16T10:00:00Z');
    expect(airportTimeToMs(6, 0, now)).toBe(Date.parse('2026-10-17T04:00:00Z'));
  });
  it('pogrešan sat računara (3 h kasni) ne pali noćni režim podne', () => {
    const real = Date.parse('2026-10-16T10:00:00Z'); // 12:00 lokalno, dan
    const wrongLocal = real - 11 * 3_600_000;        // računar misli da je 01:00 UTC → noć
    vi.useFakeTimers(); vi.setSystemTime(wrongLocal);
    expect(isNightHours(new Date(wrongLocal))).toBe(true);   // bez korekcije bi bila greška
    noteServerDate(new Date(real).toUTCString(), wrongLocal, wrongLocal + 50);
    expect(isNightHours()).toBe(false);                       // sa korekcijom: dan
  });
});
