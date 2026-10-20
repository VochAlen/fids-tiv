// lib/learning-gate.ts
//
// NOVO (2026-10-20): SAMOPROVJERA naučenih šablona. Sistem već broji koliko su prijedlozi pogađali
// (po izvoru: naučeno / profil / opšti raspored, po sedmici — vidi accuracyIncrement). Ovdje se ta
// tačnost prvi put vraća u odluku: ako su u zadnje 4 sedmice NAUČENI šabloni jasno gori od ručnog
// profila, naučeni bazeni (šalteri ili gate-ovi, svaki zasebno) se privremeno ne koriste i važi profil.
// Čim naučeni šabloni ponovo dostignu profil, vraćaju se sami (učenje se i dalje upisuje).
//
// OPREZ — namjerno konzervativno:
//   • traži bar MIN_EVALUATED ocijenjenih dodjela sa OBA izvora (inače ništa se ne mijenja);
//   • naučeno mora biti lošije za više od MARGIN (10 postotnih bodova);
//   • poredi se naučeno prema (profil + opšti raspored); to su različiti letovi (naučeno se koristi tamo
//     gdje ima istorije), pa poređenje nije savršeno — zato je prag visok;
//   • dira se samo bazen resursa i zamjene (`<kind>:…`, `fb:<kind>:…`); broj šaltera i brojači tačnosti ostaju.
// Čista funkcija — bez Redis-a, bez mreže, bez React-a.

import { recentWeekKeys, summarizeAccuracy, type LearnKind } from '@/lib/assignment-learning';

export const GATE_WEEKS = 4;
export const GATE_MIN_EVALUATED = 20;
export const GATE_MARGIN = 0.10;

export interface GateDecision {
  kind: LearnKind;
  /** true = naučeni bazeni se NE koriste (važi ručni profil). */
  distrust: boolean;
  learnedRate: number | null;
  learnedN: number;
  baselineRate: number | null;
  baselineN: number;
}

export function decideGate(raw: Record<string, string> | null | undefined, kind: LearnKind, todayISO: string): GateDecision {
  const s = summarizeAccuracy(raw, kind, recentWeekKeys(todayISO, GATE_WEEKS));
  const l = s.bySource.learned;
  const p = s.bySource.profile, d = s.bySource.default;
  const learnedN = l ? l.hit + l.miss : 0;
  const baseHit = (p?.hit ?? 0) + (d?.hit ?? 0);
  const baselineN = baseHit + (p?.miss ?? 0) + (d?.miss ?? 0);
  const learnedRate = learnedN ? l!.hit / learnedN : null;
  const baselineRate = baselineN ? baseHit / baselineN : null;
  const distrust =
    learnedRate !== null && baselineRate !== null &&
    learnedN >= GATE_MIN_EVALUATED && baselineN >= GATE_MIN_EVALUATED &&
    learnedRate < baselineRate - GATE_MARGIN;
  return { kind, distrust, learnedRate, learnedN, baselineRate, baselineN };
}

export interface GatedLearning {
  raw: Record<string, string> | null;
  decisions: GateDecision[];
  /** Kratka poruka za operatera (prazna kad se ništa ne mijenja). */
  notes: Partial<Record<LearnKind, string>>;
}

const pct = (x: number | null) => `${Math.round((x ?? 0) * 100)}%`;

export function gateLearnedRaw(raw: Record<string, string> | null | undefined, todayISO: string | null): GatedLearning {
  if (!raw) return { raw: null, decisions: [], notes: {} };
  if (!todayISO) return { raw, decisions: [], notes: {} };
  const decisions = (['desk', 'gate'] as const).map(k => decideGate(raw, k, todayISO));
  const bad = decisions.filter(x => x.distrust).map(x => x.kind);
  const notes: GatedLearning['notes'] = {};
  for (const x of decisions) {
    if (x.distrust) {
      notes[x.kind] = `Naučeni šabloni su privremeno isključeni (pogađaju ${pct(x.learnedRate)} naspram ${pct(x.baselineRate)} za profil, zadnje ${GATE_WEEKS} sedmice) — važi ručni profil.`;
    }
  }
  if (bad.length === 0) return { raw, decisions, notes };
  const out: Record<string, string> = {};
  for (const [field, val] of Object.entries(raw)) {
    if (bad.some(k => field.startsWith(`${k}:`) || field.startsWith(`fb:${k}:`))) continue;
    out[field] = val;
  }
  return { raw: out, decisions, notes };
}
