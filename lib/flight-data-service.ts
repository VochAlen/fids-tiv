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

// ── CACHE CONSTANTS ───────────────────────────────────────────
const FLIGHT_CACHE_KEY = 'cache:flights:tivat';
// const FLIGHT_CACHE_TTL_SECONDS = 180;
const FLIGHT_CACHE_TTL_SECONDS = 240;
const FLIGHT_META_KEY = 'cache:flights:meta';

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

const FETCH_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/javascript, */*; q=0.01',
  'Accept-Language': 'en-US,en;q=0.9,hr;q=0.8',
  'Accept-Encoding': 'gzip, deflate, br',
  'Referer': 'https://montenegroairports.com/tivat/en/flights/departures',
  'Origin': 'https://montenegroairports.com',
  'X-Requested-With': 'XMLHttpRequest',
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
const MAX_RETRIES = 2;
const RETRY_DELAY = 1000;

async function runRedisCleanupIfNeeded(): Promise<void> {
  if (Date.now() - lastRedisCleanup < REDIS_CLEANUP_INTERVAL_MS) return;
  lastRedisCleanup = Date.now();

  const TTL_RULES: Record<string, number> = {
    'cache:flights':  180,
    'override:':      21_600,
    'gate-status:':   21_600,
    'desk-status:':   21_600,
    'desk-class:':    21_600,
  };

  Promise.race([
    (async () => {
      try {
        const client = getRedisClient();
        const keysToFix: string[] = [];
        let cursor = '0';

        do {
          const [nextCursor, keys] = await client.scan(cursor, 'COUNT', 100);
          cursor = nextCursor;

          if (keys.length > 0) {
            const pipeline = client.pipeline();
            keys.forEach(key => pipeline.ttl(key));
            const results = await pipeline.exec();
            results?.forEach((result, i) => {
              if (!result[0] && result[1] === -1) keysToFix.push(keys[i]);
            });
          }

          if (keysToFix.length > 200) break;
        } while (cursor !== '0');

        if (keysToFix.length > 0) {
          const fixPipeline = client.pipeline();
          keysToFix.forEach(key => {
            const rule = Object.entries(TTL_RULES).find(([p]) => key.startsWith(p));
            fixPipeline.expire(key, rule ? rule[1] : 3_600);
          });
          await fixPipeline.exec();
          console.log(`🧹 Redis cleanup: ${keysToFix.length} keys fixed`);
        }
      } catch (e) {
        console.error('⚠️ Redis cleanup failed (non-critical):', e);
      }
    })(),
    new Promise<void>(resolve => setTimeout(resolve, 5_000)),
  ]);
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

async function saveFlightDataAndMetadata(slimmed: FlightData, source: string): Promise<void> {
  try {
    const client = getRedisClient();
    const hash = Buffer.from(JSON.stringify({
      dCount: slimmed.departures.length,
      aCount: slimmed.arrivals.length,
      source,
      timestamp: new Date().toISOString(),
    })).toString('base64').substring(0, 32);

    const meta = {
      hash,
      count: slimmed.departures.length + slimmed.arrivals.length,
      lastModified: new Date().toISOString(),
      source,
    };

    const pipeline = client.pipeline();
    pipeline.setex(FLIGHT_CACHE_KEY, FLIGHT_CACHE_TTL_SECONDS, JSON.stringify(slimmed));
    pipeline.setex(FLIGHT_META_KEY, 60, JSON.stringify(meta));
    await pipeline.exec();
  } catch (e) {
    console.warn('⚠️ Failed to save flight data/metadata:', e);
  }

  inProcessFlightData = slimmed;
  inProcessFlightExpiry = Date.now() + IN_PROCESS_FLIGHT_TTL_MS;
}
//ne radi-stari kod-ne funkcionise vise -POCETAK 12JUL2026
// async function loadOverridesMap(): Promise<Record<string, Record<string, string>>> {
//   if (Date.now() < overrideCacheExpiry) {
//     return overrideCacheData;
//   }

//   const timeoutPromise = new Promise<null>(resolve =>
//     setTimeout(() => resolve(null), 3_000)
//   );

//   const fetchPromise = (async () => {
//     try {
//       const client = getRedisClient();
//       const keys: string[] = [];
//       let cursor = '0';

//       do {
//         const scanResult = await client.scan(cursor, 'MATCH', 'override:*', 'COUNT', 100);
//         cursor = scanResult[0];
//         keys.push(...scanResult[1]);
//         if (keys.length > 200) break;
//       } while (cursor !== '0');

//       if (keys.length === 0) {
//         overrideCacheData = {};
//         overrideCacheExpiry = Date.now() + OVERRIDE_CACHE_MS;
//         return overrideCacheData;
//       }

//       const pipeline = client.pipeline();
//       keys.forEach(key => pipeline.hgetall(key));
//       const results = await pipeline.exec();

//       const map: Record<string, Record<string, string>> = {};
//       if (results) {
//         keys.forEach((key, i) => {
//           const result = results[i];
//           if (result && !result[0] && result[1]) {
//             const flightNumber = key.replace('override:', '');
//             const data = result[1] as Record<string, string>;
//             if (Object.keys(data).length > 0) map[flightNumber] = data;
//           }
//         });
//       }

//       overrideCacheData = map;
//       overrideCacheExpiry = Date.now() + OVERRIDE_CACHE_MS;
//       return overrideCacheData;
//     } catch {
//       return null;
//     }
//   })();

//   const result = await Promise.race([fetchPromise, timeoutPromise]);

//   if (result === null) {
//     console.warn('[loadOverridesMap] Timeout ili greška — vraćam stari cache');
//     overrideCacheExpiry = Date.now() + OVERRIDE_CACHE_MS;
//   }

//   return overrideCacheData;
// }

// async function applyKvOverrides(flights: Flight[]): Promise<Flight[]> {
//   try {
//     const overridesMap = await loadOverridesMap();
//     if (Object.keys(overridesMap).length === 0) return flights;

//     const resolveField = (overrideVal: string | undefined, apiVal: string | undefined): string => {
//       if (overrideVal === undefined) return apiVal ?? '';
//       if (overrideVal === '__EMPTY__') return '';
//       return overrideVal;
//     };

//     return flights.map(flight => {
//       const localOverride = overridesMap[flight.FlightNumber];
//       if (!localOverride) return flight;
//       return {
//         ...flight,
//         GateNumber:     resolveField(localOverride.GateNumber,     flight.GateNumber),
//         CheckInDesk:    resolveField(localOverride.CheckInDesk,    flight.CheckInDesk),
//         BaggageReclaim: resolveField(localOverride.BaggageReclaim, flight.BaggageReclaim),
//         StatusEN:       resolveField(localOverride.StatusEN,       flight.StatusEN),
//         Terminal:       resolveField(localOverride.Terminal,       flight.Terminal),
//       };
//     });
//   } catch {
//     return flights;
//   }
// }

// async function applyOverridesToFlightData(data: FlightData): Promise<FlightData> {
//   const [departures, arrivals] = await Promise.all([
//     applyKvOverrides(data.departures),
//     applyKvOverrides(data.arrivals),
//   ]);
//   return { ...data, departures, arrivals };
// }
// ne radi-stari kod-ne funkcionise vise -POCETAK 12JUL2026

async function fetchWithQuickRetry(
  url: string,
  options: RequestInit,
  retries = MAX_RETRIES
): Promise<Response> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);
      const response = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(timeoutId);
      if (response.ok) return response;
      console.error(`❌ HTTP ${response.status} on attempt ${attempt}/${retries}`);
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
      signal: AbortSignal.timeout(10000),
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

async function buildFlightData(
  rawFlights: Flight[],
  source: 'live' | 'backup' | 'auto-processed' | 'emergency',
  lastUpdated: string,
  options?: { isOfflineMode?: boolean; warning?: string; backupTimestamp?: string; autoProcessedCount?: number }
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
    ...(options?.warning && { warning: options.warning }),
    ...(options?.backupTimestamp && { backupTimestamp: options.backupTimestamp }),
    ...(options?.autoProcessedCount !== undefined && { autoProcessedCount: options.autoProcessedCount }),
  };
}

// ── GLAVNA FUNKCIJA — pozivaju je i /api/flights ruta i cleanup-overrides cron,
// direktno, bez HTTP self-fetch-a ──────────────────────────────────────────
export async function getCurrentFlightData(): Promise<FlightData> {
  // ── 1. PROVJERI CACHE PRVO (in-process → Redis) ──────────
  const cached = await getFlightDataFromCache();
  if (cached) {
    return cached;
  }

  // ── 2. REDIS CLEANUP (background, ne blokira) ─────────────
  runRedisCleanupIfNeeded().catch(() => {});

  const backupService = FlightBackupService.getInstance();

  // ── 3. POKUŠAJ LIVE FETCH ─────────────────────────────────
  try {
    const response = await fetchWithQuickRetry(FLIGHT_API_URL, {
      method: 'GET',
      cache: 'no-store',
      headers: FETCH_HEADERS,
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const rawData: RawFlightData[] = await response.json();
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

try {
      await backupService.saveBackup(finalFlights);
    } catch (e) {
      console.error('⚠️ Backup save failed:', e);
    }

    const flightData = await buildFlightData(finalFlights, 'live', new Date().toISOString());
    const slimmed = slimFlightData(flightData);

    await saveFlightDataAndMetadata(slimmed, 'live');

    console.log(`📊 Live: ${flightData.departures.length} dep, ${flightData.arrivals.length} arr`);

    return slimmed;

  } catch (liveError) {
    console.error('❌ Live API failed:', liveError instanceof Error ? liveError.message : liveError);
  }

  // ── 4. BACKUP MODE ────────────────────────────────────────
 try {
    const latestBackup = await backupService.getLatestBackup();

    if (latestBackup.flights.length > 0) {
      console.log(`🔄 Using backup: ${latestBackup.flights.length} flights from ${latestBackup.timestamp}`);

      const processor = new FlightAutoProcessor(latestBackup.flights);
      const processedFlights = processor.processFlights();
      const simulatedFlights = FlightAutoProcessor.simulateRealTimeProgress(processedFlights);
      const autoProcessedCount = simulatedFlights.filter((f: AutoProcessedFlight) => f.AutoProcessed).length;
      const source = autoProcessedCount > 0 ? 'auto-processed' : 'backup';

      const flightData = await buildFlightData(
        simulatedFlights,
        source,
        latestBackup.timestamp,
        {
          isOfflineMode: true,
          backupTimestamp: latestBackup.timestamp,
          autoProcessedCount,
          warning: 'Using backup data. Live API temporarily unavailable.',
        }
      );

      const slimmed = slimFlightData(flightData);
      await saveFlightDataAndMetadata(slimmed, source);

      return slimmed;
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
      { isOfflineMode: true, warning: 'Emergency mode: Using directly fetched data.' }
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
// ── LOCK WRAPPER — sprečava "cache stampede" ka eksternom API-ju ── STARI NACIN-NE RADI
// export async function getCurrentFlightDataSafe(): Promise<FlightData> {
//   const cached = await getFlightDataFromCache();
//   if (cached) return applyOverridesToFlightData(cached);

//   const client = getRedisClient();
//   const lockKey = 'lock:flights:fetch';
//   const gotLock = await client.set(lockKey, '1', 'EX', 15, 'NX');

//   if (!gotLock) {
//     await new Promise(r => setTimeout(r, 500));
//     const retryCache = await getFlightDataFromCache();
//     if (retryCache) return applyOverridesToFlightData(retryCache);
//   }

//   try {
//     const fresh = await getCurrentFlightData();
//     return applyOverridesToFlightData(fresh);
//   } finally {
//     await client.del(lockKey);
//   }
// }
export async function getCurrentFlightDataSafe(): Promise<FlightData> {
  const cached = await getFlightDataFromCache();
  if (cached) return cached;

  const client = getRedisClient();
  const lockKey = 'lock:flights:fetch';
  const gotLock = await client.set(lockKey, '1', 'EX', 15, 'NX');

  if (!gotLock) {
    await new Promise(r => setTimeout(r, 500));
    const retryCache = await getFlightDataFromCache();
    if (retryCache) return retryCache;
  }

  try {
    return await getCurrentFlightData();
  } finally {
    await client.del(lockKey);
  }
}