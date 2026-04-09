// lib/check-in-service.ts

// Tipovi
export interface CheckInConfig {
  airlineIata: string;
  airlineName: string;
  checkInOpenMinutes: number;
  useAutoCheckIn: boolean;
  maxAutoOpenMinutes: number;
  minCloseBeforeDeparture: number;
  daysOfWeek: number[];
}

export interface CheckInStatus {
  shouldBeOpen: boolean;
  status: 'processing' | 'open' | 'check-in' | 'scheduled' | 'closed' | 'auto-open' | 'cancelled' | 'diverted';
  reason: string;
  minutesBeforeDeparture: number;
  isAutoOpened: boolean;
  checkInOpenTime: Date | null;
  checkInCloseTime: Date | null;
}

// Konfiguracija koja se puni sa servera
let airlineConfigs: CheckInConfig[] = [];
let configLoaded = false;
let configLoadPromise: Promise<void> | null = null;

// Mapa za brzi pristup
const AIRLINE_CONFIG_MAP = new Map<string, CheckInConfig>();

// In-memory storage za ručno otvorene check-in-ove
const manuallyOpenedCheckIns: Record<string, { isOpen: boolean; openedAt: Date }> = {};

// Keš za parsirana vremena
const timeParseCache = new Map<string, Date>();

// Funkcija za učitavanje konfiguracije sa servera
export async function loadCheckInConfig(): Promise<void> {
  // Ako se već učitava, vrati postojeći promise
  if (configLoadPromise) {
    return configLoadPromise;
  }

  // Ako je već učitano, samo vrati
  if (configLoaded) {
    return;
  }

  configLoadPromise = (async () => {
    try {
      console.log('📡 Loading check-in config from API...');
      const response = await fetch('/api/checkin-config');
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const data = await response.json();
      
      // Konvertuj u niz CheckInConfig objekata
      const configs: CheckInConfig[] = [];
      
      // Default vrijednosti
      const defaultMinutes = data.default || 120;
      
      Object.keys(data).forEach(key => {
        if (key === 'default') return;
        
        const minutes = data[key];
        
        configs.push({
          airlineIata: key,
          airlineName: getAirlineName(key),
          checkInOpenMinutes: minutes,
          useAutoCheckIn: true,
          maxAutoOpenMinutes: minutes,
          minCloseBeforeDeparture: 30,
          daysOfWeek: [],
        });
      });
      
      airlineConfigs = configs;
      
      // Ažuriraj mapu za brzi pristup
      AIRLINE_CONFIG_MAP.clear();
      airlineConfigs.forEach(config => {
        AIRLINE_CONFIG_MAP.set(config.airlineIata, config);
      });
      
      configLoaded = true;
      console.log('✅ Check-in config loaded:', {
        default: defaultMinutes,
        configs: airlineConfigs.map(c => `${c.airlineIata}: ${c.checkInOpenMinutes}`)
      });
      
    } catch (error) {
      console.error('❌ Failed to load check-in config:', error);
      // Fallback na hardkodirane vrijednosti ako API ne radi
      createFallbackConfig();
    } finally {
      configLoadPromise = null;
    }
  })();

  return configLoadPromise;
}

// Fallback konfiguracija ako API ne radi
function createFallbackConfig() {
  console.log('⚠️ Using fallback check-in configuration');
  
  const fallbackConfigs: CheckInConfig[] = [
    {
      airlineIata: 'TK',
      airlineName: 'Turkish Airlines',
      checkInOpenMinutes: 120,
      useAutoCheckIn: true,
      maxAutoOpenMinutes: 240,
      minCloseBeforeDeparture: 30,
      daysOfWeek: [],
    },
    {
      airlineIata: 'JU',
      airlineName: 'Air Serbia',
      checkInOpenMinutes: 120,
      useAutoCheckIn: true,
      maxAutoOpenMinutes: 120,
      minCloseBeforeDeparture: 30,
      daysOfWeek: [],
    },
    {
      airlineIata: 'LH',
      airlineName: 'Lufthansa',
      checkInOpenMinutes: 120,
      useAutoCheckIn: true,
      maxAutoOpenMinutes: 180,
      minCloseBeforeDeparture: 30,
      daysOfWeek: [],
    },
    {
      airlineIata: '6H',
      airlineName: 'ISRAIR',
      checkInOpenMinutes: 180,
      useAutoCheckIn: true,
      maxAutoOpenMinutes: 180,
      minCloseBeforeDeparture: 30,
      daysOfWeek: [],
    },
    {
      airlineIata: 'FZ',
      airlineName: 'Flydubai',
      checkInOpenMinutes: 180,
      useAutoCheckIn: true,
      maxAutoOpenMinutes: 180,
      minCloseBeforeDeparture: 30,
      daysOfWeek: [],
    },
    {
      airlineIata: 'BA',
      airlineName: 'British Airways',
      checkInOpenMinutes: 120,
      useAutoCheckIn: true,
      maxAutoOpenMinutes: 240,
      minCloseBeforeDeparture: 30,
      daysOfWeek: [],
    },
    {
      airlineIata: '4O',
      airlineName: 'Air Montenegro',
      checkInOpenMinutes: 120,
      useAutoCheckIn: true,
      maxAutoOpenMinutes: 120,
      minCloseBeforeDeparture: 30,
      daysOfWeek: [],
    },
    {
      airlineIata: 'FR',
      airlineName: 'Ryanair',
      checkInOpenMinutes: 120,
      useAutoCheckIn: true,
      maxAutoOpenMinutes: 240,
      minCloseBeforeDeparture: 30,
      daysOfWeek: [],
    },
    // ═══════════════════════════════════════════════════════════
    // NOVE KOMPANIJE SA 150 MINUTA
    // ═══════════════════════════════════════════════════════════
    {
      airlineIata: 'LS',
      airlineName: 'Jet2.com',
      checkInOpenMinutes: 150,
      useAutoCheckIn: true,
      maxAutoOpenMinutes: 150,
      minCloseBeforeDeparture: 30,
      daysOfWeek: [],
    },
    {
      airlineIata: 'U2',
      airlineName: 'easyJet',
      checkInOpenMinutes: 150,
      useAutoCheckIn: true,
      maxAutoOpenMinutes: 150,
      minCloseBeforeDeparture: 30,
      daysOfWeek: [],
    },
    {
      airlineIata: 'EC',
      airlineName: 'Eurowings',
      checkInOpenMinutes: 150,
      useAutoCheckIn: true,
      maxAutoOpenMinutes: 150,
      minCloseBeforeDeparture: 30,
      daysOfWeek: [],
    },
    {
      airlineIata: 'DS',
      airlineName: 'easyJet Switzerland',
      checkInOpenMinutes: 150,
      useAutoCheckIn: true,
      maxAutoOpenMinutes: 150,
      minCloseBeforeDeparture: 30,
      daysOfWeek: [],
    },
  ];
  
  airlineConfigs = fallbackConfigs;
  AIRLINE_CONFIG_MAP.clear();
  airlineConfigs.forEach(config => {
    AIRLINE_CONFIG_MAP.set(config.airlineIata, config);
  });
  configLoaded = true;
}

// Pomoćna funkcija za mapiranje IATA kodova u imena aviokompanija
function getAirlineName(iataCode: string): string {
  const airlineNames: Record<string, string> = {
    'TK': 'Turkish Airlines',
    'JU': 'Air Serbia',
    'LH': 'Lufthansa',
    '6H': 'ISRAIR',
    'FZ': 'Flydubai',
    'BA': 'British Airways',
    '4O': 'Air Montenegro',
    'FR': 'Ryanair',
    'AF': 'Air France',
    'EK': 'Emirates',
    'QR': 'Qatar Airways',
    'D8': 'Norwegian',
    // ═══════════════════════════════════════════════════════════
    // NOVE KOMPANIJE
    // ═══════════════════════════════════════════════════════════
    'LS': 'Jet2.com',
    'U2': 'easyJet',
    'EC': 'Eurowings',
    'DS': 'easyJet Switzerland',
  };
  
  return airlineNames[iataCode] || `Unknown (${iataCode})`;
}

// Pomocna funkcija za provjeru statusa leta
export function checkFlightStatus(status: string): {
  isCancelled: boolean;
  isDiverted: boolean;
  isBoarding: boolean;
  isDelayed: boolean;
} {
  if (!status) {
    return {
      isCancelled: false,
      isDiverted: false,
      isBoarding: false,
      isDelayed: false,
    };
  }

  const normalizedStatus = status.toLowerCase().trim();

  return {
    isCancelled:
      normalizedStatus.includes('cancelled') ||
      normalizedStatus.includes('canceled') ||
      normalizedStatus.includes('annulé') ||
      normalizedStatus.includes('otkazan'),
    isDiverted:
      normalizedStatus.includes('diverted') ||
      normalizedStatus.includes('preusmjeren') ||
      normalizedStatus.includes('dévié'),
    isBoarding:
      normalizedStatus.includes('boarding') ||
      normalizedStatus.includes('ukrcaj') ||
      normalizedStatus.includes('gate closing'),
    isDelayed:
      normalizedStatus.includes('delayed') ||
      normalizedStatus.includes('kašnjenje') ||
      normalizedStatus.includes('kasni'),
  };
}

// Pomocna funkcija za parsiranje vremena polaska
function parseDepartureTime(timeString: string): Date | null {
  if (!timeString) return null;

  // Provjeri keš
  const cacheKey = timeString;
  if (timeParseCache.has(cacheKey)) {
    return timeParseCache.get(cacheKey) || null;
  }

  try {
    if (timeString.includes('T')) {
      const date = new Date(timeString);
      if (!isNaN(date.getTime())) {
        timeParseCache.set(cacheKey, date);
        return date;
      }
    }

    const [hours, minutes] = timeString.split(':').map(Number);
    if (isNaN(hours) || isNaN(minutes)) return null;

    const now = new Date();
    const d = new Date(now);
    d.setHours(hours, minutes, 0, 0);

    const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
    if (now.getTime() - d.getTime() > SIX_HOURS_MS) {
      d.setDate(d.getDate() + 1);
    }

    timeParseCache.set(cacheKey, d);
    return d;
  } catch {
    return null;
  }
}

// Pomocna funkcija za generiranje ključa za čuvanje stanja check-in-a
function generateCheckInKey(flightNumber: string, scheduledTime: string): string {
  return `${flightNumber.toUpperCase()}_${scheduledTime.replace(/[:\s-]/g, '')}`;
}

// Pomocna funkcija za dobijanje check-in konfiguracije za aviokompaniju
function getCheckInConfig(airlineIata: string): CheckInConfig | null {
  return AIRLINE_CONFIG_MAP.get(airlineIata.toUpperCase()) || null;
}

// Postavi ručni status check-in-a
export function setManualCheckInStatus(
  flightNumber: string,
  scheduledTime: string,
  isOpen: boolean
): void {
  const key = generateCheckInKey(flightNumber, scheduledTime);
  manuallyOpenedCheckIns[key] = { isOpen, openedAt: new Date() };
}

// Provjeri da li je check-in ručno otvoren
export function isManuallyOpened(flightNumber: string, scheduledTime: string): boolean {
  const key = generateCheckInKey(flightNumber, scheduledTime);
  return !!manuallyOpenedCheckIns[key]?.isOpen;
}

// Poništi ručno otvaranje
export function clearManualCheckInStatus(flightNumber: string, scheduledTime: string): void {
  const key = generateCheckInKey(flightNumber, scheduledTime);
  delete manuallyOpenedCheckIns[key];
}

// Izračunaj status check-in-a na osnovu vremena i konfiguracije
function calculateCheckInStatus(
  scheduledTime: string,
  currentStatus: string,
  airlineIata: string,
  config: CheckInConfig | null
): CheckInStatus {
  const now = new Date();
  const departureTime = parseDepartureTime(scheduledTime);

  if (!departureTime) {
    return {
      shouldBeOpen: false,
      status: 'scheduled',
      reason: 'Invalid departure time',
      minutesBeforeDeparture: 0,
      isAutoOpened: false,
      checkInOpenTime: null,
      checkInCloseTime: null,
    };
  }

  // Izračunaj minuta do polaska
  const minutesBeforeDeparture = Math.floor(
    (departureTime.getTime() - now.getTime()) / (1000 * 60)
  );

  // PRVO: Provjeri da li je let otkazan ili diverted
  const { isCancelled, isDiverted } = checkFlightStatus(currentStatus);

  if (isCancelled) {
    return {
      shouldBeOpen: false,
      status: 'cancelled',
      reason: 'Flight cancelled',
      minutesBeforeDeparture,
      isAutoOpened: false,
      checkInOpenTime: null,
      checkInCloseTime: null,
    };
  }

  if (isDiverted) {
    return {
      shouldBeOpen: false,
      status: 'diverted',
      reason: 'Flight diverted',
      minutesBeforeDeparture,
      isAutoOpened: false,
      checkInOpenTime: null,
      checkInCloseTime: null,
    };
  }

  // DRUGO: Odredi koliko sati prije se otvara check-in
  let checkInOpenMinutes = 120; // default 2 sata
  
  if (config) {
    checkInOpenMinutes = config.checkInOpenMinutes;
  }

  // Izračunaj vrijeme otvaranja check-in-a
  const checkInOpenTime = new Date(departureTime);
  checkInOpenTime.setMinutes(checkInOpenTime.getMinutes() - checkInOpenMinutes);
  
  // Izračunaj vrijeme zatvaranja check-in-a (UVIJEK 30 minuta prije)
  const checkInCloseTime = new Date(departureTime);
  checkInCloseTime.setMinutes(checkInCloseTime.getMinutes() - 30);

  // TREĆE: Provjeri da li je već prošlo vrijeme zatvaranja
  if (now >= checkInCloseTime) {
    return {
      shouldBeOpen: false,
      status: 'closed',
      reason: `Check-in closed (${minutesBeforeDeparture} minutes before departure)`,
      minutesBeforeDeparture,
      isAutoOpened: false,
      checkInOpenTime,
      checkInCloseTime,
    };
  }

  // ČETVRTO: Provjeri da li je otvoreno
  if (now >= checkInOpenTime) {
    return {
      shouldBeOpen: true,
      status: 'auto-open',
      reason: `Check-in open (opened ${checkInOpenMinutes} minutes before departure)`,
      minutesBeforeDeparture,
      isAutoOpened: true,
      checkInOpenTime,
      checkInCloseTime,
    };
  }

  // PETO: Još nije otvoreno
  const minutesUntilOpen = Math.floor((checkInOpenTime.getTime() - now.getTime()) / (1000 * 60));
  
  return {
    shouldBeOpen: false,
    status: 'scheduled',
    reason: `Check-in opens in ${minutesUntilOpen} minutes`,
    minutesBeforeDeparture,
    isAutoOpened: false,
    checkInOpenTime,
    checkInCloseTime,
  };
}

// Glavna funkcija za određivanje statusa check-in-a
export async function getEnhancedCheckInStatus(
  flightNumber: string,
  scheduledTime: string,
  currentStatus: string
): Promise<CheckInStatus> {
  // Osiguraj da je konfiguracija učitana
  await loadCheckInConfig();
  
  const airlineIata = flightNumber.substring(0, 2).toUpperCase();
  const key = generateCheckInKey(flightNumber, scheduledTime);

  // 1. Prvo provjeri da li je let otkazan ili diverted
  const { isCancelled, isDiverted } = checkFlightStatus(currentStatus);
  
  if (isCancelled) {
    return {
      shouldBeOpen: false,
      status: 'cancelled',
      reason: 'Flight cancelled',
      minutesBeforeDeparture: 0,
      isAutoOpened: false,
      checkInOpenTime: null,
      checkInCloseTime: null,
    };
  }

  if (isDiverted) {
    return {
      shouldBeOpen: false,
      status: 'diverted',
      reason: 'Flight diverted',
      minutesBeforeDeparture: 0,
      isAutoOpened: false,
      checkInOpenTime: null,
      checkInCloseTime: null,
    };
  }

  // 2. Provjeri da li je check-in ručno otvoren (admin override)
  if (isManuallyOpened(flightNumber, scheduledTime)) {
    const departureTime = parseDepartureTime(scheduledTime);
    if (departureTime) {
      const checkInCloseTime = new Date(departureTime);
      checkInCloseTime.setMinutes(checkInCloseTime.getMinutes() - 30);
      
      if (new Date() >= checkInCloseTime) {
        clearManualCheckInStatus(flightNumber, scheduledTime);
        return {
          shouldBeOpen: false,
          status: 'closed',
          reason: 'Auto-closed 30 minutes before departure',
          minutesBeforeDeparture: Math.floor((departureTime.getTime() - new Date().getTime()) / (1000 * 60)),
          isAutoOpened: true,
          checkInOpenTime: manuallyOpenedCheckIns[key]?.openedAt || null,
          checkInCloseTime,
        };
      }
    }
    
    return {
      shouldBeOpen: true,
      status: 'open',
      reason: 'Manually opened from admin panel',
      minutesBeforeDeparture: 0,
      isAutoOpened: false,
      checkInOpenTime: manuallyOpenedCheckIns[key]?.openedAt || null,
      checkInCloseTime: null,
    };
  }

  // 3. Dobavi konfiguraciju za aviokompaniju
  const config = getCheckInConfig(airlineIata);

  // 4. Izračunaj status
  return calculateCheckInStatus(scheduledTime, currentStatus, airlineIata, config);
}

// Brza provjera za monitor (bez čekanja konfiguracije ako nije učitana)
export async function quickCheckInStatus(
  flightNumber: string,
  scheduledTime: string,
  currentStatus: string
): Promise<{ shouldShowCheckIn: boolean }> {
  // Ako konfiguracija nije učitana, pokušaj je učitati (ne čekaj)
  if (!configLoaded) {
    loadCheckInConfig().catch(() => {});
  }
  
  const now = Date.now();
  const departureTime = parseDepartureTime(scheduledTime);
  
  if (!departureTime) return { shouldShowCheckIn: false };
  
  const minutesBefore = Math.floor((departureTime.getTime() - now) / (1000 * 60));
  
  if (minutesBefore <= 30) return { shouldShowCheckIn: false };
  if (currentStatus?.toLowerCase().includes('cancelled')) return { shouldShowCheckIn: false };
  
  const airlineCode = flightNumber.substring(0, 2).toUpperCase();
  const config = getCheckInConfig(airlineCode);
  const openMinutes = config?.checkInOpenMinutes || 120;
  
  return {
    shouldShowCheckIn: minutesBefore <= openMinutes
  };
}

// Provjeri da li treba prikazati check-in ekran
export function shouldDisplayCheckIn(checkInStatus: CheckInStatus): boolean {
  if (checkInStatus.status === 'cancelled' || checkInStatus.status === 'diverted') {
    return false;
  }
  
  if (checkInStatus.status === 'closed') {
    return false;
  }
  
  return checkInStatus.shouldBeOpen === true;
}

// Debug funkcija za check-in logiku
export async function debugCheckInLogic(
  flightNumber: string,
  scheduledTime: string,
  currentStatus: string
): Promise<{
  checkInStatus: CheckInStatus;
  debugInfo: {
    airlineIata: string;
    config: CheckInConfig | null;
    isManuallyOpened: boolean;
    parsedTime: Date | null;
    now: Date;
    minutesBeforeDeparture: number;
    isSpecialAirline: boolean;
    checkInOpenMinutes: number;
    checkInCloseTime: Date | null;
    configLoaded: boolean;
  };
}> {
  await loadCheckInConfig();
  
  const airlineIata = flightNumber.substring(0, 2).toUpperCase();
  const now = new Date();
  const parsedTime = parseDepartureTime(scheduledTime);
  const config = getCheckInConfig(airlineIata);
  const isManuallyOpened = !!manuallyOpenedCheckIns[generateCheckInKey(flightNumber, scheduledTime)];
  
  const minutesBeforeDeparture = parsedTime 
    ? Math.floor((parsedTime.getTime() - now.getTime()) / (1000 * 60))
    : 0;
  
  const isSpecialAirline = config ? config.checkInOpenMinutes !== 120 : false;
  const checkInOpenMinutes = config?.checkInOpenMinutes || 120;

  const checkInStatus = calculateCheckInStatus(scheduledTime, currentStatus, airlineIata, config);

  return {
    checkInStatus,
    debugInfo: {
      airlineIata,
      config,
      isManuallyOpened,
      parsedTime,
      now,
      minutesBeforeDeparture,
      isSpecialAirline,
      checkInOpenMinutes,
      checkInCloseTime: checkInStatus.checkInCloseTime,
      configLoaded,
    },
  };
}

// ═══════════════════════════════════════════════════════════════
// FUNKCIJA ZA RELOAD KONFIGURACIJE
// ═══════════════════════════════════════════════════════════════
export async function reloadCheckInConfig(): Promise<void> {
  console.log('🔄 Reloading check-in configuration...');
  configLoaded = false;
  configLoadPromise = null;
  AIRLINE_CONFIG_MAP.clear();
  
  // Opciono: očisti i ručno otvorene check-in-ove
  // Object.keys(manuallyOpenedCheckIns).forEach(key => delete manuallyOpenedCheckIns[key]);
  
  await loadCheckInConfig();
  console.log('✅ Check-in configuration reloaded');
}

// Čisti cache svaki sat — spriječava beskonačan rast
if (typeof window !== 'undefined') {
  setInterval(() => {
    timeParseCache.clear();
    console.log('🧹 timeParseCache očišćen');
  }, 60 * 60 * 1000);
}

// Pojednostavljena verzija za automatski check-in
export async function calculateSimpleCheckInStatus(
  flightNumber: string,
  scheduledDepartureTime: string,
  currentStatus: string
): Promise<{
  shouldShowCheckIn: boolean;
  status: 'processing' | 'open' | 'check-in' | 'scheduled' | 'closed' | 'auto-open' | 'cancelled' | 'diverted';
  reason: string;
}> {
  await loadCheckInConfig();
  
  const now = new Date();
  const normalizedStatus = currentStatus.toLowerCase().trim();
  const airlineIata = flightNumber.substring(0, 2).toUpperCase();

  const { isCancelled, isDiverted } = checkFlightStatus(currentStatus);
  
  if (isCancelled) {
    return {
      shouldShowCheckIn: false,
      status: 'cancelled',
      reason: 'Flight cancelled',
    };
  }

  if (isDiverted) {
    return {
      shouldShowCheckIn: false,
      status: 'diverted',
      reason: 'Flight diverted',
    };
  }

  if (normalizedStatus === 'processing' || normalizedStatus === 'check-in' || normalizedStatus === 'open') {
    return {
      shouldShowCheckIn: true,
      status: normalizedStatus as 'processing' | 'open' | 'check-in',
      reason: 'Manually triggered check-in',
    };
  }

  if (
    normalizedStatus.includes('closed') ||
    normalizedStatus.includes('departed') ||
    normalizedStatus.includes('arrived') ||
    normalizedStatus.includes('completed')
  ) {
    return {
      shouldShowCheckIn: false,
      status: 'closed',
      reason: 'Flight already closed/departed',
    };
  }

  if (!scheduledDepartureTime) {
    return {
      shouldShowCheckIn: false,
      status: 'scheduled',
      reason: 'No departure time available',
    };
  }

  try {
    const departureTime = parseDepartureTime(scheduledDepartureTime);
    if (!departureTime) {
      return {
        shouldShowCheckIn: false,
        status: 'scheduled',
        reason: 'Invalid departure time',
      };
    }

    const minutesBeforeDeparture = Math.floor((departureTime.getTime() - now.getTime()) / (1000 * 60));
    const config = getCheckInConfig(airlineIata);
    const checkInOpenMinutes = config?.checkInOpenMinutes || 120;

    if (minutesBeforeDeparture <= 30) {
      return {
        shouldShowCheckIn: false,
        status: 'closed',
        reason: `Too close to departure (${minutesBeforeDeparture} minutes remaining)`,
      };
    }

    if (minutesBeforeDeparture <= checkInOpenMinutes) {
      return {
        shouldShowCheckIn: true,
        status: 'auto-open',
        reason: `Auto-opened ${checkInOpenMinutes} minutes before departure`,
      };
    }

    return {
      shouldShowCheckIn: false,
      status: 'scheduled',
      reason: `Check-in opens in ${minutesBeforeDeparture - checkInOpenMinutes} minutes`,
    };

  } catch (error) {
    console.error('Error calculating check-in status:', error);
    return {
      shouldShowCheckIn: false,
      status: 'scheduled',
      reason: 'Error calculating check-in time',
    };
  }
}