// lib/plan-stability.ts
//
// Stabilnost prijedloga: ako prethodni plan za let i dalje važi, a novi je samo marginalno bolji,
// zadrži prethodni (operater ne treba da gleda kako se šalteri "preskaču" zbog sitnica).
//
// Zadržavanje je dozvoljeno SAMO kad su sva četiri uslova ispunjena:
//   1) isti let, isti interval (openAt/closeAt/std) i isti zatraženi broj resursa;
//   2) potpis operativnih ulaza se nije promijenio (napomene/ograničenja, sezona, lead time);
//   3) dobit novog plana (razlika cijene) je manja od praga `minGain`;
//   4) spojeni plan prolazi NEZAVISNU provjeru (lib/plan-validator.ts) — blokada, zauzeće koje je
//      u međuvremenu nastalo ili ručna dodjela automatski poništavaju zadržavanje.
// Operativne promjene (izmjena vremena leta, blokiran resurs, nova napomena) uvijek pobjeđuju stabilnost.

import { suggestionCost, type Suggestion, type SuggestionResult } from '@/lib/assignment-suggestions';
import { validatePlan } from '@/lib/plan-validator';

/**
 * Prag dobiti (jedinice planCost). Manje od jednog upozorenja/praznine (30) ne opravdava promjenu
 * prikazanog prijedloga; manje od jednog nedostajućeg šaltera (120) uvijek dovoljno važno.
 */
export const STABILITY_MIN_GAIN = 40;

export interface PreviousPlan {
  result: SuggestionResult;
  /** Potpis operativnih ulaza pod kojima je plan nastao (vidi `planSignature`). */
  signature: string;
}

/** Potpis ulaza čija promjena je OPERATIVNA (poništava stabilnost). Model/brojači namjerno nisu u njemu. */
export function planSignature(parts: { constraints?: unknown; summer?: boolean; openLeadByIata?: Record<string, number> }): string {
  const lead = parts.openLeadByIata ? Object.entries(parts.openLeadByIata).sort(([a], [b]) => a.localeCompare(b)) : [];
  return JSON.stringify([parts.constraints ?? null, !!parts.summer, lead]);
}

const keyOf = (s: Suggestion) => `${s.type}:${s.flightNumber}`;

const sameResources = (a: string[], b: string[]) => a.length === b.length && a.every((v, i) => v === b[i]);

export function stabilizePlan(
  prev: PreviousPlan | null,
  next: SuggestionResult,
  signature: string,
  minGain: number = STABILITY_MIN_GAIN,
): SuggestionResult & { kept: string[] } {
  const none = { ...next, kept: [] as string[] };
  if (!prev || prev.signature !== signature) return none;

  const prevBy = new Map<string, Suggestion>();
  for (const s of [...prev.result.desks, ...prev.result.gates]) prevBy.set(keyOf(s), s);

  // kandidati za zadržavanje
  const keep = new Map<string, Suggestion>();
  for (const n of [...next.desks, ...next.gates]) {
    const p = prevBy.get(keyOf(n));
    if (!p || p.resources.length === 0) continue;
    if (sameResources(p.resources, n.resources)) continue;
    if (p.std !== n.std || p.openAt !== n.openAt || p.closeAt !== n.closeAt || p.wanted !== n.wanted) continue;
    const gain = suggestionCost(p, next.winterT1) - suggestionCost(n, next.winterT1);
    // gain < 0: prethodni je jeftiniji; gain u [0, minGain): novi je samo marginalno bolji
    if (gain < minGain) keep.set(keyOf(n), p);
  }
  if (keep.size === 0) return none;

  const build = () => {
    const swap = (list: Suggestion[]) => list.map(s => keep.get(keyOf(s)) ?? s);
    return { ...next, desks: swap(next.desks), gates: swap(next.gates) };
  };

  // Provjera spojenog plana; za svaku grešku ukloni zadržane prijedloge koji su u nju umiješani.
  for (let round = 0; round < 10 && keep.size > 0; round++) {
    const merged = build();
    const errors = validatePlan({ result: merged, currentDesks: {}, currentGates: {} }).filter(i => i.severity === 'error');
    // currentDesks/currentGates se koriste samo za upozorenje o terminalu gate-a; greške ne zavise od njih
    if (errors.length === 0) {
      return { ...merged, kept: [...keep.keys()].sort() };
    }
    const toDrop = new Set<string>();
    for (const e of errors) {
      const k = `${e.type}:${e.flight}`;
      if (keep.has(k)) toDrop.add(k);
      // zadržani prijedlog koji dijeli resurs sa prijavljenim letom
      for (const [kk, p] of keep) {
        if (kk.startsWith(`${e.type}:`) && p.resources.some(r => e.resources.includes(r))) toDrop.add(kk);
      }
    }
    if (toDrop.size === 0) { keep.clear(); break; } // ne znamo ko je kriv — bezbjedno: novi plan
    for (const k of toDrop) keep.delete(k);
  }
  return none;
}
