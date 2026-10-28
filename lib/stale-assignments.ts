// lib/stale-assignments.ts
//
// Čista logika (testirana): koje otvorene dodjele izgledaju "zaboravljene". Dodjela je sumnjiva ako je
//  • let već poletio (a šalter/gate je i dalje otvoren), ili
//  • otvorena predugo: šalter > DESK_STALE_MIN, gate > GATE_STALE_MIN minuta.
import type { Flight } from '@/types/flight';

export const DESK_STALE_MIN = 180;
export const GATE_STALE_MIN = 90;

export type StaleReason = 'departed' | 'long';

const DEPARTED_RE = /(departed|poletio)/i;
export const normFlight = (s: string | null | undefined) => (s ?? '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();

/** Skup (normalizovanih) brojeva letova koji su poletjeli. */
export function departedFlightSet(departures: readonly Flight[] | null | undefined): Set<string> {
  const out = new Set<string>();
  for (const f of departures ?? []) {
    if (DEPARTED_RE.test(f.StatusEN ?? '') || f.ProcessingStage === 'departed') {
      const n = normFlight(f.FlightNumber);
      if (n) out.add(n);
    }
  }
  return out;
}

export function staleReason(type: 'desk' | 'gate', sinceMin: number, flight: string, departed: ReadonlySet<string>): StaleReason | null {
  if (flight && departed.has(normFlight(flight))) return 'departed';
  if (sinceMin >= (type === 'desk' ? DESK_STALE_MIN : GATE_STALE_MIN)) return 'long';
  return null;
}
