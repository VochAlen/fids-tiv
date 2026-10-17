import { describe, it, expect } from 'vitest';
import { ASSIGNMENT_MAX_AGE_MS, ASSIGNMENT_TTL_SECONDS } from './assignment-limits';
import { computeCleanup, type ResourceEntry } from './resource-mutations';

const H = 3_600_000;
const entry = (age: number, now: number): ResourceEntry => ({ status: 'open', flightNumber: 'JU1', classType: null, setAt: now - age, seq: 1 });

describe('rok trajanja dodjele (uzrok "dodijeljen let nestane dok je još aktivan")', () => {
  it('TTL ključa nikad nije kraći od roka unosa', () => {
    expect(ASSIGNMENT_TTL_SECONDS * 1000).toBeGreaterThanOrEqual(ASSIGNMENT_MAX_AGE_MS);
  });
  it('dodjela stara 5 h, 6.5 h i 11 h (kašnjenje leta) NIJE obrisana; 13 h jeste', () => {
    const now = Date.now();
    const all = { a: entry(5 * H, now), b: entry(6.5 * H, now), c: entry(11 * H, now), d: entry(13 * H, now) };
    const cleaned = computeCleanup(all, now, ASSIGNMENT_MAX_AGE_MS).map(c => c.key);
    expect(cleaned).toEqual(['d']);
    expect(Object.keys(all).sort()).toEqual(['a', 'b', 'c']);
  });
});
