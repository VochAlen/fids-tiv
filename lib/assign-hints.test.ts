import { describe, it, expect } from 'vitest';
import { minutesToDeparture, shouldCloseCheckin, freeResources } from './assign-hints';

describe('assign-hints', () => {
  it('koristi ETD ako postoji, inače STD', () => {
    expect(minutesToDeparture('10:00', '10:30', 9 * 60 + 50)).toBe(40);
    expect(minutesToDeparture('10:00', '', 9 * 60 + 50)).toBe(10);
    expect(minutesToDeparture('', '', 600)).toBeNull();
  });
  it('prelazak ponoći', () => {
    expect(minutesToDeparture('00:10', '', 23 * 60 + 50)).toBe(20);
  });
  it('zatvori check-in samo <20 min i dok je šalter otvoren', () => {
    expect(shouldCloseCheckin(19, true)).toBe(true);
    expect(shouldCloseCheckin(20, true)).toBe(false);
    expect(shouldCloseCheckin(10, false)).toBe(false);
    expect(shouldCloseCheckin(-1, true)).toBe(false);
    expect(shouldCloseCheckin(null, true)).toBe(false);
  });
  it('slobodni resursi', () => {
    expect(freeResources(['1', '2', '3'], ['2'])).toEqual(['1', '3']);
  });
});
