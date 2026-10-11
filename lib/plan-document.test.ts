import { describe, it, expect } from 'vitest';
import { computeAssignmentSuggestions } from './assignment-suggestions';
import { buildPlanHtml } from './plan-document';

const flights = [
  { FlightNumber: 'JU680', AirlineName: 'Air Serbia', DestinationCityName: 'Beograd', ScheduledDepartureTime: '09:10', StatusEN: 'Scheduled' },
  { FlightNumber: 'LY5111', AirlineName: 'El Al', DestinationCityName: 'Tel Aviv <b>', ScheduledDepartureTime: '10:20', StatusEN: 'Scheduled' },
];
const r = computeAssignmentSuggestions({ flights, currentDesks: {}, currentGates: {}, nowMin: 7 * 60 });
const html = buildPlanHtml({ ...r, dateLabel: '11.10.2026.', generatedAt: '10:52', modelText: 'Model trenutno uči', constraints: ['šalter 12 ne radi'] });

describe('štampani plan', () => {
  it('sadrži letove, šaltere, gate-ove, datum i dijakritike', () => {
    expect(html).toContain('JU680');
    expect(html).toContain('LY5111');
    expect(html).toContain('11.10.2026.');
    expect(html).toContain('Plan dodjele check-in šaltera i gate-ova');
    expect(html).toContain('šalter 12 ne radi');
    expect(html).toContain('Model trenutno uči');
    expect(html).toContain('class="gantt"');
  });
  it('escapira HTML iz podataka (nema ubacivanja)', () => {
    expect(html).toContain('Tel Aviv &lt;b&gt;');
    expect(html).not.toContain('Tel Aviv <b>');
  });
  it('prazan plan se ne ruši', () => {
    const e = buildPlanHtml({ desks: [], gates: [], dateLabel: '', generatedAt: '' });
    expect(e).toContain('Nema predloženih dodjela šaltera');
    expect(e).toContain('Nema zauzetosti za prikaz');
  });
});

import { buildDayFlights } from './plan-document';
describe('dnevni raspored', () => {
  const all = [
    ...flights,
    { FlightNumber: 'AA1', AirlineName: 'Rano', DestinationCityName: 'Rim', ScheduledDepartureTime: '06:00', StatusEN: 'Departed' },
    { FlightNumber: 'BB2', AirlineName: 'Kasno', DestinationCityName: 'Pariz', ScheduledDepartureTime: '07:10', StatusEN: 'Scheduled' },
  ];
  const day = buildDayFlights(all, { '4': 'JU680' }, {}, r, 7 * 60);
  it('sadrži SVE letove dana, sortirane po vremenu', () => {
    expect(day.map(d => d.flightNumber)).toEqual(['AA1', 'BB2', 'JU680', 'LY5111']);
  });
  it('postojeća dodjela ima prednost nad prijedlogom, prijedlog je označen', () => {
    const ju = day.find(d => d.flightNumber === 'JU680')!;
    expect(ju.desks).toEqual(['4']);
    expect(ju.desksSuggested).toBe(false);
    expect(ju.status).toBe('Dodijeljeno');
    const ly = day.find(d => d.flightNumber === 'LY5111')!;
    expect(ly.desksSuggested).toBe(true);
    expect(ly.status).toBe('Prijedlog');
  });
  it('poletio i check-in završen imaju svoj status', () => {
    expect(day.find(d => d.flightNumber === 'AA1')!.status).toBe('Poletio');
    expect(day.find(d => d.flightNumber === 'BB2')!.status).toBe('Check-in završen');
  });
  it('dokument sadrži sekciju dnevnog rasporeda', () => {
    const h = buildPlanHtml({ ...r, dayFlights: day, dateLabel: 'x', generatedAt: 'y' });
    expect(h).toContain('Dnevni raspored letova');
    expect(h).toContain('AA1');
    expect(h).toContain('class="b t1 sug"');
  });
});
