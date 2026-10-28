import { describe, it, expect } from 'vitest';
import type { Flight } from '@/types/flight';
import { distanceNm, bearingDeg, extrapolate, etaMinutes, buildScheduleIndex, matchCallsign, planRefresh, TIV, FAST_SEC, SLOW_SEC } from './radar';
import { airportTimeToMs } from '@/lib/night-hours';

const fl = (o: Partial<Flight>): Flight => ({ id: 'x', FlightNumber: '', AirlineCode: '', AirlineICAO: '', AirlineName: '', DestinationAirportName: '', DestinationAirportCode: '', ScheduledDepartureTime: '', EstimatedDepartureTime: '', ActualDepartureTime: '', StatusEN: '', Terminal: '', GateNumber: '', CheckInDesk: '', BaggageReclaim: '', CodeShareFlights: [], AirlineLogoURL: '', FlightType: 'arrival', DestinationCityName: '', ...o }) as Flight;

describe('geometrija', () => {
  it('Tivat → Beograd ≈ 160 NM (≈297 km), kurs ≈ 40°', () => {
    const d = distanceNm(TIV.lat, TIV.lon, 44.8184, 20.3091);
    expect(d).toBeGreaterThan(155); expect(d).toBeLessThan(165);
    const b = bearingDeg(TIV.lat, TIV.lon, 44.8184, 20.3091);
    expect(b).toBeGreaterThan(20); expect(b).toBeLessThan(40);
  });
  it('0 udaljenost na istoj tački', () => expect(distanceNm(1, 1, 1, 1)).toBe(0));
  it('extrapolate: 360 kt na istok 1 h ≈ 360 NM dalje', () => {
    const p = extrapolate(42.4, 18.7, 360, 90, 3600);
    expect(distanceNm(42.4, 18.7, p.lat, p.lon)).toBeGreaterThan(350);
    expect(distanceNm(42.4, 18.7, p.lat, p.lon)).toBeLessThan(370);
  });
});

describe('ETA', () => {
  it('daleko: udaljenost / brzina', () => expect(etaMinutes(120, 480)).toBeCloseTo(15, 0));
  it('blizu: brzina ograničena (prilaz)', () => expect(etaMinutes(10, 300)).toBeCloseTo(4, 0));
  it('gs ~ 0 → null', () => expect(etaMinutes(50, 5)).toBeNull());
});

describe('uparivanje callsign-a', () => {
  const now = airportTimeToMs(9, 0);
  const idx = buildScheduleIndex(
    [fl({ FlightNumber: 'LS1234', AirlineCode: 'LS', AirlineICAO: 'EXS', ScheduledDepartureTime: '09:35' })],
    [fl({ FlightNumber: 'JU0681', AirlineCode: 'JU', AirlineICAO: 'ASL', ScheduledDepartureTime: '10:00', FlightType: 'departure' })], now);
  it('ICAO + broj', () => expect(matchCallsign('EXS1234 ', idx)?.sched.type).toBe('arrival'));
  it('IATA + broj', () => expect(matchCallsign('LS1234', idx)).not.toBeNull());
  it('vodeće nule', () => expect(matchCallsign('ASL681', idx)?.sched.type).toBe('departure'));
  it('nepoznat callsign', () => expect(matchCallsign('RYR9999', idx)).toBeNull());
  it('prazan callsign', () => expect(matchCallsign('  ', idx)).toBeNull());
});

describe('planRefresh', () => {
  const now = airportTimeToMs(10, 0);
  const arr = (hm: string, st = '') => fl({ FlightNumber: 'A1', ScheduledDepartureTime: hm, StatusEN: st });
  it('noć → nema pollinga', () => expect(planRefresh([arr('10:10')], [], now, true).intervalSec).toBeNull());
  it('let za 20 min → brzo', () => expect(planRefresh([arr('10:20')], [], now, false)).toMatchObject({ mode: 'fast', intervalSec: FAST_SEC }));
  it('sljedeći let za 3 h → sporo (12 min)', () => expect(planRefresh([arr('13:00')], [], now, false)).toMatchObject({ mode: 'slow', intervalSec: SLOW_SEC }));
  it('let za 40 min → sporo, ali ne duže od vremena do brzog prozora (10 min)', () => {
    const p = planRefresh([arr('10:40')], [], now, false);
    expect(p.mode).toBe('slow'); expect(p.intervalSec).toBe(600);
  });
  it('obrađen (sletio) let ne drži brzi režim', () => expect(planRefresh([arr('09:50', 'Landed')], [], now, false).mode).toBe('slow'));
  it('kasni dolazak (planiran prije 30 min, još nije sletio) → brzo', () => expect(planRefresh([arr('09:30')], [], now, false).mode).toBe('fast'));
  it('odlazak koji je poletio prije >20 min → sporo', () => {
    const d = fl({ FlightNumber: 'D1', ScheduledDepartureTime: '09:30', FlightType: 'departure' });
    expect(planRefresh([], [d], now, false).mode).toBe('slow');
  });
  it('nema letova → sporo', () => expect(planRefresh([], [], now, false)).toMatchObject({ mode: 'slow', intervalSec: SLOW_SEC, next: null }));
  it('next sadrži najbliži neobrađeni', () => expect(planRefresh([arr('13:00'), arr('11:00')], [], now, false).next?.hm).toBe('11:00'));
});

import { heuristicMatch, matchFlightNumber, type Entry } from './radar';
describe('callsign bez broja leta (ASL80X)', () => {
  const now = airportTimeToMs(9, 0);
  const idx = buildScheduleIndex(
    [fl({ FlightNumber: 'JU686', AirlineCode: 'JU', AirlineICAO: 'ASL', ScheduledDepartureTime: '09:30' }),
     fl({ FlightNumber: 'JU682', AirlineCode: 'JU', AirlineICAO: 'ASL', ScheduledDepartureTime: '13:00' })], [], now);
  const cands = [...new Map([...idx.values()].map((e) => [e.sched.flightNumber, e])).values()] as Entry[];
  it('ručna tabela: broj leta → zapis', () => expect(matchFlightNumber('JU686', idx)?.sched.flightNumber).toBe('JU686'));
  it('procjena: ASL ka Tivtu, ETA ~09:30 → JU686 (ne JU682)', () => {
    // ~70 NM sjeverno od TIV, 420 kt → ETA ≈ 10 min... pomjeri da ETA ≈ 30 min: ~200 NM
    const a = { cs: 'ASL80X', lat: 45.3, lon: 18.7, gs: 400, trk: 180, gnd: false };
    expect(heuristicMatch(a, cands, now)?.sched.flightNumber).toBe('JU686');
  });
  it('procjena: drugi prefiks aviokompanije → null', () => expect(heuristicMatch({ cs: 'WZZ12A', lat: 44, lon: 18.7, gs: 400, trk: 180, gnd: false }, cands, now)).toBeNull());
  it('procjena: leti od Tivta (ne prema) → null za dolazak', () => expect(heuristicMatch({ cs: 'ASL80X', lat: 44, lon: 18.7, gs: 400, trk: 0, gnd: false }, cands, now)).toBeNull());
  it('procjena: ETA daleko od plana (JU682 u 13:00) → null', () => expect(heuristicMatch({ cs: 'ASL33T', lat: 43.0, lon: 18.7, gs: 300, trk: 180, gnd: false }, [cands[1]], now)).toBeNull());
});

import { groundFor } from './radar';
describe('groundFor', () => {
  const f = fl({ FlightNumber: 'JU682', AirlineCode: 'JU', AirlineICAO: 'ASL', FlightType: 'departure', GateNumber: '4', CheckInDesk: '7,8', BaggageReclaim: '2' });
  it('ručna dodjela ima prednost: otvoreni šalteri/gate i zatvoreni', () => {
    const g = groundFor(f,
      { '7': { status: 'open', flightNumber: 'JU 682' }, '8': { status: 'closed', flightNumber: 'JU682' }, '9': { status: 'open', flightNumber: 'OU123' } },
      { '4': { status: 'open', flightNumber: 'JU682' } });
    expect(g.planned).toBe(false);
    expect(g.desks).toEqual([{ id: '7', open: true }, { id: '8', open: false }]);
    expect(g.gates).toEqual([{ id: '4', open: true }]);
  });
  it('bez dodjela: planirano iz rasporeda', () => {
    const g = groundFor(f, {}, {});
    expect(g.planned).toBe(true);
    expect(g.gates).toEqual([{ id: '4', open: false }]);
    expect(g.desks.map((d) => d.id)).toEqual(['7', '8']);
    expect(g.belt).toBe('2');
  });
  it('tuđi let ne dobija dodjelu', () => expect(groundFor(f, { '1': { status: 'open', flightNumber: 'OU1' } }, {}).desks.every((d) => !d.open)).toBe(true));
});
