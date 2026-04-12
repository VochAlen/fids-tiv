// lib/flight-service.ts
import type { Flight, FlightData } from '@/types/flight';

import {
  hasBusinessClass,
  getAirlineByIata,
  getAllSpecificFlights,
  getCurrentSeason,
} from '@/lib/business-class-service';

// ─────────────────────────────────────────────────────────────
// IZMJENA 1: Koristi /api/flights-cached umjesto /api/flights
// Jedan red izmjene — sve ostalo radi identično.
// Svi kiosci dijele isti server-side cache (45s svježina),
// umjesto da svaki poziva vanjski API direktno.
// ─────────────────────────────────────────────────────────────
const FLIGHT_API_URL = '/api/flights-cached';

const MIN_FETCH_INTERVAL = 30_000; // 30s — dodatna klijentska zaštita
let lastFetchTime = 0;

// Enhanced Flight type sa dodatnim poljima za desk tracking
export type EnhancedFlight = Flight & {
  _allDesks?: string[];
  _deskIndex?: number;
};

// ─────────────────────────────────────────────────────────────
// IZMJENA 2: In-memory cache umjesto localStorage
// localStorage na 24/7 kiosk ekranima može se napuniti i bacati
// QuotaExceededError. In-memory cache živi dok je tab otvoren,
// što je dovoljno — kiosci se ne zatvaraju.
// ─────────────────────────────────────────────────────────────
let memoryCache: (FlightData & { cachedAt: number }) | null = null;
const MEMORY_CACHE_MAX_AGE_MS = 10 * 60 * 1000; // 10 minuta

function cacheData(data: FlightData): void {
  memoryCache = { ...data, cachedAt: Date.now() };
}

function getCachedData(): FlightData {
  if (memoryCache && Date.now() - memoryCache.cachedAt < MEMORY_CACHE_MAX_AGE_MS) {
    console.log('Using in-memory cached flight data');
    const { cachedAt, ...data } = memoryCache;
    return data;
  }
  return {
    departures: [],
    arrivals: [],
    totalFlights: 0,
    lastUpdated: new Date().toISOString(),
    source: 'fallback',
    isOfflineMode: true,
  };
}

export async function fetchFlightData(): Promise<FlightData> {
  const now = Date.now();
  if (now - lastFetchTime < MIN_FETCH_INTERVAL) {
    console.log('Skipping fetch - too soon after last request');
    return getCachedData();
  }

  try {
    console.log('Fetching flight data from API...');

    const response = await fetch(FLIGHT_API_URL, {
      method: 'GET',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
    });

    if (!response.ok) {
      console.error(`API returned ${response.status}: ${response.statusText}`);
      throw new Error(`Failed to fetch flight data: ${response.status}`);
    }

    const data = await response.json();

    if (data && (Array.isArray(data.departures) || Array.isArray(data.arrivals))) {
      lastFetchTime = Date.now();

      const departures = Array.isArray(data.departures) ? data.departures : [];
      const arrivals   = Array.isArray(data.arrivals)   ? data.arrivals   : [];

      const flightData: FlightData = {
        departures,
        arrivals,
        totalFlights:      departures.length + arrivals.length,
        lastUpdated:       data.lastUpdated       || new Date().toISOString(),
        source:            data.source            || 'live',
        isOfflineMode:     data.isOfflineMode     || false,
        error:             data.error,
        warning:           data.warning,
        backupTimestamp:   data.backupTimestamp,
        autoProcessedCount: data.autoProcessedCount,
      };

      cacheData(flightData);
      return flightData;
    } else {
      throw new Error('Invalid data format received from API');
    }
  } catch (error) {
    console.error('Error fetching flight data:', error);

    const cached = getCachedData();
    if (cached.departures.length > 0 || cached.arrivals.length > 0) {
      console.log('Returning cached data due to error');
      return {
        ...cached,
        source: 'cached',
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }

    return {
      departures: [],
      arrivals: [],
      totalFlights: 0,
      lastUpdated: new Date().toISOString(),
      source: 'fallback',
      error: error instanceof Error ? error.message : 'Failed to fetch flight data',
      isOfflineMode: true,
    };
  }
}

// ─────────────────────────────────────────────────────────────
// Helper funkcije za filtriranje letova
// ─────────────────────────────────────────────────────────────
export function filterActiveFlights(flights: Flight[]): Flight[] {
  if (!flights || flights.length === 0) return [];
  return flights.filter(flight => shouldDisplayFlight(flight));
}

export function shouldDisplayFlight(flight: Flight): boolean {
  if (!flight || !flight.StatusEN) return false;

  const status = flight.StatusEN.toLowerCase().trim();

  const isCancelled = status.includes('cancelled') || status.includes('canceled') || status.includes('otkazan');
  const isDiverted  = status.includes('diverted')  || status.includes('preusmjeren');
  const isDeparted  = status.includes('departed')  || status.includes('poletio');

  return !isCancelled && !isDiverted && !isDeparted;
}

export function isFlightCompleted(flight: Flight): boolean {
  if (!flight || !flight.StatusEN) return false;

  const status = flight.StatusEN.toLowerCase().trim();
  const completedStatuses = [
    'departed', 'cancelled', 'canceled', 'diverted',
    'arrived', 'landed', 'poletio', 'otkazan', 'preusmjeren',
  ];

  return completedStatuses.some(s => new RegExp(`\\b${s}\\b`, 'i').test(status));
}

export function shouldDisplayOnCheckIn(flight: Flight): boolean {
  if (!flight || !flight.StatusEN) return false;

  const status = flight.StatusEN.toLowerCase().trim();

  const isProcessingOrBoarding = status.includes('processing') || status.includes('boarding');
  const isNotCompleted = !isFlightCompleted(flight);
  const isNotClosed    = !status.includes('closed') && !status.includes('gate closed');

  return isProcessingOrBoarding && isNotCompleted && isNotClosed;
}

export function filterCheckInFlights(flights: Flight[]): Flight[] {
  if (!flights || flights.length === 0) return [];
  return flights.filter(flight => shouldDisplayOnCheckIn(flight));
}

export function getFlightsByCheckIn(flights: Flight[], deskNumber: string): Flight[] {
  if (!flights || !deskNumber) return [];

  const normalizedDesk = deskNumber.replace(/^0+/, '');
  const deskVariants = [deskNumber, normalizedDesk, deskNumber.padStart(2, '0')];

  const checkInFlights = flights.filter(flight => {
    if (!flight.CheckInDesk) return false;
    return deskVariants.some(variant => {
      const exactMatch    = flight.CheckInDesk === variant;
      const containsExact = typeof flight.CheckInDesk === 'string' &&
        flight.CheckInDesk.split(',').map(s => s.trim()).includes(variant);
      return exactMatch || containsExact;
    });
  });

  const combinedFlights = combineFlightsWithSameNumber(checkInFlights);
  return filterCheckInFlights(combinedFlights);
}

function combineFlightsWithSameNumber(flights: Flight[]): Flight[] {
  const flightMap = new Map<string, Flight>();

  flights.forEach(flight => {
    const key = flight.FlightNumber;

    if (!flightMap.has(key)) {
      flightMap.set(key, { ...flight });
    } else {
      const existing = flightMap.get(key)!;

      const existingDesks = existing.CheckInDesk.split(',').map(d => d.trim()).filter(Boolean);
      const newDesks      = flight.CheckInDesk.split(',').map(d => d.trim()).filter(Boolean);

      newDesks.forEach(desk => { if (!existingDesks.includes(desk)) existingDesks.push(desk); });
      existingDesks.sort((a, b) => (parseInt(a.replace(/\D/g, '')) || 0) - (parseInt(b.replace(/\D/g, '')) || 0));

      existing.CheckInDesk = existingDesks.join(', ');
    }
  });

  return Array.from(flightMap.values());
}

export function getFlightForSpecificDesk(flights: Flight[], deskNumber: string): EnhancedFlight | null {
  if (!flights || !deskNumber || flights.length === 0) return null;

  const flightsByNumber = new Map<string, Flight[]>();
  flights.forEach((flight: Flight) => {
    if (!flight.CheckInDesk) return;
    const list = flightsByNumber.get(flight.FlightNumber) || [];
    list.push(flight);
    flightsByNumber.set(flight.FlightNumber, list);
  });

  for (const [, flightGroup] of flightsByNumber) {
    if (flightGroup.length === 0) continue;

    const allDesks: string[] = [];
    flightGroup.forEach((flight: Flight) => {
      if (flight.CheckInDesk) {
        flight.CheckInDesk.split(',').map(d => d.trim()).filter(Boolean).forEach(desk => {
          if (!allDesks.includes(desk)) allDesks.push(desk);
        });
      }
    });

    allDesks.sort((a, b) => (parseInt(normalizeDeskNumber(a), 10) || 0) - (parseInt(normalizeDeskNumber(b), 10) || 0));
    if (allDesks.length === 0) continue;

    const deskVariants = getDeskNumberVariants(deskNumber);
    for (const variant of deskVariants) {
      const foundIndex = allDesks.findIndex(desk => normalizeDeskNumber(desk) === variant);
      if (foundIndex !== -1) {
        return {
          ...flightGroup[0],
          CheckInDesk: allDesks[foundIndex],
          _allDesks:   allDesks,
          _deskIndex:  foundIndex,
        };
      }
    }
  }

  return null;
}

function normalizeDeskNumber(deskNumber: string): string {
  if (!deskNumber) return '';
  const digitsOnly = deskNumber.replace(/\D/g, '');
  return digitsOnly.replace(/^0+/, '') || digitsOnly || deskNumber;
}

function getDeskNumberVariants(deskNumber: string): string[] {
  const variants = new Set<string>();
  if (!deskNumber) return [];

  variants.add(deskNumber);
  variants.add(deskNumber.replace(/^0+/, ''));
  if (deskNumber.length === 1) variants.add(`0${deskNumber}`);

  const numericMatch = deskNumber.match(/\d+/);
  if (numericMatch) {
    const numeric = numericMatch[0];
    variants.add(numeric);
    variants.add(numeric.replace(/^0+/, ''));
    if (numeric.length === 1) variants.add(`0${numeric}`);
  }

  return Array.from(variants);
}

export function getFlightsByGate(flights: Flight[], gateNumber: string): Flight[] {
  if (!flights || !gateNumber) return [];

  const gateVariants = [gateNumber, gateNumber.replace(/^0+/, ''), gateNumber.padStart(2, '0')];
  return filterActiveFlights(
    flights.filter(f => f.GateNumber && gateVariants.some(v => f.GateNumber.includes(v)))
  );
}

export function getFlightsByBaggage(flights: Flight[], baggageReclaim: string): Flight[] {
  if (!flights || !baggageReclaim) return [];
  const norm = baggageReclaim.trim().toUpperCase();
  return filterActiveFlights(
    flights.filter(f => f.BaggageReclaim && f.BaggageReclaim.trim().toUpperCase() === norm)
  );
}

export function getProcessingFlights(flights: Flight[]): Flight[] {
  return filterActiveFlights(
    flights.filter(f => f.StatusEN?.toLowerCase() === 'processing')
  );
}

export function removeDuplicateFlights(flights: Flight[]): Flight[] {
  const seen = new Map<string, Flight>();

  flights.forEach(flight => {
    const key = `${flight.FlightNumber}_${flight.ScheduledDepartureTime}`;

    if (!seen.has(key)) {
      seen.set(key, flight);
    } else {
      const existing = seen.get(key)!;

      if (flight.CheckInDesk && existing.CheckInDesk !== flight.CheckInDesk) {
        existing.CheckInDesk = [
          ...(existing.CheckInDesk?.split(',') || []),
          ...(flight.CheckInDesk?.split(',') || []),
        ].map(d => d.trim()).filter(Boolean).filter((d, i, a) => a.indexOf(d) === i).sort().join(', ');
      }

      if (flight.GateNumber && existing.GateNumber !== flight.GateNumber) {
        existing.GateNumber = [
          ...(existing.GateNumber?.split(',') || []),
          ...(flight.GateNumber?.split(',') || []),
        ].map(g => g.trim()).filter(Boolean).filter((g, i, a) => a.indexOf(g) === i).sort().join(', ');
      }

      seen.set(key, existing);
    }
  });

  return Array.from(seen.values());
}

export function getUniqueDepartures(flights: Flight[]): Flight[] {
  return removeDuplicateFlights(flights).sort((a, b) => {
    if (!a.ScheduledDepartureTime) return 1;
    if (!b.ScheduledDepartureTime) return -1;
    return a.ScheduledDepartureTime.localeCompare(b.ScheduledDepartureTime);
  });
}

export function getUniqueDeparturesWithDeparted(flights: Flight[]): Flight[] {
  const now = new Date();
  const thirtyMinutesAgo = new Date(now.getTime() - 30 * 60 * 1000);

  const isDeparted = (status: string) =>
    status.toLowerCase().includes('departed') || status.toLowerCase().includes('poletio');

  const getTime = (flight: Flight): Date | null => {
    const s = flight.ActualDepartureTime || flight.EstimatedDepartureTime || flight.ScheduledDepartureTime;
    if (!s) return null;
    const [h, m] = s.split(':').map(Number);
    const d = new Date(now);
    d.setHours(h, m, 0, 0);
    return d;
  };

  const unique = removeDuplicateFlights(flights);
  const departed = unique.filter(f => isDeparted(f.StatusEN));
  const active   = unique.filter(f => !isDeparted(f.StatusEN));

  const recentDeparted = departed
    .sort((a, b) => (getTime(b)?.getTime() ?? 0) - (getTime(a)?.getTime() ?? 0))
    .filter(f => { const t = getTime(f); return t && t >= thirtyMinutesAgo; })
    .slice(0, 2);

  return [...active, ...recentDeparted].sort((a, b) => {
    if (!a.ScheduledDepartureTime) return 1;
    if (!b.ScheduledDepartureTime) return -1;
    return a.ScheduledDepartureTime.localeCompare(b.ScheduledDepartureTime);
  });
}

export function getFlightsByGateWithPriority(flights: Flight[], gateNumber: string): Flight[] {
  if (!flights || !gateNumber) return [];

  const gateVariants = [gateNumber, gateNumber.replace(/^0+/, ''), gateNumber.padStart(2, '0')];
  const gateFlights  = flights.filter(f => f.GateNumber && gateVariants.some(v => f.GateNumber.includes(v)));
  const active       = filterActiveFlights(gateFlights);

  if (active.length > 0) return active;

  const next = gateFlights
    .filter(f => f.ScheduledDepartureTime)
    .sort((a, b) => a.ScheduledDepartureTime.localeCompare(b.ScheduledDepartureTime))[0];

  return next ? [next] : [];
}

// ─────────────────────────────────────────────────────────────
// Business class logika — nepromijenjeno
// ─────────────────────────────────────────────────────────────
export async function hasBusinessClassCheckIn(flightNumber: string): Promise<boolean> {
  if (!flightNumber) return false;

  try {
    const airlineIata    = flightNumber.substring(0, 2).toUpperCase();
    const specificFlights = await getAllSpecificFlights();
    const specificFlight  = specificFlights.find(f => f.flightNumber === flightNumber);

    if (specificFlight) {
      if (!specificFlight.alwaysBusinessClass) return false;

      const currentSeason = getCurrentSeason();
      if (specificFlight.winterOnly && currentSeason !== 'winter') return false;
      if (specificFlight.summerOnly && currentSeason !== 'summer') return false;

      if (specificFlight.daysOfWeek?.length > 0) {
        if (!specificFlight.daysOfWeek.includes(new Date().getDay())) return false;
      }

      const now = new Date();
      if (specificFlight.validFrom && now < new Date(specificFlight.validFrom)) return false;
      if (specificFlight.validUntil && now > new Date(specificFlight.validUntil)) return false;

      return true;
    }

    const airline = await getAirlineByIata(airlineIata);
    if (!airline?.hasBusinessClass) return false;

    const currentSeason = getCurrentSeason();
    const schedule = currentSeason === 'winter' ? airline.winterSchedule : airline.summerSchedule;
    if (!schedule.hasBusinessClass) return false;

    if (schedule.specificFlights?.length > 0) return schedule.specificFlights.includes(flightNumber);

    if (schedule.daysOfWeek?.length > 0) {
      if (!schedule.daysOfWeek.includes(new Date().getDay())) return false;
    }

    const now = new Date();
    if (schedule.startDate && now < new Date(schedule.startDate)) return false;
    if (schedule.endDate   && now > new Date(schedule.endDate))   return false;

    return true;
  } catch (error) {
    console.error('Error checking business class for check-in:', error);
    return false;
  }
}

export async function getCheckInClassType(
  flight: Flight | EnhancedFlight,
  currentDeskNumber: string
): Promise<'business' | 'economy' | null> {
  if (!flight?.FlightNumber || !flight.CheckInDesk) return null;

  try {
    if (!await hasBusinessClassCheckIn(flight.FlightNumber)) return null;

    const enhanced = flight as EnhancedFlight;
    if (enhanced._allDesks && enhanced._deskIndex !== undefined) {
      return enhanced._deskIndex === 0 ? 'business' : 'economy';
    }

    const normalizedCurrent = normalizeDeskNumber(currentDeskNumber);
    const currentVariants   = getDeskNumberVariants(currentDeskNumber);
    const allDesks = (flight.CheckInDesk as string)
      .split(/[,;]/).map(d => d.trim()).filter(Boolean).map(normalizeDeskNumber);

    if (allDesks.length === 0) return null;

    let idx = allDesks.findIndex(d => d === normalizedCurrent);
    if (idx === -1) {
      for (const v of currentVariants) {
        idx = allDesks.findIndex(d => d === v);
        if (idx !== -1) break;
      }
    }

    return idx === -1 ? null : idx === 0 ? 'business' : 'economy';
  } catch (error) {
    console.error('Error determining check-in class type:', error);
    return null;
  }
}

export async function debugCheckInClassType(
  flight: Flight | EnhancedFlight,
  currentDeskNumber: string
): Promise<{
  classType: 'business' | 'economy' | null;
  debugInfo: {
    flightNumber: string; airlineCode: string; checkInDesk: string;
    normalizedDesks: string[]; currentDesk: string; normalizedCurrent: string;
    currentVariants: string[]; currentIndex: number; deskCount: number;
    hasEnhancedInfo: boolean; enhancedDesks?: string[]; enhancedIndex?: number;
    hasBusinessConfig: boolean; configSource: string;
  };
}> {
  const enhanced = flight as EnhancedFlight;
  const debugInfo = {
    flightNumber:     flight?.FlightNumber || '',
    airlineCode:      flight?.FlightNumber ? flight.FlightNumber.substring(0, 2).toUpperCase() : '',
    checkInDesk:      flight?.CheckInDesk || '',
    normalizedDesks:  [] as string[],
    currentDesk:      currentDeskNumber || '',
    normalizedCurrent: '',
    currentVariants:  [] as string[],
    currentIndex:     -1,
    deskCount:        0,
    hasEnhancedInfo:  !!(enhanced?._allDesks && enhanced._deskIndex !== undefined),
    enhancedDesks:    enhanced?._allDesks,
    enhancedIndex:    enhanced?._deskIndex,
    hasBusinessConfig: false,
    configSource:     'unknown',
  };

  if (!flight?.FlightNumber) return { classType: null, debugInfo };

  try {
    debugInfo.hasBusinessConfig = await hasBusinessClassCheckIn(flight.FlightNumber);
    const airlineIata    = flight.FlightNumber.substring(0, 2).toUpperCase();
    const specificFlights = await getAllSpecificFlights();
    const airline         = await getAirlineByIata(airlineIata);

    debugInfo.configSource = specificFlights.some(f => f.flightNumber === flight.FlightNumber)
      ? 'specific-flight'
      : airline?.hasBusinessClass ? 'airline-global'
      : airline ? 'airline-seasonal'
      : 'not-configured';
  } catch {
    debugInfo.configSource = 'error';
  }

  debugInfo.normalizedCurrent = normalizeDeskNumber(currentDeskNumber);
  debugInfo.currentVariants   = getDeskNumberVariants(currentDeskNumber);

  if (flight.CheckInDesk) {
    const allDesks = flight.CheckInDesk.split(',').map(d => d.trim()).filter(Boolean).map(normalizeDeskNumber);
    debugInfo.normalizedDesks = allDesks;
    debugInfo.deskCount       = allDesks.length;

    let idx = allDesks.findIndex(d => d === debugInfo.normalizedCurrent);
    if (idx === -1) {
      for (const v of debugInfo.currentVariants) {
        idx = allDesks.findIndex(d => d === v);
        if (idx !== -1) break;
      }
    }
    debugInfo.currentIndex = idx;
  }

  let classType: 'business' | 'economy' | null = null;
  if (debugInfo.hasEnhancedInfo && debugInfo.enhancedDesks && debugInfo.enhancedIndex !== undefined) {
    classType = debugInfo.enhancedIndex === 0 ? 'business' : 'economy';
  } else if (debugInfo.hasBusinessConfig && debugInfo.deskCount >= 1) {
    classType = debugInfo.deskCount === 1 ? 'business'
      : debugInfo.currentIndex === 0 ? 'business' : 'economy';
  }

  return { classType, debugInfo };
}

export function getCheckInDesksWithClasses(flight: Flight): Array<{ deskNumber: string; classType: 'business' | 'economy' }> {
  if (!flight?.CheckInDesk) return [];
  const desks = flight.CheckInDesk.split(',').map(d => d.trim()).filter(Boolean);
  if (desks.length < 2) return [];
  return desks.map((desk, i) => ({ deskNumber: desk, classType: i === 0 ? 'business' : 'economy' }));
}

export interface ExtendedFlightData extends FlightData {
  source: 'live' | 'cached' | 'fallback' | 'backup' | 'auto-processed' | 'emergency';
  error?: string; warning?: string; backupTimestamp?: string;
  autoProcessedCount?: number; isOfflineMode?: boolean;
}

export async function getFlightClassTypeFromConfig(
  flightNumber: string,
  airlineIata?: string
): Promise<'business' | 'economy' | null> {
  if (!flightNumber) return null;
  try {
    const code = airlineIata || flightNumber.substring(0, 2).toUpperCase();
    return await hasBusinessClass(code, flightNumber) ? 'business' : 'economy';
  } catch {
    return null;
  }
}

export async function updateCheckInStatus(
  flightNumber: string,
  scheduledTime: string,
  deskNumber: string,
  action: 'open' | 'close'
): Promise<{ success: boolean; flightNumber: string; scheduledTime: string; deskNumber: string; action: string; updatedAt: string }> {
  console.log(`Updating check-in status for ${flightNumber} (${scheduledTime}) at desk ${deskNumber} to ${action}`);
  return { success: true, flightNumber, scheduledTime, deskNumber, action, updatedAt: new Date().toISOString() };
}