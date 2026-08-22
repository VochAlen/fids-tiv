// lib/flight-api-helpers.ts
import type { Flight, RawFlightData } from '@/types/flight';

// ── Debug logger — aktivan samo u development modu ──────────
// Smanjuje log šum u produkciji (Vercel logovi imaju kvote/retenciju),
// bez gubitka mogućnosti debagovanja lokalno.
const isDev = process.env.NODE_ENV !== 'production';
const dlog = (...args: unknown[]) => { if (isDev) console.log(...args); };


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
    dlog(`✈️ Cleaned flight (removed ICAO ${icaoCode}): ${flightNumber} → ${cleaned}`);
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
      dlog(`✈️ Cleaned flight (ICAO only): ${flightNumber} → ${cleaned}`);
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
        dlog(`✅ Found logo for ${normalizedIcao}: ${logoUrl}`);
        logoCache.set(cacheKey, logoUrl);
        return logoUrl;
      }
    } catch (error) {
      continue;
    }
  }

  dlog(`❌ No logo found for ${normalizedIcao}`);
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

  // ── NOVO: Parsiraj datum za sortiranje ──────────────────────────
  // API vraća Datum u formatu "22-05-2026" (dan-mjesec-godina)
  let sortTime: number | undefined = undefined;
  
  if (raw.Datum && raw.Planirano) {
    try {
      const [day, month, year] = raw.Datum.split('-').map(Number);
      // Parsiraj vrijeme (može biti "1115" ili "11:15")
      let hours: number, minutes: number;
      if (raw.Planirano.includes(':')) {
        [hours, minutes] = raw.Planirano.split(':').map(Number);
      } else if (raw.Planirano.length === 4) {
        hours = parseInt(raw.Planirano.substring(0, 2));
        minutes = parseInt(raw.Planirano.substring(2, 4));
      } else {
        hours = 0;
        minutes = 0;
      }
      dlog(`RAW Planirano za HN2392: "${raw.Planirano}", BrojLeta: "${raw.BrojLeta}"`);

      
      if (!isNaN(day) && !isNaN(month) && !isNaN(year) && !isNaN(hours) && !isNaN(minutes)) {
        // month je 0-indexed u JavaScript Date
// Kreiraj timestamp kao da je UTC, ali zapravo su sati lokalni
// Offset u minutama (npr. UTC+2 = -120)
const tzOffset = new Date().getTimezoneOffset() * 60 * 1000;
const scheduledDate = new Date(Date.UTC(year, month - 1, day, hours, minutes, 0, 0));
sortTime = scheduledDate.getTime() + tzOffset;
dlog(`🕐 ${raw.BrojLeta}: input=${hours}:${minutes} | local=${scheduledDate.getHours()}:${scheduledDate.getMinutes()} | timestamp=${sortTime}`);
        sortTime = scheduledDate.getTime();
      }
    } catch (err) {
      console.warn(`⚠️ Failed to parse date for ${raw.Kompanija}${raw.BrojLeta}:`, err);
    }
  }

  dlog(`📝 Mapping flight: ${raw.Kompanija}${raw.BrojLeta} | TipLeta: ${raw.TipLeta} → FlightType: ${flightType} | SortTime: ${sortTime ? new Date(sortTime).toLocaleString() : 'N/A'}`);

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
    
    // ── NOVO POLJE ZA SORTIRANJE ──────────────────────────────
    _sortTime: sortTime,
    
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

// ── Tip sirovih podataka sa ngrok proxy-ja (/schedule endpoint) ──
export interface NgrokFlightRaw {
  AD: 'DEPARTURE' | 'ARRIVAL';
  acttime: string;
  airlineCode: string;
  airlineICAO: string;
  brlet: string;
  checkinDesk: string;
  codeShareFlights: string;
  comment: string;
  esttime: string;
  fromto: string;
  gate: string;
  operlong: string;
  parkingPosition: string;
  schdate: string;
  schtime: string;
  sifFromto: string;
  sifVia: string;
  via: string;
  baggageReclaim?: string;
}

/**
 * Mapira sirovi zapis sa ngrok proxy-ja u POSTOJEĆI Flight oblik.
 * Ponovo koristi iste helpere kao mapRawFlight (cleanFlightNumber,
 * parseGateNumbers, parseCheckInDesks, getLogoURLWithFallback, formatTime)
 * da izlazni Flight objekat bude potpuno identičnog oblika, bez obzira
 * na to koji je izvor podataka.
 */
export async function mapNgrokFlightToFlight(raw: NgrokFlightRaw): Promise<Flight> {
  const flightType: 'departure' | 'arrival' = raw.AD === 'DEPARTURE' ? 'departure' : 'arrival';

  const cleanNumber = cleanFlightNumber(raw.brlet || '', raw.airlineCode || '');

  const codeShareFlights = raw.codeShareFlights
    ? raw.codeShareFlights.split(',').map(f => f.trim()).filter(Boolean)
    : [];

  const airlineLogoURL = await getLogoURLWithFallback(raw.airlineICAO);

  const flightId = `${raw.brlet}_${raw.schtime}_${raw.sifFromto}`;

  // ── _sortTime: schtime je već puni ISO string ("2026-07-31T06:40:00"),
  // pa ga direktno parsiramo — isti princip kao u mapRawFlight (wall-clock
  // sati se tretiraju dosljedno za sortiranje, bez stvarne TZ konverzije,
  // jer server (Vercel) radi u UTC pa se brojevi poklapaju).
  let sortTime: number | undefined = undefined;
  if (raw.schtime) {
    try {
      const parsed = new Date(raw.schtime).getTime();
      if (!isNaN(parsed)) sortTime = parsed;
    } catch (err) {
      console.warn(`⚠️ Failed to parse schtime for ${raw.brlet}:`, err);
    }
  }

  dlog(`📝 Mapping ngrok flight: ${raw.brlet} | AD: ${raw.AD} → FlightType: ${flightType} | SortTime: ${sortTime ? new Date(sortTime).toLocaleString() : 'N/A'}`);

  return {
    id: flightId,
    FlightNumber: cleanNumber,
    AirlineCode: raw.airlineCode || '',
    AirlineICAO: raw.airlineICAO || '',
    AirlineName: raw.operlong || '',
    DestinationAirportName: raw.fromto || '',
    DestinationAirportCode: raw.sifFromto || '',
    ScheduledDepartureTime: formatTime(raw.schtime || ''),
    // esttime je ponekad prazan string prije nego let postane "aktivan" —
    // pada nazad na schtime da EstimatedDepartureTime nikad ne bude '--:--'
    // dok god postoji planirano vrijeme.
    EstimatedDepartureTime: formatTime(raw.esttime || raw.schtime || ''),
    ActualDepartureTime: formatTime(raw.acttime || ''),
    StatusEN: raw.comment || 'On Time',
    StatusMN: '',
    Terminal: '',
    GateNumber: raw.gate || '',
    GateNumbers: parseGateNumbers(raw.gate || ''),
    CheckInDesk: raw.checkinDesk || '',
    CheckInDesks: parseCheckInDesks(raw.checkinDesk || ''),
    BaggageReclaim: raw.baggageReclaim || '',
    CodeShareFlights: codeShareFlights,
    AirlineLogoURL: airlineLogoURL,
    FlightType: flightType,
    DestinationCityName: raw.fromto || '',

    _sortTime: sortTime,

    // MongoDB polja — isto kao u mapRawFlight
    _id: undefined,
    manualOverride: undefined,
    checkInDesks: undefined,
    adminNotes: undefined,
    lastModifiedBy: undefined,
    lastModifiedAt: undefined,
    modificationCount: 0,
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

// lib/flight-api-helpers.ts
export function sortFlightsByTime(flights: Flight[]): Flight[] {
  return [...flights].sort((a, b) => {
    if (a._sortTime && b._sortTime) return a._sortTime - b._sortTime;
    if (a._sortTime) return -1;
    if (b._sortTime) return 1;
    const timeA = a.EstimatedDepartureTime || a.ScheduledDepartureTime || '';
    const timeB = b.EstimatedDepartureTime || b.ScheduledDepartureTime || '';
    return timeA.localeCompare(timeB);
  });
}

export function filterTodayFlights(flights: Flight[]): Flight[] {
  const today = new Date().toDateString();
  return flights.filter(f => {
    if (!f._sortTime) return true;
    return new Date(f._sortTime).toDateString() === today;
  });
}