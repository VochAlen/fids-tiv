import { describe, it, expect } from 'vitest';
import {
  computeAssignmentSuggestions, computeAssignmentSuggestionsRaw, type SuggestionFlight, type SuggestionInput, type SuggestionResult, type Suggestion,
} from './assignment-suggestions';
import { validatePlan, type ValidationCode } from './plan-validator';

// ── deterministički slučajni brojevi ──────────────────────────────────────
function rng(seed: number) { let s = seed >>> 0; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296; }
const pick = <T,>(r: () => number, a: T[]) => a[Math.floor(r() * a.length)];
const hhmm = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

const AIRLINES: Array<[string, string]> = [
  ['LY', 'El Al'], ['TK', 'Turkish Airlines'], ['BA', 'British Airways'], ['U2', 'easyJet'],
  ['JU', 'Air Serbia'], ['4O', 'Air Montenegro'], ['DY', 'Norwegian'], ['FR', 'Ryanair'], ['6H', 'Israir'],
];
const LEAD = { LY: 180, BA: 150, TK: 120, '6H': 180, default: 120 };

function scenario(seed: number): SuggestionInput {
  const r = rng(seed);
  const n = 3 + Math.floor(r() * 24);
  const flights: SuggestionFlight[] = [];
  for (let i = 0; i < n; i++) {
    const [code, name] = pick(r, AIRLINES);
    const std = 6 * 60 + Math.floor(r() * 16 * 60);
    const delayed = r() < 0.2;
    flights.push({
      FlightNumber: `${code}${100 + i}`, AirlineName: name, DestinationCityName: `Grad${i}`,
      ScheduledDepartureTime: hhmm(std),
      EstimatedDepartureTime: delayed ? hhmm(std + 15 + Math.floor(r() * 90)) : undefined,
      StatusEN: 'Scheduled',
    });
  }
  const currentDesks: Record<string, string> = {};
  const currentGates: Record<string, string> = {};
  const deskIds = [...Array.from({ length: 12 }, (_, i) => String(i + 1)), '21', '22', '23', '24', '25', '26'];
  const gateIds = ['2', '3', '4', '5', '6', ...Array.from({ length: 11 }, (_, i) => String(21 + i))];
  const holders = flights.filter(() => r() < 0.35);
  for (const h of holders) {
    const k = 1 + Math.floor(r() * 3);
    const start = Math.floor(r() * 12);
    for (let j = 0; j < k; j++) currentDesks[String(1 + ((start + j) % 12))] = h.FlightNumber;
    currentGates[pick(r, gateIds.slice(0, 5))] = h.FlightNumber;
  }
  if (r() < 0.3) currentDesks[pick(r, deskIds)] = 'ZZ999'; // let koji nije na rasporedu
  const blocked = r() < 0.4
    ? Array.from({ length: 1 + Math.floor(r() * 3) }, () => ({
        type: (r() < 0.7 ? 'desk' : 'gate') as 'desk' | 'gate',
        id: r() < 0.7 ? pick(r, deskIds) : pick(r, gateIds),
        ...(r() < 0.5 ? { fromMin: Math.floor(r() * 600), toMin: 600 + Math.floor(r() * 600) } : {}),
      }))
    : [];
  // blokada mora biti resurs odgovarajuće vrste
  const fixedBlocked = blocked.map(b => ({ ...b, id: b.type === 'desk' ? (deskIds.includes(b.id) ? b.id : '3') : (gateIds.includes(b.id) ? b.id : '5') }));
  return {
    flights, currentDesks, currentGates,
    nowMin: 5 * 60 + Math.floor(r() * 12 * 60),
    openLeadByIata: LEAD, summer: r() < 0.4, dow: Math.floor(r() * 7),
    constraints: { blocked: fixedBlocked, pins: [], counts: [], ...(r() < 0.15 ? { t2: true } : {}) },
  };
}

const errors = (res: SuggestionResult, input: SuggestionInput) =>
  validatePlan({ result: res, currentDesks: input.currentDesks, currentGates: input.currentGates }).filter(i => i.severity === 'error');

describe('nasumični rasporedi: planer nikad ne daje neispravan plan', () => {
  it('500 nasumičnih scenarija — nula grešaka provjere (planer BEZ zaštite)', () => {
    const bad: string[] = [];
    for (let seed = 1; seed <= 500; seed++) {
      const input = scenario(seed);
      const res = computeAssignmentSuggestionsRaw(input);
      const e = errors(res, input);
      if (e.length) bad.push(`seed ${seed}: ${e.map(x => `${x.code}(${x.flight}:${x.resources.join('/')})`).join(', ')}`);
    }
    expect(bad.slice(0, 5)).toEqual([]);
  });

  it('blokirani resurs se nikad ne dodjeljuje u blokiranom intervalu (nijedna grana)', () => {
    for (let seed = 1000; seed < 1300; seed++) {
      const input = scenario(seed);
      const res = computeAssignmentSuggestionsRaw(input);
      const blocked = res.occupancy.filter(o => o.flight === undefined);
      for (const sg of [...res.desks, ...res.gates]) {
        for (const id of sg.resources) {
          for (const b of blocked) {
            if (b.type === sg.type && b.id === id) {
              const overlap = sg.openAt < b.end + res.turnoverMin && b.start < sg.closeAt + res.turnoverMin;
              expect(overlap, `seed ${seed} ${sg.flightNumber} ${id}`).toBe(false);
            }
          }
        }
      }
    }
  }, 30_000);

  it('javna funkcija (sa zaštitom) uvijek vraća plan bez grešaka', () => {
    for (let seed = 2000; seed < 2200; seed++) {
      const input = scenario(seed);
      const res = computeAssignmentSuggestions(input);
      expect(errors(res, input), `seed ${seed}`).toEqual([]);
    }
  });
});

describe('granična vremena', () => {
  const f = (fn: string, name: string, t: string): SuggestionFlight => ({ FlightNumber: fn, AirlineName: name, ScheduledDepartureTime: t, StatusEN: 'Scheduled', DestinationCityName: 'X' });
  it('interval koji počinje tačno kad drugi završi + 1 min je dozvoljen, a ranije nije', () => {
    // LY check-in 180 min prije; LY zatvara 30 min prije polaska. Gradimo ručno preko provjeravača.
    const base = computeAssignmentSuggestionsRaw({
      flights: [f('LY1', 'El Al', '14:00')], currentDesks: {}, currentGates: {}, nowMin: 420, openLeadByIata: LEAD, summer: false, dow: 1,
    });
    const sg = base.desks[0];
    const mk = (start: number): SuggestionResult => ({
      ...base,
      occupancy: [{ type: 'desk', id: sg.resources[0], start: sg.openAt - 100, end: start - base.turnoverMin, flight: 'HOLD' }],
    });
    // zauzeće završava tačno openAt - 1 → pauza ispoštovana
    const ok = validatePlan({ result: mk(sg.openAt), currentDesks: {}, currentGates: {} }).filter(i => i.code === 'RESOURCE_OVERLAP');
    expect(ok).toEqual([]);
    // zauzeće završava openAt (nema pauze) → preklapanje
    const bad = validatePlan({ result: mk(sg.openAt + 1), currentDesks: {}, currentGates: {} }).filter(i => i.code === 'RESOURCE_OVERLAP');
    expect(bad.length).toBeGreaterThan(0);
  });
});

describe('promjena ulaza ne ostavlja zastarjelu dodjelu', () => {
  it('nova blokada resursa koji je bio predložen → novi plan ga ne sadrži', () => {
    const input = scenario(77);
    const before = computeAssignmentSuggestions(input);
    const target = before.desks.find(d => d.resources.length)!;
    const id = target.resources[0];
    const blocked = [...(input.constraints?.blocked ?? []), { type: 'desk' as const, id }];
    const after = computeAssignmentSuggestions({ ...input, constraints: { blocked, pins: [], counts: [] } });
    const again = after.desks.find(d => d.flightNumber === target.flightNumber)!;
    expect(again.resources).not.toContain(id);
    expect(errors(after, input)).toEqual([]);
  });

  it('kašnjenje leta pomjera interval i plan ostaje ispravan', () => {
    for (let seed = 3000; seed < 3100; seed++) {
      const input = scenario(seed);
      const delayed = { ...input, flights: input.flights.map((fl, i) => (i % 3 === 0 ? { ...fl, EstimatedDepartureTime: hhmm((parseInt(fl.ScheduledDepartureTime!.slice(0, 2)) * 60 + parseInt(fl.ScheduledDepartureTime!.slice(3)) + 75) % 1440) } : fl)) };
      expect(errors(computeAssignmentSuggestions(delayed), delayed), `seed ${seed}`).toEqual([]);
    }
  });
});

// ── mutacije: namjerno pokvaren plan MORA biti odbijen ────────────────────
describe('provjeravač otkriva namjerno ubačene greške', () => {
  const input = scenario(5);
  const base = computeAssignmentSuggestionsRaw(input);
  const withDesk = (patch: Partial<Suggestion>): SuggestionResult => {
    const d = base.desks.find(x => x.resources.length >= 1)!;
    return { ...base, desks: base.desks.map(x => (x === d ? { ...x, ...patch } : x)) };
  };
  const codes = (res: SuggestionResult): ValidationCode[] =>
    validatePlan({ result: res, currentDesks: input.currentDesks, currentGates: input.currentGates }).map(i => i.code);

  it('osnovni plan je čist', () => { expect(errors(base, input)).toEqual([]); });
  it('šalteri 1, 4, 12 → NON_CONSECUTIVE_DESKS', () => {
    expect(codes(withDesk({ resources: ['1', '4', '12'] }))).toContain('NON_CONSECUTIVE_DESKS');
  });
  it('šalteri 7 i 21 → TERMINAL_MISMATCH (i nisu uzastopni)', () => {
    expect(codes(withDesk({ resources: ['7', '21'] }))).toContain('TERMINAL_MISMATCH');
  });
  it('nepostojeći šalter 13 → UNKNOWN_RESOURCE', () => {
    expect(codes(withDesk({ resources: ['13'] }))).toContain('UNKNOWN_RESOURCE');
  });
  it('isti šalter dvaput → DUPLICATE_RESOURCE', () => {
    expect(codes(withDesk({ resources: ['2', '2'] }))).toContain('DUPLICATE_RESOURCE');
  });
  it('resurs blokiran u intervalu → BLOCKED_RESOURCE', () => {
    const d = base.desks.find(x => x.resources.length)!;
    const res: SuggestionResult = { ...base, occupancy: [...base.occupancy, { type: 'desk', id: d.resources[0], start: d.openAt - 10, end: d.closeAt + 10 }] };
    expect(codes(res)).toContain('BLOCKED_RESOURCE');
  });
  it('isti šalter u preklapajućem intervalu dva leta → RESOURCE_OVERLAP', () => {
    const [a, b] = base.desks.filter(x => x.resources.length);
    const res: SuggestionResult = {
      ...base,
      desks: base.desks.map(x => (x === b ? { ...x, resources: [a.resources[0]], openAt: a.openAt, closeAt: a.closeAt } : x)),
    };
    expect(codes(res)).toContain('RESOURCE_OVERLAP');
  });
  it('čekanje na let koji ne drži taj resurs → INVALID_WAIT_DEPENDENCY', () => {
    const d = base.desks.find(x => x.resources.length)!;
    const res = withDesk({ state: 'WAITING_FOR_RESOURCE', waitFor: [{ flight: 'NEMA123', resources: [d.resources[0]], releaseAt: d.openAt }] });
    expect(codes(res)).toContain('INVALID_WAIT_DEPENDENCY');
  });
  it('stanje READY a ima zavisnost → INVALID_WAIT_DEPENDENCY', () => {
    const d = base.desks.find(x => x.resources.length)!;
    const res = withDesk({ state: 'READY', waitFor: [{ flight: 'X', resources: [d.resources[0]], releaseAt: 0 }] });
    expect(codes(res)).toContain('INVALID_WAIT_DEPENDENCY');
  });
  it('gate u drugom terminalu od šaltera → samo UPOZORENJE (ne greška)', () => {
    const d = base.desks.find(x => x.resources.length && x.resources.every(r => Number(r) < 20))!;
    const g = base.gates.find(x => x.flightNumber === d.flightNumber);
    if (!g) return;
    const res: SuggestionResult = { ...base, gates: base.gates.map(x => (x === g ? { ...x, resources: ['21'] } : x)) };
    const issues = validatePlan({ result: res, currentDesks: input.currentDesks, currentGates: input.currentGates })
      .filter(i => i.code === 'GATE_TERMINAL_WARNING');
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.every(i => i.severity === 'warning')).toBe(true);
  });
});

describe('čekanje po zatvaranju je eksplicitno stanje', () => {
  it('prijedlog koji čeka ima state, od koga zavisi i vrijeme oslobađanja', () => {
    const f = (fn: string, name: string, t: string): SuggestionFlight => ({ FlightNumber: fn, AirlineName: name, ScheduledDepartureTime: t, StatusEN: 'Scheduled', DestinationCityName: 'X' });
    const res = computeAssignmentSuggestions({
      flights: [f('XX100', 'Nepoznata', '08:55'), f('U28812', 'easyJet', '10:00')],
      currentDesks: { '1': 'XX100', '2': 'XX100', '3': 'XX100' }, currentGates: {}, nowMin: 480, summer: false, dow: 1,
    });
    const d = res.desks.find(x => x.flightNumber === 'U28812')!;
    expect(d.state).toBe('WAITING_FOR_RESOURCE');
    expect(d.waitFor.length).toBeGreaterThan(0);
    expect(d.waitFor[0].flight).toBe('XX100');
    expect(d.waitFor[0].releaseAt).toBe(d.openAt);
    expect(res.issues.filter(i => i.severity === 'error')).toEqual([]);
  });
});
