// lib/flight-data-service.ts
import { getRedisClient } from '@/lib/redis';
import { FlightBackupService } from '@/lib/backup/flight-backup-service';
import { FlightAutoProcessor, type AutoProcessedFlight } from '@/lib/backup/flight-auto-processor';
import type { Flight, FlightData, RawFlightData } from '@/types/flight';
import {
  mapRawFlight,
  expandFlightForMultipleGates,
  sortFlightsByTime,
  filterTodayFlights
} from '@/lib/flight-api-helpers';
import { cleanupRedisTTLs } from '@/lib/redis-cleanup';

import { isNightHours, getPodgoricaDateString } from '@/lib/night-hours';
// ── FETCH LOCK — garantuje da se live fetch dešava max 1x po ciklusu,
// bez obzira koliko istovremenih poziva stigne iz drugih fajlova/instanci.
const FETCH_LOCK_KEY = 'lock:flights:fetch';
// Mora biti veći od worst-case trajanja cijele fetch faze (~22-23s po
// komentarima gore) — inače lock istekne dok fetch još traje i neko
// drugi krene paralelno.
const FETCH_LOCK_TTL_SECONDS = 28;
const LOCK_WAIT_POLL_MS = 300;
// Koliko čekamo da TUĐI fetch završi prije nego odustanemo (ne radimo
// svoj fetch nikad u ovoj grani — to bi narušilo "1 fetch po ciklusu").
const LOCK_WAIT_MAX_MS = 12000;

function generateLockToken(): string {
  return `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

// Atomic "obriši SAMO ako je ovo moj lock" — Lua skripta, da izbjegnemo
// scenario gdje instanca A obriše lock koji trenutno drži instanca B
// (npr. A-in lock je istekao pa ga je B zauzeo, a A tek sad stiže do finally).
const UNLOCK_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end
`;

// ── CACHE CONSTANTS ───────────────────────────────────────────
const FLIGHT_CACHE_KEY = 'cache:flights:tivat';
// const FLIGHT_CACHE_TTL_SECONDS = 180;
const FLIGHT_CACHE_TTL_SECONDS = 240;
const FLIGHT_META_KEY = 'cache:flights:meta';

// ── PREKIDAČ ZA BACKUP SISTEM ──────────────────────────────────
// Promijeni na false da potpuno isključiš korišćenje backup podataka
// (kad live API padne, prikazaće se prazan/error state umjesto starog rasporeda).
const BACKUP_ENABLED = true;

// ── IN-PROCESS OVERRIDE CACHE ─────────────────────────────────
let overrideCacheData: Record<string, Record<string, string>> = {};
let overrideCacheExpiry = 0;
const OVERRIDE_CACHE_MS = 10_000;

// ── IN-PROCESS FLIGHT DATA CACHE ──────────────────────────────
// TTL namjerno usklađen sa FLIGHT_CACHE_TTL_SECONDS (240s) ispod, ne
// proizvoljno kraći. Ranije je ovo bilo 60_000 dok je Redis TTL bio
// 240s — na toplom instance-u je to tjeralo Redis GET + JSON.parse()
// (stvaran CPU rad, ne I/O čekanje) na svakih 60s, iako se podatak
// ispod njega realno ne mijenja brže od 240s (toliko traje Redis TTL
// prije nego što novi live fetch prepiše vrijednost). Rezultat: 3 od
// svaka 4 parsiranja su bila potpuno nepotrebna — isti JSON, parsiran
// iznova. Sad je ovo tik ispod 240s: dovoljno kratko da nikad ne drži
// podatak nakon što je Redis vrijednost mogla biti osvježena, dovoljno
// dugo da eliminiše te nepotrebne re-parseve. Noćni TTL (3600s) i
// jutarnji prelaz i dalje rade nezavisno od ovoga — provjera
// `cached.isNightMode && !nightNow` se izvršava na SVAKI poziv bez
// obzira na TTL, pa ovo ne unosi stale-data rizik.
let inProcessFlightData: FlightData | null = null;
let inProcessFlightExpiry = 0;
const IN_PROCESS_FLIGHT_TTL_MS = 220_000;

// ── REDIS CLEANUP ──────────────────────────────────────────────
let lastRedisCleanup = 0;
const REDIS_CLEANUP_INTERVAL_MS = 12 * 60 * 60 * 1000;
// ── Header-i uhvaćeni direktno iz pravog Chrome desktop browsera (DevTools
// Network → Copy as fetch, sa isključenom mobile emulacijom) dok učitava
// https://montenegroairports.com/aerodrom-tivat/ — ne ručno pretpostavljeni.
// Verzija Chrome-a (150) i sec-ch-ua header-i moraju ostati međusobno
// konzistentni; ako se ažurira User-Agent verzija, MORA se ažurirati i
// sec-ch-ua string ispod, inače se vraća isti mismatch problem kao ranije
// (kad je User-Agent govorio Android/mobile a sec-ch-ua-platform Windows).
const FETCH_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/javascript, */*; q=0.01',
  'Accept-Language': 'en-US,en;q=0.9,hr;q=0.8',
  'Accept-Encoding': 'gzip, deflate, br',
  'Referer': 'https://montenegroairports.com/aerodrom-tivat/',
  'Origin': 'https://montenegroairports.com',
  'X-Requested-With': 'XMLHttpRequest',
  'sec-ch-ua': '"Not;A=Brand";v="8", "Chromium";v="150", "Google Chrome";v="150"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Windows"',
  'Sec-Fetch-Dest': 'empty',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Site': 'same-origin',
  'Connection': 'keep-alive',
  'DNT': '1',
  'Cache-Control': 'no-cache',
  'Pragma': 'no-cache',
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

const FLIGHT_API_URL = 'https://montenegroairports.com/aerodromixs/cache-flights.php?airport=tv';

// ── RETRY / TIMEOUT BUDŽETI ─────────────────────────────────────
// Ovi brojevi su usklađeni sa maxDuration=30 (eksplicitno postavljen
// u route.ts). Ranija verzija je bila mnogo agresivnija (3500ms po
// pokušaju) jer je tada maxDuration bio na Vercel default-u (15s) i
// trebalo je striktno budžetirati. Sad kad imamo dvostruko veći
// budžet, per-attempt timeout je vraćen bliže originalnoj vrijednosti
// (10s) — jer se pokazalo da montenegroairports.com API zna legitimno
// (ne mrtav, samo spor) odgovoriti sporije od 3.5s, naročito tokom
// perioda kad cache-flights.php interno regeneriše svoj keš. Prekratak
// timeout je tjerao sistem da odustane PRIJE nego što stigne ispravan
// odgovor — pošto je BACKUP_ENABLED false, to je značilo prazan/
// emergency prikaz umjesto ispravnih podataka, iako API nije bio
// zaista nedostupan.
const MAX_RETRIES = 3;               // ukupno pokušaja ka live API-ju — umjereno povećano sa 2
const RETRY_DELAY_BASE = 600;        // bazna pauza za exponential backoff (ms)
const PER_ATTEMPT_TIMEOUT_MS = 6000; // AbortSignal timeout po pokušaju — blago smanjeno da ostavi prostor za 3. pokušaj

// Tvrd, apsolutni rok za CIJELU live-fetch fazu (svi pokušaji zajedno).
// Matematika: 3 × 6000 + (600 + 1200) backoff + jitter margin ≈ 20.000ms
// worst-case iz retry logike, pa 22000ms ovdje ostavlja mali safety margin
// bez da bude prekratak. I dalje je ovo "safety net" iznad per-attempt
// timeouta, ne primarni mehanizam — retry logika treba sama da završi ranije.


// Tvrd, apsolutni rok za CIJELU live-fetch fazu (svi pokušaji zajedno).
// Matematika: 2 × 7000 + 1 × 500 = 14500ms worst-case iz retry logike,
// pa 15000ms ovdje ostavlja mali safety margin bez da bude
// prekratak. I dalje je ovo "safety net" iznad per-attempt timeouta,
// ne primarni mehanizam — retry logika treba sama da završi ranije.
const LIVE_FETCH_HARD_DEADLINE_MS = 22000;

// Emergency fetch (korak 5, "zadnja linija odbrane") — ranije 4000ms,
// vraćeno na 6000ms iz istog razloga kao gore: prekratak timeout je
// tjerao lažne "critical failure" ishode kad je API bio samo spor.
const EMERGENCY_FETCH_TIMEOUT_MS = 6000;

// Ukupan worst-case sad: ~15s (live) + ~6s (emergency) + ~1-2s (ostalo)
// ≈ 22-23s, i dalje udobno ispod maxDuration=30 (≈7-8s margin).

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

      // Uhvati tijelo odgovora prije nego što ga baciš — pomaže da se vidi
      // da li je 500 generička PHP greška, WAF/Cloudflare block stranica,
      // ili nešto treće.
      let bodyPreview = '';
      try {
        bodyPreview = (await response.clone().text()).substring(0, 300);
      } catch {
        bodyPreview = '(tijelo nije moglo biti pročitano)';
      }
      console.error(`❌ HTTP ${response.status} on attempt ${attempt}/${retries} — body: ${bodyPreview}`);

      if (attempt < retries) {
        // Exponential backoff + jitter: 600ms → ~1200ms → ~2400ms, uz malu
        // nasumičnu varijaciju da izbjegnemo savršeno pravilan, mašinski
        // izgledajući obrazac ponavljanja (bitno i zbog WAF-a spomenutog ranije).
        const backoff = RETRY_DELAY_BASE * Math.pow(2, attempt - 1);
        const jitter = Math.random() * 200;
        await new Promise(r => setTimeout(r, backoff + jitter));
      }
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      console.error(`❌ Fetch attempt ${attempt}/${retries} failed: ${errMsg}`);
      if (attempt < retries) {
        const backoff = RETRY_DELAY_BASE * Math.pow(2, attempt - 1);
        const jitter = Math.random() * 200;
        await new Promise(r => setTimeout(r, backoff + jitter));
      }
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

    const rawData: RawFlightData[] = await emergencyResponse.json();
    if (!Array.isArray(rawData) || rawData.length === 0) return null;

    const mapped = await Promise.all(rawData.slice(0, 5).map(raw => mapRawFlight(raw)));
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
// u odnosu na SADAŠNJI trenutak. Koristi EstimatedDepartureTime ako postoji
// (precizniji, ažuriran podatak), inače pada na ScheduledDepartureTime.
// Handluje prelaz preko ponoći (npr. let u 00:20 dok je "sad" 23:50 dan ranije,
// ili obrnuto) — bez toga bi razlika ispala pogrešna za skoro cio dan.
// Vraća null ako vrijeme nije moguće parsirati (prazan string, loš format).
function minutesSinceFlightTime(timeStr: string | undefined): number | null {
  if (!timeStr) return null;
  const [hours, minutes] = timeStr.split(':').map(Number);
  if (isNaN(hours) || isNaN(minutes)) return null;

  const now = new Date();
  const flightDate = new Date(now);
  flightDate.setHours(hours, minutes, 0, 0);

  let diffMs = now.getTime() - flightDate.getTime();
  const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000;

  // Ako je razlika veća od 12h u budućnost/prošlost, vjerovatno je riječ
  // o vremenu koje pripada susjednom kalendarskom danu (prelaz preko ponoći) —
  // pomjeri datum i preračunaj.
  if (diffMs > TWELVE_HOURS_MS) {
    flightDate.setDate(flightDate.getDate() + 1);
    diffMs = now.getTime() - flightDate.getTime();
  } else if (diffMs < -TWELVE_HOURS_MS) {
    flightDate.setDate(flightDate.getDate() - 1);
    diffMs = now.getTime() - flightDate.getTime();
  }

  return Math.floor(diffMs / 60_000);
}

// ── Filtrira letove čije je planirano/procijenjeno vrijeme više od
// `cutoffMinutes` U PROŠLOSTI — bez obzira šta piše u StatusEN. Ovo je
// pouzdanije od filtriranja po tekstu statusa jer backup podatak može biti
// star i njegov status tekst zastario (npr. i dalje piše "Scheduled" iako
// je let odavno otišao). Koristi se SAMO u BACKUP granama, isto kao
// filterOutCompletedFlights — live podatak API sam čisti.
function filterOutStaleFlights<T extends Flight>(flights: T[], cutoffMinutes: number = 40): T[] {
  return flights.filter(flight => {
    const timeStr = flight.EstimatedDepartureTime || flight.ScheduledDepartureTime;
    const minutesSince = minutesSinceFlightTime(timeStr);
    // null (vrijeme nepoznato/neparsivo) → ne filtriraj, radije prikaži nego sakrij
    if (minutesSince === null) return true;
    return minutesSince <= cutoffMinutes;
  });
}
// ← Generička po T extends Flight, da očuva konkretan tip ulaza (npr.
// AutoProcessedFlight) na izlazu. Bez generika, TypeScript bi suzio
// povratnu vrijednost na "obični" Flight[] i izgubio AutoProcessed/
// OriginalStatus polja koja poziv u koraku 4 (BACKUP MODE) treba
// kasnije da pročita.
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

// ── Mali nasumičan jitter na TTL, da fetch ciklusi ne budu savršeno
// periodični (npr. tačno svakih 240.000ms). Neki WAF/bot-detekcija sistemi
// prepoznaju besprijekorno pravilne intervale kao mašinski, ne ljudski
// saobraćaj — par sekundi nasumičnosti to razbija bez ikakvog uticaja
// na svježinu podataka.
function jitteredTTL(baseSeconds: number, maxJitterSeconds: number = 8): number {
  const jitter = Math.floor(Math.random() * maxJitterSeconds);
  return baseSeconds + jitter;
}
// ── GLAVNA FUNKCIJA — pozivaju je i /api/flights ruta i cleanup-overrides cron,
// direktno, bez HTTP self-fetch-a ──────────────────────────────────────────
async function getCurrentFlightData(): Promise<FlightData> {
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

if (nightNow) {   // ← bilo: isNightHours() — nepotreban drugi poziv, nightNow je već izračunat gore
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

  // ── 3. POKUŠAJ LIVE FETCH (sa tvrdim globalnim rokom) ─────
  // Promise.race garantuje da ova faza NIKAD ne traje duže od
  // LIVE_FETCH_HARD_DEADLINE_MS, bez obzira šta se dešava unutar
  // fetchWithQuickRetry (retry logika po sebi treba da završi ranije,
  // ovo je samo apsolutna gornja granica "za svaki slučaj").
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
const rawData: RawFlightData[] = normalizeRawFlightArray(rawPayload);

if (!Array.isArray(rawData)) throw new Error('Invalid data format');

    console.log(`✅ Live fetch: ${rawData.length} flights`);

    const mappedFlights = await Promise.all(rawData.map((raw: RawFlightData) => mapRawFlight(raw)));
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

// ── BACKUP_ENABLED je true — svaki uspješan live fetch osvježava backup,
// tako da kad live API kasnije padne, backup mode ima najsvježiji mogući
// podatak (ne stari po nekoliko sati). Namjerno se NE piše backup kad je
// finalFlights prazan (0 letova) — to bi moglo prepisati dobar, pun backup
// praznim rezultatom u slučaju da API vrati privremeno prazan niz.
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
    // ← NOVO: makni letove koji su već poletjeli/sletjeli prije nego što ih prikažemo
   const filteredBackupFlights = filterOutStaleFlights(filterOutCompletedFlights(existingBackup.flights));
  //  const filteredBackupFlights = filterOutStaleFlights(filterOutCompletedFlights(existingBackup.flights), 45);
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

await saveFlightDataAndMetadata(slimmed, 'live', nightNow ? NIGHT_CACHE_TTL_SECONDS : jitteredTTL(FLIGHT_CACHE_TTL_SECONDS));

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

    // ← NOVO: filtriraj TEK nakon simulacije — simulacija može ažurirati
    // status leta (npr. "Scheduled" → "Departed") pa filter mora vidjeti
    // najnoviji, simulirani status, ne stari iz sirovog backupa.
const filteredSimulatedFlights = filterOutStaleFlights(filterOutCompletedFlights(simulatedFlights));

    // autoProcessedCount se računa na FILTRIRANOJ listi — brojač treba da
    // odražava koliko auto-processed letova je STVARNO prikazano, ne koliko
    // ih je bilo prije filtriranja (inače bi brojka bila veća od broja
    // letova koje korisnik zapravo vidi na ekranu).
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
    // Ja sam nosilac locka ovog ciklusa — JA radim live fetch,
    // svi ostali istovremeni pozivi (iz drugih fajlova/instanci) idu u granu ispod.
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
  // ne pokrećemo svoj fetch. Ovo je jedini način da se garantuje tačno
  // 1 live fetch po intervalu bez obzira na broj istovremenih poziva.
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