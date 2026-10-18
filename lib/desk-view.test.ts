import { describe, it, expect } from 'vitest';
import { deriveDeskView } from './desk-view';

type F = { FlightNumber: string; StatusEN: string };
const fl = (FlightNumber: string, StatusEN: string): F => ({ FlightNumber, StatusEN });
const open = (flightNumber: string) => ({ status: 'open' as const, flightNumber });

describe('deriveDeskView — SVI scenariji u kojima ekran smije / ne smije biti inactive', () => {
  it('nema unosa / prazan broj leta / status null → inactive (no-entry)', () => {
    expect(deriveDeskView(undefined, null)).toEqual({ kind: 'inactive', reason: 'no-entry' });
    expect(deriveDeskView({ status: 'open', flightNumber: '' }, null).kind).toBe('inactive');
    expect(deriveDeskView({ status: null, flightNumber: 'JU1' }, null).kind).toBe('inactive');
  });
  it('closed → inactive', () => {
    expect(deriveDeskView({ status: 'closed', flightNumber: 'JU1' }, null)).toEqual({ kind: 'inactive', reason: 'closed' });
  });

  describe('OTVOREN šalter ostaje aktivan kad podaci o letovima nisu idealni', () => {
    const cases: [string, Parameters<typeof deriveDeskView<F>>[1]][] = [
      ['liveFlightData još nije stigao (null)', null],
      ['undefined', undefined],
      ['prazan snapshot (noć / prazan keš)', { departures: [], arrivals: [] }],
      ['liveFlightData bez departures/arrivals polja', {}],
      ['let nije u rasporedu (stari keš)', { departures: [fl('ZZ9', 'Scheduled')] }],
      ['let je samo u arrivals', { arrivals: [fl('JU1', 'Expected')] }],
      ['Scheduled', { departures: [fl('JU1', 'Scheduled')] }],
      ['Boarding / Gate closed / Delayed / Check-in', { departures: [fl('JU1', 'Boarding')] }],
      ['nepoznat status', { departures: [fl('JU1', '???')] }],
      ['prazan status', { departures: [fl('JU1', '')] }],
    ];
    for (const [name, flights] of cases) {
      it(name, () => expect(deriveDeskView(open('JU1'), flights).kind).toBe('open'));
    }
    it('detailsMissing je true kad leta nema, false kad ga ima', () => {
      expect(deriveDeskView(open('JU1'), null)).toMatchObject({ kind: 'open', detailsMissing: true });
      expect(deriveDeskView(open('JU1'), { departures: [fl('JU1', 'Scheduled')] })).toMatchObject({ detailsMissing: false });
    });
  });

  describe('inactive SAMO zbog stvarnog kraja leta', () => {
    it('Departed / Poletio / Take off → departed', () => {
      for (const s of ['Departed', 'poletio', 'Take off', 'DEPARTED 10:12'])
        expect(deriveDeskView(open('JU1'), { departures: [fl('JU1', s)] })).toEqual({ kind: 'inactive', reason: 'departed' });
    });
    it('Cancelled / Otkazan / Annulé → cancelled', () => {
      for (const s of ['Cancelled', 'Canceled', 'otkazan', 'Annulé'])
        expect(deriveDeskView(open('JU1'), { departures: [fl('JU1', s)] })).toMatchObject({ kind: 'inactive', reason: 'cancelled' });
    });
    it('Diverted / Preusmjeren → diverted', () => {
      for (const s of ['Diverted', 'preusmjeren', 'Dévié'])
        expect(deriveDeskView(open('JU1'), { departures: [fl('JU1', s)] })).toMatchObject({ kind: 'inactive', reason: 'diverted' });
    });
  });

  describe('isti broj leta više puta u rasporedu', () => {
    it('stari poletio + novi Scheduled → OTVOREN (prijavljeni scenario)', () => {
      expect(deriveDeskView(open('JU1'), { departures: [fl('JU1', 'Departed'), fl('JU1', 'Scheduled')] }).kind).toBe('open');
      expect(deriveDeskView(open('JU1'), { departures: [fl('JU1', 'Scheduled'), fl('JU1', 'Departed')] }).kind).toBe('open');
    });
    it('stari otkazan + novi Scheduled → OTVOREN', () => {
      expect(deriveDeskView(open('JU1'), { departures: [fl('JU1', 'Cancelled'), fl('JU1', 'Scheduled')] }).kind).toBe('open');
    });
    it('odlazak poletio, dolazak istog broja aktivan → OTVOREN', () => {
      expect(deriveDeskView(open('JU1'), { departures: [fl('JU1', 'Departed')], arrivals: [fl('JU1', 'Expected')] }).kind).toBe('open');
    });
    it('svi primjerci poletjeli → inactive', () => {
      expect(deriveDeskView(open('JU1'), { departures: [fl('JU1', 'Departed'), fl('JU1', 'Departed')] }).kind).toBe('inactive');
    });
  });

  it('nasumično: otvoren šalter sa BILO KOJIM nizom nekonačnih statusa nikad nije inactive', () => {
    const statuses = ['Scheduled', 'Boarding', 'Delayed', 'Gate open', 'Final call', 'Check-in', 'Expected', '', 'Landed', 'On time'];
    let s = 7; const r = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
    for (let i = 0; i < 2000; i++) {
      const n = Math.floor(r() * 5);
      const dep = Array.from({ length: n }, () => fl(r() < 0.6 ? 'JU1' : 'XX' + Math.floor(r() * 9), statuses[Math.floor(r() * statuses.length)]));
      expect(deriveDeskView(open('JU1'), { departures: dep }).kind).toBe('open');
    }
  });
});
