// lib/flight-sanitize.ts
//
// NOVO (2026-10-18): jedno mjesto gdje se podaci o letovima "dovode u oblik" koji tip `Flight` obećava.
// RAZLOG (produkcija 2026-10-18: svi gate monitori "Reconnecting… reading 'startsWith'"): tip kaže da je `id` string, a
// pravi feed ga ne mora poslati; isto važi za bilo koje drugo polje. Jedan `undefined.startsWith` u renderu ruši
// ekran, a zaštitni okvir ga samo ponavlja. Ovdje se vrijednosti pogrešnog tipa pretvaraju u ispravne
// (nedostaje → '', broj → string, CodeShareFlights → niz stringova, id → izveden) — ISPRAVNE vrijednosti se NE mijenjaju.
// Poziva se na ulazu u hooks/useRealtimeFlightData.ts (REST, Ably i emergency keš) — pa važi za SVE ekrane.
import type { Flight, FlightData } from '@/types/flight';

const STRING_KEYS = [
  'FlightNumber', 'AirlineCode', 'AirlineICAO', 'AirlineName', 'DestinationAirportName', 'DestinationAirportCode',
  'DestinationCityName', 'ScheduledDepartureTime', 'EstimatedDepartureTime', 'ActualDepartureTime', 'StatusEN',
  'Terminal', 'GateNumber', 'CheckInDesk', 'BaggageReclaim', 'AirlineLogoURL', 'FlightType',
] as const;
const OPTIONAL_ARRAY_KEYS = ['GateNumbers', 'CheckInDesks'] as const;

const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : typeof v === 'object' ? '' : String(v));

function codeShares(v: unknown): string[] {
  if (Array.isArray(v)) {
    return v
      .map(x => (typeof x === 'string' ? x : x && typeof x === 'object' ? str((x as { FlightNumber?: unknown }).FlightNumber) : str(x)))
      .map(s => s.trim())
      .filter(Boolean);
  }
  if (typeof v === 'string') return v.split(/[,;\s]+/).filter(Boolean);
  return [];
}

/** Vraća NOVI objekat (ulaz se ne mijenja). Ne-objekat → null (poziva se filter). */
export function sanitizeFlight(input: unknown): Flight | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const f = { ...(input as Record<string, unknown>) };
  for (const k of STRING_KEYS) if (typeof f[k] !== 'string') f[k] = str(f[k]);
  f.CodeShareFlights = codeShares(f.CodeShareFlights);
  for (const k of OPTIONAL_ARRAY_KEYS) if (f[k] != null && !Array.isArray(f[k])) f[k] = undefined;
  if (typeof f.id !== 'string' || !f.id) f.id = `${f.FlightNumber}_${f.ScheduledDepartureTime}`;
  return f as unknown as Flight;
}

export function sanitizeFlightList(list: unknown): Flight[] {
  if (!Array.isArray(list)) return [];
  const out: Flight[] = [];
  for (const x of list) { const f = sanitizeFlight(x); if (f) out.push(f); }
  return out;
}

/** Ulaz u hook: neispravan omot (nije objekat) se vraća kakav jeste — ne izmišljamo podatke. */
export function sanitizeFlightData<T extends Partial<FlightData> | null | undefined>(data: T): T {
  if (!data || typeof data !== 'object') return data;
  return { ...data, departures: sanitizeFlightList(data.departures), arrivals: sanitizeFlightList(data.arrivals) } as T;
}
