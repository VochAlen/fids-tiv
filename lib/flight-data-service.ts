// lib/flight-data-service.ts
import { getRedisClient } from '@/lib/redis';
import { FlightBackupService } from '@/lib/backup/flight-backup-service';
import { FlightAutoProcessor, type AutoProcessedFlight } from '@/lib/backup/flight-auto-processor';
import type { Flight, FlightData, RawFlightData } from '@/types/flight';
import {
  mapNgrokFlightToFlight,
  type NgrokFlightRaw,
  expandFlightForMultipleGates,
  sortFlightsByTime,
  filterTodayFlights
} from '@/lib/flight-api-helpers';
import { cleanupRedisTTLs } from '@/lib/redis-cleanup';

import { isNightHours, getPodgoricaDateString } from '@/lib/night-hours';

// ── CACHE CONSTANTS ───────────────────────────────────────────
const FLIGHT_CACHE_KEY = 'cache:flights:tivat';
// const FLIGHT_CACHE_TTL_SECONDS = 180;
const FLIGHT_CACHE_TTL_SECONDS = 240;
const FLIGHT_META_KEY = 'cache:flights:meta';

// ── PREKIDAČ ZA BACKUP SISTEM ──────────────────────────────────
// Promijeni na false da potpuno isključiš korišćenje backup podataka
// (kad live API padne, prikazaće se prazan/error state umjesto starog rasporeda).
const BACKUP_ENABLED = false;

// ── IN-PROCESS OVERRIDE CACHE ─────────────────────────────────
let overrideCacheData: Record<string, Record<string, string>> = {};
let overrideCacheExpiry = 0;
const OVERRIDE_CACHE_MS = 10_000;

// ── IN-PROCESS FLIGHT DATA CACHE ──────────────────────────────
let inProcessFlightData: FlightData | null = null;
let inProcessFlightExpiry = 0;
const IN_PROCESS_FLIGHT_TTL_MS = 60_000;

// ── REDIS CLEANUP ──────────────────────────────────────────────
let lastRedisCleanup = 0;
const REDIS_CLEANUP_INTERVAL_MS = 12 * 60 * 60 * 1000;

// ── Sopstveni ngrok proxy umjesto direktnog poziva ka montenegroairports.com.
// MORA biti deklarisano PRIJE FETCH_HEADERS ispod, jer FETCH_HEADERS
// koristi PROXY_SECRET — const deklaracije u JS/TS nisu dostupne prije
// svoje linije (temporal dead zone), pa obrnut redoslijed puca na builds.
const FLIGHT_API_URL = process.env.FLIGHT_PROXY_URL || 'https://crafty-dumpling-molehill.ngrok-free.dev/schedule';
const PROXY_SECRET = process.env.FLIGHT_PROXY_SECRET || '';

// ── Header-i za poziv ka SOPSTVENOM ngrok proxy-ju. Chrome-spoofing
// header-i više nisu potrebni jer se poziva vlastiti server, ne tuđi.
// ngrok-skip-browser-warning je bitan za besplatne ngrok-free domene —
// bez njega ngrok ponekad vraća HTML interstitial umjesto JSON-a.
const FETCH_HEADERS = {
  'Accept': 'application/json',
  'x-proxy-secret': PROXY_SECRET,
  'ngrok-skip-browser-warning': 'true',
} as const;

const SLIM_FIELDS = [
  'FlightNumber',
  'FlightType',
  'AirlineName',
  'AirlineICAO',
  'AirlineLogoURL',
  'DestinationCityName',
  'DestinationAirportCode',
  'ScheduledDepartureTime',
  'EstimatedDepartureTime',
  'StatusEN',
  'GateNumber',
  'CheckInDesk',
  'BaggageReclaim',
  'Terminal',
  'CodeShareFlights',
  '_sortTime',
] as const;

type SlimFlight = Pick<Flight, typeof SLIM_FIELDS[number]>;

function slimFlight(f: Flight): SlimFlight {
  const out = {} as SlimFlight;
  for (const key of SLIM_FIELDS) {
    if (key in f) (out as any)[key] = (f as any)[key];
  }
  return out;
}

function slimFlightData(data: FlightData): FlightData {
  return {
    ...data,
    departures: data.departures.map(slimFlight) as Flight[],
    arrivals:   data.arrivals.map(slimFlight)   as Flight[],
  };
}

// ── RETRY / TIMEOUT BUDŽETI ─────────────────────────────────────
// Usklađeno sa maxDuration=30 u route.ts. Izvor podataka sad ide
// preko lanca desktop → ngrok tunel → tiv.nais.aero — INHERENTNO
// manje pouzdano od direktnog poziva starom API-ju (tri karike koje
// mogu zakazati umjesto jedne: desktop se može ugasiti, ngrok tunel
// može pući, WiFi može otkazati). Zato je budžet OVDJE namjerno
// konzervativniji, ne velikodušniji — kad proxy najviše zakaže,
// funkcija ne smije najduže čekati.
const MAX_RETRIES = 2;               // bilo 5
const RETRY_DELAY = 800;             // bilo 1500
const PER_ATTEMPT_TIMEOUT_MS = 6000; // bilo hardkodirano 8000 unutar fetchWithQuickRetry

// Tvrd, apsolutni rok za CIJELU live-fetch fazu (svi pokušaji zajedno).
// Matematika: 2 × 6000 + 1 × 800 = 12.800ms worst-case iz retry logike,
// 15.000ms ovdje ostavlja mali safety margin. Promise.race garantuje
// da ova faza NIKAD ne pređe ovaj rok, bez obzira šta se dešava unutar
// fetchWithQuickRetry (retry logika treba sama da završi ranije, ovo
// je apsolutna gornja granica "za svaki slučaj").
const LIVE_FETCH_HARD_DEADLINE_MS = 15000;

// Emergency fetch (korak 5, zadnja linija odbrane) — smanjeno sa
// 10000 na 6000, jer se dešava TEK NAKON što je live fetch već
// potrošio svoj budžet.
const EMERGENCY_FETCH_TIMEOUT_MS = 6000;

// Ukupan worst-case sad: ~15s (live) + ~6s (emergency) + ~1-2s (ostalo)
// ≈ 22-23s, i dalje udobno ispod maxDuration=30 (≈7-8s margin) — čak
// i sa manje pouzdanim ngrok/desktop lancem.

// ── FETCH LOCK ────────────────────────────────────────────────
// NAPOMENA: komentar ispod je bio zastario (referencirao je stare
// brojeve 10 pokušaja × 10s ≈ 120s koji više ne postoje u kodu).
// Sad usklađeno sa stvarnim worst-case budžetom iznad (~22s), plus
// dobra margina. Kraći TTL takođe znači: ako Vercel NASILNO ubije
// funkciju zbog maxDuration dok drži lock (finally blok se tada možda
// NE izvrši), lock se sam "izliječi" mnogo brže — 60s umjesto 130s
// blokiranja ostalih ciklusa.
const FETCH_LOCK_KEY = 'lock:flights:fetch';
const FETCH_LOCK_TTL_SECONDS = 60; // bilo 130
const LOCK_WAIT_POLL_MS = 500;
const LOCK_WAIT_MAX_MS = 25000; // bilo 30000 — usklađeno sa novim, kraćim worst-case

function generateLockToken(): string {
  return `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

// Atomic "obriši SAMO ako je ovo moj lock" — sprečava scenario gdje
// instanca A obriše lock koji trenutno drži instanca B (npr. A-in lock
// je istekao pa ga je B zauzeo, a A tek sad stiže do finally).
const UNLOCK_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end
`;

// ── REDIS CLEANUP ──────────────────────────────────────────────
// Throttle: opportunistic cleanup iz live traffic-a, najviše 1x/12h.
// Glavni cleanup i dalje ide preko cron rute /api/cron/redis-cleanup (03:00),
// ovo je samo dodatna zaštitna mreža ako cron ne stigne/padne.
async function runRedisCleanupIfNeeded(): Promise<void> {
  if (Date.now() - lastRedisCleanup < REDIS_CLEANUP_INTERVAL_MS) return;
  lastRedisCleanup = Date.now();

  cleanupRedisTTLs().catch(e => {
    console.error('⚠️ Redis cleanup failed (non-critical):', e);
  });
}

async function getFlightDataFromCache(): Promise<FlightData | null> {
  const now = Date.now();
  if (inProcessFlightData && now < inProcessFlightExpiry) {
    return inProcessFlightData;
  }
  try {
    const client = getRedisClient();
    const cached = await client.get(FLIGHT_CACHE_KEY);
    if (cached) {
      const parsed = JSON.parse(cached) as FlightData;
      inProcessFlightData = parsed;
      inProcessFlightExpiry = now + IN_PROCESS_FLIGHT_TTL_MS;
      return parsed;
    }
  } catch {
    // tiho — cache miss
  }
  return null;
}

async function saveFlightDataAndMetadata(
  slimmed: FlightData,
  source: string,
  ttlSeconds: number = FLIGHT_CACHE_TTL_SECONDS
): Promise<void> {
  try {
    const client = getRedisClient();

    const hash = Buffer.from(JSON.stringify({
      d: slimmed.departures.map(f => `${f.FlightNumber}|${f.GateNumber}|${f.CheckInDesk}|${f.StatusEN}|${f.EstimatedDepartureTime}`),
      a: slimmed.arrivals.map(f => `${f.FlightNumber}|${f.GateNumber}|${f.StatusEN}`),
    })).toString('base64').substring(0, 32);

    const meta = {
      hash,
      count: slimmed.departures.length + slimmed.arrivals.length,
      lastModified: new Date().toISOString(),
      source,
    };

    const pipeline = client.pipeline();
    pipeline.setex(FLIGHT_CACHE_KEY, ttlSeconds, JSON.stringify(slimmed));
    pipeline.setex(FLIGHT_META_KEY, ttlSeconds, JSON.stringify(meta));
    await pipeline.exec();
  } catch (e) {
    console.warn('⚠️ Failed to save flight data/metadata:', e);
  }

  inProcessFlightData = slimmed;
  inProcessFlightExpiry = Date.now() + IN_PROCESS_FLIGHT_TTL_MS;
}

// ── Normalizuje odgovor eksternog API-ja u niz letova, bez obzira na
// tačan oblik koji PHP keš skripta vrati. cache-flights.php je server-side
// keš fajl koji se periodično regeneriše — u tom prozoru može vratiti
// null, {}, {"error": "..."} ili slično umjesto praznog niza. Ovo NIKAD
// ne baca grešku zbog oblika — nepoznat/prazan oblik se tretira kao
// "trenutno nema letova", ne kao kvar sistema. ─────────────────────────
function normalizeRawFlightArray(payload: unknown): RawFlightData[] {
  // Najčešći, ispravan slučaj
  if (Array.isArray(payload)) return payload as RawFlightData[];

  // null / undefined → nema podataka
  if (payload === null || payload === undefined) {
    console.warn('⚠️ Live API vratio null/undefined — tretiram kao 0 letova');
    return [];
  }

  // boolean / string / number → nešto neočekivano, ali i dalje ne rušimo sistem
  if (typeof payload !== 'object') {
    console.warn(`⚠️ Live API vratio primitivan tip (${typeof payload}) — tretiram kao 0 letova:`, payload);
    return [];
  }

  // Objekat — probaj naći niz unutar poznatih wrapper ključeva
  const obj = payload as Record<string, unknown>;
  const candidateKeys = ['data', 'flights', 'result', 'results', 'response', 'items', 'Flights'];
  for (const key of candidateKeys) {
    if (Array.isArray(obj[key])) {
      console.warn(`⚠️ Live API vratio objekat sa nizom unutar "${key}" — koristim taj niz`);
      return obj[key] as RawFlightData[];
    }
  }

  // Objekat bez prepoznatog niza (npr. {"error": "..."}, {} ili {"status": "..."})
  console.warn('⚠️ Live API vratio objekat bez prepoznatog niza letova — tretiram kao 0 letova:',
    JSON.stringify(obj).substring(0, 500));
  return [];
}

async function fetchWithQuickRetry(
  url: string,
  options: RequestInit,
  retries = MAX_RETRIES
): Promise<Response> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), PER_ATTEMPT_TIMEOUT_MS);
      const response = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(timeoutId);
      if (response.ok) return response;

      // ── PRIVREMENO: uhvati tijelo 400 odgovora da vidimo TAČAN uzrok —
      // da li je to ngrok-ov error/interstitial page, ili nešto iz
      // proxy-server.js, ili nešto treće. Bez ovoga pucamo u mrak.
      let bodyPreview = '';
      try {
        bodyPreview = (await response.clone().text()).substring(0, 500);
      } catch {
        bodyPreview = '(tijelo nije moglo biti pročitano)';
      }
      console.error(`❌ HTTP ${response.status} on attempt ${attempt}/${retries} — body: ${bodyPreview}`);
      console.error(`   → URL: ${url}`);
      console.error(`   → Headers sent:`, JSON.stringify(options.headers));

      if (attempt < retries) await new Promise(r => setTimeout(r, RETRY_DELAY));
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      console.error(`❌ Fetch attempt ${attempt}/${retries} failed: ${errMsg}`);
      if (attempt < retries) await new Promise(r => setTimeout(r, RETRY_DELAY));
    }
  }
  throw new Error(`Live API fetch failed after ${retries} attempts`);
}

async function performEmergencyFetch(): Promise<Flight[] | null> {
  try {
    const emergencyResponse = await fetch(FLIGHT_API_URL, {
      method: 'GET',
      cache: 'no-store',
      headers: FETCH_HEADERS,
      signal: AbortSignal.timeout(EMERGENCY_FETCH_TIMEOUT_MS),
    });
    if (!emergencyResponse.ok) return null;

    const rawData: NgrokFlightRaw[] = await emergencyResponse.json();
    if (!Array.isArray(rawData) || rawData.length === 0) return null;

    const mapped = await Promise.all(rawData.slice(0, 5).map(raw => mapNgrokFlightToFlight(raw)));
    return mapped;
  } catch {
    return null;
  }
}

function removeDuplicateFlights(flights: Flight[]): Flight[] {
  const seen = new Map<string, Flight>();
  flights.forEach(flight => {
    const key = `${flight.FlightNumber}-${flight.ScheduledDepartureTime}-${flight.FlightType}`;
    if (seen.has(key)) {
      const existing = seen.get(key)!;
      if ((flight.GateNumber && !existing.GateNumber) || (flight.CheckInDesk && !existing.CheckInDesk)) {
        seen.set(key, flight);
      }
    } else {
      seen.set(key, flight);
    }
  });
  return Array.from(seen.values());
}

function applyDefaultBaggageBelt(arrivals: Flight[]): Flight[] {
  return arrivals.map(flight => {
    const statusLower = (flight.StatusEN || '').toLowerCase();
    const isArrived = statusLower.includes('arrived') || statusLower.includes('sletio') || statusLower.includes('landed');
    if (!isArrived && !flight.BaggageReclaim) {
      return { ...flight, BaggageReclaim: '2' };
    }
    return flight;
  });
}

// ── Računa koliko je minuta prošlo od planiranog/procijenjenog vremena leta,
// u odnosu na SADAŠNJI trenutak. Handluje prelaz preko ponoći. Vraća null
// ako vrijeme nije moguće parsirati.
function minutesSinceFlightTime(timeStr: string | undefined): number | null {
  if (!timeStr || timeStr === '--:--') return null;
  const [hours, minutes] = timeStr.split(':').map(Number);
  if (isNaN(hours) || isNaN(minutes)) return null;

  const now = new Date();
  const flightDate = new Date(now);
  flightDate.setHours(hours, minutes, 0, 0);

  let diffMs = now.getTime() - flightDate.getTime();
  const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000;

  if (diffMs > TWELVE_HOURS_MS) {
    flightDate.setDate(flightDate.getDate() + 1);
    diffMs = now.getTime() - flightDate.getTime();
  } else if (diffMs < -TWELVE_HOURS_MS) {
    flightDate.setDate(flightDate.getDate() - 1);
    diffMs = now.getTime() - flightDate.getTime();
  }

  return Math.floor(diffMs / 60_000);
}

// ── Filtrira letove koji su VEĆ poletjeli/sletjeli po tekstu statusa —
// koristi se SAMO u BACKUP granama (kad ngrok proxy nije dostupan).
function filterOutCompletedFlights<T extends Flight>(flights: T[]): T[] {
  return flights.filter(flight => {
    const statusLower = (flight.StatusEN || '').toLowerCase();
    const isDeparted = statusLower.includes('departed') || statusLower.includes('poletio');
    const isArrived =
      statusLower.includes('arrived') ||
      statusLower.includes('sletio') ||
      statusLower.includes('landed');
    return !(isDeparted || isArrived);
  });
}

// ── Filtrira letove čije je planirano/procijenjeno vrijeme više od
// cutoffMinutes U PROŠLOSTI — hvata letove čiji je status u starom
// backupu ostao zastario (npr. i dalje piše "Scheduled" iako je let
// odavno otišao dok je tvoj računar bio ugašen).
function filterOutStaleFlights<T extends Flight>(flights: T[], cutoffMinutes: number = 30): T[] {
  return flights.filter(flight => {
    const timeStr = flight.EstimatedDepartureTime || flight.ScheduledDepartureTime;
    const minutesSince = minutesSinceFlightTime(timeStr);
    if (minutesSince === null) return true;
    return minutesSince <= cutoffMinutes;
  });
}

async function buildFlightData(
  rawFlights: Flight[],
  source: 'live' | 'backup' | 'auto-processed' | 'emergency',
  lastUpdated: string,
  options?: { isOfflineMode?: boolean; warning?: string; backupTimestamp?: string; autoProcessedCount?: number; isNightMode?: boolean }
): Promise<FlightData> {
  const departures = sortFlightsByTime(rawFlights.filter(f => f.FlightType === 'departure'));
  let arrivals = sortFlightsByTime(rawFlights.filter(f => f.FlightType === 'arrival'));

  arrivals = applyDefaultBaggageBelt(arrivals);

  return {
    departures,
    arrivals,
    lastUpdated,
    source,
    totalFlights: departures.length + arrivals.length,
    isOfflineMode: options?.isOfflineMode ?? false,
    isNightMode: options?.isNightMode ?? false,   // ← NOVO
    ...(options?.warning && { warning: options.warning }),
    ...(options?.backupTimestamp && { backupTimestamp: options.backupTimestamp }),
    ...(options?.autoProcessedCount !== undefined && { autoProcessedCount: options.autoProcessedCount }),
  };
}

// ── GLAVNA FUNKCIJA — pozivaju je i /api/flights ruta i cleanup-overrides cron,
// direktno, bez HTTP self-fetch-a ──────────────────────────────────────────
export async function getCurrentFlightData(): Promise<FlightData> {
 const nightNow = isNightHours();   // ← izračunaj JEDNOM, koristi svuda ispod
  // ── 1. PROVJERI CACHE PRVO (in-process → Redis) ──────────
  const cached = await getFlightDataFromCache();
  if (cached) {
    // ── JUTARNJI PRELAZ: ako je keširan podatak markiran kao NOĆNI,
    // a sada VIŠE nije noć — odbaci ga i uradi svjež live fetch.
    // Sprečava da se ujutro (npr. 04:00–04:30) i dalje prikazuje stari
    // prazan/noćni cache dok mu TTL (do 1h) sam ne istekne.
    if (!(cached.isNightMode && !nightNow)) {
      return cached;
    }
    console.log('🌅 Prelazak iz noći u dan — odbacujem stari noćni cache, radim svjež live fetch');
    // ne vraćamo cached — nastavljamo dolje na svjež fetch
  }

  // ── 2. REDIS CLEANUP (background, ne blokira) ─────────────
  runRedisCleanupIfNeeded().catch(() => {});

  const backupService = FlightBackupService.getInstance();

// ── 2.5 NOĆNA PAUZA — probaj live fetch najviše 1x na sat, inače koristi zadnji keširan live rezultat ──
const NIGHT_FETCH_INTERVAL_SECONDS = 3600; // 1 sat
const NIGHT_CACHE_TTL_SECONDS = NIGHT_FETCH_INTERVAL_SECONDS; // cache noću traje koliko i interval fetch-a

if (isNightHours()) {
  const client = getRedisClient();
  const nightFetchGateKey = 'night:fetch:gate';

  // Atomic: uspije samo ako ključ ne postoji (znači nije fetch-ovano u zadnjih 1h)
  const canFetchNow = await client.set(nightFetchGateKey, '1', 'EX', NIGHT_FETCH_INTERVAL_SECONDS, 'NX');

if (!canFetchNow) {
    // Već smo probali live fetch ovog sata — ne gađaj API ponovo.
    // Cache je ovdje garantovano prazan (inače bi već bio vraćen u koraku 1),
    // pa ne pravimo dodatni Redis poziv — direktno vraćamo prazan noćni odgovor.
    console.log('🌙 Noćni period — live fetch već probavan u zadnjih 1h, nema keširanih podataka');

    return {
      departures: [],
      arrivals: [],
      lastUpdated: new Date().toISOString(),
      source: 'emergency',
      isOfflineMode: true,
      isNightMode: nightNow,
      totalFlights: 0,
      warning: 'Aerodrom trenutno ne radi (noćna pauza). Nema keširanih live podataka.',
    };
  }

  // canFetchNow === 'OK' → dozvoljeno, probaj live fetch ovog sata.
  // Ne vraćamo se ovdje — nastavljamo dolje na korak 3 (live fetch) kao inače.
  console.log('🌙 Noćni period — probam live fetch (dozvoljeno 1x/h)');
}

  // ── 3. POKUŠAJ LIVE FETCH ─────────────────────────────────
  try {
  const response = await Promise.race([
    fetchWithQuickRetry(FLIGHT_API_URL, {
      method: 'GET',
      cache: 'no-store',
      headers: FETCH_HEADERS,
    }),
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error('Live fetch hard deadline exceeded')),
        LIVE_FETCH_HARD_DEADLINE_MS
      )
    ),
  ]);

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

const rawPayload: unknown = await response.json();
const rawData: NgrokFlightRaw[] = normalizeRawFlightArray(rawPayload) as unknown as NgrokFlightRaw[];

if (!Array.isArray(rawData)) throw new Error('Invalid data format');

    console.log(`✅ Live fetch: ${rawData.length} flights`);

    const mappedFlights = await Promise.all(rawData.map((raw: NgrokFlightRaw) => mapNgrokFlightToFlight(raw)));
    let todayFlights = filterTodayFlights(mappedFlights);
    todayFlights = removeDuplicateFlights(todayFlights);

    const expandedFlights: Flight[] = [];
    todayFlights.forEach(flight => {
      if ((flight.GateNumber?.includes(',')) || (flight.CheckInDesk?.includes(','))) {
        expandedFlights.push(...expandFlightForMultipleGates(flight));
      } else {
        expandedFlights.push(flight);
      }
    });

const finalFlights = removeDuplicateFlights(expandedFlights);

// ── Svaki uspješan fetch sa ngrok proxy-ja osvježava backup, tako da kad
// tvoj računar/ngrok kasnije padne, backup ima najsvježiji mogući podatak.
// Namjerno se NE piše kad je finalFlights prazan (0 letova) — to bi moglo
// prepisati dobar, pun backup praznim rezultatom.
if (finalFlights.length > 0) {
  try {
    await backupService.saveBackup(finalFlights);
  } catch (e) {
    console.error('⚠️ Backup save failed:', e);
  }
} else {
  console.warn('⚠️ Live vratio 0 letova — preskačem backup save da ne pregazim dobar backup');
}
// isto u lib/flight-data-service.ts — unutar step 3, blok "finalFlights.length === 0":

if (finalFlights.length === 0 && BACKUP_ENABLED) {
  const existingBackup = await backupService.getLatestBackup();
  
  const todayPodgorica = getPodgoricaDateString();

if (existingBackup.flights.length > 0 && existingBackup.date === todayPodgorica) {
    const filteredBackupFlights = filterOutStaleFlights(filterOutCompletedFlights(existingBackup.flights));
    const bd = await buildFlightData(filteredBackupFlights, 'backup', existingBackup.timestamp, {
      isOfflineMode: true,
      backupTimestamp: existingBackup.timestamp,
      warning: 'Nema aktivnih letova (noćna pauza ili API pauza). Prikazan zadnji poznati raspored.',
    });
    const slimmed = slimFlightData(bd);
    await saveFlightDataAndMetadata(slimmed, 'backup');
    return slimmed;
  } else if (existingBackup.flights.length > 0) {
    // backup postoji, ali NIJE od danas — ne smijemo ga tiho prikazati
    // kao da je današnji raspored. Radije padamo dalje na BACKUP MODE / emergency,
    // koji će sami odlučiti (i tamo je ista provjera ispravljena ispod).
    console.warn(`⚠️ Live vratio 0 letova, backup postoji ali je od ${existingBackup.date} (ne od danas ${todayPodgorica}) — preskačem ga`);
  }
}

const flightData = await buildFlightData(finalFlights, 'live', new Date().toISOString(), { isNightMode: nightNow });
    const slimmed = slimFlightData(flightData);

await saveFlightDataAndMetadata(slimmed, 'live', nightNow ? NIGHT_CACHE_TTL_SECONDS : FLIGHT_CACHE_TTL_SECONDS);

    console.log(`📊 Live: ${flightData.departures.length} dep, ${flightData.arrivals.length} arr`);

    return slimmed;

  } catch (liveError) {
    console.error('❌ Live API failed:', liveError instanceof Error ? liveError.message : liveError);
  }

// ── 4. BACKUP MODE ────────────────────────────────────────

try {
  if (!BACKUP_ENABLED) {
    return {
      departures: [],
      arrivals: [],
      totalFlights: 0,
      lastUpdated: new Date().toISOString(),
      source: 'emergency',
      isOfflineMode: true,
      warning: 'Live API nedostupan. Backup je isključen — nema podataka za prikaz.',
    };
  }
  const latestBackup = await backupService.getLatestBackup();
  const today = getPodgoricaDateString(); // ← bilo: new Date().toISOString().split('T')[0]

  if (latestBackup.flights.length > 0 && latestBackup.date === today) {
    console.log(`🔄 Using backup: ${latestBackup.flights.length} flights from today (${latestBackup.timestamp})`);

const processor = new FlightAutoProcessor(latestBackup.flights);
    const processedFlights = processor.processFlights();
    const simulatedFlights = FlightAutoProcessor.simulateRealTimeProgress(processedFlights);

    const filteredSimulatedFlights = filterOutStaleFlights(filterOutCompletedFlights(simulatedFlights));
    const autoProcessedCount = filteredSimulatedFlights.filter((f: AutoProcessedFlight) => f.AutoProcessed).length;
    const source = autoProcessedCount > 0 ? 'auto-processed' : 'backup';

const flightData = await buildFlightData(
  filteredSimulatedFlights,
  source,
  latestBackup.timestamp,
  {
    isOfflineMode: true,
    isNightMode: nightNow,   // ← DODATO
    backupTimestamp: latestBackup.timestamp,
    autoProcessedCount,
    warning: 'Using backup data. Live API temporarily unavailable.',
  }
);

    const slimmed = slimFlightData(flightData);
    await saveFlightDataAndMetadata(slimmed, source);
    return slimmed;
  } else {
    // Backup je star ili prazan – vrati prazan odgovor
    console.warn('⚠️ Backup is from a previous day or empty – returning no-data state');
    return {
      departures: [],
      arrivals: [],
      totalFlights: 0,
      lastUpdated: new Date().toISOString(),
      source: 'emergency',  // ← ispravljeno
      isOfflineMode: true,
      warning: 'Trenutno nema dostupnih podataka o letovima. Molimo pokušajte ponovo za nekoliko minuta.',
    };
  }
} catch (backupError) {
  console.error('❌ Backup system failed:', backupError instanceof Error ? backupError.message : backupError);
}

  // ── 5. EMERGENCY FETCH ────────────────────────────────────
  const emergencyFlights = await performEmergencyFetch();

  if (emergencyFlights && emergencyFlights.length > 0) {
    await backupService.saveBackup(emergencyFlights);
    const processor = new FlightAutoProcessor(emergencyFlights);
    const processedFlights = processor.processFlights();

const flightData = await buildFlightData(
  processedFlights,
  'emergency',
  new Date().toISOString(),
  { isOfflineMode: true, isNightMode: nightNow, warning: 'Emergency mode: Using directly fetched data.' }
);

    const slimmed = slimFlightData(flightData);
    await saveFlightDataAndMetadata(slimmed, 'emergency');

    return slimmed;
  }

  // ── 6. CRITICAL FAILURE ───────────────────────────────────
  return {
    departures: [],
    arrivals: [],
    lastUpdated: new Date().toISOString(),
    source: 'emergency',
    isOfflineMode: true,
    totalFlights: 0,
    error: 'All data sources unavailable.',
    warning: 'System will recover when connection is restored.',
  };
}

export async function getCurrentFlightDataSafe(): Promise<FlightData> {
  // 1. Keš prvo — najčešći put, bez ikakvog Redis lock overhead-a.
  const cached = await getFlightDataFromCache();
  if (cached) return cached;

  const client = getRedisClient();
  const token = generateLockToken();
  const gotLock = await client.set(FETCH_LOCK_KEY, token, 'EX', FETCH_LOCK_TTL_SECONDS, 'NX');

  if (gotLock) {
    // Ja sam nosilac locka ovog ciklusa — JA radim fetch ka proxy-ju,
    // svi ostali istovremeni pozivi idu u granu ispod i čekaju MOJ rezultat.
    try {
      return await getCurrentFlightData();
    } finally {
      try {
        await client.eval(UNLOCK_SCRIPT, 1, FETCH_LOCK_KEY, token);
      } catch (e) {
        console.warn('⚠️ Unlock failed (nekritično, lock će isteći sam za', FETCH_LOCK_TTL_SECONDS, 's):', e);
      }
    }
  }

  // Neko drugi već radi fetch ovog ciklusa — čekamo NJEGOV rezultat u kešu,
  // ne pokrećemo svoj fetch. Ovo garantuje tačno 1 poziv ka ngrok proxy-ju
  // po ciklusu, bez obzira na broj istovremenih korisnika na FIDS ekranu.
  const deadline = Date.now() + LOCK_WAIT_MAX_MS;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, LOCK_WAIT_POLL_MS));
    const retryCache = await getFlightDataFromCache();
    if (retryCache) return retryCache;
  }

  // Predugo čekanje — nosilac locka je vjerovatno spor/zaglavljen.
  // NE radimo fetch ovdje (to bi narušilo garanciju), vraćamo best-effort stanje.
  console.warn('⚠️ Lock držan predugo od druge instance — vraćam privremeno emergency stanje bez dodatnog fetcha');
  return {
    departures: [],
    arrivals: [],
    lastUpdated: new Date().toISOString(),
    source: 'emergency',
    isOfflineMode: true,
    totalFlights: 0,
    warning: 'Podaci se trenutno ažuriraju, pokušajte ponovo za par sekundi.',
  };
}