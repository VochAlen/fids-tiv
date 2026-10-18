import { describe, it, expect } from 'vitest';
import { pickFlightForNumber } from './flight-pick';

const f = (FlightNumber: string, StatusEN: string, tag = '') => ({ FlightNumber, StatusEN, tag });

describe('pickFlightForNumber', () => {
  it('nema leta → undefined, nije departed', () => {
    expect(pickFlightForNumber([f('A1', 'Scheduled')], [], 'ZZ')).toEqual({ flight: undefined, departed: false });
  });
  it('jedan poletio → departed', () => {
    expect(pickFlightForNumber([f('A1', 'Departed')], [], 'A1').departed).toBe(true);
  });
  it('dva primjerka: poletio prvi, aktivan drugi → bira aktivan (stari find() je grešio)', () => {
    const r = pickFlightForNumber([f('A1', 'Departed', 'old'), f('A1', 'Scheduled', 'new')], [], 'A1');
    expect(r.departed).toBe(false);
    expect(r.flight?.tag).toBe('new');
  });
  it('odlazak ima prednost nad dolaskom istog broja', () => {
    const r = pickFlightForNumber([f('A1', 'Scheduled', 'dep')], [f('A1', 'Landed', 'arr')], 'A1');
    expect(r.flight?.tag).toBe('dep');
  });
  it('dolazak je aktivan a odlazak poletio → ipak aktivan (bar jedan nije terminiran)', () => {
    const r = pickFlightForNumber([f('A1', 'Departed')], [f('A1', 'Expected')], 'A1');
    expect(r.departed).toBe(false);
  });
  it('"Take off" / "Poletio" prepoznati', () => {
    expect(pickFlightForNumber([f('A1', 'Take off')], [], 'A1').departed).toBe(true);
    expect(pickFlightForNumber([f('A1', 'Poletio')], [], 'A1').departed).toBe(true);
  });
});

describe('pickFlightForNumber — otkazan/preusmjeren primjerak', () => {
  it('aktivan pobjeđuje otkazan (bez obzira na redoslijed)', () => {
    const r = pickFlightForNumber([f('A1', 'Cancelled', 'c'), f('A1', 'Scheduled', 's')], [], 'A1');
    expect(r.flight?.tag).toBe('s');
  });
  it('samo otkazan → vraća otkazan (ekran prikazuje otkazan), nije departed', () => {
    const r = pickFlightForNumber([f('A1', 'Departed', 'd'), f('A1', 'Cancelled', 'c')], [], 'A1');
    expect(r.flight?.tag).toBe('c');
    expect(r.departed).toBe(false);
  });
  it('preusmjeren se prepoznaje', () => {
    expect(pickFlightForNumber([f('A1', 'Diverted', 'x')], [], 'A1').departed).toBe(false);
  });
});
