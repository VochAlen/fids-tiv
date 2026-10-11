// lib/plan-validator.ts
//
// NOVO (2026-10-11): NEZAVISNA provjera gotovog plana. Planer (lib/assignment-suggestions.ts)
// bira resurse; ovaj fajl ih samo PREGLEDA i prijavljuje strukturisane greške. Namjerno:
//   • ne uvozi nijednu logiku planera (samo tipove) — vlastita lista resursa, vlastito pravilo
//     terminala i vlastita provjera preklapanja, pa ista greška ne može sjediti na oba mjesta;
//   • "čekanje po zatvaranju" nema izuzetak: prijedlog u stanju WAITING_FOR_RESOURCE mora imati
//     interval koji POČINJE tek kad se resurs oslobodi (uz pauzu), pa prolazi istu provjeru
//     preklapanja kao i svaki drugi; dodatno se provjerava da zavisnost (`waitFor`) stvarno
//     postoji i da je vrijeme oslobađanja tačno.
//
// GREŠKA (severity 'error') = plan se ne smije prikazati kao važeći.
// UPOZORENJE (severity 'warning') = operater može da pregleda i odluči.

import type { SuggestionResult, Suggestion, OccupancyItem } from '@/lib/assignment-suggestions';

export type ValidationCode =
  | 'RESOURCE_OVERLAP'
  | 'NON_CONSECUTIVE_DESKS'
  | 'TERMINAL_MISMATCH'
  | 'BLOCKED_RESOURCE'
  | 'INVALID_WAIT_DEPENDENCY'
  | 'UNKNOWN_RESOURCE'
  | 'DUPLICATE_RESOURCE'
  | 'GATE_TERMINAL_WARNING';

export interface ValidationIssue {
  code: ValidationCode;
  severity: 'error' | 'warning';
  type: 'desk' | 'gate';
  flight: string;
  resources: string[];
  message: string;
}

// Vlastiti skupovi resursa (namjerno prepisani, ne uvezeni iz planera).
const VALID_DESKS = new Set([...Array.from({ length: 12 }, (_, i) => String(i + 1)), '21', '22', '23', '24', '25', '26']);
const VALID_GATES = new Set(['2', '3', '4', '5', '6', ...Array.from({ length: 11 }, (_, i) => String(21 + i))]);
const terminalOf = (id: string): 1 | 2 => (Number(id) >= 20 ? 2 : 1);

export interface ValidateInput {
  result: SuggestionResult;
  currentDesks: Record<string, string>;
  currentGates: Record<string, string>;
}

/** Dva intervala su ODVOJENA ako prvi završi bar `buf` min prije početka drugog (ili obrnuto). */
const separated = (a: { start: number; end: number }, b: { start: number; end: number }, buf: number) =>
  a.end + buf <= b.start || b.end + buf <= a.start;

export function validatePlan(input: ValidateInput): ValidationIssue[] {
  const { result, currentDesks, currentGates } = input;
  const buf = result.turnoverMin;
  const issues: ValidationIssue[] = [];
  const add = (code: ValidationCode, sg: Suggestion, resources: string[], message: string) =>
    issues.push({
      code, severity: code === 'GATE_TERMINAL_WARNING' ? 'warning' : 'error',
      type: sg.type, flight: sg.flightNumber, resources, message,
    });

  const all: Suggestion[] = [...result.desks, ...result.gates];
  const hasResources = (sg: Suggestion) => sg.resources.length > 0;

  for (const sg of all) {
    if (!hasResources(sg)) continue;
    const valid = sg.type === 'desk' ? VALID_DESKS : VALID_GATES;

    // 1) postojanje i duplikati
    const unknown = sg.resources.filter(id => !valid.has(id));
    if (unknown.length) add('UNKNOWN_RESOURCE', sg, unknown, `Resurs ne postoji: ${unknown.join(', ')}.`);
    if (new Set(sg.resources).size !== sg.resources.length) add('DUPLICATE_RESOURCE', sg, sg.resources, 'Isti resurs je naveden više puta.');

    if (sg.type === 'desk') {
      // 2) isti terminal
      if (new Set(sg.resources.map(terminalOf)).size > 1) {
        add('TERMINAL_MISMATCH', sg, sg.resources, `Šalteri ${sg.resources.join(', ')} su u različitim terminalima.`);
      }
      // 3) uzastopni brojevi
      if (sg.resources.length > 1) {
        const n = sg.resources.map(Number).sort((a, b) => a - b);
        if (!n.every((v, i) => i === 0 || v === n[i - 1] + 1)) {
          add('NON_CONSECUTIVE_DESKS', sg, sg.resources, `Šalteri ${sg.resources.join(', ')} nisu uzastopni.`);
        }
      }
    }
  }

  // 4) preklapanje i blokade — po resursu
  const occ = result.occupancy;
  for (const sg of all) {
    for (const id of sg.resources) {
      const me = { start: sg.openAt, end: sg.closeAt };
      // protiv postojećeg zauzeća / blokada
      for (const o of occ) {
        if (o.type !== sg.type || o.id !== id || o.flight === sg.flightNumber) continue;
        if (separated(me, o, buf)) continue;
        if (o.flight === undefined) add('BLOCKED_RESOURCE', sg, [id], `Resurs ${id} je blokiran u tom intervalu.`);
        else add('RESOURCE_OVERLAP', sg, [id], `Resurs ${id} se preklapa sa letom ${o.flight}.`);
      }
      // protiv drugih prijedloga (svaki par se prijavi jednom)
      for (const other of all) {
        if (other === sg || other.type !== sg.type || !other.resources.includes(id)) continue;
        if (other.flightNumber === sg.flightNumber) continue;
        if (sg.flightNumber > other.flightNumber) continue;
        if (separated(me, { start: other.openAt, end: other.closeAt }, buf)) continue;
        add('RESOURCE_OVERLAP', sg, [id], `Resurs ${id} se preklapa sa prijedlogom za ${other.flightNumber}.`);
      }
    }
  }

  // 5) zavisnosti čekanja (WAITING_FOR_RESOURCE)
  const holderEnds = (type: 'desk' | 'gate', flight: string, id: string): number[] => {
    const ends: number[] = [];
    for (const o of occ as OccupancyItem[]) if (o.type === type && o.flight === flight && o.id === id) ends.push(o.end);
    for (const s of type === 'desk' ? result.desks : result.gates) {
      if (s.flightNumber === flight && s.resources.includes(id)) ends.push(s.closeAt);
    }
    return ends;
  };
  for (const sg of all) {
    const waiting = sg.state === 'WAITING_FOR_RESOURCE';
    if (waiting !== (sg.waitFor.length > 0)) {
      add('INVALID_WAIT_DEPENDENCY', sg, sg.resources, 'Stanje čekanja se ne slaže sa zavisnostima.');
      continue;
    }
    for (const dep of sg.waitFor) {
      for (const id of dep.resources) {
        const ends = holderEnds(sg.type, dep.flight, id);
        if (!sg.resources.includes(id) || ends.length === 0) {
          add('INVALID_WAIT_DEPENDENCY', sg, [id], `Čekanje na ${dep.flight} (${id}) se ne odnosi na postojeću dodjelu.`);
          continue;
        }
        // Resurs je slobodan tek kad holder završi + pauza; prijedlog ne smije početi prije toga.
        const free = Math.max(...ends) + buf;
        if (sg.openAt < free || dep.releaseAt < free) {
          add('INVALID_WAIT_DEPENDENCY', sg, [id], `Čekanje na ${dep.flight}: resurs ${id} se oslobađa tek u ${free}, a prijedlog počinje ranije.`);
        }
      }
    }
    if (sg.waitingUntil !== undefined && sg.waitingUntil > sg.openAt) {
      add('INVALID_WAIT_DEPENDENCY', sg, sg.resources, 'Vrijeme otvaranja je prije vremena oslobađanja.');
    }
  }

  // 6) gate u istom terminalu kao šalteri tog leta (upozorenje)
  const deskTerminals = new Map<string, Set<number>>();
  const noteDesk = (fn: string, id: string) => deskTerminals.set(fn, (deskTerminals.get(fn) ?? new Set()).add(terminalOf(id)));
  for (const [id, fn] of Object.entries(currentDesks)) noteDesk(fn, id);
  for (const d of result.desks) for (const id of d.resources) noteDesk(d.flightNumber, id);
  for (const g of result.gates) {
    const dt = deskTerminals.get(g.flightNumber);
    if (!dt || dt.size !== 1 || !g.resources.length) continue;
    const want = [...dt][0];
    if (g.resources.some(id => terminalOf(id) !== want)) {
      add('GATE_TERMINAL_WARNING', g, g.resources, `Gate ${g.resources.join(', ')} je u drugom terminalu od šaltera (T${want}).`);
    }
  }
  void currentGates;
  return issues;
}
