// lib/gate-view.ts
//
// NOVO (2026-10-17): čista logika izbora leta za gate koji je RUČNO OTVOREN za određeni broj leta
// (lib/gate-view.test.ts pokriva scenarije). Gate ekran se NIKAD ne smije vratiti na "nema letova"
// samo zato što lista letova trenutno ne sadrži dodijeljeni let (stari keš, prazan noćni snapshot,
// zakašnjeli podaci) — tada se prikazuje otvoren gate sa brojem leta, a detalji se povlače naknadno.
import type { Flight } from '@/types/flight';
import { pickFlightForNumber } from '@/lib/flight-pick';

export function makePlaceholderFlight(flightNumber: string): Flight {
  return {
    id: `placeholder-${flightNumber}`, FlightNumber: flightNumber,
    AirlineCode: flightNumber.substring(0, 2).toUpperCase(), AirlineICAO: '', AirlineName: '',
    DestinationAirportName: '', DestinationAirportCode: '', DestinationCityName: '',
    ScheduledDepartureTime: '', EstimatedDepartureTime: '', ActualDepartureTime: '',
    StatusEN: '', Terminal: '', GateNumber: '', CheckInDesk: '', BaggageReclaim: '',
    CodeShareFlights: [], AirlineLogoURL: '', FlightType: 'departure',
  } as Flight;
}

// FIX (2026-10-18, produkcija: svi gate monitori "Reconnecting… Cannot read properties of undefined (reading 'startsWith')"):
// pravi letovi iz feeda NEMAJU uvijek `id` (tip kaže string, podatak ne garantuje) — `f.id.startsWith` je rušio render
// gate ekrana čim se pojavi pravi let. Placeholder se prepoznaje SAMO po svom `id`, ali bez pretpostavke da postoji.
export const isPlaceholderFlight = (f: Flight | null | undefined): boolean =>
  !!f && typeof f.id === 'string' && f.id.startsWith('placeholder-');

/** Kandidati za ručno otvoren gate: pravi let ako postoji, inače placeholder. */
export function gateOverrideCandidates(departures: readonly Flight[] | undefined, flightNumber: string): Flight[] {
  const picked = pickFlightForNumber<Flight>(departures ?? [], [], flightNumber);
  return [picked.flight ?? makePlaceholderFlight(flightNumber)];
}
