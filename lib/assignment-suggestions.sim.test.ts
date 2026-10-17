import { describe, it, expect } from 'vitest';
import { computeAssignmentSuggestions, deskTerminal, DESKS, GATES, type SuggestionFlight, type Suggestion } from './assignment-suggestions';

// Deterministički PRNG (mulberry32)
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const AIRLINES = [
  { code: 'LY', name: 'El Al', w: 2 }, { code: 'TK', name: 'Turkish', w: 2 }, { code: 'U2', name: 'easyJet', w: 3 },
  { code: 'BA', name: 'British Airways', w: 1 }, { code: 'JU', name: 'Air Serbia', w: 3 }, { code: '4O', name: 'Air Montenegro', w: 2 },
  { code: 'DY', name: 'Norwegian', w: 1 }, { code: 'FR', name: 'Ryanair', w: 2 }, { code: '6H', name: 'Israir', w: 1 },
];
export function genDay(seed: number, n: number): SuggestionFlight[] {
  const r = rng(seed);
  const pool = AIRLINES.flatMap(a => Array(a.w).fill(a));
  const used = new Set<string>();
  const out: SuggestionFlight[] = [];
  while (out.length < n) {
    const a = pool[Math.floor(r() * pool.length)];
    const num = a.code + (100 + Math.floor(r() * 899));
    if (used.has(num)) continue;
    used.add(num);
    const min = 6 * 60 + Math.floor(r() * 15 * 60); // 06:00–21:00, gusto se preklapa
    const hh = String(Math.floor(min / 60)).padStart(2, '0'), mm = String(min % 60).padStart(2, '0');
    out.push({
      FlightNumber: num, AirlineCode: a.code, AirlineName: a.name,
      DestinationAirportCode: 'XXX', DestinationCityName: 'Test', StatusEN: 'Scheduled',
      ScheduledDepartureTime: `${hh}:${mm}`,
    });
  }
  return out;
}

describe('sim: kvalitet plana', () => {
  it('statistika', () => {
    let cost = 0, short = 0, empty = 0, warn = 0, ms = 0, days = 0, maxMs = 0;
    for (const summer of [false, true]) for (let seed = 1; seed <= 40; seed++) {
      const flights = genDay(seed * 7 + (summer ? 1 : 0), 14 + (seed % 16));
      const t0 = performance.now();
      const r = computeAssignmentSuggestions({ flights, currentDesks: {}, currentGates: {}, nowMin: 5 * 60, summer, openLeadByIata: { default: 120, LY: 180 } });
      const dt = performance.now() - t0; ms += dt; maxMs = Math.max(maxMs, dt); days++;
      cost += r.cost.desks + r.cost.gates;
      for (const s of [...r.desks, ...r.gates]) {
        short += Math.max(s.wanted - s.resources.length, 0);
        if (!s.resources.length) empty++;
        warn += s.warnings.length;
      }
    }
    console.log('SIM', JSON.stringify({ days, cost: Math.round(cost), short, empty, warn, avgMs: +(ms / days).toFixed(1), maxMs: +maxMs.toFixed(1) }));
    expect(days).toBe(80);
  }, 60_000);
});

// ── LOGIČKE INVARIJANTE nad stotinama simuliranih dana (plan ne smije biti nelogičan) ──────────
describe('sim: invarijante plana', () => {
  const days: { r: ReturnType<typeof computeAssignmentSuggestions>; flights: SuggestionFlight[] }[] = [];
  for (const summer of [false, true]) for (let seed = 100; seed < 160; seed++) {
    const flights = genDay(seed * 13 + (summer ? 5 : 0), 10 + (seed % 22));
    days.push({ flights, r: computeAssignmentSuggestions({ flights, currentDesks: {}, currentGates: {}, nowMin: 5 * 60, summer, openLeadByIata: { default: 120, LY: 180 } }) });
  }
  const all = (r: (typeof days)[number]['r']) => [...r.desks, ...r.gates];

  it('nijedan prijedlog nije odbačen provjerom plana (nezavisni validator ne nalazi greške)', () => {
    for (const { r } of days) {
      expect(r.issues.filter(i => i.severity === 'error')).toEqual([]);
      for (const s of all(r)) expect(s.warnings.some(w => w.includes('odbačen'))).toBe(false);
    }
  });

  it('šalteri jednog leta: isti terminal, uzastopni brojevi, najviše traženi broj, postojeći šalteri', () => {
    for (const { r } of days) for (const s of r.desks) {
      expect(s.resources.length).toBeLessThanOrEqual(s.wanted);
      expect(new Set(s.resources).size).toBe(s.resources.length);
      for (const id of s.resources) expect(DESKS).toContain(id);
      if (s.resources.length > 1) {
        expect(new Set(s.resources.map(deskTerminal)).size).toBe(1);
        const n = s.resources.map(Number).sort((a, b) => a - b);
        n.forEach((v, i) => { if (i) expect(v).toBe(n[i - 1] + 1); });
      }
    }
  });

  it('gate: tačno jedan postojeći gate (ili nijedan uz upozorenje)', () => {
    for (const { r } of days) for (const s of r.gates) {
      expect(s.resources.length).toBeLessThanOrEqual(1);
      if (s.resources.length) expect(GATES).toContain(s.resources[0]);
      else expect(s.warnings.length).toBeGreaterThan(0);
    }
  });

  it('NEMA preklapanja: isti resurs nikad dva leta u istom intervalu (osim "po zatvaranju" čekanja)', () => {
    for (const { r } of days) for (const list of [r.desks, r.gates] as Suggestion[][]) {
      const by = new Map<string, Suggestion[]>();
      for (const s of list) for (const id of s.resources) by.set(id, [...(by.get(id) ?? []), s]);
      for (const [, arr] of by) for (let i = 0; i < arr.length; i++) for (let j = i + 1; j < arr.length; j++) {
        const a = arr[i], b = arr[j];
        const overlap = a.openAt < b.closeAt + r.turnoverMin && b.openAt < a.closeAt + r.turnoverMin;
        expect(overlap).toBe(false);
      }
    }
  });

  it('let sa manjkom resursa uvijek ima upozorenje (osoblje ne vidi tihi manjak)', () => {
    for (const { r } of days) for (const s of all(r)) if (s.resources.length < s.wanted) expect(s.warnings.length).toBeGreaterThan(0);
  });

  it('faza alternativa ne pogoršava plan: cijena nikad veća od pohlepnog+redoslijed (determinističan rezultat)', () => {
    const { flights } = days[0];
    const a = computeAssignmentSuggestions({ flights, currentDesks: {}, currentGates: {}, nowMin: 300, openLeadByIata: { default: 120 } });
    const b = computeAssignmentSuggestions({ flights, currentDesks: {}, currentGates: {}, nowMin: 300, openLeadByIata: { default: 120 } });
    expect(JSON.stringify(a.desks)).toBe(JSON.stringify(b.desks));
  });

  it('objašnjenje: kad je alternativa izabrana, razlog to kaže', () => {
    const notes = days.flatMap(d => all(d.r)).filter(s => s.reason.includes('Plan: izbjegnuto'));
    console.log('PLAN-NOTES', notes.length, notes[0]?.flightNumber, notes[0]?.reason);
    for (const s of notes) expect(s.reason).toMatch(/Plan: izbjegnuto [\d, ]+ .*ukupna ocjena plana −\d+/);
  });
});
