import { describe, it, expect } from 'vitest';
import { sanitizeFlight, sanitizeFlightList, sanitizeFlightData } from './flight-sanitize';
import { isPlaceholderFlight } from './gate-view';
import { pickFlightForNumber, normFlightNumber } from './flight-pick';
import type { FlightData } from '@/types/flight';

const good = {
  id: 'abc', FlightNumber: 'JU681', AirlineCode: 'JU', AirlineICAO: 'ASL', AirlineName: 'Air Serbia',
  DestinationAirportName: 'Belgrade', DestinationAirportCode: 'BEG', DestinationCityName: 'Beograd',
  ScheduledDepartureTime: '12:30', EstimatedDepartureTime: '12:30', ActualDepartureTime: '', StatusEN: 'Scheduled',
  Terminal: 'T1', GateNumber: '4', CheckInDesk: '10', BaggageReclaim: '', CodeShareFlights: ['TK1'], AirlineLogoURL: '', FlightType: 'departure',
};

describe('sanitizeFlight', () => {
  it('ispravan let se ne mijenja (vrijednosti ostaju iste)', () => {
    expect(sanitizeFlight(good)).toEqual(good);
  });
  it('nedostaje/null → prazan string; id se izvodi; ulaz se ne mutira', () => {
    const bad: Record<string, unknown> = { ...good }; delete bad.id; delete bad.StatusEN; bad.Terminal = null; bad.AirlineName = undefined;
    const copy = { ...bad };
    const f = sanitizeFlight(bad)!;
    expect(f.id).toBe('JU681_12:30');
    expect(f.StatusEN).toBe('');
    expect(f.Terminal).toBe('');
    expect(f.AirlineName).toBe('');
    expect(bad).toEqual(copy);
  });
  it('broj → string (Terminal 2, FlightNumber 681)', () => {
    const f = sanitizeFlight({ ...good, Terminal: 2, FlightNumber: 681 })!;
    expect(f.Terminal).toBe('2');
    expect(f.FlightNumber).toBe('681');
    expect(() => f.Terminal.replace('T0', 'T')).not.toThrow();
  });
  it('CodeShareFlights: string → niz, objekti → brojevi letova, null → []', () => {
    expect(sanitizeFlight({ ...good, CodeShareFlights: 'TK1234, LH4321' })!.CodeShareFlights).toEqual(['TK1234', 'LH4321']);
    expect(sanitizeFlight({ ...good, CodeShareFlights: [{ FlightNumber: 'TK1' }, 'LH2', null, ''] })!.CodeShareFlights).toEqual(['TK1', 'LH2']);
    expect(sanitizeFlight({ ...good, CodeShareFlights: null })!.CodeShareFlights).toEqual([]);
    expect(sanitizeFlight({ ...good, CodeShareFlights: undefined })!.CodeShareFlights).toEqual([]);
  });
  it('GateNumbers/CheckInDesks koji nisu nizovi se uklanjaju (nikad ne ruše .map/.includes)', () => {
    const f = sanitizeFlight({ ...good, GateNumbers: '4', CheckInDesks: 7 })!;
    expect(f.GateNumbers).toBeUndefined();
    expect(f.CheckInDesks).toBeUndefined();
    expect(sanitizeFlight({ ...good, GateNumbers: ['4', '5'] })!.GateNumbers).toEqual(['4', '5']);
  });
  it('ne-objekti se odbacuju', () => {
    for (const x of [null, undefined, 'JU681', 5, [], true]) expect(sanitizeFlight(x)).toBeNull();
  });
  it('lista: null/string stavke se izbacuju, ne-niz → []', () => {
    expect(sanitizeFlightList([good, null, 'x', undefined, { ...good, FlightNumber: 'TK1' }]).map(f => f.FlightNumber)).toEqual(['JU681', 'TK1']);
    expect(sanitizeFlightList(null)).toEqual([]);
    expect(sanitizeFlightList({ a: 1 })).toEqual([]);
  });
  it('omot: departures/arrivals uvijek nizovi, ostala polja netaknuta; ne-objekat se vraća kakav jeste', () => {
    const d = sanitizeFlightData({ departures: null, lastUpdated: 'x', totalFlights: 3 } as unknown as FlightData);
    expect(d.departures).toEqual([]);
    expect(d.arrivals).toEqual([]);
    expect(d.lastUpdated).toBe('x');
    expect(sanitizeFlightData(null)).toBeNull();
    expect(sanitizeFlightData(undefined)).toBeUndefined();
  });
  it('isPlaceholderFlight i dalje prepoznaje placeholder poslije sanitizacije', () => {
    const f = sanitizeFlight({ ...good, id: 'placeholder-JU681' })!;
    expect(isPlaceholderFlight(f)).toBe(true);
    expect(isPlaceholderFlight(sanitizeFlight({ ...good, id: undefined })!)).toBe(false);
  });
});

describe('pickFlightForNumber: broj leta bez obzira na velika/mala slova i razmake', () => {
  it('"ju681", " JU681 " i "JU 681" nalaze let "JU681"', () => {
    const list = [{ FlightNumber: 'JU681', StatusEN: 'Scheduled' }];
    for (const q of ['ju681', ' JU681 ', 'JU 681']) expect(pickFlightForNumber(list, [], q).flight?.FlightNumber).toBe('JU681');
    expect(pickFlightForNumber([{ FlightNumber: ' ju681 ', StatusEN: '' }], [], 'JU681').flight).toBeDefined();
    expect(pickFlightForNumber(list, [], 'JU682').flight).toBeUndefined();
  });
  it('normFlightNumber', () => {
    expect(normFlightNumber(' ju 681 ')).toBe('JU681');
    expect(normFlightNumber(null)).toBe('');
    expect(normFlightNumber(681)).toBe('681');
  });
});
