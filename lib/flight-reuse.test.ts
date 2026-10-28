import { describe, it, expect } from 'vitest';
import { reuseFlights } from './flight-reuse';

const f = (n: string, extra: Record<string, unknown> = {}) => ({ FlightNumber: n, ScheduledDepartureTime: '10:00', StatusEN: 'Scheduled', CodeShareFlights: [] as string[], ...extra });

describe('reuseFlights', () => {
  it('isti sadržaj → ista referenca niza i objekata', () => {
    const prev = [f('A1'), f('B2')];
    const next = [f('A1'), f('B2')];
    expect(reuseFlights(prev, next)).toBe(prev);
  });
  it('promijenjen jedan let → samo on je nov, ostali su stari objekti', () => {
    const prev = [f('A1'), f('B2')];
    const next = [f('A1'), f('B2', { StatusEN: 'Boarding' })];
    const out = reuseFlights(prev, next);
    expect(out).not.toBe(prev);
    expect(out[0]).toBe(prev[0]);
    expect(out[1]).toBe(next[1]);
  });
  it('novi let / uklonjen let / promijenjen redoslijed', () => {
    const prev = [f('A1'), f('B2')];
    expect(reuseFlights(prev, [f('B2'), f('A1')])[0]).toBe(prev[1]);
    expect(reuseFlights(prev, [f('A1')]).length).toBe(1);
    const out = reuseFlights(prev, [f('A1'), f('B2'), f('C3')]);
    expect(out[2].FlightNumber).toBe('C3');
  });
  it('nizovi unutar leta se porede po sadržaju', () => {
    const prev = [f('A1', { CodeShareFlights: ['X1'] })];
    expect(reuseFlights(prev, [f('A1', { CodeShareFlights: ['X1'] })])).toBe(prev);
    expect(reuseFlights(prev, [f('A1', { CodeShareFlights: ['X2'] })])).not.toBe(prev);
  });
});
