// lib/flight-service.ts
import type { Flight, FlightData } from '@/types/flight';

import { 
  hasBusinessClass,
  getAirlineByIata,
  getAllSpecificFlights,
  getCurrentSeason // DODAJTE OVO
} from '@/lib/business-class-service';

const FLIGHT_API_URL = '/api/flights';
let lastFetchTime = 0;
const MIN_FETCH_INTERVAL = 30000; // 30 sekundi

// Enhanced Flight type sa dodatnim poljima za desk tracking
export type EnhancedFlight = Flight & { 
  _allDesks?: string[]; 
  _deskIndex?: number;
};

export async function fetchFlightData(): Promise<FlightData> {
  // Sprečavamo previše česte requeste
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
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      console.error(`API returned ${response.status}: ${response.statusText}`);
      throw new Error(`Failed to fetch flight data: ${response.status}`);
    }

    const data = await response.json();
    
    // Validiraj podatke
    if (data && (Array.isArray(data.departures) || Array.isArray(data.arrivals))) {
      // Sačuvaj vrijeme uspješnog fetcha
      lastFetchTime = Date.now();
      
      // Izračunaj totalFlights
      const departures = Array.isArray(data.departures) ? data.departures : [];
      const arrivals = Array.isArray(data.arrivals) ? data.arrivals : [];
      const totalFlights = departures.length + arrivals.length;
      
      // Prepare flight data object
      const flightData: FlightData = {
        departures,
        arrivals,
        totalFlights,
        lastUpdated: data.lastUpdated || new Date().toISOString(),
        source: data.source || 'live',
        isOfflineMode: data.isOfflineMode || false,
        error: data.error,
        warning: data.warning,
        backupTimestamp: data.backupTimestamp,
        autoProcessedCount: data.autoProcessedCount
      };
      
      // Cache podatke
      cacheData(flightData);
      return flightData;
    } else {
      throw new Error('Invalid data format received from API');
    }
  } catch (error) {
    console.error('Error fetching flight data:', error);
    
    // Vrati cached podatke ako postoje
    const cached = getCachedData();
    if (cached.departures.length > 0 || cached.arrivals.length > 0) {
      console.log('Returning cached data due to error');
      return {
        ...cached,
        source: 'cached',
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
    
    // Fallback na prazne podatke
    return {
      departures: [],
      arrivals: [],
      totalFlights: 0,
      lastUpdated: new Date().toISOString(),
      source: 'fallback',
      error: error instanceof Error ? error.message : 'Failed to fetch flight data',
      isOfflineMode: true
    };
  }
}

// Cache funkcije
function cacheData(data: FlightData): void {
  if (typeof window !== 'undefined') {
    try {
      localStorage.setItem('flightData_cache', JSON.stringify({
        ...data,
        cachedAt: new Date().toISOString()
      }));
    } catch (e) {
      console.warn('Could not cache flight data:', e);
    }
  }
}

function getCachedData(): FlightData {
  if (typeof window !== 'undefined') {
    try {
      const cached = localStorage.getItem('flightData_cache');
      if (cached) {
        const parsed = JSON.parse(cached);
        // Provjeri da li je cache stariji od 10 minuta
        const cachedAt = new Date(parsed.cachedAt);
        const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
        
        if (cachedAt > tenMinutesAgo) {
          console.log('Using cached flight data');
          return {
            departures: Array.isArray(parsed.departures) ? parsed.departures : [],
            arrivals: Array.isArray(parsed.arrivals) ? parsed.arrivals : [],
            totalFlights: parsed.totalFlights || 0,
            lastUpdated: parsed.lastUpdated || new Date().toISOString(),
            source: parsed.source || 'cached',
            isOfflineMode: parsed.isOfflineMode || false
          };
        }
      }
    } catch (e) {
      console.warn('Could not retrieve cached flight data:', e);
    }
  }
  
  // Fallback na prazne podatke
  return {
    departures: [],
    arrivals: [],
    totalFlights: 0,
    lastUpdated: new Date().toISOString(),
    source: 'fallback',
    isOfflineMode: true
  };
}

// Helper funkcije za filtriranje letova
export function filterActiveFlights(flights: Flight[]): Flight[] {
  if (!flights || flights.length === 0) return [];
  return flights.filter(flight => shouldDisplayFlight(flight));
}

export function shouldDisplayFlight(flight: Flight): boolean {
  if (!flight || !flight.StatusEN) return false;
  
  const status = flight.StatusEN.toLowerCase().trim();
  
  // Lista statusa koji se NE prikazuju
  const excludedStatuses = [
    'departed',
    'cancelled', 
    'canceled',
    'diverted',
    'completed',
    'arrived',
    'landed',
    'poletio',
    'otkazan',
    'preusmjeren'
  ];
  
  // Provjeri da li status sadrži bilo koju od zabranjenih riječi
  const hasExcludedStatus = excludedStatuses.some(excluded => {
    const regex = new RegExp(`\\b${excluded}\\b`, 'i');
    return regex.test(status);
  });
  
  return !hasExcludedStatus;
}

export function isFlightCompleted(flight: Flight): boolean {
  if (!flight || !flight.StatusEN) return false;
  
  const status = flight.StatusEN.toLowerCase().trim();
  
  const completedStatuses = [
    'departed',
    'cancelled', 
    'canceled',
    'diverted',
    'completed',
    'arrived',
    'landed',
    'poletio',
    'otkazan',
    'preusmjeren'
  ];
  
  return completedStatuses.some(completed => {
    const regex = new RegExp(`\\b${completed}\\b`, 'i');
    return regex.test(status);
  });
}

export function shouldDisplayOnCheckIn(flight: Flight): boolean {
  if (!flight || !flight.StatusEN) return false;
  
  const status = flight.StatusEN.toLowerCase().trim();
  
  const isProcessingOrBoarding = status.includes('processing') || status.includes('boarding');
  const isNotCompleted = !isFlightCompleted(flight);
  const isNotClosed = !status.includes('closed') && !status.includes('gate closed');
  
  return isProcessingOrBoarding && isNotCompleted && isNotClosed;
}

export function filterCheckInFlights(flights: Flight[]): Flight[] {
  if (!flights || flights.length === 0) return [];
  return flights.filter(flight => shouldDisplayOnCheckIn(flight));
}

export function getFlightsByCheckIn(flights: Flight[], deskNumber: string): Flight[] {
  if (!flights || !deskNumber) return [];
  
  const normalizedDesk = deskNumber.replace(/^0+/, '');
  const deskVariants = [
    deskNumber,
    normalizedDesk,
    deskNumber.padStart(2, '0'),
  ];
  
  const checkInFlights = flights.filter(flight => {
    if (!flight.CheckInDesk) return false;
    
    return deskVariants.some(variant => {
      const exactMatch = flight.CheckInDesk === variant;
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
      const existingFlight = flightMap.get(key)!;
      
      const existingDesks = existingFlight.CheckInDesk.split(',')
        .map(d => d.trim())
        .filter(d => d !== '');
      
      const newDesks = flight.CheckInDesk.split(',')
        .map(d => d.trim())
        .filter(d => d !== '');
      
      newDesks.forEach(desk => {
        if (!existingDesks.includes(desk)) {
          existingDesks.push(desk);
        }
      });
      
      existingDesks.sort((a, b) => {
        const numA = parseInt(a.replace(/\D/g, '')) || 0;
        const numB = parseInt(b.replace(/\D/g, '')) || 0;
        return numA - numB;
      });
      
      existingFlight.CheckInDesk = existingDesks.join(', ');
    }
  });
  
  return Array.from(flightMap.values());
}

export function getFlightForSpecificDesk(
  flights: Flight[], 
  deskNumber: string
): EnhancedFlight | null {
  if (!flights || !deskNumber || flights.length === 0) {
    return null;
  }
  
  const flightsByNumber = new Map<string, Flight[]>();
  
  flights.forEach((flight: Flight) => {
    if (!flight.CheckInDesk) {
      return;
    }
    
    const key = flight.FlightNumber;
    const flightList = flightsByNumber.get(key) || [];
    flightList.push(flight);
    flightsByNumber.set(key, flightList);
  });
  
  const flightEntries = Array.from(flightsByNumber.entries());
  for (const [flightNumber, flightGroup] of flightEntries) {
    if (flightGroup.length === 0) {
      continue;
    }
    
    const allDesks: string[] = [];
    
    flightGroup.forEach((flight: Flight) => {
      if (flight.CheckInDesk) {
        const desks = flight.CheckInDesk
          .split(',')
          .map((d: string) => d.trim())
          .filter((d: string) => d !== '');
        
        desks.forEach((desk: string) => {
          if (!allDesks.includes(desk)) {
            allDesks.push(desk);
          }
        });
      }
    });
    
    allDesks.sort((a: string, b: string): number => {
      const numA = parseInt(normalizeDeskNumber(a), 10) || 0;
      const numB = parseInt(normalizeDeskNumber(b), 10) || 0;
      return numA - numB;
    });
    
    if (allDesks.length === 0) {
      continue;
    }
    
    const deskVariants = getDeskNumberVariants(deskNumber);
    
    for (const variant of deskVariants) {
      const foundIndex = allDesks.findIndex((desk: string): boolean => {
        const normalizedDesk = normalizeDeskNumber(desk);
        return normalizedDesk === variant;
      });
      
      if (foundIndex !== -1) {
        const firstFlight = flightGroup[0];
        
        const enhancedFlight: EnhancedFlight = {
          ...firstFlight,
          CheckInDesk: allDesks[foundIndex],
          _allDesks: allDesks,
          _deskIndex: foundIndex
        };
        
        return enhancedFlight;
      }
    }
  }
  
  return null;
}

function normalizeDeskNumber(deskNumber: string): string {
  if (!deskNumber) return '';
  const digitsOnly = deskNumber.replace(/\D/g, '');
  const withoutLeadingZeros = digitsOnly.replace(/^0+/, '');
  return withoutLeadingZeros || digitsOnly || deskNumber;
}

function getDeskNumberVariants(deskNumber: string): string[] {
  const variants = new Set<string>();
  
  if (!deskNumber) return [];
  
  variants.add(deskNumber);
  variants.add(deskNumber.replace(/^0+/, ''));
  
  if (deskNumber.length === 1) {
    variants.add(`0${deskNumber}`);
  }
  
  const numericMatch = deskNumber.match(/\d+/);
  if (numericMatch) {
    const numeric = numericMatch[0];
    variants.add(numeric);
    variants.add(numeric.replace(/^0+/, ''));
    if (numeric.length === 1) {
      variants.add(`0${numeric}`);
    }
  }
  
  return Array.from(variants);
}

export function getFlightsByGate(flights: Flight[], gateNumber: string): Flight[] {
  if (!flights || !gateNumber) return [];
  
  const normalizedGate = gateNumber.replace(/^0+/, '');
  const gateVariants = [
    gateNumber,
    normalizedGate,
    gateNumber.padStart(2, '0'),
  ];
  
  const gateFlights = flights.filter(flight => {
    if (!flight.GateNumber) return false;
    return gateVariants.some(variant => 
      flight.GateNumber.includes(variant)
    );
  });
  
  return filterActiveFlights(gateFlights);
}

export function getFlightsByBaggage(flights: Flight[], baggageReclaim: string): Flight[] {
  if (!flights || !baggageReclaim || flights.length === 0) {
    return [];
  }
  
  const baggageFlights = flights.filter(flight => {
    if (!flight.BaggageReclaim) return false;
    
    const normalizedBelt = baggageReclaim.trim().toUpperCase();
    const flightBelt = flight.BaggageReclaim.trim().toUpperCase();
    
    return flightBelt === normalizedBelt;
  });
  
  return filterActiveFlights(baggageFlights);
}

export function getProcessingFlights(flights: Flight[]): Flight[] {
  const processingFlights = flights.filter(flight => 
    flight.StatusEN?.toLowerCase() === 'processing'
  );
  
  return filterActiveFlights(processingFlights);
}

export function removeDuplicateFlights(flights: Flight[]): Flight[] {
  const seenFlights = new Map<string, Flight>();
  
  flights.forEach(flight => {
    const key = flight.FlightNumber + '_' + flight.ScheduledDepartureTime;
    
    if (!seenFlights.has(key)) {
      seenFlights.set(key, flight);
    } else {
      const existingFlight = seenFlights.get(key)!;
      
      if (flight.CheckInDesk && existingFlight.CheckInDesk !== flight.CheckInDesk) {
        const allDesks = [
          ...(existingFlight.CheckInDesk?.split(',') || []),
          ...(flight.CheckInDesk?.split(',') || [])
        ]
          .map(desk => desk.trim())
          .filter(desk => desk !== '')
          .filter((desk, index, array) => array.indexOf(desk) === index)
          .sort();
        
        existingFlight.CheckInDesk = allDesks.join(', ');
      }
      
      if (flight.GateNumber && existingFlight.GateNumber !== flight.GateNumber) {
        const allGates = [
          ...(existingFlight.GateNumber?.split(',') || []),
          ...(flight.GateNumber?.split(',') || [])
        ]
          .map(gate => gate.trim())
          .filter(gate => gate !== '')
          .filter((gate, index, array) => array.indexOf(gate) === index)
          .sort();
        
        existingFlight.GateNumber = allGates.join(', ');
      }
      
      seenFlights.set(key, existingFlight);
    }
  });
  
  return Array.from(seenFlights.values());
}

export function getUniqueDepartures(flights: Flight[]): Flight[] {
  const uniqueFlights = removeDuplicateFlights(flights);
  
  return uniqueFlights.sort((a, b) => {
    const timeA = a.ScheduledDepartureTime;
    const timeB = b.ScheduledDepartureTime;
    
    if (!timeA && !timeB) return 0;
    if (!timeA) return 1;
    if (!timeB) return -1;
    
    return timeA.localeCompare(timeB);
  });
}

export function getUniqueDeparturesWithDeparted(flights: Flight[]): Flight[] {
  const now = new Date();
  const thirtyMinutesAgo = new Date(now.getTime() - 30 * 60 * 1000);

  const isDeparted = (status: string): boolean => {
    const statusLower = status.toLowerCase();
    return statusLower.includes('departed') || statusLower.includes('poletio');
  };

  const getFlightDateTime = (flight: Flight): Date | null => {
    const timeStr = flight.ActualDepartureTime || 
                    flight.EstimatedDepartureTime || 
                    flight.ScheduledDepartureTime;
    if (!timeStr) return null;

    const [hours, minutes] = timeStr.split(':').map(Number);
    const flightDate = new Date(now);
    flightDate.setHours(hours, minutes, 0, 0);
    return flightDate;
  };

  const departedFlights: Flight[] = [];
  const activeFlights: Flight[] = [];

  const uniqueFlights = removeDuplicateFlights(flights);

  uniqueFlights.forEach(flight => {
    if (isDeparted(flight.StatusEN)) {
      departedFlights.push(flight);
    } else {
      activeFlights.push(flight);
    }
  });

  const sortedDepartedFlights = departedFlights.sort((a, b) => {
    const timeA = getFlightDateTime(a);
    const timeB = getFlightDateTime(b);
    if (!timeA || !timeB) return 0;
    return timeB.getTime() - timeA.getTime();
  });

  const recentDepartedFlights = sortedDepartedFlights
    .filter(flight => {
      const flightTime = getFlightDateTime(flight);
      return flightTime && flightTime >= thirtyMinutesAgo;
    })
    .slice(0, 2);

  const allFilteredFlights = [...activeFlights, ...recentDepartedFlights];
  
  return allFilteredFlights.sort((a, b) => {
    const timeA = a.ScheduledDepartureTime;
    const timeB = b.ScheduledDepartureTime;
    
    if (!timeA && !timeB) return 0;
    if (!timeA) return 1;
    if (!timeB) return -1;
    
    return timeA.localeCompare(timeB);
  });
}

export function getFlightsByGateWithPriority(flights: Flight[], gateNumber: string): Flight[] {
  if (!flights || !gateNumber) return [];
  
  const normalizedGate = gateNumber.replace(/^0+/, '');
  const gateVariants = [
    gateNumber,
    normalizedGate,
    gateNumber.padStart(2, '0'),
  ];
  
  const gateFlights = flights.filter(flight => {
    if (!flight.GateNumber) return false;
    return gateVariants.some(variant => 
      flight.GateNumber.includes(variant)
    );
  });
  
  const activeFlights = filterActiveFlights(gateFlights);
  
  if (activeFlights.length > 0) {
    return activeFlights;
  }
  
  if (gateFlights.length > 0) {
    const nextScheduledFlight = gateFlights
      .filter(flight => flight.ScheduledDepartureTime)
      .sort((a, b) => a.ScheduledDepartureTime.localeCompare(b.ScheduledDepartureTime))[0];
    
    return nextScheduledFlight ? [nextScheduledFlight] : [];
  }
  
  return [];
}

// NOVA asinhrona funkcija koja koristi vašu konfiguraciju
export async function hasBusinessClassCheckIn(flightNumber: string): Promise<boolean> {
  if (!flightNumber) return false;
  
  try {
    const airlineIata = flightNumber.substring(0, 2).toUpperCase();
    
    // Prvo provjeri specifične letove
    const specificFlights = await getAllSpecificFlights();
    const specificFlight = specificFlights.find(f => f.flightNumber === flightNumber);
    
    // Ako postoji specifična konfiguracija za ovaj let
    if (specificFlight) {
      // Provjeri da li ovaj specifični let uopšte ima business class
      if (!specificFlight.alwaysBusinessClass) {
        return false; // Specifični let NEMA business class
      }
      
      // Provjeri sezonska ograničenja
      const currentSeason = getCurrentSeason();
      
      if (specificFlight.winterOnly && currentSeason !== 'winter') {
        return false;
      }
      
      if (specificFlight.summerOnly && currentSeason !== 'summer') {
        return false;
      }
      
      // Provjeri dane u sedmici
      if (specificFlight.daysOfWeek && specificFlight.daysOfWeek.length > 0) {
        const today = new Date().getDay(); // 0 = nedjelja, 1 = ponedjeljak, ...
        if (!specificFlight.daysOfWeek.includes(today)) {
          return false;
        }
      }
      
      // Provjeri datumski opseg
      const now = new Date();
      
      if (specificFlight.validFrom) {
        const validFromDate = new Date(specificFlight.validFrom);
        if (now < validFromDate) {
          return false;
        }
      }
      
      if (specificFlight.validUntil) {
        const validUntilDate = new Date(specificFlight.validUntil);
        if (now > validUntilDate) {
          return false;
        }
      }
      
      // Sve provjere prošle, let IMA business class
      return true;
    }
    
    // Ako NEMA specifične konfiguracije, onda provjeri generalna pravila za aviokompaniju
    const airline = await getAirlineByIata(airlineIata);
    
    if (!airline) {
      return false; // Aviokompanija nije u bazi
    }
    
    // Ako aviokompanija globalno NEMA business class, vrati false
    if (!airline.hasBusinessClass) {
      return false;
    }
    
    // Provjeri sezonska podešavanja
    const currentSeason = getCurrentSeason();
    const schedule = currentSeason === 'winter' ? airline.winterSchedule : airline.summerSchedule;
    
    // Ako sezonska konfiguracija NEMA business class
    if (!schedule.hasBusinessClass) {
      return false;
    }
    
    // Provjeri da li je ovaj let u specifičnim letovima za sezonu
    if (schedule.specificFlights && schedule.specificFlights.length > 0) {
      // Ako postoje specifični letovi za ovu sezonu, onda samo oni imaju business class
      return schedule.specificFlights.includes(flightNumber);
    }
    
    // Provjeri dane u sedmici
    if (schedule.daysOfWeek && schedule.daysOfWeek.length > 0) {
      const today = new Date().getDay();
      if (!schedule.daysOfWeek.includes(today)) {
        return false;
      }
    }
    
    // Provjeri datumski opseg
    const now = new Date();
    
    if (schedule.startDate) {
      const startDate = new Date(schedule.startDate);
      if (now < startDate) {
        return false;
      }
    }
    
    if (schedule.endDate) {
      const endDate = new Date(schedule.endDate);
      if (now > endDate) {
        return false;
      }
    }
    
    // Sve provjere prošle, let IMA business class
    return true;
    
  } catch (error) {
    console.error('Error checking business class for check-in:', error);
    return false;
  }
}

// NOVA asinhrona verzija koja koristi vašu konfiguraciju
export async function getCheckInClassType(
  flight: Flight | EnhancedFlight, 
  currentDeskNumber: string
): Promise<'business' | 'economy' | null> {
  if (!flight || !flight.FlightNumber || !flight.CheckInDesk) {
    return null;
  }
  
  try {
    const flightNumber = flight.FlightNumber;
    
    // 1. Proveri da li let uopšte ima business class prema vašoj konfiguraciji
    const hasBusiness = await hasBusinessClassCheckIn(flightNumber);
    
    // Ako let NEMA business class uopšte, vrati null
    if (!hasBusiness) {
      return null;
    }
    
    // 2. Logika za određivanje business/economy na osnovu check-in deska
    const enhancedFlight = flight as EnhancedFlight;
    
    // Ako imamo enhanced info, koristimo ga
    if (enhancedFlight._allDesks && enhancedFlight._deskIndex !== undefined) {
      return enhancedFlight._deskIndex === 0 ? 'business' : 'economy';
    }
    
    // Fallback na logiku za određivanje na osnovu pozicije u listi
    const deskString = flight.CheckInDesk as string;
    const normalizedCurrent = normalizeDeskNumber(currentDeskNumber);
    const currentVariants = getDeskNumberVariants(currentDeskNumber);
    
    const allDesks = deskString
      .split(/[,;]/)
      .map(desk => desk.trim())
      .filter(desk => desk !== '')
      .map(desk => normalizeDeskNumber(desk));
    
    if (allDesks.length === 0) {
      return null;
    }
    
    let currentIndex = allDesks.findIndex(desk => desk === normalizedCurrent);
    
    if (currentIndex === -1) {
      for (const variant of currentVariants) {
        currentIndex = allDesks.findIndex(desk => desk === variant);
        if (currentIndex !== -1) break;
      }
    }
    
    if (currentIndex === -1) {
      return null;
    }
    
    // Let IMA business class (prema konfiguraciji) i sada određujemo class type
    // PRVI desk je uvek BUSINESS, ostali su ECONOMY
    return currentIndex === 0 ? 'business' : 'economy';
    
  } catch (error) {
    console.error('Error determining check-in class type:', error);
    return null;
  }
}

// Ažurirana debug funkcija
export async function debugCheckInClassType(
  flight: Flight | EnhancedFlight, 
  currentDeskNumber: string
): Promise<{
  classType: 'business' | 'economy' | null;
  debugInfo: {
    flightNumber: string;
    airlineCode: string;
    checkInDesk: string;
    normalizedDesks: string[];
    currentDesk: string;
    normalizedCurrent: string;
    currentVariants: string[];
    currentIndex: number;
    deskCount: number;
    hasEnhancedInfo: boolean;
    enhancedDesks?: string[];
    enhancedIndex?: number;
    hasBusinessConfig: boolean;
    configSource: string;
  };
}> {
  const enhancedFlight = flight as EnhancedFlight;
  const debugInfo = {
    flightNumber: flight?.FlightNumber || '',
    airlineCode: flight?.FlightNumber ? flight.FlightNumber.substring(0, 2).toUpperCase() : '',
    checkInDesk: flight?.CheckInDesk || '',
    normalizedDesks: [] as string[],
    currentDesk: currentDeskNumber || '',
    normalizedCurrent: '',
    currentVariants: [] as string[],
    currentIndex: -1,
    deskCount: 0,
    hasEnhancedInfo: !!(enhancedFlight?._allDesks && enhancedFlight._deskIndex !== undefined),
    enhancedDesks: enhancedFlight?._allDesks,
    enhancedIndex: enhancedFlight?._deskIndex,
    hasBusinessConfig: false,
    configSource: 'unknown'
  };
  
  if (!flight || !flight.FlightNumber) {
    return { classType: null, debugInfo };
  }
  
  // Proveri business class konfiguraciju
  try {
    debugInfo.hasBusinessConfig = await hasBusinessClassCheckIn(flight.FlightNumber);
    
    // Pokušaj da saznaš izvor konfiguracije
    const airlineIata = flight.FlightNumber.substring(0, 2).toUpperCase();
    const specificFlights = await getAllSpecificFlights();
    const airline = await getAirlineByIata(airlineIata);
    
    if (specificFlights.some(f => f.flightNumber === flight.FlightNumber)) {
      debugInfo.configSource = 'specific-flight';
    } else if (airline?.hasBusinessClass) {
      debugInfo.configSource = 'airline-global';
    } else if (airline) {
      debugInfo.configSource = 'airline-seasonal';
    } else {
      debugInfo.configSource = 'not-configured';
    }
  } catch (error) {
    console.error('Error checking business class config:', error);
    debugInfo.configSource = 'error';
  }
  
  debugInfo.normalizedCurrent = normalizeDeskNumber(currentDeskNumber);
  debugInfo.currentVariants = getDeskNumberVariants(currentDeskNumber);
  
  if (flight.CheckInDesk) {
    const allDesks = flight.CheckInDesk
      .split(',')
      .map(desk => desk.trim())
      .filter(desk => desk !== '')
      .map(desk => normalizeDeskNumber(desk));
    
    debugInfo.normalizedDesks = allDesks;
    debugInfo.deskCount = allDesks.length;
    
    let currentIndex = allDesks.findIndex(desk => desk === debugInfo.normalizedCurrent);
    
    if (currentIndex === -1) {
      for (const variant of debugInfo.currentVariants) {
        currentIndex = allDesks.findIndex(desk => desk === variant);
        if (currentIndex !== -1) break;
      }
    }
    
    debugInfo.currentIndex = currentIndex;
  }
  
  let classType: 'business' | 'economy' | null = null;
  
  if (debugInfo.hasEnhancedInfo && debugInfo.enhancedDesks && debugInfo.enhancedIndex !== undefined) {
    classType = debugInfo.enhancedIndex === 0 ? 'business' : 'economy';
  } else if (debugInfo.hasBusinessConfig && debugInfo.deskCount >= 1) {
    classType = debugInfo.deskCount === 1 ? 'business' : 
                debugInfo.currentIndex === 0 ? 'business' : 'economy';
  }
  
  return { classType, debugInfo };
}

export function getCheckInDesksWithClasses(flight: Flight): Array<{
  deskNumber: string;
  classType: 'business' | 'economy';
}> {
  if (!flight || !flight.CheckInDesk) {
    return [];
  }
  
  const allDesks = flight.CheckInDesk
    .split(',')
    .map(desk => desk.trim())
    .filter(desk => desk !== '');
  
  if (allDesks.length < 2) {
    return [];
  }
  
  return allDesks.map((desk, index) => ({
    deskNumber: desk,
    classType: index === 0 ? 'business' : 'economy'
  }));
}

// Extended FlightData type for more specific use cases
export interface ExtendedFlightData extends FlightData {
  source: 'live' | 'cached' | 'fallback' | 'backup' | 'auto-processed' | 'emergency';
  error?: string;
  warning?: string;
  backupTimestamp?: string;
  autoProcessedCount?: number;
  isOfflineMode?: boolean;
}

// Helper funkcija za dobijanje klase na osnovu konfiguracije (sync verzija za jednostavne slučajeve)
export async function getFlightClassTypeFromConfig(
  flightNumber: string,
  airlineIata?: string
): Promise<'business' | 'economy' | null> {
  if (!flightNumber) return null;
  
  try {
    const airlineCode = airlineIata || flightNumber.substring(0, 2).toUpperCase();
    const hasBiz = await hasBusinessClass(airlineCode, flightNumber);
    
    // Ako ima business class, trebalo bi da ima barem jedan check-in desk
    // U praksi bi trebalo proveriti i check-in deskove
    return hasBiz ? 'business' : 'economy';
  } catch (error) {
    console.error('Error getting flight class type from config:', error);
    return null;
  }
}

export async function updateCheckInStatus(
  flightNumber: string,
  scheduledTime: string,
  deskNumber: string,
  action: 'open' | 'close'
): Promise<any> {
  // Pretpostavljamo da imate neku vrstu baze podataka ili in-memory storage-a
  // Ovdje implementirate logiku za ažuriranje statusa check-in-a

  // Primjer: Ažuriranje u lokalnom storage-u ili bazi
  console.log(`Updating check-in status for ${flightNumber} (${scheduledTime}) at desk ${deskNumber} to ${action}`);

  // Vratite rezultat
  return {
    success: true,
    flightNumber,
    scheduledTime,
    deskNumber,
    action,
    updatedAt: new Date().toISOString(),
  };
}
