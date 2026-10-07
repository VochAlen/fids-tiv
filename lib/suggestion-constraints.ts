// lib/suggestion-constraints.ts
//
// NOVO (2026-10-08): OGRANIČENJA za AI sugestiju — izlaz čitača napomena
// (lib/suggestion-note-parser.ts) i ulaz algoritma (lib/assignment-suggestions.ts).
//
// Čitač ne dodjeljuje šaltere: samo pretvara kratke fraze osoblja
// ("šalter 12 ne radi do 14:00", "LY1234 na 10 i 11") u ovaj mali oblik.
// Sve prolazi kroz sanitizeConstraints — nepoznati resursi, nepoznati letovi,
// loša vremena i višak stavki se odbacuju — pa tek onda algoritam (običan kod)
// primjenjuje ograničenja. Osoblje vidi pročitana ograničenja kao "čipove".
// (Isti oblik bi mogao puniti i LLM, ali sada se ne koristi — bez troška.)

import { DESKS, GATES, parseClockMinutes, formatClockMinutes } from '@/lib/assignment-suggestions';

export type ResourceType = 'desk' | 'gate';

export interface BlockedResource {
  type: ResourceType;
  id: string;
  /** Minuta od ponoći; izostavljeno = od sada / do kraja dana. */
  fromMin?: number;
  toMin?: number;
}
export interface PinnedFlight {
  type: ResourceType;
  flight: string;
  resources: string[];
}
export interface CountOverride {
  flight: string;
  count: number;
}

export interface SuggestionConstraints {
  blocked: BlockedResource[];
  pins: PinnedFlight[];
  counts: CountOverride[];
}

export const EMPTY_CONSTRAINTS: SuggestionConstraints = { blocked: [], pins: [], counts: [] };

export const MAX_CONSTRAINT_ITEMS = 20;
const FLIGHT_RE = /^[A-Z0-9]{2}\d{1,4}[A-Z]?$/;

export const isEmptyConstraints = (c: SuggestionConstraints | undefined | null): boolean =>
  !c || (c.blocked.length === 0 && c.pins.length === 0 && c.counts.length === 0);

const universeOf = (t: ResourceType) => (t === 'desk' ? DESKS : GATES);

function asType(v: unknown): ResourceType | null {
  return v === 'desk' || v === 'gate' ? v : null;
}
function asId(t: ResourceType, v: unknown): string | null {
  const s = typeof v === 'number' ? String(v) : typeof v === 'string' ? v.trim() : '';
  return universeOf(t).includes(s) ? s : null;
}
function asFlight(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.toUpperCase().replace(/\s+/g, '');
  return FLIGHT_RE.test(s) ? s : null;
}
function asClock(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v < 1440) return Math.round(v);
  if (typeof v === 'string') {
    const m = parseClockMinutes(v);
    if (m !== null) return m;
  }
  return undefined;
}

/**
 * Prima BILO ŠTA (npr. izlaz LLM-a) i vraća samo ispravna ograničenja.
 * `knownFlights` (ako je dat) odbacuje pinove/brojeve za letove kojih nema na rasporedu.
 */
export function sanitizeConstraints(raw: unknown, knownFlights?: string[]): SuggestionConstraints {
  const out: SuggestionConstraints = { blocked: [], pins: [], counts: [] };
  if (!raw || typeof raw !== 'object') return out;
  const r = raw as Record<string, unknown>;
  const known = knownFlights ? new Set(knownFlights.map(f => f.toUpperCase())) : null;

  if (Array.isArray(r.blocked)) {
    for (const b of r.blocked.slice(0, MAX_CONSTRAINT_ITEMS)) {
      if (!b || typeof b !== 'object') continue;
      const o = b as Record<string, unknown>;
      const type = asType(o.type);
      const id = type ? asId(type, o.id) : null;
      if (!type || !id) continue;
      const fromMin = asClock(o.from ?? o.fromMin);
      const toMin = asClock(o.to ?? o.toMin);
      out.blocked.push({ type, id, ...(fromMin !== undefined ? { fromMin } : {}), ...(toMin !== undefined ? { toMin } : {}) });
    }
  }
  if (Array.isArray(r.pins)) {
    for (const p of r.pins.slice(0, MAX_CONSTRAINT_ITEMS)) {
      if (!p || typeof p !== 'object') continue;
      const o = p as Record<string, unknown>;
      const type = asType(o.type);
      const flight = asFlight(o.flight);
      if (!type || !flight || (known && !known.has(flight))) continue;
      const ids = Array.isArray(o.resources) ? o.resources : [];
      const resources = [...new Set(ids.map(i => (type ? asId(type, i) : null)).filter((i): i is string => !!i))].slice(0, 6);
      if (resources.length) out.pins.push({ type, flight, resources });
    }
  }
  if (Array.isArray(r.counts)) {
    for (const c of r.counts.slice(0, MAX_CONSTRAINT_ITEMS)) {
      if (!c || typeof c !== 'object') continue;
      const o = c as Record<string, unknown>;
      const flight = asFlight(o.flight);
      const count = typeof o.count === 'number' ? Math.round(o.count) : NaN;
      if (!flight || (known && !known.has(flight)) || !(count >= 1 && count <= 6)) continue;
      out.counts.push({ flight, count });
    }
  }
  return out;
}

/** Spoji ograničenja iz više tekstova (bez duplikata). */
export function mergeConstraints(a: SuggestionConstraints, b: SuggestionConstraints): SuggestionConstraints {
  const key = (x: unknown) => JSON.stringify(x);
  const uniq = <T,>(arr: T[]) => [...new Map(arr.map(x => [key(x), x])).values()].slice(0, MAX_CONSTRAINT_ITEMS);
  return {
    blocked: uniq([...a.blocked, ...b.blocked]),
    pins: uniq([...a.pins, ...b.pins]),
    counts: uniq([...a.counts, ...b.counts]),
  };
}

/** Kratki ljudski opis (za "čipove" u card-u). */
export function describeConstraints(c: SuggestionConstraints): Array<{ key: string; text: string }> {
  const out: Array<{ key: string; text: string }> = [];
  const noun = (t: ResourceType) => (t === 'desk' ? 'šalter' : 'gate');
  c.blocked.forEach((b, i) => {
    const when = b.fromMin !== undefined || b.toMin !== undefined
      ? ` ${b.fromMin !== undefined ? `od ${formatClockMinutes(b.fromMin)}` : ''}${b.toMin !== undefined ? ` do ${formatClockMinutes(b.toMin)}` : ''}`.replace(/\s+/g, ' ')
      : '';
    out.push({ key: `b${i}`, text: `${noun(b.type)} ${b.id} ne radi${when}` });
  });
  c.pins.forEach((p, i) => out.push({ key: `p${i}`, text: `${p.flight}: ${noun(p.type)} ${p.resources.join(', ')}` }));
  c.counts.forEach((n, i) => out.push({ key: `c${i}`, text: `${n.flight}: ${n.count} šalter${n.count === 1 ? '' : 'a'}` }));
  return out;
}
