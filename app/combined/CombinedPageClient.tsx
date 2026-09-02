'use client';

// ═══════════════════════════════════════════════════════════════
// CombinedPageClient.tsx — OPTIMIZOVANO za Vercel CPU
// ═══════════════════════════════════════════════════════════════
//
// CPU OPTIMIZACIJE za Vercel:
//  1. Polling interval: 180s (optimizovano)
//  2. Stale-while-revalidate strategija (10min)
//  3. Batch state updates (useReducer sa 1s batch-om)
//  4. Throttling resize events (100ms)
//  5. Weather caching (10min TTL)
//  6. Memoizacija svih teških operacija
//  7. Smanjen timeout na 8s
//  8. Sprečavanje paralelnih fetch-ova
//  9. Optimizovana priprema podataka (Set za O(1) lookup)
// 10. useReducer za batch update
// 11. Weather emoji za destinaciju i Tivat
// ═══════════════════════════════════════════════════════════════

import type React from "react"
import {
  type JSX,
  useEffect,
  useState,
  useCallback,
  useMemo,
  useRef,
  memo,
  Component,
  type ErrorInfo,
  type ReactNode,
  useReducer,
} from "react"
import type { Flight } from "@/types/flight"
import { fetchFlightData, getUniqueDeparturesWithDeparted } from "@/lib/flight-service"
import { Info, Plane, Clock, MapPin, Users, DoorOpen, Building2 } from "lucide-react"
import { getInitialAirlineLogoSrc, isKnownLocalLogo } from '@/lib/airline-logo';
import { isNightHours } from '@/lib/night-hours';
import { useWeather } from '@/hooks/use-weather';
import WeatherIcon from '@/components/weather-icon';

// ============================================================
// OPTIMIZOVANE KONSTANTE
// ============================================================
const BASE_INTERVAL_MS       = 130_000  // 2 minute (optimizovano)
const MEDIUM_INTERVAL_MS     = 180_000  // 3 minuta
const SLOW_INTERVAL_MS       = 240_000  // 4 minuta
const FAST_THRESHOLD_MIN     = 45       // 45 min
const MEDIUM_THRESHOLD_MIN   = 120      // 2h
// FIX (podaci se ne učitavaju oko 4h ujutro): server (/api/flights, preko
// getCurrentFlightDataSafe u lib/flight-data-service.ts) može legitimno
// trebati do ~25s da odgovori tačno u trenutku noć→dan prelaza — svi kiosci
// istovremeno dobiju cache miss, jedan drži FETCH_LOCK i radi live fetch
// (worst-case ~15-22s), ostali čekaju taj rezultat do LOCK_WAIT_MAX_MS (25s).
// Stari 8s timeout je garantovano prekidao fetch prije nego što server stigne
// da odgovori. Podignuto na 30s — udobno iznad servera worst-case (~25-27s
// sa mrežnom marginom), a i dalje ispod maxDuration=60 na /api/flights ruti.
const FETCH_TIMEOUT_MS       = 30_000   // 30s (bilo 8s)
const CACHE_DURATION         = 180_000  // 3 min
const STALE_WHILE_REVALIDATE = 300_000  // 5 min
const CACHE_KEY              = "flight_board_cache_v3"
const HARD_RESET_HOUR        = 3
const SOFT_RELOAD_INTERVAL_MS = 4 * 60 * 60_000
const MAX_FLIGHTS_DISPLAY    = 9
const MAX_FLIGHTS_MEMORY     = 60
const MAX_PREV_GATES         = 200
const MEMORY_CLEANUP_INTERVAL_MS = 30 * 60_000
const HEARTBEAT_TIMEOUT_MS   = 120_000
const HEARTBEAT_CHECK_INTERVAL_MS = 30_000
const MAX_CONCURRENT_FETCHES = 1;
const BATCH_UPDATE_INTERVAL  = 1000;

// ── Low-end detekcija ──
const IS_LOW_END = typeof navigator !== 'undefined' &&
  (navigator.hardwareConcurrency ?? 4) < 4;

const MEMORY_PRESSURE_THRESHOLD = 0.80;
const HIDDEN_FLIGHT_PATTERNS = ["ZZZ", "G00", "PVT", "TST"]

const COLOR_CONFIG = {
  arrivals: {
    background: "bg-gradient-to-br from-blue-950 via-blue-900 to-blue-950",
    accent:     "bg-cyan-400",
    header:     "bg-white",
    title:      "text-white",
    subtitle:   "text-cyan-200",
    border:     "border-cyan-400",
    cardBg:     "bg-blue-900/80",
  },
  departures: {
    background: "bg-gradient-to-br from-[#1F0218] via-[#7D185E] to-[#1F0218]",
    accent:     "bg-purple-500",
    header:     "bg-yellow-400",
    title:      "text-yellow-400",
    subtitle:   "text-purple-200",
    border:     "border-purple-500",
    cardBg:     "bg-[#3a0a30]/80",
  },
} as const

interface FlightDataResponse {
  departures:   Flight[]
  arrivals:     Flight[]
  lastUpdated:  string
  source?:      "live" | "cached" | "fallback" | "backup" | "auto-processed" | "emergency"
  error?:       string
  warning?:     string
  hash?:        string | null
  count?:       number
  lastModified?: string | null
  timestamp?:   string
  isNightMode?: boolean
  desks?:       Record<string, string>
  gates?:       Record<string, string>
  deskEntries?: Record<string, unknown>
  gateEntries?: Record<string, { status?: string | null; flightNumber?: string | null; classType?: string | null }>
}

// ── State reducer za batch update ──
interface FlightState {
  arrivals: Flight[]
  departures: Flight[]
  loading: boolean
  errorMessage: string | null
  lastUpdate: string
}

type FlightAction =
  | { type: 'UPDATE_FLIGHTS'; payload: { arrivals: Flight[]; departures: Flight[]; lastUpdate: string } }
  | { type: 'SET_LOADING'; payload: boolean }
  | { type: 'SET_ERROR'; payload: string | null }
  | { type: 'BATCH_UPDATE'; payload: Partial<FlightState> }

const flightReducer = (state: FlightState, action: FlightAction): FlightState => {
  switch (action.type) {
    case 'UPDATE_FLIGHTS':
      return {
        ...state,
        arrivals: action.payload.arrivals,
        departures: action.payload.departures,
        lastUpdate: action.payload.lastUpdate,
        loading: false,
        errorMessage: null,
      }
    case 'SET_LOADING':
      return { ...state, loading: action.payload }
    case 'SET_ERROR':
      return { ...state, errorMessage: action.payload, loading: false }
    case 'BATCH_UPDATE':
      return { ...state, ...action.payload }
    default:
      return state
  }
}

const EMERGENCY_CACHE_KEY = "flight_board_emergency_v1"

const saveEmergencyCache = (data: FlightDataResponse) => {
  try { localStorage.setItem(EMERGENCY_CACHE_KEY, JSON.stringify({ data, timestamp: Date.now() })) }
  catch { /* quota exceeded */ }
}

const loadEmergencyCache = (): FlightDataResponse | null => {
  try {
    const raw = localStorage.getItem(EMERGENCY_CACHE_KEY)
    if (!raw) return null
    const { data, timestamp } = JSON.parse(raw)
    return Date.now() - timestamp > 12 * 60 * 60_000 ? null : data
  } catch { return null }
}

// ============================================================
// I18N
// ============================================================
const LANGUAGE_KEYS = ["en", "bs", "de", "fr", "he", "tr"] as const
type LangKey = typeof LANGUAGE_KEYS[number]

const LANGUAGE_CONFIG: Record<LangKey, {
  arrivals: string; departures: string
  incomingFlights: string; outgoingFlights: string
  tableHeaders: { scheduled: string; estimated: string; flight: string; from: string; destination: string; checkIn: string; gate: string; status: string }
}> = {
  en: {
    arrivals: "ARRIVALS", departures: "DEPARTURES",
    incomingFlights: "Incoming flights", outgoingFlights: "Outgoing flights",
    tableHeaders: { scheduled: "Scheduled", estimated: "Estimated", flight: "Flight", from: "From", destination: "Destination", checkIn: "Check-In", gate: "Gate", status: "Status" },
  },
  bs: {
    arrivals: "DOLASCI", departures: "POLASCI",
    incomingFlights: "Dolazni letovi", outgoingFlights: "Odlazni letovi",
    tableHeaders: { scheduled: "Planirano", estimated: "Očekivano", flight: "Let", from: "Od", destination: "Destinacija", checkIn: "Check-In", gate: "Izlaz", status: "Status" },
  },
  de: {
    arrivals: "ANKÜNFTE", departures: "ABFLÜGE",
    incomingFlights: "Ankommende Flüge", outgoingFlights: "Abfliegende Flüge",
    tableHeaders: { scheduled: "Geplant", estimated: "Geschätzt", flight: "Flug", from: "Von", destination: "Ziel", checkIn: "Check-In", gate: "Gate", status: "Status" },
  },
  fr: {
    arrivals: "ARRIVÉES", departures: "DÉPARTS",
    incomingFlights: "Vols entrants", outgoingFlights: "Vols sortants",
    tableHeaders: { scheduled: "Prévu", estimated: "Estimé", flight: "Vol", from: "De", destination: "Destination", checkIn: "Enregist.", gate: "Porte", status: "Statut" },
  },
  he: {
    arrivals: "טיסות נכנסות", departures: "טיסות יוצאות",
    incomingFlights: "טיסות נכנסות", outgoingFlights: "טיסות יוצאות",
    tableHeaders: { scheduled: "מתוכנן", estimated: "משוער", flight: "טיסה", from: "מ", destination: "יעד", checkIn: "צ׳ק-אין", gate: "שער", status: "סטטוס" },
  },
  tr: {
    arrivals: "Varış", departures: "Kalkış",
    incomingFlights: "Varış Uçuşları", outgoingFlights: "Kalkış Uçuşları",
    tableHeaders: { scheduled: "Planlanan", estimated: "Tahmini", flight: "Uçuş", from: "Kalkış Yeri", destination: "Varış Yeri", checkIn: "Check-in", gate: "Kapı", status: "Durum" },
  },
}

const SECURITY_MESSAGES = [
  "⚠️ DEAR PASSENGERS, PLEASE DO NOT LEAVE YOUR BAGGAGE UNATTENDED AT THE AIRPORT - UNATTENDED BAGGAGE WILL BE CONFISCATED AND DESTROYED •",
  "⚠️ POŠTOVANI PUTNICI, MOLIMO VAS DA NE OSTAVLJATE SVOJ PRTLJAG BEZ NADZORA NA AERODROMU - NENADZIRANI PRTLJAG ĆE BITI ODUZET I UNIŠTEN •",
  "📶 FREE AIRPORT WIFI: Network: \"One Crna Gora\" | No password required | Connect to One Crna Gora for access •",
  "📶 BESPLATAN WIFI: Mreža: \"One Crna Gora\" | Bez lozinke | Povežite se na One Crna Gora •",

  "💻 FIDS SYSTEM DEVELOPED BY: Alen • Full-stack development from concept to deployment • © 2025-2026 All Rights Reserved •",
  "💻 FIDS SISTEM RAZVIO: Alen • Razvoj od ideje do realizacije • © 2025-2026 Sva prava zadržana •",
];


const PLACEHOLDER_IMAGE =
  "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMzIiIGhlaWdodD0iMzIiIHZpZXdCb3g9IjAgMCAzMiAzMiIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHJlY3Qgd2lkdGg9IjMyIiBoZWlnaHQ9IjMyIiBmaWxsPSIjMzQzQzU0Ii8+Cjx0ZXh0IHg9IjE2IiB5PSIxNiIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZG9taW5hbnQtYmFzZWxpbmU9Im1pZGRsZSIgZmlsbD0iIzlDQTdCNiIgZm9udC1mYW1pbHk9IkFyaWFsLCBzYW5zLXNlcmlmIiBmb250LXNpemU9IjgiPk5vIExvZ288L3RleHQ+Cjwvc3ZnPgo="

// ============================================================
// WEATHER HELPER
// ============================================================
// NAPOMENA (FIX — weather ikone se prikazuju kao kockica/prazno):
// Ranije se ovdje vraćao Unicode emoji string, renderovan direktno kao tekst.
// Na kiosk Windows mini-PC uređajima to zavisi od sistemskog color-emoji fonta
// (Segoe UI Emoji) — ako font nedostaje/je zastario ili varijacioni selektor
// (U+FE0F) nije podržan, glif se prikaže kao prazna kockica ili se ne prikaže
// uopšte. Zamijenjeno <WeatherIcon /> komponentom (components/weather-icon.tsx)
// koja iscrtava sopstveni SVG — identično na svakom uređaju, bez zavisnosti od
// instaliranih fontova i bez ikakvog dodatnog mrežnog poziva.

// ============================================================
// ERROR BOUNDARY
// ============================================================
interface EBState { hasError: boolean; errorMessage: string }
class FlightBoardErrorBoundary extends Component<{ children: ReactNode; fallback?: ReactNode }, EBState> {
  constructor(props: { children: ReactNode; fallback?: ReactNode }) {
    super(props)
    this.state = { hasError: false, errorMessage: "" }
  }
  static getDerivedStateFromError(error: Error): EBState {
    return { hasError: true, errorMessage: error.message }
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("FlightBoard ErrorBoundary:", error, info)
    setTimeout(() => this.setState({ hasError: false, errorMessage: "" }), 10_000)
  }
  render() {
    if (this.state.hasError) return this.props.fallback || (
      <div className="h-screen bg-blue-950 flex flex-col items-center justify-center text-white gap-6">
        <Plane className="w-24 h-24 opacity-30 animate-pulse" />
        <div className="text-4xl font-bold opacity-70">Reconnecting...</div>
        <div className="text-xl opacity-40">{this.state.errorMessage}</div>
      </div>
    )
    return this.props.children
  }
}

// ============================================================
// HELPER FUNKCIJE
// ============================================================
const getFlightawareLogoURL = (icao: string): string =>
  icao ? `https://www.flightaware.com/images/airline_logos/180px/${icao}.png` : ""

function getEffectiveFlightTime(f: Flight): Date | null {
  return parseFlightTimeToDate(f.EstimatedDepartureTime || f.ScheduledDepartureTime)
}

// ── ISPRAVLJENA funkcija za adaptivni interval ──
function getMinutesUntilNextFlight(flights: Flight[]): number {
  const now = Date.now()
  let min = Infinity
  for (const f of flights) {
    const t = getEffectiveFlightTime(f)
    if (!t) continue
    const diffMin = (t.getTime() - now) / 60_000
    // NAMJERNO bez "diffMin > 0 &&" — vidi objašnjenje gore
    if (diffMin < min) min = diffMin
  }
  return min
}
 
// getAdaptiveInterval ostaje NEPROMIJENJEN — eksplicitna provjera
// gapMin === Infinity je dobra dopuna, samo je gornja funkcija bila
// problem:
function getAdaptiveInterval(arrivals: Flight[], departures: Flight[]): number {
  const gapMin = getMinutesUntilNextFlight([...arrivals, ...departures])
  if (gapMin === Infinity) return SLOW_INTERVAL_MS
  if (gapMin <= FAST_THRESHOLD_MIN) return BASE_INTERVAL_MS
  if (gapMin <= MEDIUM_THRESHOLD_MIN) return MEDIUM_INTERVAL_MS
  return SLOW_INTERVAL_MS
}

function parseFlightTimeToDate(timeStr: string | null | undefined): Date | null {
  if (!timeStr) return null
  const s = timeStr.trim()
  if (!s || s === "-" || s === "--:--") return null
  try {
    if (s.includes("T") || (s.includes("-") && s.length > 5)) {
      const d = new Date(s); return isNaN(d.getTime()) ? null : d
    }
    const ampm = s.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i)
    if (ampm) {
      let h = parseInt(ampm[1], 10); const m = parseInt(ampm[2], 10)
      if (ampm[3].toUpperCase() === "PM" && h !== 12) h += 12
      if (ampm[3].toUpperCase() === "AM" && h === 12) h = 0
      const d = new Date(); d.setHours(h, m, 0, 0)
      if (Date.now() - d.getTime() > 12 * 60 * 60_000) d.setDate(d.getDate() + 1)
      return d
    }
    const sep = s.match(/^(\d{1,2})[:.](\d{2})$/)
    if (sep) {
      const h = parseInt(sep[1], 10); const m = parseInt(sep[2], 10)
      if (h > 23 || m > 59) return null
      const d = new Date(); d.setHours(h, m, 0, 0)
      if (Date.now() - d.getTime() > 12 * 60 * 60_000) d.setDate(d.getDate() + 1)
      return d
    }
    const digits = s.replace(/\D/g, "")
    if (digits.length === 4) {
      const h = parseInt(digits.substring(0, 2), 10); const m = parseInt(digits.substring(2, 4), 10)
      if (h > 23 || m > 59) return null
      const d = new Date(); d.setHours(h, m, 0, 0)
      if (Date.now() - d.getTime() > 12 * 60 * 60_000) d.setDate(d.getDate() + 1)
      return d
    }
    return null
  } catch { return null }
}

function formatTimeString(timeStr: string | null | undefined): string {
  if (!timeStr) return ""
  const s = timeStr.trim()
  if (!s || s === "-" || s === "--:--") return ""
  if (s.includes("T")) {
    const d = new Date(s)
    if (!isNaN(d.getTime())) return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
  }
  if (/^\d{2}:\d{2}$/.test(s)) return s
  const digits = s.replace(/\D/g, "")
  if (digits.length === 4) {
    const h = parseInt(digits.substring(0, 2), 10); const m = parseInt(digits.substring(2, 4), 10)
    if (h > 23 || m > 59) return ""
    if (h === 0 && m === 0) return ""
    return `${digits.substring(0, 2)}:${digits.substring(2, 4)}`
  }
  return ""
}

function isValidDisplayTime(t: string | null | undefined): boolean {
  const f = formatTimeString(t); return f !== "" && f !== "00:00"
}

function getTerminalBadge(idStr: string): { label: string; bg: string; text: string } {
  const num = parseInt(idStr.replace(/\D/g, ''), 10);
  const isTerminal2 = !isNaN(num) && num >= 21;
  return isTerminal2
    ? { label: 'T2', bg: 'bg-yellow-400', text: 'text-black' }
    : { label: 'T1', bg: 'bg-green-300', text: 'text-black' };
}

function getFlightTerminalBadge(flight: Flight): { label: string; bg: string; text: string } | null {
  if (flight.GateNumber && flight.GateNumber !== '-') {
    return getTerminalBadge(flight.GateNumber.split(',')[0].trim());
  }
  if (flight.CheckInDesk && flight.CheckInDesk !== '-') {
    const firstDesk = flight.CheckInDesk.split(',')[0].trim();
    if (firstDesk) return getTerminalBadge(firstDesk);
  }
  return null;
}

// ── Cache helpers ──
const saveToCache = (data: FlightDataResponse) => {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify({ data, timestamp: Date.now() })) }
  catch { /* quota exceeded */ }
}

const loadFromCache = (): { data: FlightDataResponse; timestamp: number } | null => {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return parsed
  } catch { return null }
}

// ── OPTIMIZOVANI fetchWithTimeout ──
const fetchWithTimeout = (
  url: string,
  timeout: number,
  headers?: HeadersInit,
  externalSignal?: AbortSignal
): Promise<Response> => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
 
  if (externalSignal?.aborted) {
    controller.abort();
  } else if (externalSignal) {
    externalSignal.addEventListener("abort", () => controller.abort(), { once: true });
  }
 
return fetch(url, { signal: controller.signal, headers })
    .finally(() => clearTimeout(timeoutId))
    .catch(err => {
      if (err.name === 'AbortError') {
        throw new Error(`Request to ${url} timed out after ${timeout}ms`);
      }
      throw err;
    });
};

// ── Auto-status logika ──
// ── Prošireni CHECKIN_OFFSETI sa tačnim podacima ──
const CHECKIN_OFFSETS: Record<string, number> = {
  // ── POSTOJEĆE (zadržano) ──
  "6H": 180,  // Israir
  "FZ": 180,  // flydubai
  "LS": 150,  // Jet2.com
  "LY": 180,  // El Al Israel Airlines
  "IZ": 180,  // Arkia Israeli Airlines
  "BA": 150,  // British Airways

  // ── EVROPSKI PREVOZNICI ──
  // Lufthansa Group (180 min)
  "LH": 180,  // Lufthansa
  "OS": 180,  // Austrian Airlines
  "LX": 180,  // Swiss International Air Lines
  "SN": 180,  // Brussels Airlines
  "EW": 180,  // Eurowings
  
  // Air France-KLM Group (180 min)
  "AF": 180,  // Air France
  "KL": 180,  // KLM Royal Dutch Airlines
  
  // IAG Group (180 min)
  "IB": 180,  // Iberia
  "EI": 180,  // Aer Lingus
  "VY": 180,  // Vueling
  
  // Ostali evropski (180 min)
  "TK": 180,  // Turkish Airlines
  "A3": 180,  // Aegean Airlines
  "JU": 180,  // Air Serbia
  "OU": 180,  // Croatia Airlines
  "LO": 180,  // LOT Polish Airlines
  "OK": 180,  // Czech Airlines
  "MA": 180,  // Malév Hungarian Airlines (ako još postoji)
  "RO": 180,  // TAROM
  "FB": 180,  // Bulgaria Air
  "JP": 180,  // Adria Airways (ako još postoji)
  
  // Low-cost evropski (120-150 min)
  "FR": 120,  // Ryanair
  "U2": 120,  // easyJet
  "W6": 150,  // Wizz Air
  "DY": 120,  // Norwegian Air Shuttle
  "SK": 120,  // SAS Scandinavian Airlines
  "BT": 120,  // airBaltic
  
  // ── RUSKI I CIS PREVOZNICI ──
  "SU": 180,  // Aeroflot
  "A4": 180,  // Azimuth
  "DP": 180,  // Pobeda (low-cost, ali 180 min)
  "U6": 180,  // Ural Airlines
  "S7": 180,  // S7 Airlines
  "UT": 180,  // UTair
  "B2": 180,  // Belavia (Belarus)
  "PS": 180,  // Ukraine International Airlines
  
  // ── BLISKOISTOČNI PREVOZNICI ──
  "EK": 180,  // Emirates
  "QR": 180,  // Qatar Airways
  "EY": 180,  // Etihad Airways
  "KU": 180,  // Kuwait Airways
  "SV": 180,  // Saudia
  "G9": 180,  // Air Arabia
  "J9": 180,  // Jazeera Airways
  
  // ── ČARTER I SEZONSKI ──
  "H1": 150,  // Hahn Air (čarter)
  "H2": 150,  // Sky Airline (čarter)
  "H3": 150,  // Niki (čarter)
  "R6": 150,  // DAT (čarter)
  "S3": 150,  // Santa Barbara Airlines (čarter)
  
  // ── BALKANSKI PREVOZNICI ──
  "4O": 150,  // Montenegro Airlines (bivši)
  "YM": 150,  // Montenegro Airlines
  "GP": 150,  // GP Aviation (čarter)
  "DI": 150,  // DIA (čarter)
  "YR": 150,  // Scandinavian Airlines System (SAS) - ponavljanje, ali ostavljam
}

// ── Mapa za prevod statusa na više jezika ──
const STATUS_I18N: Record<string, Record<LangKey, string>> = {
  'Closing': {
    en: 'Closing', bs: 'Zatvara se', de: 'Schließt', fr: 'Fermeture', he: 'נסגר', tr: 'Kapanıyor'
  },
  'Final Call': {
    en: 'Final Call', bs: 'Posljednji poziv', de: 'Letzter Aufruf', fr: 'Dernier appel', he: 'קריאה אחרונה', tr: 'Son çağrı'
  },
  'Go to Gate': {
    en: 'Go to Gate', bs: 'Idite na izlaz', de: 'Zum Gate', fr: 'Allez à la porte', he: 'לכו לשער', tr: 'Kapıya gidin'
  },
  'Boarding': {
    en: 'Boarding', bs: 'Ukrcavanje', de: 'Bord', fr: 'Embarquement', he: 'עלייה למטוס', tr: 'Biniş'
  },
  'Check-In': {
    en: 'Check-In', bs: 'Prijava', de: 'Check-In', fr: 'Enregistrement', he: 'צ׳ק-אין', tr: 'Check-In'
  },
  'Scheduled': {
    en: 'Scheduled', bs: 'Planirano', de: 'Geplant', fr: 'Prévu', he: 'מתוכנן', tr: 'Planlandı'
  },
  'On time': {
    en: 'On time', bs: 'Na vrijeme', de: 'Pünktlich', fr: 'À l\'heure', he: 'בזמן', tr: 'Zamanında'
  },
  'Delayed': {
    en: 'Delayed', bs: 'Kasni', de: 'Verspätet', fr: 'Retardé', he: 'מעוכב', tr: 'Gecikmeli'
  },
  'Early': {
    en: 'Arriving early', bs: 'Dolazi ranije', de: 'Kommt früher', fr: 'Arrive plus tôt', he: 'מגיע מוקדם', tr: 'Erken geliyor'
  },
}

// ── Poboljšana getAutoStatus funkcija sa CHECKIN_OFFSETS ──
function getAutoStatus(flight: Flight, lang: LangKey = 'en'): string | null {
  const status = (flight.StatusEN ?? "").trim()
  
  // Ako API već ima status, nemoj ga prebrisati (osim ako je generički)
  if (status && status !== "-" && !/^(on time|na vrijeme|scheduled)$/i.test(status)) {
    return null
  }

  const scheduled = parseFlightTimeToDate(flight.ScheduledDepartureTime)
  if (!scheduled) return null
  
  const estimated = parseFlightTimeToDate(flight.EstimatedDepartureTime)
  const ref = estimated ?? scheduled
  const now = Date.now()
  
  const minsToRef = (ref.getTime() - now) / 60_000
  const minsToSTD = (scheduled.getTime() - now) / 60_000

  // ── 1. Let je već poletio ──
  if (minsToRef < -5) {
    return null
  }

  // ── 2. Closing (posljednjih 5 minuta) ──
  if (minsToRef <= 5) {
    const closeTime = new Date(ref.getTime() + 5 * 60_000)
    const closeTimeStr = `${String(closeTime.getHours()).padStart(2, "0")}:${String(closeTime.getMinutes()).padStart(2, "0")}`
    const gateInfo = flight.GateNumber && flight.GateNumber !== '-' 
      ? ` ${flight.GateNumber}` 
      : ''
    return `${STATUS_I18N['Closing'][lang]}`
  }

  // ── 3. Final Call (5-10 minuta) ──
  if (minsToRef <= 10) {
    const finalTime = new Date(ref.getTime() + 10 * 60_000)
    const finalTimeStr = `${String(finalTime.getHours()).padStart(2, "0")}:${String(finalTime.getMinutes()).padStart(2, "0")}`
    const gateInfo = flight.GateNumber && flight.GateNumber !== '-' 
      ? ` ${flight.GateNumber}` 
      : ''
    return `${STATUS_I18N['Final Call'][lang]}`
  }

  // ── 4. Go to Gate (10-30 minuta) ──
  if (minsToRef <= 30) {
    const gateTime = new Date(ref.getTime() + 30 * 60_000)
    const gateTimeStr = `${String(gateTime.getHours()).padStart(2, "0")}:${String(gateTime.getMinutes()).padStart(2, "0")}`
    const gateInfo = flight.GateNumber && flight.GateNumber !== '-' 
      ? ` ${flight.GateNumber}` 
      : ''
    return `${STATUS_I18N['Go to Gate'][lang]}`
  }

  // ── 5. Check-In (30+ minuta do polijetanja) ──
  if (minsToSTD > 30) {
    // Koristi CHECKIN_OFFSETS za specifične kompanije, default 120 min
    const iata = (flight.FlightNumber ?? "").replace(/\s/g, "").substring(0, 2).toUpperCase()
    const offset = CHECKIN_OFFSETS[iata] ?? 120
    const checkInTime = new Date(scheduled.getTime() - offset * 60_000)
    const checkInTimeStr = `${String(checkInTime.getHours()).padStart(2, "0")}:${String(checkInTime.getMinutes()).padStart(2, "0")}`
    
    // Dodaj info o šalteru ako je dostupan
    const deskInfo = flight.CheckInDesk && flight.CheckInDesk !== '-'
      ? ` ${flight.CheckInDesk}`
      : ''
    
    // Dodaj info o koliko vremena pre polijetanja se otvara check-in
    const hoursBefore = Math.floor(offset / 60)
    const timeInfo = hoursBefore > 0 ? ` (${hoursBefore}h before)` : ''
    
    return `${STATUS_I18N['Check-In'][lang]} ${checkInTimeStr}`
  }

  return null
}

// ── Poboljšana getAutoArrivalStatus funkcija ──
// ── ISPRAVLJENA getAutoArrivalStatus funkcija ──
function getAutoArrivalStatus(flight: Flight, fmtTime: (t: string) => string, lang: LangKey = 'en'): string | null {
  const status = (flight.StatusEN ?? "").trim()
  
  // Ako API već ima status, nemoj ga prebrisati (osim ako je generički)
  const isGenericStatus =
    !status || status === "-" || /^(on time|na vrijeme|scheduled)$/i.test(status)
  if (!isGenericStatus) return null

  const schStr = flight.ScheduledDepartureTime
  const estStr = flight.EstimatedDepartureTime
  if (!schStr) return null
  
  // Ako nema estimated ili je isti kao scheduled, prikaži samo "Scheduled"
  if (!estStr || !isValidDisplayTime(estStr) || schStr === estStr) {
    return STATUS_I18N['Scheduled'][lang]
  }
  
  const sch = parseFlightTimeToDate(schStr)
  const est = parseFlightTimeToDate(estStr)
  if (!sch || !est) {
    return STATUS_I18N['Scheduled'][lang]
  }

  const diffMinutes = (est.getTime() - sch.getTime()) / 60_000
  const estTimeStr = fmtTime(estStr)

  // ── 1. Kašnjenje (diffMinutes > 15) ──
  if (diffMinutes > 15) {
    const delayMins = Math.round(diffMinutes)
    const gateInfo = flight.GateNumber && flight.GateNumber !== '-'
      ? ` | Gate ${flight.GateNumber}`
      : ''
    return `${STATUS_I18N['Delayed'][lang]} ${delayMins}min – ${estTimeStr}`
  }

  // ── 2. Dolazak ranije (diffMinutes < -15) ──
  if (diffMinutes < -15) {
    const earlyMins = Math.round(Math.abs(diffMinutes))
    const gateInfo = flight.GateNumber && flight.GateNumber !== '-'
      ? ` | Gate ${flight.GateNumber}`
      : ''
    return `${STATUS_I18N['Early'][lang]} ${earlyMins}min – ${estTimeStr}`
  }

  // ── 3. On time (diffMinutes između -15 i 15) ──
  const gateInfo = flight.GateNumber && flight.GateNumber !== '-'
    ? ` | Gate ${flight.GateNumber}`
    : ''
  return `${STATUS_I18N['On time'][lang]} – ${estTimeStr}`
}

// ── NAJJEDNOSTAVNIJA funkcija za generisanje korisnih informacija za putnike ──
// Koristi SAMO polja koja sigurno postoje u Flight tipu
function getPassengerInfo(flight: Flight): string | null {
  const info: string[] = []
  
  // 1. Informacija o terminalu
  const terminal = getFlightTerminalBadge(flight)
  if (terminal) {
    info.push(`Terminal ${terminal.label}`)
  }

  // 2. Informacija o gate-u
  if (flight.GateNumber && flight.GateNumber !== '-') {
    info.push(`Gate ${flight.GateNumber}`)
  }

  // 3. Informacija o check-in šalteru
  if (flight.CheckInDesk && flight.CheckInDesk !== '-') {
    info.push(`Check-In ${flight.CheckInDesk}`)
  }

  // 4. Informacija o kodu dijeljenja (codeshare)
  if (flight.CodeShareFlights && flight.CodeShareFlights.length > 0) {
    const codeshareInfo = flight.CodeShareFlights.slice(0, 3).join(', ')
    if (flight.CodeShareFlights.length > 3) {
      info.push(`+${flight.CodeShareFlights.length - 3} codeshare`)
    } else {
      info.push(`Codeshare: ${codeshareInfo}`)
    }
  }

  // 5. Informacija o avio-kompaniji
  if (flight.AirlineName) {
    info.push(flight.AirlineName)
  }

  return info.length > 0 ? info.join(' · ') : null
}

// ── Funkcija za procjenu vremena do ukrcaja ──
function getBoardingTimeInfo(flight: Flight): string | null {
  const scheduled = parseFlightTimeToDate(flight.ScheduledDepartureTime)
  if (!scheduled) return null
  
  const estimated = parseFlightTimeToDate(flight.EstimatedDepartureTime)
  const ref = estimated ?? scheduled
  const now = Date.now()
  const minsToRef = (ref.getTime() - now) / 60_000

  // Ako je prošlo vrijeme polijetanja
  if (minsToRef < -30) {
    return null
  }

  // Ako je let u toku (boarding)
  if (minsToRef < 0) {
    return '🛫 Departing now'
  }

  // Boarding počinje 30 minuta prije polijetanja
  const minsToBoarding = minsToRef - 30

  // Ako je boarding već počeo (ili uskoro počinje)
  if (minsToBoarding <= 5) {
    return '🛫 Boarding now'
  }

  // Ako je boarding za manje od 2 sata
  if (minsToBoarding <= 120) {
    const hours = Math.floor(minsToBoarding / 60)
    const minutes = Math.round(minsToBoarding % 60)
    
    if (hours === 0) {
      return `🛫 Boarding in ${minutes}min`
    } else if (hours === 1) {
      return `🛫 Boarding in ${minutes}min`
    } else {
      return `🛫 Boarding in ${hours}h ${minutes}min`
    }
  }

  // Za letove za više od 2 sata
  const hours = Math.floor(minsToBoarding / 60)
  const minutes = Math.round(minsToBoarding % 60)
  return `🛫 Departure in ${hours}h ${minutes}min`
}

// ── Funkcija za procjenu vremena do dolaska ──
function getArrivalTimeInfo(flight: Flight): string | null {
  const scheduled = parseFlightTimeToDate(flight.ScheduledDepartureTime)
  if (!scheduled) return null
  
  const estimated = parseFlightTimeToDate(flight.EstimatedDepartureTime)
  const ref = estimated ?? scheduled
  const now = Date.now()
  const minsToRef = (ref.getTime() - now) / 60_000

  // Ako je let već stigao
  if (minsToRef < -10) {
    return null
  }

  // Ako je let na prilazu
  if (minsToRef < 0) {
    return '🛬 Landing now'
  }

  // Ako je za manje od 1 sata
  if (minsToRef <= 60) {
    const minutes = Math.round(minsToRef)
    return `🛬 ${minutes}min until arrival`
  }

  // Za više od 1 sat
  const hours = Math.floor(minsToRef / 60)
  const minutes = Math.round(minsToRef % 60)
  return `🛬 ${hours}h ${minutes}min until arrival`
}

// ── Status pill ──
type LEDColor = "blue"|"green"|"orange"|"red"|"yellow"|"cyan"|"purple"|"lime"

// ── AŽURIRANA computeStatusPill funkcija ──
// ── AŽURIRANA computeStatusPill funkcija ──
function computeStatusPill(flight: Flight, isArrival: boolean, fmtTime: (t: string) => string, lang: LangKey = 'en') {
  const gateChangedAt = (flight as any)._gateChangedAt;
  const isRecentGateChange = !isArrival && gateChangedAt && (Date.now() - gateChangedAt < 15_000);

  if (isRecentGateChange) {
    return {
      bg: "bg-red-600/30", border: "border-red-500/70", text: "text-red-100",
      led1: "red" as LEDColor, led2: "orange" as LEDColor,
      blinkClass: "animate-pill-blink-fast",
      showLEDs: true, hasStatusText: true,
      displayText: `⚠️ Gate changed to ${flight.GateNumber}`,
      passengerInfo: `⚠️ Gate change to ${flight.GateNumber}`,
      boardingTime: null,
      arrivalTime: null,
    };
  }

  const auto = isArrival 
    ? getAutoArrivalStatus(flight, fmtTime, lang) 
    : getAutoStatus(flight, lang)
  
  // ── BITNO: auto sadrži cijeli tekst, npr. "Delayed 125min – 12:10" ──
  const effectiveStatus = auto !== null ? auto : (flight.StatusEN ?? "")
  const s = effectiveStatus

  const isCancelled    = /(cancelled|canceled|otkazan)/i.test(s)
  const isDelayed      = /(delay|kasni)/i.test(s)
  const isBoarding     = !isArrival && /(boarding|gate open|closing|final call|go to gate)/i.test(s)
  const isProcessing   = /processing/i.test(s)
  const isEarly        = /(earlier|ranije|arriving early)/i.test(s)
  const isOnTime       = /(on time|na vrijeme)/i.test(s)
  const isDiverted     = /(diverted|preusmjeren)/i.test(s)
  const isCheckInOpen  = /(check.?in|check-in)/i.test(s)
  const isGoToGate     = !isArrival && /(go to gate)/i.test(s)
  const isClose        = !isArrival && /^closing/i.test(s.trim())
  const isFinalCall    = !isArrival && /^final call/i.test(s.trim())
  const isArrived      = isArrival  && /(arrived|landed|sletio|sletjelo|dolazak|stigao)/i.test(s)

  // ── BITNO: displayText = effectiveStatus (cijeli tekst) ──
  let displayText = effectiveStatus  // ← OVDJE JE BIO PROBLEM! ranije je bio s (skraćeni status)
  
  // Posebni slučajevi:
  if (isProcessing) displayText = "Check-In"
  if (isArrived) {
    const t = flight.EstimatedDepartureTime || flight.ScheduledDepartureTime || flight.ActualDepartureTime
    displayText = `Arrived at ${t ? fmtTime(t) : ""}`
  }

  const hasStatusText = displayText.trim() !== ""
  const showLEDs      = isCancelled || isDelayed || isBoarding || isProcessing ||
                        isCheckInOpen || isArrived || isDiverted || isGoToGate ||
                        isClose || isFinalCall || isEarly

  let bg = "bg-white/10", border = "border-white/30", text = "text-white"
  let led1: LEDColor = "blue", led2: LEDColor = "green", blinkClass = ""

  if      (isCancelled)                { bg="bg-red-500/20";    border="border-red-500/50";    text="text-red-100";    led1="red";    led2="orange"; blinkClass="animate-pill-blink"      }
  else if (isClose)                    { bg="bg-red-600/30";    border="border-red-500/70";    text="text-red-100";    led1="red";    led2="orange"; blinkClass="animate-pill-blink-fast" }
  else if (isFinalCall)                { bg="bg-orange-600/30"; border="border-orange-500/70"; text="text-orange-100"; led1="orange"; led2="red";    blinkClass="animate-pill-blink-fast" }
  else if (isGoToGate)                 { bg="bg-blue-500/20";   border="border-blue-500/50";   text="text-blue-100";   led1="blue";   led2="cyan";   blinkClass="animate-pill-blink"      }
  else if (isDelayed)                  { bg="bg-yellow-500/20"; border="border-yellow-500/50"; text="text-yellow-100"; led1="yellow"; led2="orange"                                        }
  else if (isEarly)                    { bg="bg-purple-500/20"; border="border-purple-500/50"; text="text-purple-100"; led1="purple"; led2="blue"                                         }
  else if (isBoarding)                 { bg="bg-cyan-500/20";   border="border-cyan-500/50";   text="text-cyan-100";   led1="cyan";   led2="blue";   blinkClass="animate-pill-blink"      }
  else if (isCheckInOpen||isProcessing){ bg="bg-green-500/20";  border="border-green-500/50";  text="text-green-100";  led1="green";  led2="lime"                                          }
  else if (isDiverted)                 { bg="bg-orange-500/20"; border="border-orange-500/50"; text="text-orange-100"; led1="orange"; led2="red"                                          }
  else if (isOnTime)                   { bg="bg-lime-500/20";   border="border-lime-500/50";   text="text-lime-100";   led1="lime";   led2="green"                                        }
  else if (isArrived)                  { bg="bg-green-500/20";  border="border-green-500/50";  text="text-green-100";  led1="green";  led2="lime";   blinkClass="animate-pill-blink"      }

  // ── Dodatne informacije za putnike ──
  const passengerInfo = getPassengerInfo(flight)
  const boardingTime = isArrival ? getArrivalTimeInfo(flight) : getBoardingTimeInfo(flight)
  const arrivalTime = isArrival ? getArrivalTimeInfo(flight) : null

  return { 
    bg, border, text, led1, led2, blinkClass, showLEDs, hasStatusText, displayText,
    passengerInfo,
    boardingTime,
    arrivalTime,
  }
}

// ============================================================
// MICRO KOMPONENTE
// ============================================================

const ClockDisplay = memo(function ClockDisplay({ colorClass }: { colorClass: string }) {
  const [time, setTime] = useState("")
  useEffect(() => {
    const tick = () => setTime(new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }))
    tick();
    const id = setInterval(tick, 10_000);
    return () => clearInterval(id)
  }, [])
  return <div className={`text-[3rem] sm:text-[7rem] font-black ${colorClass} drop-shadow-2xl leading-none tabular-nums`}>{time || "--:--"}</div>
})

const NightClock = memo(function NightClock() {
  const [time, setTime] = useState("")
  useEffect(() => {
    const tick = () => setTime(new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }))
    tick(); const id = setInterval(tick, 10_000); return () => clearInterval(id)
  }, [])
  return (
    <div className="h-screen w-full flex items-center justify-center bg-black select-none">
      <div className="font-black text-yellow-400 drop-shadow-2xl tabular-nums" style={{ fontSize: "72px", lineHeight: 1 }}>
        {time || "--:--"}
      </div>
    </div>
  )
})

const LEDIndicator = memo(function LEDIndicator({
  color, phase = "a", size = "w-3 h-3",
}: { color: LEDColor; phase?: "a"|"b"; size?: string }) {
  const colorMap: Record<LEDColor, string> = {
    blue: "bg-blue-500", green: "bg-green-500", orange: "bg-orange-500",
    red: "bg-red-500", yellow: "bg-yellow-400", cyan: "bg-cyan-400",
    purple: "bg-purple-500", lime: "bg-lime-500",
  }
  return (
    <div
      className={`${size} rounded-full ${colorMap[color]} ${phase === "a" ? "led-blink-a" : "led-blink-b"}`}
    />
  )
})

const TableHeaders = memo(function TableHeaders({
  headers, headerBg,
}: { headers: { label: string; width: string; icon: React.ComponentType<{ className?: string }> }[]; headerBg: string }) {
  return (
    <div className={`flex gap-2 p-2 ${headerBg} border-b-4 border-black/30 font-black text-black text-[1.3rem] uppercase tracking-wider flex-shrink-0 shadow-xl`}>
      {headers.map(h => {
        const Icon = h.icon
        return (
          <div key={h.label} className="flex items-stretch justify-center gap-1 px-1 h-full" style={{ width: h.width }}>
            <Icon className="w-5 h-5 self-center" /><span className="truncate self-center">{h.label}</span>
          </div>
        )
      })}
    </div>
  )
}, (prev, next) => prev.headerBg === next.headerBg && prev.headers.length === next.headers.length)

// ============================================================
// FLIGHT ROW
// ============================================================
const FlightRow = memo(
  function FlightRow({ flight, index, showArrivals, colorTitle, autoStatusTick, isDesktopLayout }: {
    flight: Flight; index: number; showArrivals: boolean; colorTitle: string; autoStatusTick: number
    isDesktopLayout: boolean
  }) {
    const formatTime = useCallback((t: string) => formatTimeString(t), [])

    const pill = useMemo(
      () => computeStatusPill(flight, showArrivals, formatTime),
      [flight, showArrivals, formatTime, autoStatusTick]
    )

    const icao = flight.AirlineICAO || flight.FlightNumber?.substring(0, 2).toUpperCase() || ""

    // ── Weather za destinaciju koristeći useWeather hook ──
    const weather = useWeather({
      cityName: flight.DestinationCityName,
      airportCode: flight.DestinationAirportCode,
      airportName: flight.DestinationAirportName
    }, 0);

    const onImgErr = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
      const img = e.currentTarget
      if (IS_LOW_END) {
        img.src = PLACEHOLDER_IMAGE;
        img.onerror = null;
        return;
      }
      if (img.dataset.tried === 'local') {
        img.dataset.tried = 'fw'
        const fw = getFlightawareLogoURL(icao)
        if (fw) { img.src = fw; return }
        img.src = PLACEHOLDER_IMAGE; img.onerror = null; return
      }
      img.src = PLACEHOLDER_IMAGE; img.onerror = null
    }, [icao])

    const rowBg          = index % 2 === 0 ? "bg-white/15" : "bg-white/5"
    const gateChangedAt  = (flight as any)._gateChangedAt
    const isGateChanged  = gateChangedAt && (Date.now() - gateChangedAt < 15_000)

    const pillCls = `w-[95%] flex items-center justify-center gap-3 text-[1.9rem] font-extrabold rounded-2xl border-2 px-4 py-2 transition-colors duration-300 ${pill.bg} ${pill.border} ${pill.text} ${pill.blinkClass}`
    const mobilePillCls = `flex items-center gap-1.5 text-xs font-bold rounded-xl border px-2 py-1 ${pill.bg} ${pill.border} ${pill.text} ${pill.blinkClass}`

    const estimatedDisplay = useMemo(() => {
      const est = flight.EstimatedDepartureTime; const sch = flight.ScheduledDepartureTime
      if (!isValidDisplayTime(est)) return null
      const estFmt = formatTimeString(est); const schFmt = formatTimeString(sch)
      if (estFmt === schFmt) return null
      return estFmt
    }, [flight.EstimatedDepartureTime, flight.ScheduledDepartureTime])

    // ── DESKTOP (sm+) ── sa content-visibility za lazy render ──
    if (isDesktopLayout) {
      return (
        <div
          className={`flex gap-2 p-1 border-b border-white/10 ${rowBg}`}
          style={{ minHeight: "68px", contain: "layout style paint", contentVisibility: "auto", containIntrinsicSize: "68px" }}
        >
          {/* Scheduled */}
          <div className="flex items-center justify-center" style={{ width: "150px" }}>
            <div className="text-[2.2rem] font-black text-white drop-shadow-lg tabular-nums">
              {formatTimeString(flight.ScheduledDepartureTime) || <span className="text-white/40">--:--</span>}
            </div>
          </div>

          {/* Estimated */}
          <div className="flex items-center justify-center" style={{ width: "150px" }}>
            {estimatedDisplay
              ? <div className={`text-[2.2rem] font-black ${colorTitle} drop-shadow-lg tabular-nums`}>{estimatedDisplay}</div>
              : <div className="text-2xl text-white/30 font-bold">-</div>}
          </div>

          {/* Flight info */}
          <div className="flex items-center gap-2" style={{ width: "240px" }}>
            <div className="relative w-[60px] h-10 bg-white rounded-xl p-1 shadow-xl flex-shrink-0">
              <img
                src={getInitialAirlineLogoSrc(icao, PLACEHOLDER_IMAGE)}
                alt={`${flight.AirlineName} logo`}
                className="object-contain w-full h-full"
                onError={onImgErr}
                data-tried={isKnownLocalLogo(icao) ? 'local' : 'fw'}
                decoding="async"
                loading={index < 9 ? "eager" : "lazy"}
                fetchPriority={index < 8 ? "high" : "auto"}
              />
            </div>
            <div className="text-[2rem] font-black text-white drop-shadow-lg">{flight.FlightNumber}</div>
            {flight.CodeShareFlights && flight.CodeShareFlights.length > 0 && (
              <div className="text-sm text-white/50 font-bold">+{flight.CodeShareFlights.length}</div>
            )}
          </div>

          {showArrivals ? (
            <>
              {/* From / Destination */}
              <div className="flex items-center" style={{ width: "450px" }}>
                <div className="text-[3rem] font-black text-white truncate drop-shadow-lg">
                  {flight.DestinationCityName || flight.DestinationAirportName}
                </div>
              </div>

              {/* WEATHER KOLONA */}
              <div className="flex items-center justify-center" style={{ width: "200px" }}>
                {weather && !weather.loading && !weather.error ? (
                  <WeatherIcon code={weather.weatherCode} temperature={weather.temperature} size={26} textSize={20} />
                ) : weather?.loading ? (
                  <div className="w-6 h-6 border-2 border-white/20 border-t-cyan-400 rounded-full animate-spin" />
                ) : (
                  <span className="text-white/20 text-xl">—</span>
                )}
              </div>

              {/* Status */}
              <div className="flex items-center justify-center" style={{ width: "580px" }}>
                {pill.hasStatusText ? (
                  <div className={`${pillCls} overflow-hidden relative`}
                    style={{ paddingLeft: pill.showLEDs ? "3.5rem" : "1rem", paddingRight: "1rem", width: "95%" }}>
                    {pill.showLEDs && (
                      <div className="absolute left-3 top-1/2 -translate-y-1/2 flex items-center gap-1 z-10">
                        <LEDIndicator color={pill.led1} phase="a" size="w-4 h-4" />
                        <LEDIndicator color={pill.led2} phase="b" size="w-4 h-4" />
                      </div>
                    )}
                    <div className="overflow-hidden text-center whitespace-nowrap"
                      style={{ marginLeft: pill.showLEDs ? "2.5rem" : "0", width: "100%" }}>
                      {pill.displayText}
                    </div>
                  </div>
                ) : (
                  <div className="text-[2rem] font-bold text-slate-300">Scheduled</div>
                )}
              </div>
            </>
          ) : (
            <>
              {/* Destination */}
              <div className="flex items-center" style={{ width: "320px" }}>
                <div className="text-[3rem] font-black text-white truncate drop-shadow-lg">
                  {flight.DestinationCityName || flight.DestinationAirportName}
                </div>
              </div>

              {/* WEATHER KOLONA */}
              <div className="flex items-center justify-center" style={{ width: "100px" }}>
                {weather && !weather.loading && !weather.error ? (
                  <WeatherIcon code={weather.weatherCode} temperature={weather.temperature} size={22} textSize={18} />
                ) : weather?.loading ? (
                  <div className="w-6 h-6 border-2 border-white/20 border-t-cyan-400 rounded-full animate-spin" />
                ) : (
                  <span className="text-white/20 text-xl">—</span>
                )}
              </div>

              {/* Check-In */}
              <div className="flex items-center justify-center flex-wrap gap-1" style={{ width: "280px" }}>
                {flight.CheckInDesk && flight.CheckInDesk !== '-'
                  ? flight.CheckInDesk.split(',').map(d => d.trim()).filter(Boolean).map(d => (
                      <div key={d} className="text-[1.6rem] font-black text-white bg-black/40 py-1 px-2.5 rounded-xl border-2 border-white/20 shadow-xl">
                        {d}
                      </div>
                    ))
                  : <div className="text-[2rem] font-black text-transparent py-2 px-3">-</div>}
              </div>

              {/* Gate */}
              <div className="flex items-center justify-center" style={{ width: "150px" }}>
                {flight.GateNumber && flight.GateNumber !== '-'
                  ? <div className={`text-[2.2rem] font-black py-1.5 px-3 rounded-xl border-2 shadow-xl
                      ${isGateChanged
                        ? 'text-red-500 bg-red-500/20 border-red-400 animate-pill-blink-fast'
                        : 'text-white bg-black/40 border-white/20'}`}>
                        {flight.GateNumber}
                      </div>
                  : <div className="text-[2rem] font-black text-transparent py-2 px-3">-</div>}
              </div>

              {/* Terminal */}
              <div className="flex items-center justify-center" style={{ width: "120px" }}>
                {(() => {
                  const badge = getFlightTerminalBadge(flight);
                  return badge ? (
                    <span className={`text-[1.4rem] font-black rounded-full px-3 py-1.5 leading-none ${badge.bg} ${badge.text}`}>
                      {badge.label}
                    </span>
                  ) : (
                    <div className="text-[2rem] font-black text-transparent">-</div>
                  );
                })()}
              </div>

              {/* Status */}
              <div className="flex items-center justify-center" style={{ width: "360px" }}>
                {pill.hasStatusText ? (
                  <div className={`${pillCls} overflow-hidden text-[1.6rem]`}>
                    {pill.showLEDs && (
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <LEDIndicator color={pill.led1} phase="a" size="w-3.5 h-3.5" />
                        <LEDIndicator color={pill.led2} phase="b" size="w-3.5 h-3.5" />
                      </div>
                    )}
                    <span className="truncate whitespace-nowrap font-extrabold tracking-wide">{pill.displayText}</span>
                  </div>
                ) : (
                  <div className="text-[1.4rem] font-bold text-slate-300">Scheduled</div>
                )}
              </div>
            </>
          )}
        </div>
      );
    }

    // ── MOBILE (ispod sm) ──
    return (
      <div className={`flex flex-col gap-2 px-3 py-2.5 border-b border-white/10 ${rowBg}`}
        style={{ contain: "layout style" }}
      >
        <div className="flex items-center gap-2.5">
          <div className="relative w-10 h-7 bg-white rounded-lg p-0.5 shadow-md flex-shrink-0">
            <img
              src={getInitialAirlineLogoSrc(icao, PLACEHOLDER_IMAGE)}
              alt={`${flight.AirlineName} logo`}
              className="object-contain w-full h-full"
              onError={onImgErr}
              data-tried={isKnownLocalLogo(icao) ? 'local' : 'fw'}
              decoding="async"
            />
          </div>
          <span className="text-base font-black text-white tracking-wide">{flight.FlightNumber}</span>
          {flight.CodeShareFlights && flight.CodeShareFlights.length > 0 && (
            <span className="text-xs text-white/40 font-bold">+{flight.CodeShareFlights.length}</span>
          )}
          <div className="ml-auto flex items-center gap-1.5">
            <span className="text-lg font-black text-white tabular-nums">
              {formatTimeString(flight.ScheduledDepartureTime) || "--:--"}
            </span>
            {estimatedDisplay && (
              <><span className="text-white/30 text-xs">›</span>
                <span className={`text-lg font-black ${colorTitle} tabular-nums`}>{estimatedDisplay}</span></>
            )}
          </div>
        </div>
        <div className="flex items-center justify-between">
          <div className="text-[1.25rem] font-black text-white truncate leading-tight">
            {flight.DestinationCityName || flight.DestinationAirportName}
          </div>
          {weather && !weather.loading && !weather.error && (
            <div className="flex-shrink-0 ml-2">
              <WeatherIcon code={weather.weatherCode} temperature={weather.temperature} size={16} textSize={13} />
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {!showArrivals && flight.CheckInDesk && flight.CheckInDesk !== "-" && (
            <span className="inline-flex items-center gap-1 text-xs font-bold text-white bg-black/40 px-2 py-1 rounded-lg border border-white/20">
              <Users className="w-3 h-3 opacity-70" />{flight.CheckInDesk}
            </span>
          )}
          {!showArrivals && flight.GateNumber && flight.GateNumber !== "-" && (
            <span className={`inline-flex items-center gap-1 text-xs font-bold px-2 py-1 rounded-lg border ${isGateChanged ? "text-red-400 bg-red-500/20 border-red-400 animate-pill-blink-fast" : "text-white bg-black/40 border-white/20"}`}>
              <DoorOpen className="w-3 h-3 opacity-70" />{flight.GateNumber}
            </span>
          )}

          {!showArrivals && (() => {
            const badge = getFlightTerminalBadge(flight);
            return badge ? (
              <span className={`inline-flex items-center gap-1 text-xs font-bold px-2 py-1 rounded-full ${badge.bg} ${badge.text}`}>
                <Building2 className="w-3 h-3 opacity-70" />{badge.label}
              </span>
            ) : null;
          })()}

          {pill.hasStatusText ? (
            <div className={mobilePillCls}>
              {pill.showLEDs && (<><LEDIndicator color={pill.led1} phase="a" size="w-2 h-2" /><LEDIndicator color={pill.led2} phase="b" size="w-2 h-2" /></>)}
              <span className="truncate max-w-[200px]">{pill.displayText}</span>
            </div>
          ) : (
            <span className="text-xs text-white/40 font-semibold">Scheduled</span>
          )}
        </div>
      </div>
    );
  },
(prev, next) =>
    prev.isDesktopLayout               === next.isDesktopLayout               &&
    prev.autoStatusTick                === next.autoStatusTick                &&
    prev.flight.FlightNumber           === next.flight.FlightNumber           &&
    prev.flight.StatusEN               === next.flight.StatusEN               &&
    (prev.flight as any)._gateChangedAt === (next.flight as any)._gateChangedAt &&
    prev.flight.EstimatedDepartureTime === next.flight.EstimatedDepartureTime &&
    prev.flight.ScheduledDepartureTime === next.flight.ScheduledDepartureTime &&
    prev.flight.GateNumber             === next.flight.GateNumber             &&
    prev.flight.CheckInDesk            === next.flight.CheckInDesk            &&
    prev.showArrivals                  === next.showArrivals                  &&
    prev.colorTitle                    === next.colorTitle                    &&
    prev.index                         === next.index
)

// ============================================================
// GLAVNA KOMPONENTA
// ============================================================
function FlightBoard(): JSX.Element {
  const [state, dispatch] = useReducer(flightReducer, {
    arrivals: [],
    departures: [],
    loading: true,
    errorMessage: null,
    lastUpdate: "",
  });

  const [nightMode, setNightMode] = useState(false)
  const [langIdx, setLangIdx] = useState(0)
  const [showArrivals, setShowArrivals] = useState(true)
  const [autoStatusTick, setAutoStatusTick] = useState(0)
  const [reducedAnimations, setReducedAnimations] = useState(IS_LOW_END)
  const [isDesktopLayout, setIsDesktopLayout] = useState(true)

  const isMountedRef = useRef(true)
  const prevGatesRef = useRef<Record<string, string>>({})
  const isInitialLoad = useRef(true)
  const lastHeartbeat = useRef(Date.now())
  const lastKnownHashRef = useRef<string | null>(null)
  const isFetchingRef = useRef(false)
  const arrivalsRef = useRef<Flight[]>([])
  const departuresRef = useRef<Flight[]>([])
  const nightModeRef = useRef(false)
  const etagStatusRef = useRef<string | null>(null)
  const batchTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const pendingBatchRef = useRef<Partial<FlightState> | null>(null)

  // ── Weather za Tivat (header) koristeći useWeather hook ──
  const tivatWeather = useWeather({
    cityName: 'Tivat',
    airportCode: 'TIV',
    airportName: 'Tivat Airport'
  }, 0);

  useEffect(() => { arrivalsRef.current = state.arrivals }, [state.arrivals])
  useEffect(() => { departuresRef.current = state.departures }, [state.departures])
  useEffect(() => { nightModeRef.current = nightMode }, [nightMode])

  const colors = useMemo(() => showArrivals ? COLOR_CONFIG.arrivals : COLOR_CONFIG.departures, [showArrivals])

  // ── Throttled resize ──
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mql = window.matchMedia('(min-width: 640px)');
    let timeoutId: NodeJS.Timeout;
    
    setIsDesktopLayout(mql.matches);
    const handler = (e: MediaQueryListEvent) => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        setIsDesktopLayout(e.matches);
      }, 100);
    };
    
    if (mql.addEventListener) {
      mql.addEventListener('change', handler);
      return () => mql.removeEventListener('change', handler);
    } else {
      (mql as any).addListener(handler);
      return () => (mql as any).removeListener(handler);
    }
  }, []);

  // ── Batch state updates ──
  const batchUpdate = useCallback((updates: Partial<FlightState>) => {
    if (batchTimeoutRef.current) {
      clearTimeout(batchTimeoutRef.current);
    }
    pendingBatchRef.current = { ...pendingBatchRef.current, ...updates };
    batchTimeoutRef.current = setTimeout(() => {
      if (pendingBatchRef.current) {
        dispatch({ type: 'BATCH_UPDATE', payload: pendingBatchRef.current });
        pendingBatchRef.current = null;
      }
      batchTimeoutRef.current = null;
    }, BATCH_UPDATE_INTERVAL);
  }, []);

  // ── Hard reset u 03:00 ──
  useEffect(() => {
    const now = new Date()
    const reset = new Date()
    reset.setHours(HARD_RESET_HOUR, 0, 0, 0)
    if (reset <= now) reset.setDate(reset.getDate() + 1)
    const ms = reset.getTime() - now.getTime()
    const id = setTimeout(() => window.location.reload(), ms)
    return () => clearTimeout(id)
  }, [])

  // ── Periodični "meki" reload ──
  useEffect(() => {
    const id = setInterval(() => window.location.reload(), SOFT_RELOAD_INTERVAL_MS)
    return () => clearInterval(id)
  }, [])

  // ── Kiosk: prevent context menu ──
  useEffect(() => {
    const p = (e: Event) => e.preventDefault()
    document.addEventListener("contextmenu", p)
    document.addEventListener("selectstart", p)
    document.addEventListener("dragstart", p)
    return () => {
      document.removeEventListener("contextmenu", p)
      document.removeEventListener("selectstart", p)
      document.removeEventListener("dragstart", p)
    }
  }, [])

  // ── autoStatusTick ──
  useEffect(() => {
    const id = setInterval(() => setAutoStatusTick(t => t + 1), 60_000)
    return () => clearInterval(id)
  }, [])

  // ── Language rotation ──
  useEffect(() => {
    const id = setInterval(() => setLangIdx(i => (i + 1) % LANGUAGE_KEYS.length), 4_000)
    return () => clearInterval(id)
  }, [])

  // ── Arrivals/Departures switch ──
  useEffect(() => {
    const id = setInterval(() => {
      setShowArrivals(p => !p)
    }, 20_000)
    return () => clearInterval(id)
  }, [])

  // ── Heartbeat ──
  useEffect(() => {
    const id = setInterval(() => {
      if (Date.now() - lastHeartbeat.current > HEARTBEAT_TIMEOUT_MS) window.location.reload()
      else lastHeartbeat.current = Date.now()
    }, HEARTBEAT_CHECK_INTERVAL_MS)
    return () => clearInterval(id)
  }, [])

  // ── Memory cleanup ──
  useEffect(() => {
    const id = setInterval(() => {
      const gateKeys = Object.keys(prevGatesRef.current);
      if (gateKeys.length > MAX_PREV_GATES) {
        const toRemove = gateKeys.slice(0, gateKeys.length - MAX_PREV_GATES);
        for (const key of toRemove) {
          delete prevGatesRef.current[key];
        }
      }
    }, MEMORY_CLEANUP_INTERVAL_MS)
    return () => clearInterval(id)
  }, [])

  // ── Memory pressure detekcija ──
  useEffect(() => {
    if (IS_LOW_END) return;
    const checkMemory = () => {
      const perf = (performance as any);
      if (perf?.memory) {
        const used = perf.memory.usedJSHeapSize;
        const total = perf.memory.totalJSHeapSize;
        if (total > 0 && used / total > MEMORY_PRESSURE_THRESHOLD) {
          setReducedAnimations(true);
        }
      }
    };
    const id = setInterval(checkMemory, 60_000);
    return () => clearInterval(id);
  }, []);

  // ── Global error handler ──
  useEffect(() => {
    const onErr = (e: ErrorEvent) => {
      const m = e.error?.message || ""
      if (m.includes("Out of memory") || m.includes("stack overflow") || m.includes("heap")) {
        setTimeout(() => window.location.reload(), 2_000)
      }
    }
    window.addEventListener("error", onErr)
    return () => window.removeEventListener("error", onErr)
  }, [])

  // ── FIX (24/7 rad bez nadzora): handler za neuhvaćene odbijene
  // promise-e — univerzalan propust, nije postojao NA NIJEDNOJ kiosk
  // stranici prije analize. fetch() pozivi bez .catch(), ili async
  // funkcije čija greška ne stigne do try/catch, završavaju ovdje. Bez
  // ovog handlera Chrome samo ispiše upozorenje u konzoli i ništa više
  // se ne dešava — barem sad postoji vidljiv trag za dijagnostiku. ──
  useEffect(() => {
    const onRejection = (e: PromiseRejectionEvent) => {
      console.error('[combined] Neuhvaćena odbijena promise:', e.reason?.message || e.reason)
    }
    window.addEventListener('unhandledrejection', onRejection)
    return () => window.removeEventListener('unhandledrejection', onRejection)
  }, [])

  // ── Filter helpers ──
  const filterRecentFlights = useCallback((flights: Flight[], isArrivals: boolean): Flight[] => {
    const now = new Date()
    const hiddenSet = new Set(HIDDEN_FLIGHT_PATTERNS);
    
    return flights.filter(f => {
      const fn = (f.FlightNumber || "").toUpperCase()
      if (hiddenSet.has(fn)) return false
      if (HIDDEN_FLIGHT_PATTERNS.some(p => fn.includes(p))) return false
      
      const status = (f.StatusEN ?? "").toLowerCase()
      const arrived = /(arrived|landed|sletio|sletjelo|dolazak|stigao)/i.test(status)
      const departed = !/(delay|kasni)/i.test(status) &&
        (status.includes("departed") || status.includes("poletio") || status.includes("take off"))
      
      if (!arrived && !departed) return true
      const timeStr = f.EstimatedDepartureTime || f.ScheduledDepartureTime || f.ActualDepartureTime
      if (!timeStr) return false
      const ft = parseFlightTimeToDate(timeStr)
      if (!ft) return false
      const diff = Math.floor((now.getTime() - ft.getTime()) / 60_000)
      if (isArrivals && arrived) return diff <= 25
      if (!isArrivals && departed) return diff <= 15
      return true
    })
  }, [])

  // ── OPTIMIZOVANA prepareData ──
  const prepareData = useCallback((
    data: FlightDataResponse,
    assignments?: { desks: Record<string, string>; gates: Record<string, string> }
  ) => {
    const filteredArrivals = filterRecentFlights(data.arrivals, true)
    const rawDep = getUniqueDeparturesWithDeparted(filterRecentFlights(data.departures, false))

    const departuresWithMeta = rawDep.map(f => {
      const num = f.FlightNumber ?? ""
      const adminDesk = assignments?.desks?.[num]
      const adminGate = assignments?.gates?.[num]
      const effectiveGate = adminGate || f.GateNumber || ""

      if (!adminDesk && (!effectiveGate || effectiveGate === "-" || effectiveGate === f.GateNumber)) {
        return f;
      }

      const clone = { ...f }
      if (adminDesk) {
        (clone as any).CheckInDesk = adminDesk
      }
      if (effectiveGate && effectiveGate !== "-") {
        if (prevGatesRef.current[num] && prevGatesRef.current[num] !== effectiveGate) {
          (clone as any)._gateChangedAt = Date.now()
        }
        clone.GateNumber = effectiveGate
        prevGatesRef.current[num] = effectiveGate
      }
      return clone
    })

    return { filteredArrivals, departuresWithMeta }
  }, [filterRecentFlights])

  // ── Inicijalni keš load ──
  useEffect(() => {
    const cached = loadFromCache()
    if (!cached) return
    const { filteredArrivals, departuresWithMeta } = prepareData(cached.data)
    dispatch({
      type: 'UPDATE_FLIGHTS',
      payload: {
        arrivals: filteredArrivals,
        departures: departuresWithMeta,
        lastUpdate: cached.data.lastUpdated || new Date().toLocaleTimeString("en-GB")
      }
    })
  }, [prepareData])

  // ── Polling ──
  useEffect(() => {
    isMountedRef.current = true
    let tid: ReturnType<typeof setTimeout>
    const controller = new AbortController()
 
  const load = async () => {
  if (!isMountedRef.current) return
  if (isFetchingRef.current) return
  isFetchingRef.current = true

  const wasNightMode = nightModeRef.current

  if (isNightHours()) {
    if (isMountedRef.current) setNightMode(true)
    batchUpdate({ loading: false })
    isFetchingRef.current = false
    tid = setTimeout(load, BASE_INTERVAL_MS)
    return
  }
  if (isMountedRef.current) setNightMode(false)

  const justExitedNightMode = wasNightMode
  let nextInterval: number = BASE_INTERVAL_MS

  try {
    if (isInitialLoad.current && arrivalsRef.current.length === 0 && departuresRef.current.length === 0) {
      batchUpdate({ loading: true })
    }
    
    // ── ISPRAVLJENA Stale-while-revalidate ──
    // UVIJEK pozivamo fetch, ali koristimo cache kao fallback
    const cached = loadFromCache()
    
    // Ako imamo cache, prikaži ga odmah (smanjuje loading state)
    if (cached && isMountedRef.current) {
      const { filteredArrivals, departuresWithMeta } = prepareData(cached.data)
      // Samo ako je arrivals/departures prazno (prvi load), prikaži cache
      if (arrivalsRef.current.length === 0 && departuresRef.current.length === 0) {
        dispatch({
          type: 'UPDATE_FLIGHTS',
          payload: {
            arrivals: filteredArrivals,
            departures: departuresWithMeta,
            lastUpdate: cached.data.lastUpdated || new Date().toLocaleTimeString("en-GB")
          }
        })
      }
    }

    const boardIsCurrentlyEmpty = arrivalsRef.current.length === 0 && departuresRef.current.length === 0
    const forceRefresh = boardIsCurrentlyEmpty || justExitedNightMode

    const headers: HeadersInit = {}
    if (!forceRefresh && etagStatusRef.current) {
      headers['If-None-Match'] = etagStatusRef.current
    }

    let res: Response
    try {
      res = await fetchWithTimeout('/api/flights', FETCH_TIMEOUT_MS, headers, controller.signal)
    } catch (fe) {
      if (controller.signal.aborted) {
        return
      }

      // Ako fetch padne, koristi cache
      const cachedData = loadFromCache()
      if (cachedData) {
        const { filteredArrivals, departuresWithMeta } = prepareData(cachedData.data)
        dispatch({
          type: 'UPDATE_FLIGHTS',
          payload: {
            arrivals: filteredArrivals,
            departures: departuresWithMeta,
            lastUpdate: cachedData.data.lastUpdated || new Date().toLocaleTimeString("en-GB")
          }
        })
        nextInterval = getAdaptiveInterval(filteredArrivals, departuresWithMeta)
      } else {
        const emergencyCached = loadEmergencyCache()
        if (emergencyCached) {
          const { filteredArrivals, departuresWithMeta } = prepareData(emergencyCached)
          dispatch({
            type: 'UPDATE_FLIGHTS',
            payload: {
              arrivals: filteredArrivals,
              departures: departuresWithMeta,
              lastUpdate: emergencyCached.lastUpdated || new Date().toLocaleTimeString("en-GB")
            }
          })
          nextInterval = getAdaptiveInterval(filteredArrivals, departuresWithMeta)
        } else {
          batchUpdate({ errorMessage: "Unable to load flight data" })
          nextInterval = BASE_INTERVAL_MS
        }
      }
      setTimeout(() => { if (isMountedRef.current) batchUpdate({ errorMessage: null }) }, 5_000)
      return
    }

    if (res.status === 304) {
      batchUpdate({ lastUpdate: new Date().toLocaleTimeString("en-GB") })
      nextInterval = getAdaptiveInterval(arrivalsRef.current, departuresRef.current)
      return
    }

    if (!res.ok) throw new Error(`HTTP ${res.status}`)

    const newEtag = res.headers.get('ETag')
    if (newEtag) etagStatusRef.current = newEtag

    const data: FlightDataResponse = await res.json()

    if (isMountedRef.current) {
      saveToCache(data)
      saveEmergencyCache(data)
    }

    if (!isMountedRef.current) return

    const gatesByFlight: Record<string, string> = {}
    for (const [gateNum, entry] of Object.entries(data.gateEntries ?? {})) {
      if (entry?.status === 'open' && entry.flightNumber) {
        const fn = entry.flightNumber
        gatesByFlight[fn] = gatesByFlight[fn] ? `${gatesByFlight[fn]}, ${gateNum}` : gateNum
      }
    }
    const assignments = { desks: data.desks ?? {}, gates: gatesByFlight }
    if (isMountedRef.current) setNightMode(!!data.isNightMode)

    const incomingTotal = (data.departures?.length || 0) + (data.arrivals?.length || 0)
    const currentlyHasData = arrivalsRef.current.length > 0 || departuresRef.current.length > 0

    if (incomingTotal === 0 && currentlyHasData) {
      batchUpdate({ lastUpdate: new Date().toLocaleTimeString("en-GB") })
      nextInterval = getAdaptiveInterval(arrivalsRef.current, departuresRef.current)
    } else {
      const { filteredArrivals, departuresWithMeta } = prepareData(data, assignments)
      dispatch({
        type: 'UPDATE_FLIGHTS',
        payload: {
          arrivals: filteredArrivals,
          departures: departuresWithMeta,
          lastUpdate: new Date().toLocaleTimeString("en-GB")
        }
      })
      nextInterval = getAdaptiveInterval(filteredArrivals, departuresWithMeta)
    }
  } catch (e) {
    console.error("Critical:", e)
    nextInterval = BASE_INTERVAL_MS
  } finally {
    isInitialLoad.current = false
    isFetchingRef.current = false
    if (isMountedRef.current && !controller.signal.aborted) {
      batchUpdate({ loading: false })
      tid = setTimeout(load, nextInterval)
    }
  }
}
 
    load()
    return () => {
      isMountedRef.current = false
      clearTimeout(tid)
      controller.abort()
      isFetchingRef.current = false
      if (batchTimeoutRef.current) {
        clearTimeout(batchTimeoutRef.current)
        batchTimeoutRef.current = null
      }
    }
  }, [prepareData, batchUpdate])

  const handleClose = useCallback(() => {
    if ((window as any).electronAPI?.quitApp) { (window as any).electronAPI.quitApp(); return }
    try { if ((window as any).chrome?.webview) { (window as any).chrome.webview.postMessage("APP_QUIT"); return } } catch {}
    window.postMessage({ type: "ELECTRON_APP_QUIT" }, "*")
    try { if (window.parent !== window) window.parent.postMessage({ type: "ELECTRON_APP_QUIT" }, "*") } catch {}
    window.location.reload()
  }, [])

  const lang = LANGUAGE_CONFIG[LANGUAGE_KEYS[langIdx]]
  const title = showArrivals ? lang.arrivals : lang.departures
  const subtitle = showArrivals ? lang.incomingFlights : lang.outgoingFlights

  const ArrivalIcon = useCallback(({ className = "w-5 h-5" }: { className?: string }) =>
    <Plane className={`${className} text-orange-500 rotate-90`} />, [])
  const DepartureIcon = useCallback(({ className = "w-5 h-5" }: { className?: string }) =>
    <Plane className={`${className} text-orange-500`} />, [])

  const tableHeaders = useMemo(() => {
    const t = lang.tableHeaders
    if (showArrivals) return [
      { label: t.scheduled, width: "150px", icon: Clock },
      { label: t.estimated, width: "150px", icon: Clock },
      { label: t.flight, width: "240px", icon: ArrivalIcon },
      { label: t.from, width: "450px", icon: MapPin },
      { label: "Weather", width: "200px", icon: () => <span className="text-lg">🌡️</span> },
      { label: t.status, width: "580px", icon: Info },
    ]
    return [
      { label: t.scheduled, width: "150px", icon: Clock },
      { label: t.estimated, width: "150px", icon: Clock },
      { label: t.flight, width: "240px", icon: DepartureIcon },
      { label: t.destination, width: "320px", icon: MapPin },
      { label: "Weather", width: "200px", icon: () => <span className="text-lg">🌡️</span> },
      { label: t.checkIn, width: "280px", icon: Users },
      { label: t.gate, width: "150px", icon: DoorOpen },
      { label: "Terminal", width: "120px", icon: Building2 },
      { label: t.status, width: "360px", icon: Info },
    ]
  }, [showArrivals, lang, ArrivalIcon, DepartureIcon])

  const getTimeOfDayMinutes = useCallback((t: string | null | undefined): number => {
    if (!t) return Infinity
    const s = t.trim()
    if (!s || s === "-" || s === "--:--") return Infinity
    if (s.includes("T")) {
      const d = new Date(s)
      if (!isNaN(d.getTime())) return d.getHours() * 60 + d.getMinutes()
    }
    const m = s.match(/^(\d{1,2})[:.](\d{2})$/)
    if (m) {
      const h = parseInt(m[1], 10), min = parseInt(m[2], 10)
      if (h > 23 || min > 59) return Infinity
      return h * 60 + min
    }
    const dg = s.replace(/\D/g, "")
    if (dg.length === 4) {
      const h = parseInt(dg.slice(0, 2), 10), min = parseInt(dg.slice(2), 10)
      if (h > 23 || min > 59) return Infinity
      return h * 60 + min
    }
    return Infinity
  }, [])

  const allSortedFlights = useMemo(() => {
    const base = showArrivals ? state.arrivals : state.departures
    const now = new Date()
    const nowMinutes = now.getHours() * 60 + now.getMinutes()

    return base.slice().sort((a, b) => {
      const aTime = getTimeOfDayMinutes(a.EstimatedDepartureTime || a.ScheduledDepartureTime)
      const bTime = getTimeOfDayMinutes(b.EstimatedDepartureTime || b.ScheduledDepartureTime)
      const aDiff = aTime === Infinity ? Infinity : aTime - nowMinutes
      const bDiff = bTime === Infinity ? Infinity : bTime - nowMinutes
      return aDiff - bDiff
    })
  }, [showArrivals, state.arrivals, state.departures, getTimeOfDayMinutes])

  const sortedFlights = useMemo(
    () => allSortedFlights.slice(0, MAX_FLIGHTS_DISPLAY),
    [allSortedFlights]
  )

  // ── NOĆNI PRIKAZ ──
  if (nightMode) {
    return (
      <div
        className="h-screen bg-black select-none"
        onDragOver={e => e.preventDefault()}
        onDrop={e => e.preventDefault()}
      >
        <NightClock />
      </div>
    )
  }

  return (
    <div
      className={`h-screen ${colors.background} text-white p-2 sm:p-4 transition-colors duration-700 flex flex-col select-none`}
      onDragOver={e => e.preventDefault()}
      onDrop={e => e.preventDefault()}
    >
      {state.errorMessage && (
        <div className="fixed bottom-4 left-4 right-4 md:left-auto md:right-4 bg-red-500/90 text-white px-4 py-3 rounded-lg text-sm z-50 shadow-lg animate-pulse">
          ⚠️ {state.errorMessage}
        </div>
      )}

      <button
        onClick={handleClose}
        className="absolute top-3 right-3 sm:top-6 sm:right-6 w-8 h-8 sm:w-10 sm:h-10 flex items-center justify-center rounded-full bg-black/40 hover:bg-black/60 active:bg-black/80 text-white shadow-2xl cursor-pointer z-50 transition-all duration-200 hover:scale-110 active:scale-95 border-2 border-white/20"
        type="button"
        title="Close App"
      >
        <span className="text-xl sm:text-2xl font-bold leading-none pointer-events-none">×</span>
      </button>

      {/* Header */}
      <div className="w-full mx-auto mb-2 sm:mb-4 flex-shrink-0">
        <div className="flex justify-between items-center gap-2 sm:gap-4">
          <div className="flex items-center gap-3 sm:gap-6 min-w-0">
            <div className="p-2 sm:p-4 bg-transparent rounded-xl sm:rounded-2xl shadow-2xl border-2 border-orange-500 flex-shrink-0">
              {showArrivals
                ? <Plane className="w-8 h-8 sm:w-16 sm:h-16 text-orange-500 rotate-90" />
                : <Plane className="w-8 h-8 sm:w-16 sm:h-16 text-orange-500" />}
            </div>
            <div className="min-w-0">
              <h1 className={`text-[2.5rem] sm:text-[6rem] font-black ${colors.title} leading-none tracking-tight drop-shadow-2xl truncate`}>
                {title}
              </h1>
              <p className={`${colors.subtitle} text-sm sm:text-2xl mt-0.5 sm:mt-2 font-semibold truncate flex items-center gap-2`}>
                {subtitle}
                {tivatWeather && !tivatWeather.loading && !tivatWeather.error && (
                  <span className="text-white/80 text-base sm:text-xl font-medium flex items-center gap-1">
                    <span>Weather at TIV:</span>
                    <WeatherIcon code={tivatWeather.weatherCode} temperature={tivatWeather.temperature} size={18} textSize={15} />
                  </span>
                )}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 sm:gap-4 flex-shrink-0">
            <ClockDisplay colorClass="text-white" />
            <div className={`w-3 h-3 sm:w-6 sm:h-6 rounded-full ${colors.accent} animate-pulse shadow-2xl flex-shrink-0`} />
          </div>
        </div>
      </div>

      {/* Tablica */}
      <div className="w-full mx-auto flex-1 min-h-0">
        {state.loading && state.arrivals.length === 0 && state.departures.length === 0 ? (
          <div className="text-center p-8 h-full flex items-center justify-center">
            <div className="inline-flex items-center gap-4">
              <div className={`w-8 h-8 border-4 ${colors.border} border-t-transparent rounded-full animate-spin`} />
              <span className="text-xl sm:text-2xl text-white font-semibold">Awaiting flight data...</span>
            </div>
          </div>
        ) : (
          <div className={`${colors.cardBg} rounded-2xl sm:rounded-3xl border-2 sm:border-4 border-white/20 shadow-2xl overflow-hidden h-full flex flex-col`}>
            {isDesktopLayout && <TableHeaders headers={tableHeaders} headerBg={colors.header} />}
            <div className="flex-1 overflow-y-auto">
              {sortedFlights.length === 0 ? (
                <div className="p-8 text-center text-white/60 h-full flex flex-col items-center justify-center">
                  <Plane className="w-12 h-12 sm:w-16 sm:h-16 mx-auto mb-4 opacity-50" />
                  <div className="text-xl sm:text-2xl font-semibold">No {title.toLowerCase()} scheduled</div>
                </div>
              ) : (
                sortedFlights.map((flight, index) => (
                  <FlightRow
                    key={`${flight.FlightNumber}-${flight.ScheduledDepartureTime}`}
                    flight={flight}
                    index={index}
                    showArrivals={showArrivals}
                    colorTitle={colors.title}
                    autoStatusTick={autoStatusTick}
                    isDesktopLayout={isDesktopLayout}
                  />
                ))
              )}
            </div>
          </div>
        )}
      </div>

      {/* Ticker */}
      <div className="w-full mx-auto mt-2 sm:mt-4 flex-shrink-0 overflow-hidden bg-black/30 rounded-full border-2 border-white/10 h-8 sm:h-10 relative">
        <div className="ticker-wrap">
          <div className={`ticker-move ${colors.title} font-bold text-sm sm:text-xl flex items-center h-full`}>
            {SECURITY_MESSAGES.map((msg, i) => <span key={i} className="mx-6 sm:mx-8 whitespace-nowrap">{msg}</span>)}
            {SECURITY_MESSAGES.map((msg, i) => <span key={`d-${i}`} className="mx-6 sm:mx-8 whitespace-nowrap">{msg}</span>)}
          </div>
        </div>
      </div>

      <style jsx global>{`
        #__next,body,html{height:100vh}*{-webkit-font-smoothing:antialiased}

        @keyframes ledBlinkA{0%{opacity:.2}100%{opacity:1}}
        @keyframes ledBlinkB{0%{opacity:1}100%{opacity:.2}}
        @keyframes pill-blink{0%,50%{opacity:1}51%,100%{opacity:.75}}
        @keyframes pill-blink-fast{0%,40%{opacity:1}41%,100%{opacity:.55}}

        .animate-pill-blink{animation:.8s ease-in-out infinite pill-blink}
        .animate-pill-blink-fast{animation:.4s ease-in-out infinite pill-blink-fast}
        .led-blink-a{animation:ledBlinkA .8s ease-in-out infinite alternate}
        .led-blink-b{animation:ledBlinkB .8s ease-in-out infinite alternate}

        .ticker-wrap{width:100%;overflow:hidden;position:absolute;top:0;left:0;height:100%}
        .ticker-move{
          display:inline-block;
          white-space:nowrap;
          backface-visibility:hidden;
          animation:ticker-scroll 45s linear infinite
        }
        @keyframes ticker-scroll{0%{transform:translate3d(0,0,0)}100%{transform:translate3d(-50%,0,0)}}

        @media(max-width:639px){.ticker-move{animation-duration:35s}}

        ${reducedAnimations ? `
          .animate-pulse{animation:none!important;opacity:1!important}
          .animate-spin{animation:none!important;opacity:1!important}
        ` : ''}

        @media(prefers-reduced-motion:reduce){
          .animate-pulse,.animate-spin{animation:none!important;opacity:1!important}
        }

        ::-webkit-scrollbar{width:6px}::-webkit-scrollbar-track{background:rgba(0,0,0,.3);border-radius:3px}
        ::-webkit-scrollbar-thumb{background:rgba(255,255,255,.4);border-radius:3px}::-webkit-scrollbar-thumb:hover{background:rgba(255,255,255,.6)}
        body,html{overflow:hidden;margin:0;padding:0}
      `}</style>
    </div>
  )
}

export default function CombinedPageClient(): JSX.Element {
  return <FlightBoardErrorBoundary><FlightBoard /></FlightBoardErrorBoundary>
}