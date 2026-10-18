import { describe, it, expect } from 'vitest';
import { computeAssignmentSuggestions, type SuggestionFlight, type SuggestionInput, type SuggestionResult } from './assignment-suggestions';
import { validatePlan } from './plan-validator';
import { stabilizePlan, planSignature, STABILITY_MIN_GAIN, type PreviousPlan } from './plan-stability';

const fl = (n: string, std: string, name = 'Turkish Airlines'): SuggestionFlight =>
  ({ FlightNumber: n, AirlineName: name, DestinationCityName: 'X', ScheduledDepartureTime: std, StatusEN: 'Scheduled' });

const base = (flights: SuggestionFlight[]): SuggestionInput => ({
  flights, currentDesks: {}, currentGates: {}, nowMin: 6 * 60, openLeadByIata: { default: 120 }, summer: false, dow: 2,
  constraints: { blocked: [], pins: [], counts: [] },
});
const SIG = planSignature({ constraints: { blocked: [], pins: [], counts: [] }, summer: false, openLeadByIata: { default: 120 } });

/** Isti plan, ali let `fn` ima druge šaltere (simulira "novi plan je malo drugačiji"). */
const withDesks = (r: SuggestionResult, fn: string, ids: string[]): SuggestionResult => ({
  ...r, desks: r.desks.map(s => (s.flightNumber === fn ? { ...s, resources: ids } : s)),
});

describe('stabilnost prijedloga', () => {
  const prevRes = computeAssignmentSuggestions(base([fl('TK100', '12:00')]));
  const prev: PreviousPlan = { result: prevRes, signature: SIG };
  const prevDesks = prevRes.desks[0].resources;
  const alt = prevDesks.includes('10') ? ['8', '9'] : ['10', '11'];

  it('podrazumijevani prag je 40', () => expect(STABILITY_MIN_GAIN).toBe(40));

  it('bez prethodnog plana ili sa drugim potpisom vraća novi plan', () => {
    const next = withDesks(prevRes, 'TK100', alt);
    expect(stabilizePlan(null, next, SIG, Infinity).desks[0].resources).toEqual(alt);
    expect(stabilizePlan(prev, next, 'drugi', Infinity).desks[0].resources).toEqual(alt);
  });

  it('marginalna dobit (ispod praga) → zadrži prethodni', () => {
    const next = withDesks(prevRes, 'TK100', alt);
    const r = stabilizePlan(prev, next, SIG, Infinity);
    expect(r.desks[0].resources).toEqual(prevDesks);
    expect(r.kept).toContain('desk:TK100');
  });

  it('prag −∞ nikad ne zadržava', () => {
    const next = withDesks(prevRes, 'TK100', alt);
    const r = stabilizePlan(prev, next, SIG, -Infinity);
    expect(r.desks[0].resources).toEqual(alt);
    expect(r.kept).toEqual([]);
  });

  it('znatna dobit (≥ prag) pobjeđuje stabilnost', () => {
    // prethodni ima 1 šalter umjesto traženih → skup (shortage); novi je bolji za mnogo više od praga
    const worse = { ...prev, result: withDesks(prevRes, 'TK100', [prevDesks[0]]) };
    const r = stabilizePlan(worse, prevRes, SIG);
    expect(r.desks[0].resources).toEqual(prevDesks);
  });

  it('operativne promjene pobjeđuju: promjena vremena leta', () => {
    const next = withDesks(prevRes, 'TK100', alt);
    next.desks = next.desks.map(s => ({ ...s, openAt: s.openAt + 20, closeAt: s.closeAt + 20 }));
    expect(stabilizePlan(prev, next, SIG, Infinity).desks[0].resources).toEqual(alt);
  });

  it('operativne promjene pobjeđuju: prethodni resurs je sada blokiran', () => {
    const next = withDesks(prevRes, 'TK100', alt);
    const d = next.desks[0];
    next.occupancy = [...next.occupancy, ...prevDesks.map(id => ({ type: 'desk' as const, id, start: d.openAt, end: d.closeAt }))];
    const r = stabilizePlan(prev, next, SIG, Infinity);
    expect(r.desks[0].resources).toEqual(alt);
    expect(r.kept).toEqual([]);
  });

  it('operativne promjene pobjeđuju: ručna dodjela istog šaltera drugom letu', () => {
    const next = withDesks(prevRes, 'TK100', alt);
    const d = next.desks[0];
    next.occupancy = [...next.occupancy, { type: 'desk', id: prevDesks[0], start: d.openAt - 30, end: d.closeAt + 30, flight: 'ZZ1' }];
    expect(stabilizePlan(prev, next, SIG, Infinity).desks[0].resources).toEqual(alt);
  });

  it('promjena napomena (potpis) poništava stabilnost', () => {
    const sig2 = planSignature({ constraints: { blocked: [{ type: 'desk', id: '3' }], pins: [], counts: [] }, summer: false, openLeadByIata: { default: 120 } });
    const next = withDesks(prevRes, 'TK100', alt);
    expect(stabilizePlan(prev, next, sig2, Infinity).desks[0].resources).toEqual(alt);
  });
});

describe('stabilnost: svojstva na nasumičnim planovima', () => {
  function rng(seed: number) { let s = seed >>> 0; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296; }
  const hhmm = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  const names = ['Turkish Airlines', 'El Al', 'easyJet', 'Air Serbia', 'British Airways', 'Ryanair'];

  it('spojeni plan nikad ne sadrži grešku, ni uz beskonačan prag, ni uz stvarni', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const r = rng(seed);
      const n = 4 + Math.floor(r() * 16);
      const flights = Array.from({ length: n }, (_, i) =>
        fl(`${['TK', 'LY', 'U2', 'JU', 'BA', 'FR'][i % 6]}${100 + i}`, hhmm(6 * 60 + Math.floor(r() * 14 * 60)), names[i % 6]));
      const a = base(flights);
      const p1 = computeAssignmentSuggestions(a);
      // promjena: jedan let kasni, jedan resurs se blokira
      const b: SuggestionInput = {
        ...a,
        flights: flights.map((f, i) => (i === 0 ? { ...f, EstimatedDepartureTime: hhmm(8 * 60 + Math.floor(r() * 300)) } : f)),
        currentDesks: { [String(1 + Math.floor(r() * 12))]: 'ZZ999' },
      };
      const p2 = computeAssignmentSuggestions(b);
      for (const gain of [Infinity, STABILITY_MIN_GAIN]) {
        const out = stabilizePlan({ result: p1, signature: SIG }, p2, SIG, gain);
        const errs = validatePlan({ result: out, currentDesks: b.currentDesks, currentGates: b.currentGates }).filter(i => i.severity === 'error');
        expect(errs, `seed ${seed} gain ${gain}`).toEqual([]);
      }
    }
  });

  it('identičan ulaz → identičan plan (nema titranja)', () => {
    const a = base([fl('TK100', '12:00'), fl('LY200', '12:30', 'El Al'), fl('U2300', '13:00', 'easyJet')]);
    const p1 = computeAssignmentSuggestions(a);
    const out = stabilizePlan({ result: p1, signature: SIG }, computeAssignmentSuggestions(a), SIG);
    expect(out.desks.map(s => s.resources)).toEqual(p1.desks.map(s => s.resources));
    expect(out.gates.map(s => s.resources)).toEqual(p1.gates.map(s => s.resources));
  });
});
