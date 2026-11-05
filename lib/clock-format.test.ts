import { describe, it, expect } from 'vitest';
import { formatClockHHMM, msToNextMinute } from './clock-format';

describe('clock-format', () => {
  it('formatira u zoni aerodroma (zima = UTC+1)', () => {
    expect(formatClockHHMM(Date.UTC(2026, 10, 5, 6, 9, 30))).toBe('07:09');
  });
  it('ljeto = UTC+2, ponoć je 00:xx', () => {
    expect(formatClockHHMM(Date.UTC(2026, 6, 1, 10, 0, 0))).toBe('12:00');
    expect(formatClockHHMM(Date.UTC(2026, 10, 5, 23, 5, 0))).toBe('00:05');
  });
  it('ms do sljedećeg minuta', () => {
    expect(msToNextMinute(Date.UTC(2026, 0, 1, 0, 0, 0))).toBe(60_000);
    expect(msToNextMinute(Date.UTC(2026, 0, 1, 0, 0, 59, 500))).toBe(500);
  });
});
