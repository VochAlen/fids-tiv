import { describe, it, expect } from 'vitest';
import {
  seasonFromDate, airlineKeyFromFlightNumber, incrementsForAssignment, parseLearned,
  learnedPool, learnedDeskCount, halve, fieldsOfScope, scopeResource, scopeCount, fieldOf,
  MIN_FLIGHT_SAMPLES, MIN_AIRLINE_SAMPLES,
} from './assignment-learning';

describe('sezona', () => {
  it('ljeto je 1.6.–1.10. (uključivo), ostalo zima', () => {
    expect(seasonFromDate('2026-05-31')).toBe('W');
    expect(seasonFromDate('2026-06-01')).toBe('S');
    expect(seasonFromDate('2026-09-30')).toBe('S');
    expect(seasonFromDate('2026-10-01')).toBe('S');
    expect(seasonFromDate('2026-10-02')).toBe('W');
    expect(seasonFromDate('2026-12-15')).toBe('W');
    expect(seasonFromDate('nevalidno')).toBe('W');
  });
});

describe('ključevi', () => {
  it('šifra kompanije iz broja leta', () => {
    expect(airlineKeyFromFlightNumber('U28812')).toBe('U2');
    expect(airlineKeyFromFlightNumber('JU681')).toBe('JU');
    expect(airlineKeyFromFlightNumber('4O123')).toBe('4O');
    expect(airlineKeyFromFlightNumber('ly5111')).toBe('LY');
    expect(airlineKeyFromFlightNumber('')).toBeNull();
    expect(airlineKeyFromFlightNumber('X')).toBeNull();
  });

  it('upis: šalter dobija brojače po letu, kompaniji i broju šaltera; gate bez broja šaltera', () => {
    const d = incrementsForAssignment({ kind: 'desk', resourceId: '10', flightNumber: 'LY5111', season: 'S', openCountForFlight: 2 });
    expect(d.map(x => x.field)).toEqual([
      'desk:F:LY5111:S|10', 'desk:A:LY:S|10', 'deskcount:F:LY5111:S|2', 'deskcount:A:LY:S|2',
    ]);
    const g = incrementsForAssignment({ kind: 'gate', resourceId: '5', flightNumber: 'LY5111', season: 'W' });
    expect(g.map(x => x.field)).toEqual(['gate:F:LY5111:W|5', 'gate:A:LY:W|5']);
    expect(incrementsForAssignment({ kind: 'desk', resourceId: '', flightNumber: 'LY1', season: 'W' })).toEqual([]);
  });
});

const raw = (scope: string, counts: Record<string, number>) =>
  Object.fromEntries(Object.entries(counts).map(([id, n]) => [fieldOf(scope, id), String(n)]));

describe('šablon (pool)', () => {
  it('ispod praga nema šablona; iznad praga vraća resurse po učestalosti', () => {
    const scope = scopeResource('desk', 'A', 'JU', 'W');
    expect(learnedPool(parseLearned(raw(scope, { '4': 2, '5': 2 })), 'desk', 'JU681', 'W')).toBeNull();
    const l = learnedPool(parseLearned(raw(scope, { '4': 10, '5': 8, '6': 4, '9': 1 })), 'desk', 'JU681', 'W');
    expect(l?.level).toBe('airline');
    expect(l?.samples).toBe(23);
    // '9' ima 1/23 < 15% → ne ulazi; '6' ima 4/23 ≥ 15% → ulazi
    expect(l?.pool).toEqual(['4', '5', '6']);
  });

  it('šablon po letu ima prednost nad šablonom po kompaniji', () => {
    const idx = parseLearned({
      ...raw(scopeResource('desk', 'A', 'JU', 'W'), { '4': 10, '5': 10 }),
      ...raw(scopeResource('desk', 'F', 'JU655', 'W'), { '1': MIN_FLIGHT_SAMPLES }),
    });
    expect(learnedPool(idx, 'desk', 'JU655', 'W')).toMatchObject({ level: 'flight', pool: ['1'] });
    expect(learnedPool(idx, 'desk', 'JU681', 'W')).toMatchObject({ level: 'airline', pool: ['4', '5'] });
  });

  it('sezone su odvojene: ljetni podaci ne važe zimi', () => {
    const idx = parseLearned(raw(scopeResource('desk', 'A', 'LY', 'S'), { '21': MIN_AIRLINE_SAMPLES + 2 }));
    expect(learnedPool(idx, 'desk', 'LY5111', 'S')?.pool).toEqual(['21']);
    expect(learnedPool(idx, 'desk', 'LY5111', 'W')).toBeNull();
  });

  it('gate i šalter se ne miješaju', () => {
    const idx = parseLearned(raw(scopeResource('gate', 'A', 'LY', 'W'), { '5': 10 }));
    expect(learnedPool(idx, 'desk', 'LY1', 'W')).toBeNull();
    expect(learnedPool(idx, 'gate', 'LY1', 'W')?.pool).toEqual(['5']);
  });

  it('ignoriše neispravna polja', () => {
    const idx = parseLearned({ 'bezseparatora': '5', [fieldOf('desk:A:JU:W', '4')]: 'abc', [fieldOf('desk:A:JU:W', '5')]: '-2' });
    expect(idx.size).toBe(0);
  });
});

describe('broj šaltera', () => {
  it('izvodi mod iz događaja n=1,2,3 (f(k)−f(k+1))', () => {
    // 10 letova: 7 sa 3 šaltera, 3 sa 2 šaltera → f(1)=10, f(2)=10, f(3)=7
    const scope = scopeCount('A', 'U2', 'W');
    const idx = parseLearned(raw(scope, { '1': 10, '2': 10, '3': 7 }));
    expect(learnedDeskCount(idx, 'U28812', 'W')).toEqual({ count: 3, flights: 10, level: 'airline' });
  });

  it('premalo letova → null; letovi sa 1 šalterom → 1', () => {
    expect(learnedDeskCount(parseLearned(raw(scopeCount('A', 'JU', 'W'), { '1': 3 })), 'JU1', 'W')).toBeNull();
    const idx = parseLearned(raw(scopeCount('F', 'JU655', 'W'), { '1': 5 }));
    expect(learnedDeskCount(idx, 'JU655', 'W')).toEqual({ count: 1, flights: 5, level: 'flight' });
  });
});

describe('slabljenje', () => {
  it('prepolovi i nađe polja istog opsega', () => {
    expect(halve(61)).toBe(30);
    expect(halve(1)).toBe(0);
    const scope = scopeResource('desk', 'A', 'JU', 'W');
    const r = { ...raw(scope, { '4': 61, '5': 2 }), ...raw('desk:A:LY:W', { '10': 5 }) };
    expect(fieldsOfScope(r, scope).sort()).toEqual([fieldOf(scope, '4'), fieldOf(scope, '5')].sort());
  });
});
