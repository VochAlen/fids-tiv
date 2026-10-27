import { describe, it, expect } from 'vitest';
import { pickSecurityRows, levelFor } from '@/lib/security-board';
import type { Flight } from '@/types/flight';

const fl = (o: Partial<Flight>): Flight => ({ FlightNumber: 'AA1', StatusEN: 'On Time', ScheduledDepartureTime: '12:00', EstimatedDepartureTime: '', ActualDepartureTime: '', DestinationCityName: 'X', GateNumber: '', ...o } as Flight);

// 2026-10-27 10:00 po aerodromskom vremenu (CET, UTC+1) = 09:00 UTC
const NOW = Date.UTC(2026, 9, 27, 9, 0, 0);

describe('levelFor', () => {
  it('prag 30/15/10 min', () => {
    expect(levelFor(45)).toBe('scheduled');
    expect(levelFor(30)).toBe('boarding');
    expect(levelFor(16)).toBe('boarding');
    expect(levelFor(15)).toBe('hurry');
    expect(levelFor(11)).toBe('hurry');
    expect(levelFor(10)).toBe('urgent');
    expect(levelFor(0)).toBe('urgent');
  });
});

describe('pickSecurityRows', () => {
  it('uzima najbliža 4, sortirano po vremenu, boarding = polazak − 30 min', () => {
    const rows = pickSecurityRows([
      fl({ FlightNumber: 'E', ScheduledDepartureTime: '14:00' }),
      fl({ FlightNumber: 'A', ScheduledDepartureTime: '10:40' }),
      fl({ FlightNumber: 'B', ScheduledDepartureTime: '11:00' }),
      fl({ FlightNumber: 'C', ScheduledDepartureTime: '12:00' }),
      fl({ FlightNumber: 'D', ScheduledDepartureTime: '13:00' }),
    ], {}, NOW);
    expect(rows.map((r) => r.flightNumber)).toEqual(['A', 'B', 'C', 'D']);
    expect(rows[0].boarding).toBe('10:10');
    expect(rows[0].minutesLeft).toBe(40);
  });

  it('upozorenja na 15 i 10 min, prioritet za ≤15', () => {
    const rows = pickSecurityRows([
      fl({ FlightNumber: 'A', ScheduledDepartureTime: '10:15' }),
      fl({ FlightNumber: 'B', ScheduledDepartureTime: '10:10' }),
      fl({ FlightNumber: 'C', ScheduledDepartureTime: '10:25' }),
    ], {}, NOW);
    const by = Object.fromEntries(rows.map((r) => [r.flightNumber, r]));
    expect(by.A.level).toBe('hurry'); expect(by.A.priority).toBe(true);
    expect(by.B.level).toBe('urgent'); expect(by.B.priority).toBe(true);
    expect(by.C.level).toBe('boarding'); expect(by.C.priority).toBe(false);
  });

  it('kašnjenje: nivo prema ETD, STD ostaje, ETD se prikazuje', () => {
    const [r] = pickSecurityRows([fl({ ScheduledDepartureTime: '10:10', EstimatedDepartureTime: '11:00' })], {}, NOW);
    expect(r.std).toBe('10:10'); expect(r.etd).toBe('11:00'); expect(r.level).toBe('scheduled'); expect(r.boarding).toBe('10:30');
  });

  it('izbacuje poletjele, otkazane i duplikate; gate iz dodjela ima prednost', () => {
    const rows = pickSecurityRows([
      fl({ FlightNumber: 'D1', StatusEN: 'Departed', ScheduledDepartureTime: '09:30' }),
      fl({ FlightNumber: 'C1', StatusEN: 'Cancelled', ScheduledDepartureTime: '10:30' }),
      fl({ FlightNumber: 'K1', ScheduledDepartureTime: '10:50', GateNumber: '2' }),
      fl({ FlightNumber: 'K1', ScheduledDepartureTime: '10:50', GateNumber: '2' }),
    ], { K1: '4' }, NOW);
    expect(rows).toHaveLength(1);
    expect(rows[0].gate).toBe('4');
  });

  it('bez gate-a vraća prazan string', () => {
    const [r] = pickSecurityRows([fl({ ScheduledDepartureTime: '11:30', GateNumber: '-' })], {}, NOW);
    expect(r.gate).toBe('');
  });
});
