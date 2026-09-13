// lib/business-class-store.ts
//
// Redis-backed zamjena za lib/db (SQLite preko drizzle-orm/libsql) —
// business class konfiguracija (avio kompanije, specifični letovi,
// destinacije) za /admin/business-class panel.
//
// ZAŠTO OVO POSTOJI: lib/db/index.ts je čuvao ove podatke u LOKALNOM
// SQLite fajlu (`file:${process.cwd()}/data/flights.db`). Vercel-ov
// fajlsistem je READ-ONLY u produkciji (osim /tmp, koji je efemeran i
// NIJE dijeljen između serverless instanci) — upisi su ili padali sa
// greškom, ili (ako bi prošli preko /tmp) bili nekonzistentni između
// instanci i nestajali na sledeći cold start. lib/flight-service.ts
// hvata te greške i tiho vraća `false` (economy prikaz), pa ovo nikad
// nije rušilo ekrane letova — samo je business class razlikovanje
// tiho ne radilo kako treba.
//
// Podaci su MALI (par desetina redova ukupno) i mijenjaju se RIJETKO
// (par puta mjesečno preko admin panela) — idealan kandidat da žive u
// istom Redis-u koji aplikacija već plaća i koristi svuda drugdje
// (gate/desk override-i, flight cache, itd.), umjesto uvođenja nove
// plaćene eksterne baze (npr. Turso, koja bi bila "pravi" remote pandan
// za @libsql/client) samo za ovu potrebu.
//
// DIZAJN: jedan Redis HASH po resursu (isti obrazac kao
// test:gate-status:all / test:desk-status:all) — polje je PRIRODNI
// ključ (IATA kod, broj leta, ili "destinationCode:airlineIata"
// kompozitni ključ), ne numerički auto-increment id. Numerički `id` u
// tipovima ispod je zadržan SAMO radi kompatibilnosti sa postojećim
// TypeScript ugovorom (lib/business-class-service.ts, admin UI) — u
// praksi ga NIŠTA ne koristi za pretragu/ažuriranje (provjereno: admin
// UI i service sloj svuda prosljeđuju prirodne ključeve, nikad `id`).
import { safeRedisHGetAll, safeRedisHSet, safeRedisHDel } from '@/lib/redis';

const AIRLINES_KEY         = 'business-class:airlines';
const SPECIFIC_FLIGHTS_KEY = 'business-class:specific-flights';
const DESTINATIONS_KEY     = 'business-class:destinations';

export interface SeasonSchedule {
  hasBusinessClass: boolean;
  specificFlights: string[];
  daysOfWeek: number[];
  startDate: string | null;
  endDate: string | null;
}

export interface DestinationSeasonSchedule {
  hasBusinessClass: boolean;
  startDate: string | null;
  endDate: string | null;
}

export interface Airline {
  id: number;
  iataCode: string;
  airlineName: string;
  hasBusinessClass: boolean;
  winterSchedule: SeasonSchedule;
  summerSchedule: SeasonSchedule;
  createdAt: string;
  updatedAt: string;
}

export interface SpecificFlight {
  id: number;
  flightNumber: string;
  airlineIata: string;
  alwaysBusinessClass: boolean;
  winterOnly: boolean;
  summerOnly: boolean;
  daysOfWeek: number[];
  validFrom: string | null;
  validUntil: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Destination {
  id: number;
  destinationCode: string;
  destinationName: string;
  airlineIata: string;
  hasBusinessClass: boolean;
  winterSchedule: DestinationSeasonSchedule;
  summerSchedule: DestinationSeasonSchedule;
  createdAt: string;
  updatedAt: string;
}

const DEFAULT_SEASON_SCHEDULE: SeasonSchedule = {
  hasBusinessClass: false, specificFlights: [], daysOfWeek: [], startDate: null, endDate: null,
};
const DEFAULT_DEST_SCHEDULE: DestinationSeasonSchedule = {
  hasBusinessClass: false, startDate: null, endDate: null,
};

function destKey(destinationCode: string, airlineIata: string): string {
  return `${destinationCode.toUpperCase()}:${airlineIata.toUpperCase()}`;
}

async function readAll<T>(redisKey: string): Promise<Record<string, T>> {
  const raw = await safeRedisHGetAll(redisKey);
  if (!raw) return {};
  const out: Record<string, T> = {};
  for (const [field, json] of Object.entries(raw)) {
    try { out[field] = JSON.parse(json) as T; } catch { /* oštećeno polje — preskoči, ne ruši ostale */ }
  }
  return out;
}

// ════════════════════════════════════════════════════════════
// AVIO KOMPANIJE (field = IATA kod, npr. "JU")
// ════════════════════════════════════════════════════════════
export async function getAllAirlinesFromStore(): Promise<Airline[]> {
  return Object.values(await readAll<Airline>(AIRLINES_KEY));
}

export async function getAirlineFromStore(iataCode: string): Promise<Airline | null> {
  const all = await readAll<Airline>(AIRLINES_KEY);
  return all[iataCode.toUpperCase()] ?? null;
}

export async function createAirlineInStore(data: {
  iataCode: string; airlineName: string; hasBusinessClass?: boolean;
  winterSchedule?: SeasonSchedule; summerSchedule?: SeasonSchedule;
}): Promise<{ ok: true; airline: Airline } | { ok: false; status: number; error: string }> {
  const iataCode = data.iataCode.toUpperCase();
  if (await getAirlineFromStore(iataCode)) {
    return { ok: false, status: 400, error: 'Avio kompanija sa ovim IATA kodom već postoji' };
  }
  const now = new Date().toISOString();
  const airline: Airline = {
    id: Date.now(),
    iataCode,
    airlineName: data.airlineName,
    hasBusinessClass: !!data.hasBusinessClass,
    winterSchedule: data.winterSchedule ?? DEFAULT_SEASON_SCHEDULE,
    summerSchedule: data.summerSchedule ?? DEFAULT_SEASON_SCHEDULE,
    createdAt: now,
    updatedAt: now,
  };
  const wrote = await safeRedisHSet(AIRLINES_KEY, iataCode, JSON.stringify(airline));
  if (!wrote) return { ok: false, status: 503, error: 'Redis nedostupan — pokušajte ponovo' };
  return { ok: true, airline };
}

export async function updateAirlineInStore(iataCode: string, data: Partial<{
  airlineName: string; hasBusinessClass: boolean;
  winterSchedule: SeasonSchedule; summerSchedule: SeasonSchedule;
}>): Promise<{ ok: true; airline: Airline } | { ok: false; status: number; error: string }> {
  const code = iataCode.toUpperCase();
  const existing = await getAirlineFromStore(code);
  if (!existing) return { ok: false, status: 404, error: 'Avio kompanija nije pronađena' };
  const updated: Airline = {
    ...existing,
    ...(data.airlineName     !== undefined ? { airlineName: data.airlineName }         : {}),
    ...(data.hasBusinessClass !== undefined ? { hasBusinessClass: data.hasBusinessClass } : {}),
    ...(data.winterSchedule  !== undefined ? { winterSchedule: data.winterSchedule }    : {}),
    ...(data.summerSchedule  !== undefined ? { summerSchedule: data.summerSchedule }    : {}),
    updatedAt: new Date().toISOString(),
  };
  const wrote = await safeRedisHSet(AIRLINES_KEY, code, JSON.stringify(updated));
  if (!wrote) return { ok: false, status: 503, error: 'Redis nedostupan — pokušajte ponovo' };
  return { ok: true, airline: updated };
}

export async function deleteAirlineFromStore(iataCode: string): Promise<boolean> {
  const code = iataCode.toUpperCase();
  if (!(await getAirlineFromStore(code))) return false;
  await safeRedisHDel(AIRLINES_KEY, code);
  return true;
}

// ════════════════════════════════════════════════════════════
// SPECIFIČNI LETOVI (field = broj leta, npr. "JU683")
// ════════════════════════════════════════════════════════════
export async function getAllSpecificFlightsFromStore(): Promise<SpecificFlight[]> {
  const all = Object.values(await readAll<SpecificFlight>(SPECIFIC_FLIGHTS_KEY));
  return all.sort((a, b) => a.flightNumber.localeCompare(b.flightNumber));
}

export async function getSpecificFlightFromStore(flightNumber: string): Promise<SpecificFlight | null> {
  const all = await readAll<SpecificFlight>(SPECIFIC_FLIGHTS_KEY);
  return all[flightNumber.toUpperCase()] ?? null;
}

export async function createSpecificFlightInStore(data: {
  flightNumber: string; airlineIata: string; alwaysBusinessClass?: boolean;
  winterOnly?: boolean; summerOnly?: boolean; daysOfWeek?: number[];
  validFrom?: string | null; validUntil?: string | null;
}): Promise<{ ok: true; flight: SpecificFlight } | { ok: false; status: number; error: string }> {
  if (!data.flightNumber || !data.airlineIata) {
    return { ok: false, status: 400, error: 'Flight number and airline IATA code are required' };
  }
  const flightNumber = data.flightNumber.toUpperCase();
  if (await getSpecificFlightFromStore(flightNumber)) {
    return { ok: false, status: 409, error: 'Flight already exists' };
  }
  const now = new Date().toISOString();
  const flight: SpecificFlight = {
    id: Date.now(),
    flightNumber,
    airlineIata: data.airlineIata.toUpperCase(),
    alwaysBusinessClass: !!data.alwaysBusinessClass,
    winterOnly: !!data.winterOnly,
    summerOnly: !!data.summerOnly,
    daysOfWeek: Array.isArray(data.daysOfWeek) ? data.daysOfWeek : [],
    validFrom: data.validFrom ?? null,
    validUntil: data.validUntil ?? null,
    createdAt: now,
    updatedAt: now,
  };
  const wrote = await safeRedisHSet(SPECIFIC_FLIGHTS_KEY, flightNumber, JSON.stringify(flight));
  if (!wrote) return { ok: false, status: 503, error: 'Redis nedostupan — pokušajte ponovo' };
  return { ok: true, flight };
}

export async function updateSpecificFlightInStore(flightNumber: string, data: Partial<{
  airlineIata: string; alwaysBusinessClass: boolean; winterOnly: boolean; summerOnly: boolean;
  daysOfWeek: number[]; validFrom: string | null; validUntil: string | null;
}>): Promise<{ ok: true; flight: SpecificFlight } | { ok: false; status: number; error: string }> {
  const fn = flightNumber.toUpperCase();
  const existing = await getSpecificFlightFromStore(fn);
  if (!existing) return { ok: false, status: 404, error: 'Flight not found' };
  const updated: SpecificFlight = {
    ...existing,
    ...(data.airlineIata         !== undefined ? { airlineIata: data.airlineIata.toUpperCase() } : {}),
    ...(data.alwaysBusinessClass !== undefined ? { alwaysBusinessClass: data.alwaysBusinessClass } : {}),
    ...(data.winterOnly          !== undefined ? { winterOnly: data.winterOnly }                 : {}),
    ...(data.summerOnly          !== undefined ? { summerOnly: data.summerOnly }                 : {}),
    ...(data.daysOfWeek          !== undefined ? { daysOfWeek: Array.isArray(data.daysOfWeek) ? data.daysOfWeek : [] } : {}),
    ...(data.validFrom           !== undefined ? { validFrom: data.validFrom }                   : {}),
    ...(data.validUntil          !== undefined ? { validUntil: data.validUntil }                 : {}),
    updatedAt: new Date().toISOString(),
  };
  const wrote = await safeRedisHSet(SPECIFIC_FLIGHTS_KEY, fn, JSON.stringify(updated));
  if (!wrote) return { ok: false, status: 503, error: 'Redis nedostupan — pokušajte ponovo' };
  return { ok: true, flight: updated };
}

export async function deleteSpecificFlightFromStore(flightNumber: string): Promise<SpecificFlight | null> {
  const fn = flightNumber.toUpperCase();
  const existing = await getSpecificFlightFromStore(fn);
  if (!existing) return null;
  await safeRedisHDel(SPECIFIC_FLIGHTS_KEY, fn);
  return existing;
}

// ════════════════════════════════════════════════════════════
// DESTINACIJE (field = "destinationCode:airlineIata" kompozitni ključ)
// ════════════════════════════════════════════════════════════
export async function getAllDestinationsFromStore(): Promise<Destination[]> {
  const all = Object.values(await readAll<Destination>(DESTINATIONS_KEY));
  // Isti redoslijed kao stari SQL `orderBy(desc(createdAt))`.
  return all.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getDestinationFromStore(destinationCode: string, airlineIata: string): Promise<Destination | null> {
  const all = await readAll<Destination>(DESTINATIONS_KEY);
  return all[destKey(destinationCode, airlineIata)] ?? null;
}

export async function createDestinationInStore(data: {
  destinationCode: string; destinationName: string; airlineIata: string;
  hasBusinessClass?: boolean;
  winterSchedule?: DestinationSeasonSchedule; summerSchedule?: DestinationSeasonSchedule;
}): Promise<{ ok: true; destination: Destination } | { ok: false; status: number; error: string }> {
  const key = destKey(data.destinationCode, data.airlineIata);
  if (await getDestinationFromStore(data.destinationCode, data.airlineIata)) {
    return { ok: false, status: 400, error: 'Ova destinacija već postoji za ovu avio kompaniju' };
  }
  const now = new Date().toISOString();
  const destination: Destination = {
    id: Date.now(),
    destinationCode: data.destinationCode.toUpperCase(),
    destinationName: data.destinationName,
    airlineIata: data.airlineIata.toUpperCase(),
    hasBusinessClass: !!data.hasBusinessClass,
    winterSchedule: data.winterSchedule ?? DEFAULT_DEST_SCHEDULE,
    summerSchedule: data.summerSchedule ?? DEFAULT_DEST_SCHEDULE,
    createdAt: now,
    updatedAt: now,
  };
  const wrote = await safeRedisHSet(DESTINATIONS_KEY, key, JSON.stringify(destination));
  if (!wrote) return { ok: false, status: 503, error: 'Redis nedostupan — pokušajte ponovo' };
  return { ok: true, destination };
}

export async function updateDestinationInStore(destinationCode: string, airlineIata: string, data: Partial<{
  destinationName: string; hasBusinessClass: boolean;
  winterSchedule: DestinationSeasonSchedule; summerSchedule: DestinationSeasonSchedule;
}>): Promise<{ ok: true; destination: Destination } | { ok: false; status: number; error: string }> {
  const key = destKey(destinationCode, airlineIata);
  const existing = await getDestinationFromStore(destinationCode, airlineIata);
  if (!existing) return { ok: false, status: 404, error: 'Destinacija nije pronađena' };
  const updated: Destination = {
    ...existing,
    ...(data.destinationName  !== undefined ? { destinationName: data.destinationName }   : {}),
    ...(data.hasBusinessClass !== undefined ? { hasBusinessClass: data.hasBusinessClass } : {}),
    winterSchedule: data.winterSchedule ?? existing.winterSchedule ?? DEFAULT_DEST_SCHEDULE,
    summerSchedule: data.summerSchedule ?? existing.summerSchedule ?? DEFAULT_DEST_SCHEDULE,
    updatedAt: new Date().toISOString(),
  };
  const wrote = await safeRedisHSet(DESTINATIONS_KEY, key, JSON.stringify(updated));
  if (!wrote) return { ok: false, status: 503, error: 'Redis nedostupan — pokušajte ponovo' };
  return { ok: true, destination: updated };
}

export async function deleteDestinationFromStore(destinationCode: string, airlineIata: string): Promise<boolean> {
  const key = destKey(destinationCode, airlineIata);
  if (!(await getDestinationFromStore(destinationCode, airlineIata))) return false;
  await safeRedisHDel(DESTINATIONS_KEY, key);
  return true;
}
