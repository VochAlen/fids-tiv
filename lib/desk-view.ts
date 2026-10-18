// lib/desk-view.ts
//
// NOVO (2026-10-17): ČISTA funkcija koja odlučuje šta check-in ekran pokazuje. Izdvojena iz
// CheckInPageClient.computeAssignment da se SVAKI scenario "zašto je ekran inactive" može testirati
// (lib/desk-view.test.ts), a stranica koristi baš ovaj kod.
import { pickFlightForNumber, type PickableFlight } from '@/lib/flight-pick';

export type DeskEntryLike = { status: 'open' | 'closed' | null; flightNumber: string; classType?: string | null } | undefined | null;

export type DeskView<F extends PickableFlight> =
  | { kind: 'inactive'; reason: 'no-entry' | 'closed' | 'departed'; flight?: undefined }
  | { kind: 'inactive'; reason: 'cancelled' | 'diverted'; flight: F | undefined }
  | { kind: 'open'; flight: F | undefined; detailsMissing: boolean };

export function deriveDeskView<F extends PickableFlight>(
  entry: DeskEntryLike,
  flights: { departures?: readonly F[]; arrivals?: readonly F[] } | null | undefined,
): DeskView<F> {
  if (!entry || !entry.flightNumber || entry.status === null) return { kind: 'inactive', reason: 'no-entry' };
  if (entry.status === 'closed') return { kind: 'inactive', reason: 'closed' };

  let flight: F | undefined;
  if (flights) {
    const picked = pickFlightForNumber<F>(flights.departures ?? [], flights.arrivals ?? [], entry.flightNumber);
    if (picked.flight && picked.departed) return { kind: 'inactive', reason: 'departed' };
    flight = picked.flight;
  }
  const s = (flight?.StatusEN ?? '').toLowerCase().trim();
  if (s.includes('cancelled') || s.includes('canceled') || s.includes('annulé') || s.includes('otkazan')) return { kind: 'inactive', reason: 'cancelled', flight };
  if (s.includes('diverted') || s.includes('preusmjeren') || s.includes('dévié')) return { kind: 'inactive', reason: 'diverted', flight };
  // Otvoren šalter se NIKAD ne gasi zato što podaci o letu nedostaju (stari/prazan snapshot, noć, keš).
  return { kind: 'open', flight, detailsMissing: !flight };
}
