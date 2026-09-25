// lib/disruption-index.test.ts
import { describe, it, expect } from 'vitest';
import { parseFlightTimeToDate, computeDisruptionIndex, disruptionLevel } from './disruption-index';

describe('parseFlightTimeToDate', () => {
  it('parsira ISO string deterministički', () => {
    const d = parseFlightTimeToDate('2026-01-01T08:50:00');
    expect(d?.toISOString().startsWith('2026-01-01T08:50')).toBe(true);
  });

  it('vraća null za prazne/placeholder vrijednosti', () => {
    expect(parseFlightTimeToDate(null)).toBeNull();
    expect(parseFlightTimeToDate('')).toBeNull();
    expect(parseFlightTimeToDate('-')).toBeNull();
    expect(parseFlightTimeToDate('--:--')).toBeNull();
  });

  it('vraća null za nevalidan format', () => {
    expect(parseFlightTimeToDate('not-a-time')).toBeNull();
  });
});

describe('computeDisruptionIndex', () => {
  it('vraća score 0 za prazan niz letova', () => {
    const result = computeDisruptionIndex([]);
    expect(result.score).toBe(0);
    expect(result.total).toBe(0);
  });

  it('prepoznaje otkazane letove (cancelled/canceled/otkazan)', () => {
    const flights = [
      { StatusEN: 'Cancelled', ScheduledDepartureTime: null, EstimatedDepartureTime: null },
      { StatusEN: 'On Time', ScheduledDepartureTime: '08:00', EstimatedDepartureTime: '08:00' },
    ];
    const result = computeDisruptionIndex(flights);
    expect(result.cancelled).toBe(1);
  });

  it('KRITIČNO — isključuje letove bez STVARNE procjene (Estimated === Scheduled, placeholder)', () => {
    // Ovo je tačan scenario popravljenog bug-a ranije ove sesije:
    // 1 let sa -30 min stvarnim odstupanjem, 22 leta bez procjene
    // (placeholder) NE SMIJU se brojati kao "delayed" — inače bi
    // prosjek bio lažno nizak (razblažen nulama).
    const flights = [
      { StatusEN: 'On Time', ScheduledDepartureTime: '2026-01-01T08:50:00', EstimatedDepartureTime: '2026-01-01T08:20:00' }, // stvarno -30 min
      ...Array.from({ length: 22 }, () => ({
        StatusEN: 'On Time',
        ScheduledDepartureTime: '2026-01-01T09:00:00',
        EstimatedDepartureTime: '2026-01-01T09:00:00', // placeholder, IDENTIČNO scheduled
      })),
    ];
    const result = computeDisruptionIndex(flights);
    // -30 min nije "delay" (negativno odstupanje = ranije, ne kasni) —
    // delayed mora biti 0, ne 22 lažnih "na vrijeme" upisa niti 1 lažni "delayed".
    expect(result.delayed).toBe(0);
  });

  it('broji stvarno kašnjenje (Estimated poslije Scheduled)', () => {
    const flights = [
      { StatusEN: 'Delayed', ScheduledDepartureTime: '2026-01-01T08:00:00', EstimatedDepartureTime: '2026-01-01T08:45:00' }, // +45 min
    ];
    const result = computeDisruptionIndex(flights);
    expect(result.delayed).toBe(1);
  });

  it('score raste sa procentom otkazanih i zakašnjelih letova', () => {
    const goodFlights = Array.from({ length: 20 }, () => ({
      StatusEN: 'On Time', ScheduledDepartureTime: '2026-01-01T08:00:00', EstimatedDepartureTime: '2026-01-01T08:00:00',
    }));
    const badFlights = [
      ...Array.from({ length: 2 }, () => ({ StatusEN: 'Cancelled', ScheduledDepartureTime: null, EstimatedDepartureTime: null })),
      ...Array.from({ length: 8 }, () => ({
        StatusEN: 'Delayed', ScheduledDepartureTime: '2026-01-01T08:00:00', EstimatedDepartureTime: '2026-01-01T08:45:00',
      })),
      ...Array.from({ length: 10 }, () => ({
        StatusEN: 'On Time', ScheduledDepartureTime: '2026-01-01T08:00:00', EstimatedDepartureTime: '2026-01-01T08:00:00',
      })),
    ];
    const goodScore = computeDisruptionIndex(goodFlights).score;
    const badScore = computeDisruptionIndex(badFlights).score;
    expect(badScore).toBeGreaterThan(goodScore);
  });

  it('score nikad ne prelazi plafon od 5.0', () => {
    const terribleFlights = Array.from({ length: 20 }, () => ({
      StatusEN: 'Cancelled', ScheduledDepartureTime: null, EstimatedDepartureTime: null,
    }));
    const result = computeDisruptionIndex(terribleFlights);
    expect(result.score).toBeLessThanOrEqual(5.0);
  });
});

describe('disruptionLevel', () => {
  it('vraća "Good traffic flow" za score < 2.0', () => {
    expect(disruptionLevel(0).label).toBe('Good traffic flow');
    expect(disruptionLevel(1.9).label).toBe('Good traffic flow');
  });

  it('vraća "Minor problems" za 2.0 <= score < 3.5', () => {
    expect(disruptionLevel(2.0).label).toBe('Minor problems');
    expect(disruptionLevel(3.4).label).toBe('Minor problems');
  });

  it('vraća "Major problems" za score >= 3.5', () => {
    expect(disruptionLevel(3.5).label).toBe('Major problems');
    expect(disruptionLevel(5.0).label).toBe('Major problems');
  });
});
