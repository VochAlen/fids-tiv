import { describe, it, expect } from 'vitest';
import {
  dowFromDate, isoWeekKey, recentWeekKeys, parseLearned, learnedPool, learnedFallback,
  incrementsForAssignment, accuracyIncrement, summarizeAccuracy, sanitizeLearningContext, accuracyOutcomeFor,
  scopeResource, scopeFallback, fieldOf,
} from './assignment-learning';

const idxOf = (entries: Array<[string, number]>) =>
  parseLearned(Object.fromEntries(entries.map(([f, n]) => [f, String(n)])));

describe('dan u sedmici i sedmice', () => {
  it('dow: 2026-10-07 je srijeda (3), 2026-10-04 nedjelja (0)', () => {
    expect(dowFromDate('2026-10-07')).toBe(3);
    expect(dowFromDate('2026-10-04')).toBe(0);
    expect(dowFromDate('2026-10-10')).toBe(6);
  });
  it('ISO sedmica, granica godine i zadnjih n sedmica', () => {
    expect(isoWeekKey('2026-10-07')).toBe('2026-W41');
    expect(isoWeekKey('2026-01-01')).toBe('2026-W01');
    expect(isoWeekKey('2025-12-29')).toBe('2026-W01');
    expect(recentWeekKeys('2026-10-07', 3)).toEqual(['2026-W41', '2026-W40', '2026-W39']);
  });
});

describe('šablon po danu', () => {
  const f = 'LY5111';
  const base: Array<[string, number]> = [
    [fieldOf(scopeResource('desk', 'F', f, 'S'), '10'), 5],
    [fieldOf(scopeResource('desk', 'F', f, 'S'), '11'), 5],
    [fieldOf(scopeResource('desk', 'F', f, 'S', 0), '21'), 3],
  ];
  it('let+dan ima prednost kad ima dovoljno uzoraka, inače važi opšti', () => {
    const idx = idxOf(base);
    expect(learnedPool(idx, 'desk', f, 'S', 0)).toMatchObject({ pool: ['21'], level: 'flight-dow' });
    expect(learnedPool(idx, 'desk', f, 'S', 2)).toMatchObject({ level: 'flight' });
    expect(learnedPool(idx, 'desk', f, 'S')).toMatchObject({ level: 'flight' });
  });
  it('upis povećava i dnevne brojače', () => {
    const incs = incrementsForAssignment({ kind: 'desk', resourceId: '10', flightNumber: f, season: 'S', dow: 3 });
    const scopes = incs.map(i => i.scope);
    expect(scopes).toContain(scopeResource('desk', 'F', f, 'S', 3));
    expect(scopes).toContain(scopeResource('desk', 'A', 'LY', 'S', 3));
  });
});

describe('naučena zamjena', () => {
  it('bilježi X>Y za zauzete uobičajene i čita tek od MIN_FALLBACK_SAMPLES', () => {
    const incs = incrementsForAssignment({ kind: 'desk', resourceId: '9', flightNumber: 'LY5111', season: 'S', fallbackBusy: ['10', '9'] });
    expect(incs.map(i => i.field)).toContain(fieldOf(scopeFallback('desk', 'LY', 'S'), '10>9'));
    expect(incs.map(i => i.field)).not.toContain(fieldOf(scopeFallback('desk', 'LY', 'S'), '9>9'));

    const sc = scopeFallback('desk', 'LY', 'S');
    expect(learnedFallback(idxOf([[fieldOf(sc, '10>9'), 1]]), 'desk', 'LY1', 'S')).toEqual({});
    expect(learnedFallback(idxOf([[fieldOf(sc, '10>9'), 2], [fieldOf(sc, '10>8'), 1]]), 'desk', 'LY1', 'S'))
      .toEqual({ '10': { '9': 2, '8': 1 } });
  });
});

describe('tačnost', () => {
  it('ishod: hit / miss / none', () => {
    expect(accuracyOutcomeFor('10', ['10', '11'])).toBe('hit');
    expect(accuracyOutcomeFor('12', ['10', '11'])).toBe('miss');
    expect(accuracyOutcomeFor('12', [])).toBe('none');
    expect(accuracyOutcomeFor('12', undefined)).toBe('none');
  });
  it('zbir po sedmicama i izvoru; stare sedmice se ne računaju', () => {
    const inc = (source: 'learned' | 'profile', outcome: 'hit' | 'miss' | 'none' | 'applied', week: string) =>
      accuracyIncrement({ kind: 'desk', source, outcome, weekKey: week }).field;
    const raw: Record<string, string> = {
      [inc('learned', 'hit', '2026-W41')]: '6',
      [inc('learned', 'miss', '2026-W41')]: '2',
      [inc('profile', 'hit', '2026-W40')]: '1',
      [inc('profile', 'miss', '2026-W40')]: '3',
      [inc('profile', 'applied', '2026-W40')]: '4',
      [inc('learned', 'hit', '2026-W30')]: '99',
    };
    const sum = summarizeAccuracy(raw, 'desk', recentWeekKeys('2026-10-07', 4));
    expect(sum.total).toEqual({ hit: 7, miss: 5, none: 0, applied: 4 });
    expect(sum.evaluated).toBe(12);
    expect(sum.hitRate).toBeCloseTo(7 / 12);
    expect(sum.bySource.learned).toEqual({ hit: 6, miss: 2, none: 0, applied: 0 });
    expect(summarizeAccuracy(raw, 'gate', ['2026-W41']).hitRate).toBeNull();
  });
});

describe('sanitizeLearningContext', () => {
  it('prima samo 1–2 cifre i poznate izvore', () => {
    expect(sanitizeLearningContext({ preferredPool: ['10', 'x', '123', 11, '10'], suggested: ['5'], suggestionSource: 'learned' }))
      .toEqual({ preferredPool: ['10'], suggested: ['5'], suggestionSource: 'learned' });
    expect(sanitizeLearningContext({ suggestionSource: 'hack', preferredPool: 'no' }))
      .toEqual({ preferredPool: undefined, suggested: undefined, suggestionSource: undefined });
    expect(sanitizeLearningContext(null)).toEqual({});
  });
});
