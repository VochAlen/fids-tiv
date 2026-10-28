import { describe, it, expect } from 'vitest';
import { departedFlightSet, staleReason } from '@/lib/stale-assignments';
import type { Flight } from '@/types/flight';

const f = (o: Partial<Flight>) => ({ FlightNumber: 'JU687', StatusEN: 'On Time', ...o }) as Flight;

describe('departedFlightSet', () => {
  it('prepoznaje Departed / Poletio / ProcessingStage, normalizuje broj leta', () => {
    const s = departedFlightSet([f({ FlightNumber: 'JU 687', StatusEN: 'Departed' }), f({ FlightNumber: 'LS1', StatusEN: 'Poletio' }), f({ FlightNumber: 'XX9', ProcessingStage: 'departed' }), f({ FlightNumber: 'OK1' })]);
    expect([...s].sort()).toEqual(['JU687', 'LS1', 'XX9']);
  });
  it('null/undefined → prazan skup', () => { expect(departedFlightSet(null).size).toBe(0); });
});

describe('staleReason', () => {
  const none = new Set<string>();
  it('šalter: prag 3 h', () => { expect(staleReason('desk', 179, 'A1', none)).toBeNull(); expect(staleReason('desk', 180, 'A1', none)).toBe('long'); });
  it('gate: prag 90 min', () => { expect(staleReason('gate', 89, 'A1', none)).toBeNull(); expect(staleReason('gate', 90, 'A1', none)).toBe('long'); });
  it('poletio ima prednost i pri kratkom trajanju', () => { expect(staleReason('gate', 5, 'ju 687', new Set(['JU687']))).toBe('departed'); });
});
