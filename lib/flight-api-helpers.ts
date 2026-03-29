// lib/flight-api-helpers.ts
import type { Flight, RawFlightData } from '@/types/flight';

// Cache for logo URLs
const logoCache = new Map<string, string>();

function cleanFlightNumber(flightNumber: string, airlineCode: string): string {
  if (!flightNumber) return flightNumber;
  
  let cleaned = flightNumber.trim();
  
  // Ukloni ICAO kod (3 slova) ako postoji na početku ili iza IATA koda
  // Primeri:
  // - U2EZY2271 → ukloni EZY → U22271
  // - JUASL680 → ukloni ASL → JU680
  // - 4OMNE150 → ukloni MNE → 4O150
  
  // Ako ima IATA kod (2 slova) + ICAO kod (3 slova) + brojevi
  const iataIcaoPattern = /^([A-Z]{2})([A-Z]{3})(\d+)/;
  const match = cleaned.match(iataIcaoPattern);
  
  if (match) {
    const [, iataCode, icaoCode, numbers] = match;
    // Zadrži samo IATA kod i brojeve, ukloni ICAO kod
    cleaned = `${iataCode}${numbers}`;
    console.log(`✈️ Cleaned flight (removed ICAO ${icaoCode}): ${flightNumber} → ${cleaned}`);
    return cleaned;
  }
  
  // Ako ima samo ICAO kod (3 slova) + brojevi (nema IATA kod)
  const icaoOnlyPattern = /^([A-Z]{3})(\d+)/;
  const icaoMatch = cleaned.match(icaoOnlyPattern);
  
  if (icaoMatch) {
    const [, icaoCode, numbers] = icaoMatch;
    // Ako je ICAO kod različit od airlineCode, ukloni ga i dodaj airlineCode
    if (icaoCode !== airlineCode) {
      cleaned = `${airlineCode}${numbers}`;
      console.log(`✈️ Cleaned flight (ICAO only): ${flightNumber} → ${cleaned}`);
    } else {
      cleaned = numbers;
    }
    return cleaned;
  }
  
  // Standardna logika za duplikate
  if (airlineCode && cleaned.startsWith(airlineCode)) {
    // Provjeri da li je dupliran (npr. "JUJU680")
    if (cleaned.length > airlineCode.length && cleaned.substring(airlineCode.length).startsWith(airlineCode)) {
      cleaned = cleaned.substring(airlineCode.length);
    }
  } else if (airlineCode && !cleaned.startsWith(airlineCode) && !/^\d+$/.test(cleaned)) {
    // Ako nema kod kompanije, dodaj ga
    cleaned = airlineCode + cleaned;
  }
  
  // Ako je samo broj, dodaj airlineCode
  if (/^\d+$/.test(cleaned) && airlineCode) {
    cleaned = airlineCode + cleaned;
  }
  
  return cleaned;
}

export function parseGateNumbers(gateString: string): string[] {
  if (!gateString || gateString.trim() === '') return [];
  
  return gateString
    .split(',')
    .map(gate => gate.trim())
    .filter(gate => gate !== '');
}

export function parseCheckInDesks(checkInString: string): string[] {
  if (!checkInString || checkInString.trim() === '') return [];
  
  return checkInString
    .split(',')
    .map(desk => desk.trim())
    .filter(desk => desk !== '');
}

async function findExistingLogo(icaoCode: string): Promise<string | null> {
  if (!icaoCode || typeof window === 'undefined') {
    return null;
  }

  const normalizedIcao = icaoCode.trim().toUpperCase();
  const cacheKey = `exists-${normalizedIcao}`;
  
  const cached = logoCache.get(cacheKey);
  if (cached !== undefined) {
    return cached === 'none' ? null : cached;
  }

  const extensions = ['.png', '.jpg', '.jpeg', '.svg', '.webp'];
  
  for (const ext of extensions) {
    const logoUrl = `/airlines/${normalizedIcao}${ext}`;
    
    try {
      const exists = await new Promise<boolean>((resolve) => {
        const img = new Image();
        img.onload = () => resolve(true);
        img.onerror = () => resolve(false);
        img.src = logoUrl;
        setTimeout(() => resolve(false), 100);
      });
      
      if (exists) {
        console.log(`✅ Found logo for ${normalizedIcao}: ${logoUrl}`);
        logoCache.set(cacheKey, logoUrl);
        return logoUrl;
      }
    } catch (error) {
      continue;
    }
  }

  console.log(`❌ No logo found for ${normalizedIcao}`);
  logoCache.set(cacheKey, 'none');
  return null;
}

export async function getLogoURL(icaoCode: string): Promise<string> {
  if (!icaoCode || icaoCode.trim() === '') {
    return '/airlines/placeholder.jpg';
  }

  const normalizedIcao = icaoCode.trim().toUpperCase();
  const cacheKey = `url-${normalizedIcao}`;
  
  const cachedUrl = logoCache.get(cacheKey);
  if (cachedUrl !== undefined && cachedUrl !== 'none') {
    return cachedUrl;
  }

  const existingLogo = await findExistingLogo(normalizedIcao);
  
  if (existingLogo) {
    logoCache.set(cacheKey, existingLogo);
    return existingLogo;
  }

  const placeholder = '/airlines/placeholder.jpg';
  logoCache.set(cacheKey, placeholder);
  return placeholder;
}

export function getSimpleLogoURL(icaoCode: string): string {
  if (!icaoCode || icaoCode.trim() === '') {
    return '/airlines/placeholder.jpg';
  }
  
  const normalizedIcao = icaoCode.trim().toUpperCase();
  return `/airlines/${normalizedIcao}.jpg`;
}

export async function getLogoURLWithFallback(icaoCode: string, fallbackUrl?: string): Promise<string> {
  if (!icaoCode || icaoCode.trim() === '') {
    return fallbackUrl || '/airlines/placeholder.jpg';
  }

  const normalizedIcao = icaoCode.trim().toUpperCase();
  const cacheKey = `optimized-${normalizedIcao}`;
  
  const cachedUrl = logoCache.get(cacheKey);
  if (cachedUrl !== undefined && cachedUrl !== 'none') {
    return cachedUrl;
  }

  const checkLogo = async () => {
    try {
      const existingLogo = await findExistingLogo(normalizedIcao);
      if (existingLogo) {
        logoCache.set(cacheKey, existingLogo);
      }
    } catch (error) {
      // Silent fail
    }
  };
  
  if (typeof window !== 'undefined') {
    void checkLogo();
  }

  return `/airlines/${normalizedIcao}.jpg`;
}

export function formatTime(time: string): string {
  if (!time || time.trim() === '') return '--:--';
  
  if (time.includes('T')) {
    return formatIsoTime(time);
  }
  
  if (time.length === 4 && /^\d+$/.test(time)) {
    return `${time.substring(0, 2)}:${time.substring(2, 4)}`;
  }
  
  if (time.includes(':') && time.length === 5) {
    return time;
  }
  
  return time;
}

export function formatIsoTime(isoString: string): string {
  if (!isoString) return '--:--';
  
  try {
    const date = new Date(isoString);
    if (isNaN(date.getTime())) {
      return '--:--';
    }
    
    return date.toLocaleTimeString('en-GB', { 
      hour: '2-digit', 
      minute: '2-digit',
      hour12: false 
    });
  } catch (error) {
    console.error('Error formatting ISO time:', error);
    return '--:--';
  }
}

/**
 * Map raw flight data from API to application format
 * VAŽNO: TipLeta: 'O' = departure, 'I' = arrival
 */
export async function mapRawFlight(raw: RawFlightData): Promise<Flight> {
  // ISPRAVKA: Direktno mapiranje TipLeta na FlightType
  // TipLeta: 'O' (Odlasci) -> 'departure'
  // TipLeta: 'I' (Dolasci) -> 'arrival'
  let flightType: 'departure' | 'arrival';
  
  if (raw.TipLeta === 'O') {
    flightType = 'departure';
  } else if (raw.TipLeta === 'I') {
    flightType = 'arrival';
  } else {
    // Fallback za svaki slučaj
    console.warn(`⚠️ Unknown TipLeta value: ${raw.TipLeta}, defaulting to arrival`);
    flightType = 'arrival';
  }
  
  // Očisti broj leta
  const cleanNumber = cleanFlightNumber(raw.BrojLeta || '', raw.Kompanija || '');
  
  // Parsiraj code-share letove
  const codeShareFlights = raw.CodeShare 
    ? raw.CodeShare.split(',').map(f => f.trim()).filter(Boolean)
    : [];

  // Dohvati logo URL
  const airlineLogoURL = await getLogoURLWithFallback(raw.KompanijaICAO);

  // Kreiraj deterministički ID
  const flightId = `${raw.Kompanija}${raw.BrojLeta}_${raw.Planirano}_${raw.IATA}`;

  console.log(`📝 Mapping flight: ${raw.Kompanija}${raw.BrojLeta} | TipLeta: ${raw.TipLeta} → FlightType: ${flightType}`);

  return {
    id: flightId,
    FlightNumber: cleanNumber,
    AirlineCode: raw.Kompanija || '',
    AirlineICAO: raw.KompanijaICAO || '',
    AirlineName: raw.KompanijaNaziv || '',
    DestinationAirportName: raw.Aerodrom || '',
    DestinationAirportCode: raw.IATA || '',
    ScheduledDepartureTime: formatTime(raw.Planirano || ''),
    EstimatedDepartureTime: formatTime(raw.Predvidjeno || ''),
    ActualDepartureTime: formatTime(raw.Aktuelno || ''),
    StatusEN: raw.StatusEN || raw.Status || 'On Time',
    StatusMN: raw.StatusMN || '',
    Terminal: raw.Terminal || '',
    GateNumber: raw.Gate || '',
    GateNumbers: parseGateNumbers(raw.Gate),
    CheckInDesk: raw.CheckIn || '',
    CheckInDesks: parseCheckInDesks(raw.CheckIn),
    BaggageReclaim: raw.Karusel || '',
    CodeShareFlights: codeShareFlights,
    AirlineLogoURL: airlineLogoURL,
    FlightType: flightType,
    DestinationCityName: raw.Grad || raw.Aerodrom?.split(' ')[0] || '',
    
    // MongoDB polja
    _id: undefined,
    manualOverride: undefined,
    checkInDesks: undefined,
    adminNotes: undefined,
    lastModifiedBy: undefined,
    lastModifiedAt: undefined,
    modificationCount: 0
  };
}

export function expandFlightForMultipleGates(flight: Flight): Flight[] {
  const flights: Flight[] = [flight];
  
  const gateNumbers = flight.GateNumbers || parseGateNumbers(flight.GateNumber);
  
  if (gateNumbers.length > 1) {
    for (let i = 1; i < gateNumbers.length; i++) {
      const duplicateFlight = {
        ...flight,
        GateNumber: gateNumbers[i],
        CheckInDesk: flight.CheckInDesk
      };
      flights.push(duplicateFlight);
    }
    
    flights[0].GateNumber = gateNumbers[0];
  }
  
  return flights;
}

export function sortFlightsByTime(flights: Flight[]): Flight[] {
  return flights.sort((a, b) => {
    const timeA = a.EstimatedDepartureTime || a.ScheduledDepartureTime;
    const timeB = b.EstimatedDepartureTime || b.ScheduledDepartureTime;
    
    if (!timeA) return 1;
    if (!timeB) return -1;
    
    return timeA.localeCompare(timeB);
  });
}

export function filterTodayFlights(flights: Flight[]): Flight[] {
  return flights;
}