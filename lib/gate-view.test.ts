import { describe, it, expect } from 'vitest';
import { gateOverrideCandidates, isPlaceholderFlight, makePlaceholderFlight } from './gate-view';
import type { Flight } from '@/types/flight';

const fl = (FlightNumber: string, StatusEN: string) => ({ ...makePlaceholderFlight(FlightNumber), id: FlightNumber + StatusEN, StatusEN, DestinationCityName: 'Beograd' }) as Flight;

describe('gateOverrideCandidates', () => {
  it('let postoji → pravi let', () => {
    const c = gateOverrideCandidates([fl('JU1', 'Scheduled')], 'JU1');
    expect(c).toHaveLength(1);
    expect(isPlaceholderFlight(c[0])).toBe(false);
    expect(c[0].DestinationCityName).toBe('Beograd');
  });
  it('liste letova nema / prazna / let nije u njoj → placeholder (gate ostaje OTVOREN)', () => {
    for (const deps of [undefined, [], [fl('XX9', 'Scheduled')]]) {
      const c = gateOverrideCandidates(deps, 'JU1');
      expect(isPlaceholderFlight(c[0])).toBe(true);
      expect(c[0].FlightNumber).toBe('JU1');
    }
  });
  it('stari poletio + novi aktivan istog broja → novi', () => {
    const c = gateOverrideCandidates([fl('JU1', 'Departed'), fl('JU1', 'Scheduled')], 'JU1');
    expect(c[0].StatusEN).toBe('Scheduled');
  });
  it('samo poletio → vraća poletio (stranica ga sakriva preko shouldDisplayFlight)', () => {
    expect(gateOverrideCandidates([fl('JU1', 'Departed')], 'JU1')[0].StatusEN).toBe('Departed');
  });
  it('placeholder ima prazna string polja (render ne smije pasti na undefined)', () => {
    const p = makePlaceholderFlight('JU1');
    for (const k of ['DestinationCityName', 'Terminal', 'AirlineName', 'ScheduledDepartureTime', 'StatusEN'] as const) expect(p[k]).toBe('');
  });
});
