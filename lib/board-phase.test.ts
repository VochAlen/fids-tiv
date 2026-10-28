import { describe, it, expect } from 'vitest';
import { isArrivalsPhase, msToNextPhase, BOARD_PHASE_MS } from './board-phase';

describe('board-phase', () => {
  it('naizmjenično, prelaz svakih 20 s', () => {
    expect(isArrivalsPhase(0)).toBe(true);
    expect(isArrivalsPhase(BOARD_PHASE_MS - 1)).toBe(true);
    expect(isArrivalsPhase(BOARD_PHASE_MS)).toBe(false);
    expect(isArrivalsPhase(2 * BOARD_PHASE_MS)).toBe(true);
  });
  it('ista faza za dva prozora sa istim satom (swap bez skoka)', () => {
    const t = 1_790_000_123_456;
    expect(isArrivalsPhase(t)).toBe(isArrivalsPhase(t + 300));
  });
  it('ms do sljedećeg prelaza je uvijek u (0, 20000]', () => {
    for (const t of [0, 1, 19_999, 20_000, 1_790_000_123_456]) {
      const m = msToNextPhase(t);
      expect(m).toBeGreaterThan(0);
      expect(m).toBeLessThanOrEqual(BOARD_PHASE_MS);
      expect(isArrivalsPhase(t + m)).toBe(!isArrivalsPhase(t));
    }
  });
});
