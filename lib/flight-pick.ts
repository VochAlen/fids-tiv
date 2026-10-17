// lib/flight-pick.ts
//
// NOVO (2026-10-16/17): izbor leta za dodijeljeni broj leta. Isti broj može biti u rasporedu više puta
// (dolazak i odlazak, jučerašnji/sutrašnji primjerak). Raniji `find()` je uzimao PRVI — ako je to bio
// već poletjeli primjerak, šalter dodijeljen NOVOM letu je ostajao "inactive".
//
// Prioritet primjeraka (prvi koji postoji pobjeđuje; unutar nivoa odlasci prije dolazaka):
//   1) aktivan (nije poletio/otkazan/preusmjeren)
//   2) otkazan/preusmjeren (ekran to treba da prikaže kao takav)
//   3) poletio
// `departed` je true samo kad su SVI primjerci poletjeli.

export interface PickableFlight { FlightNumber?: string; StatusEN?: string }

export const DEPARTED_RE = /(departed|poletio|take off)/i;
const CANCELLED_RE = /(cancelled|canceled|otkazan|annulé)/i;
const DIVERTED_RE = /(diverted|preusmjeren|dévié)/i;

export function pickFlightForNumber<T extends PickableFlight>(
  departures: readonly T[],
  arrivals: readonly T[],
  flightNumber: string,
): { flight: T | undefined; departed: boolean } {
  const dep = departures.filter(f => f.FlightNumber === flightNumber);
  const arr = arrivals.filter(f => f.FlightNumber === flightNumber);
  const all = [...dep, ...arr];
  if (all.length === 0) return { flight: undefined, departed: false };
  const st = (f: T) => f.StatusEN ?? '';
  const tiers: T[][] = [
    all.filter(f => !DEPARTED_RE.test(st(f)) && !CANCELLED_RE.test(st(f)) && !DIVERTED_RE.test(st(f))),
    all.filter(f => !DEPARTED_RE.test(st(f)) && (CANCELLED_RE.test(st(f)) || DIVERTED_RE.test(st(f)))),
  ];
  for (const tier of tiers) {
    const hit = tier.find(f => dep.includes(f)) ?? tier[0];
    if (hit) return { flight: hit, departed: false };
  }
  return { flight: dep[0] ?? all[0], departed: true };
}
