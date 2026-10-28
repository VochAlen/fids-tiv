// lib/flight-reuse.ts
//
// Strukturno dijeljenje: kad stigne nova poruka o letovima, svaki let se klonira/sanitizuje u NOV objekat čak i kad je
// sadržaj isti, pa memo(FlightRow) ne pomaže i svi redovi se ponovo renderuju. Ovdje se za svaki let koji je sadržajno
// identičan prethodnom (isti ključ FlightNumber+ScheduledDepartureTime) vraća STARI objekat. Čista funkcija.

type Rec = Record<string, unknown>;

const flightKey = (f: Rec) => `${f.FlightNumber ?? ''}|${f.ScheduledDepartureTime ?? ''}`;

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    try { return JSON.stringify(a) === JSON.stringify(b); } catch { return false; }
  }
  return false;
}

export function sameFlight(a: Rec, b: Rec): boolean {
  const ka = Object.keys(a), kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) if (!(k in b) || !sameValue(a[k], b[k])) return false;
  return true;
}

/** Vraća `next` (isti redoslijed), ali sa starim objektima gdje je sadržaj isti; ako je sve isto, vraća `prev` (ista referenca). */
export function reuseFlights<T extends object>(prev: readonly T[], next: readonly T[]): T[] {
  const old = new Map<string, T[]>();
  for (const f of prev) {
    const k = flightKey(f as Rec);
    const arr = old.get(k);
    if (arr) arr.push(f); else old.set(k, [f]);
  }
  let allSame = prev.length === next.length;
  const out = next.map((f, i) => {
    const cands = old.get(flightKey(f as Rec));
    const hit = cands?.find(c => sameFlight(c as Rec, f as Rec));
    if (hit) { if (prev[i] !== hit) allSame = false; return hit; }
    allSame = false;
    return f;
  });
  return allSame ? (prev as T[]) : out;
}
