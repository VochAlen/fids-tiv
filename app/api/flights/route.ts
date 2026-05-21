// app/api/flights/route.ts
import { NextResponse } from 'next/server';
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
import Redis from 'ioredis';

// ── CACHE CONSTANTS ───────────────────────────────────────────
const FLIGHT_CACHE_KEY = 'cache:flights:tivat';
const FLIGHT_CACHE_TTL_SECONDS = 60; // 1 minuta — smanjuje broj invokacija za ~60x

// ── IN-PROCESS OVERRIDE CACHE (izbjegava Redis round-trip na svakom requestu) ──
let overrideCacheData: Record<string, Record<string, string>> = {};
let overrideCacheExpiry = 0;
const OVERRIDE_CACHE_MS = 30_000; // 30 sekundi

// ── REDIS CLEANUP ─────────────────────────────────────────────
let lastRedisCleanup = 0;
const REDIS_CLEANUP_INTERVAL_MS = 5 * 60 * 60 * 1000; // 12h umjesto 6h

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

const FLIGHT_API_URL = 'https://montenegroairports.com/aerodromixs/cache-flights.php?airport=tv';
const MAX_RETRIES = 2;
const RETRY_DELAY = 1000;

async function runRedisCleanupIfNeeded(): Promise<void> {
  if (Date.now() - lastRedisCleanup < REDIS_CLEANUP_INTERVAL_MS) return;
  lastRedisCleanup = Date.now();

  try {
    const client = getRedisClient();
    const TTL_RULES: Record<string, number> = {
      'cache:flights':  180,
      'override:':      21_600,
      'gate-status:':   21_600,
      'desk-status:':   21_600,
      'desk-class:':    21_600,
    };

    let cursor = '0';
    let fixed = 0;
    do {
      const [nextCursor, keys] = await client.scan(cursor, 'COUNT', 100);
      cursor = nextCursor;
      for (const key of keys) {
        const ttl = await client.ttl(key);
        if (ttl === -1) {
          const rule = Object.entries(TTL_RULES).find(([prefix]) => key.startsWith(prefix));
          await client.expire(key, rule ? rule[1] : 3_600);
          fixed++;
        }
      }
    } while (cursor !== '0');

    if (fixed > 0) console.log(`🧹 Redis cleanup: ${fixed} keys fixed`);
  } catch (e) {
    console.error('⚠️ Redis cleanup failed:', e);
  }
}

// ── REDIS FLIGHT CACHE ────────────────────────────────────────
// Ovo je najvažnija optimizacija: kešira cijeli FlightData odgovor u Redis.
// Svaki request koji dođe unutar 60s dobija cached podatke bez ikakve compute logike.
async function getFlightDataFromCache(): Promise<FlightData | null> {
  try {
    const client = getRedisClient();
    const cached = await client.get(FLIGHT_CACHE_KEY);
    if (cached) {
      return JSON.parse(cached) as FlightData;
    }
  } catch {
    // Tiho — cache miss, nastavi normalno
  }
  return null;
}

async function saveFlightDataToCache(data: FlightData): Promise<void> {
  try {
    const client = getRedisClient();
    await client.setex(FLIGHT_CACHE_KEY, FLIGHT_CACHE_TTL_SECONDS, JSON.stringify(data));
  } catch {
    // Non-critical, nastavi
  }
}

// ── OVERRIDE CACHE (in-process, 30s TTL) ─────────────────────
// Svaki request je ranije radio SCAN + pipeline na Redis.
// Sada se overrides kešira lokalno u memoriji procesa.
async function loadOverridesMap(): Promise<Record<string, Record<string, string>>> {
  if (Date.now() < overrideCacheExpiry) {
    return overrideCacheData;
  }

  try {
    const client = getRedisClient();
    const keys: string[] = [];
    let cursor = '0';

    do {
      const scanResult = await client.scan(cursor, 'MATCH', 'override:*', 'COUNT', 100);
      cursor = scanResult[0];
      keys.push(...scanResult[1]);
      if (keys.length > 200) break;
    } while (cursor !== '0');

    if (keys.length === 0) {
      overrideCacheData = {};
      overrideCacheExpiry = Date.now() + OVERRIDE_CACHE_MS;
      return overrideCacheData;
    }

    const pipeline = client.pipeline();
    keys.forEach(key => pipeline.hgetall(key));
    const results = await pipeline.exec();

    const map: Record<string, Record<string, string>> = {};
    if (results) {
      keys.forEach((key, i) => {
        const result = results[i];
        if (result && !result[0] && result[1]) {
          const flightNumber = key.replace('override:', '');
          const data = result[1] as Record<string, string>;
          if (Object.keys(data).length > 0) map[flightNumber] = data;
        }
      });
    }

    overrideCacheData = map;
    overrideCacheExpiry = Date.now() + OVERRIDE_CACHE_MS;
  } catch {
    // Vrati stari cache ili prazan map
  }

  return overrideCacheData;
}

async function applyKvOverrides(flights: Flight[]): Promise<Flight[]> {
  try {
    const overridesMap = await loadOverridesMap();
    if (Object.keys(overridesMap).length === 0) return flights;

    const resolveField = (overrideVal: string | undefined, apiVal: string | undefined): string => {
      if (overrideVal === undefined) return apiVal ?? '';
      if (overrideVal === '__EMPTY__') return '';
      return overrideVal;
    };

    return flights.map(flight => {
      const localOverride = overridesMap[flight.FlightNumber];
      if (!localOverride) return flight;
      return {
        ...flight,
        GateNumber:     resolveField(localOverride.GateNumber,     flight.GateNumber),
        CheckInDesk:    resolveField(localOverride.CheckInDesk,    flight.CheckInDesk),
        BaggageReclaim: resolveField(localOverride.BaggageReclaim, flight.BaggageReclaim),
        StatusEN:       resolveField(localOverride.StatusEN,       flight.StatusEN),
        Terminal:       resolveField(localOverride.Terminal,       flight.Terminal),
      };
    });
  } catch {
    return flights;
  }
}

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
  let departures = sortFlightsByTime(rawFlights.filter(f => f.FlightType === 'departure'));
  let arrivals = sortFlightsByTime(rawFlights.filter(f => f.FlightType === 'arrival'));

  [departures, arrivals] = await Promise.all([
    applyKvOverrides(departures),
    applyKvOverrides(arrivals),
  ]);

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

export async function GET(): Promise<NextResponse> {
  // ── 1. PROVJERI REDIS CACHE PRVO ──────────────────────────
  // Ovo sprečava da svaki korisnikov request poziva Montenegro API i troši Vercel compute.
  const cached = await getFlightDataFromCache();
  if (cached) {
    return NextResponse.json(cached, {
      headers: {
        'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120',
        'X-Data-Source': cached.source + '-cached',
        'X-Total-Flights': cached.totalFlights.toString(),
      }
    });
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
      backupService.saveBackup(finalFlights);
    } catch (e) {
      console.error('⚠️ Backup save failed:', e);
    }

const flightData = await buildFlightData(finalFlights, 'live', new Date().toISOString());

// ── DODAJ OVO OVDJE ──────────────────────────────────────────
// Spremi metadata za status endpoint
try {
  const client = getRedisClient();
  const hash = Buffer.from(JSON.stringify({
    dCount: flightData.departures.length,
    aCount: flightData.arrivals.length,
    source: 'live',
  })).toString('base64').substring(0, 32);
  
  await Promise.all([
    client.set('cache:flights:hash', hash, 'EX', 60),
    client.set('cache:flights:count', String(flightData.totalFlights), 'EX', 60),
    client.set('cache:flights:last_modified', new Date().toISOString(), 'EX', 60),
    client.set('cache:flights:source', 'live', 'EX', 60),
  ]);
} catch(e) {}
// ── KRAJ DODATOG KODA ────────────────────────────────────────

// Sačuvaj u Redis cache za narednih 60 sekundi
await saveFlightDataToCache(flightData);

    console.log(`📊 Live: ${flightData.departures.length} dep, ${flightData.arrivals.length} arr`);

    return NextResponse.json(flightData, {
      headers: {
        'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120',
        'X-Data-Source': 'live',
        'X-Total-Flights': flightData.totalFlights.toString(),
        'X-Departures': flightData.departures.length.toString(),
        'X-Arrivals': flightData.arrivals.length.toString(),
      }
    });

  } catch (liveError) {
    console.error('❌ Live API failed:', liveError instanceof Error ? liveError.message : liveError);
  }

  // ── 4. BACKUP MODE ────────────────────────────────────────
  try {
    const latestBackup = backupService.getLatestBackup();

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

      await saveFlightDataToCache(flightData);

      return NextResponse.json(flightData, {
        headers: {
          'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=60',
          'X-Data-Source': source,
          'X-Offline-Mode': 'true',
          'X-Total-Flights': flightData.totalFlights.toString(),
        }
      });
    }
  } catch (backupError) {
    console.error('❌ Backup system failed:', backupError instanceof Error ? backupError.message : backupError);
  }

  // ── 5. EMERGENCY FETCH ────────────────────────────────────
  const emergencyFlights = await performEmergencyFetch();

  if (emergencyFlights && emergencyFlights.length > 0) {
    backupService.saveBackup(emergencyFlights);
    const processor = new FlightAutoProcessor(emergencyFlights);
    const processedFlights = processor.processFlights();

    const flightData = await buildFlightData(
      processedFlights,
      'emergency',
      new Date().toISOString(),
      { isOfflineMode: true, warning: 'Emergency mode: Using directly fetched data.' }
    );

    return NextResponse.json(flightData, {
      headers: {
        'Cache-Control': 'public, s-maxage=15, stale-while-revalidate=30',
        'X-Data-Source': 'emergency',
        'X-Offline-Mode': 'true',
        'X-Total-Flights': flightData.totalFlights.toString(),
      }
    });
  }

  // ── 6. CRITICAL FAILURE ───────────────────────────────────
  const emptyData: FlightData = {
    departures: [],
    arrivals: [],
    lastUpdated: new Date().toISOString(),
    source: 'emergency',
    isOfflineMode: true,
    totalFlights: 0,
    error: 'All data sources unavailable.',
    warning: 'System will recover when connection is restored.',
  };

  return NextResponse.json(emptyData, {
    status: 200,
    headers: {
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'X-Data-Source': 'critical-emergency',
      'X-Total-Flights': '0',
    }
  });
}

export const dynamic = 'force-dynamic';
export const revalidate = 0;