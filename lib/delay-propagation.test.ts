import { describe, it, expect } from 'vitest';
import { predictDepartureDelays, arrivalDelayMin } from './delay-propagation';
import { computeAssignmentSuggestionsRaw } from './assignment-suggestions';

const arr = (fn: string, sta: string, eta: string, city = 'Belgrade', status = 'Scheduled') =>
  ({ FlightNumber: fn, AirlineCode: 'JU', DestinationCityName: city, DestinationAirportCode: 'BEG', ScheduledDepartureTime: sta, EstimatedDepartureTime: eta, StatusEN: status });
const dep = (fn: string, std: string, etd = '', city = 'Belgrade', status = 'Scheduled') =>
  ({ FlightNumber: fn, AirlineCode: 'JU', DestinationCityName: city, DestinationAirportCode: 'BEG', ScheduledDepartureTime: std, EstimatedDepartureTime: etd, StatusEN: status });

describe('propagacija kašnjenja dolazak → polazak', () => {
  it('arrivalDelayMin: ETA poslije plana; ETA "prije" plana se ignoriše', () => {
    expect(arrivalDelayMin(arr('JU680', '10:00', '10:40'))).toBe(40);
    expect(arrivalDelayMin(arr('JU680', '10:00', '09:50'))).toBe(0);
    expect(arrivalDelayMin(arr('JU680', '23:50', '00:20'))).toBe(30);
  });

  it('dolazak kasni 40, rezerva 15 → polazak ~25', () => {
    // gap 50, turnaround 35 → rezerva 15
    const r = predictDepartureDelays([arr('JU680', '10:00', '10:40')], [dep('JU681', '10:50')]);
    expect(r['JU681'].delayMin).toBe(25);
    expect(r['JU681'].fromFlight).toBe('JU680');
    expect(r['JU681'].note).toContain('JU680');
  });

  it('velika rezerva upija kašnjenje; malo kašnjenje se ne prijavljuje', () => {
    expect(predictDepartureDelays([arr('JU680', '10:00', '10:30')], [dep('JU681', '12:30')])).toEqual({});
    expect(predictDepartureDelays([arr('JU680', '10:00', '10:08')], [dep('JU681', '10:40')])).toEqual({});
  });

  it('različit grad ili kompanija se ne upari', () => {
    expect(predictDepartureDelays([arr('JU680', '10:00', '10:50')], [{ ...dep('JU771', '10:50', '', 'Zurich'), DestinationAirportCode: 'ZRH' }])).toEqual({});
    const other = { ...dep('OS123', '10:50'), AirlineCode: 'OS' };
    expect(predictDepartureDelays([arr('JU680', '10:00', '10:50')], [other])).toEqual({});
  });

  it('svaki dolazak i polazak se koriste jednom (najbliži parovi)', () => {
    const r = predictDepartureDelays(
      [arr('JU680', '10:00', '10:50'), arr('JU682', '12:00', '12:00')],
      [dep('JU681', '10:50'), dep('JU683', '12:50')],
    );
    expect(Object.keys(r)).toEqual(['JU681']);
  });

  it('otkazan dolazak ili već poletio polazak se preskaču; maksimum 180', () => {
    expect(predictDepartureDelays([arr('JU680', '10:00', '11:00', 'Belgrade', 'Cancelled')], [dep('JU681', '10:50')])).toEqual({});
    expect(predictDepartureDelays([arr('JU680', '10:00', '11:00')], [dep('JU681', '10:50', '', 'Belgrade', 'Departed')])).toEqual({});
    const big = predictDepartureDelays([arr('JU680', '08:00', '12:00')], [dep('JU681', '08:40')]);
    expect(big['JU681'].delayMin).toBe(180);
  });
});

describe('motor prijedloga koristi procjenu kašnjenja', () => {
  const flights = [{ FlightNumber: 'JU681', AirlineCode: 'JU', AirlineName: 'Air Serbia', DestinationAirportCode: 'BEG', DestinationCityName: 'Belgrade', ScheduledDepartureTime: '14:00', EstimatedDepartureTime: '', StatusEN: 'Scheduled' }];
  const base = { flights, currentDesks: {}, currentGates: {}, nowMin: 11 * 60 };

  it('procijenjeno kašnjenje pomjera zatvaranje check-ina i nosi napomenu', () => {
    const plain = computeAssignmentSuggestionsRaw(base);
    const late = computeAssignmentSuggestionsRaw({ ...base, predictedDelays: { JU681: { delayMin: 40, note: 'Očekivano kašnjenje ~40 min' } } });
    const a = plain.desks.find(s => s.flightNumber === 'JU681')!;
    const b = late.desks.find(s => s.flightNumber === 'JU681')!;
    expect(b.closeAt).toBe(a.closeAt + 40);
    expect(b.delayNote).toContain('40');
    expect(a.delayNote).toBeUndefined();
  });

  it('zvanični ETD sa većim kašnjenjem ima prednost nad procjenom', () => {
    const withEtd = [{ ...flights[0], EstimatedDepartureTime: '15:00' }];
    const r = computeAssignmentSuggestionsRaw({ ...base, flights: withEtd, predictedDelays: { JU681: { delayMin: 30, note: 'x' } } });
    expect(r.desks.find(s => s.flightNumber === 'JU681')!.delayNote).toBeUndefined();
  });
});
