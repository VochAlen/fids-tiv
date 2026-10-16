// lib/flight-pick.ts
//
// NOVO (2026-10-16): izbor leta za dodijeljeni broj leta. Isti broj može biti u rasporedu više puta
// (dolazak i odlazak, jučerašnji/sutrašnji primjerak). Raniji `find()` je uzimao PRVI — ako je to bio
// već poletjeli primjerak, šalter dodijeljen NOVOM letu je ostajao "inactive".
// Pravilo: ako je bar jedan primjerak aktivan (nije poletio/otkazan/preusmjeren), biramo njega;
// "terminated" je samo kad su SVI primjerci terminirani.

export interface PickableFlight { FlightNumber?: string; StatusEN?: string }

const DEPARTED_RE = /(departed|poletio|take off)/i;

export function pickFlightForNumber<T extends PickableFlight>(
  departures: readonly T[],
  arrivals: readonly T[],
  flightNumber: string,
): { flight: T | undefined; departed: boolean } {
  const dep = departures.filter(f => f.FlightNumber === flightNumber);
  const arr = arrivals.filter(f => f.FlightNumber === flightNumber);
  const all = [...dep, ...arr];
  if (all.length === 0) return { flight: undefined, departed: false };
  // check-in je uvijek za ODLAZNI let: odlasci imaju prednost, pa tek onda dolasci
  const active = all.filter(f => !DEPARTED_RE.test(f.StatusEN ?? ''));
  const preferred = active.find(f => dep.includes(f)) ?? active[0];
  if (preferred) return { flight: preferred, departed: false };
  return { flight: dep[0] ?? all[0], departed: true };
}
