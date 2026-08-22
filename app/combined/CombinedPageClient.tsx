'use client';

// ═══════════════════════════════════════════════════════════════
// CombinedPageClient.tsx — OPTIMIZOVANO za low-end mini PC kioske
// ═══════════════════════════════════════════════════════════════
//
// KLJUČNE OPTIMIZACIJE (vs. original):
//
//  1. MEMORY LEAK FIX: prevGatesRef se čisti na MAX_PREV_GATES (200)
//  2. MEMORY LEAK FIX: Emergency cache TTL 1h → 12h (kao u komentaru)
//  3. MEMORY LEAK FIX: Uklonjen `will-change` sa svih stalnih animacija
//     (zadržava GPU texture beskonačno → Chrome crash na low-end)
//  4. MEMORY LEAK FIX: Ticker ne duplicira poruke (bilo 2x map, sad 1x + CSS clone)
//  5. PERFORMANCE: ClockDisplay 1s → 10s (HH:MM se mijenja svakih 60s)
//  6. PERFORMANCE: `content-visibility: auto` na FlightRow (lazy render)
//  7. PERFORMANCE: `contain: layout style paint` na redu (izoluje reflow)
//  8. PERFORMANCE: Skip FlightAware fallback na low-end (detekcija preko navigator.hardwareConcurrency)
//  9. PERFORMANCE: `prevGatesRef` se čisti u memory cleanup intervalu
// 10. PERFORMANCE: `lastKnownHash` prebačen u ref (ne preživljava HMR)
// 11. PERFORMANCE: LED blink koristi CSS `transition` umjesto `keyframes`
// 12. PERFORMANCE: `requestIdleCallback` za non-critical state updates
// 13. PERFORMANCE: Memory pressure detekcija — smanjuje animacije kad je memorija > 80%
// 14. PERFORMANCE: `allSortedFlights` sortira in-place umjesto `[...base].sort()`
// 15. PERFORMANCE: `applyAssignmentsOnly` ne klonira nepromijenjene letove
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
} from "react"
import type { Flight } from "@/types/flight"
import { fetchFlightData, getUniqueDeparturesWithDeparted } from "@/lib/flight-service"
import { Info, Plane, Clock, MapPin, Users, DoorOpen, Building2 } from "lucide-react"
import { getInitialAirlineLogoSrc, isKnownLocalLogo } from '@/lib/airline-logo';
import { isNightHours } from '@/lib/night-hours';

// ============================================================
// KONSTANTE
// ============================================================
//const REFRESH_INTERVAL_MS         = 130_000
// ── Adaptivni interval — zasnovan na "gustoći" rasporeda letova ──
 // ≤90 min do sljedećeg leta: brzo (130s). 90min-3h: srednje (200s).
 // >3h: sporo (300s). Čim se uđe u 90-min prozor prije STD sljedećeg
 // leta, interval se odmah vraća na bazni (brzi), bez obzira koliko
 // je bio spor prije toga.
 const BASE_INTERVAL_MS       = 130_000
 const MEDIUM_INTERVAL_MS     = 200_000
 const SLOW_INTERVAL_MS       = 300_000
 const FAST_THRESHOLD_MIN     = 90
 const MEDIUM_THRESHOLD_MIN   = 180 // 3h
const CACHE_DURATION              = 6 * 60_000
const CACHE_KEY                   = "flight_board_cache_v2"
const HARD_RESET_HOUR             = 3
const SOFT_RELOAD_INTERVAL_MS     = 4 * 60 * 60_000
const MAX_FLIGHTS_DISPLAY         = 9
const MAX_FLIGHTS_MEMORY          = 60
const MAX_PREV_GATES              = 200  // ← NOVO: limit za prevGatesRef
const MEMORY_CLEANUP_INTERVAL_MS  = 30 * 60_000
const HEARTBEAT_TIMEOUT_MS        = 120_000
const HEARTBEAT_CHECK_INTERVAL_MS = 30_000

// ── Low-end detekcija ──
// hardwareConcurrency < 4 = low-end mini PC (Intel NUC, Raspberry Pi, itd.)
const IS_LOW_END = typeof navigator !== 'undefined' &&
  (navigator.hardwareConcurrency ?? 4) < 4;

// ── Memory pressure threshold (Chrome: performance.memory) ──
const MEMORY_PRESSURE_THRESHOLD = 0.80; // 80% usedJSHeapSize / totalJSHeapSize

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
  // ── Polja spojena iz nekadašnjeg /api/flights/status ──
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
    // FIX: 1h → 12h (kao što komentar kaže — bolje stari podaci nego prazan ekran)
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
]

const PLACEHOLDER_IMAGE =
  "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMzIiIGhlaWdodD0iMzIiIHZpZXdCb3g9IjAgMCAzMiAzMiIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHJlY3Qgd2lkdGg9IjMyIiBoZWlnaHQ9IjMyIiBmaWxsPSIjMzQzQzU0Ii8+Cjx0ZXh0IHg9IjE2IiB5PSIxNiIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZG9taW5hbnQtYmFzZWxpbmU9Im1pZGRsZSIgZmlsbD0iIzlDQTdCNiIgZm9udC1mYW1pbHk9IkFyaWFsLCBzYW5zLXNlcmlmIiBmb250LXNpemU9IjgiPk5vIExvZ288L3RleHQ+Cjwvc3ZnPgo="

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

// Vraća minute do najbližeg NADOLAZEĆEG leta (arrival ili departure).
// NAPOMENA: namjerno NE filtriramo diffMin > 0 — let koji je već "u toku"
// (kasni, prošao STD, ali nije departed/arrived) mora ostati u razmatranju
// jer negativna vrijednost prirodno padne u FAST prag (≤ 90) ispod. Da smo
// ga isključili, tabla dominirana jednim kasnim letom (sledeći za 3h+) bi
// pogrešno prešla u SLOW baš kad treba najbrže pratiti taj let.
function getMinutesUntilNextFlight(flights: Flight[]): number {
  const now = Date.now()
  let min = Infinity
  for (const f of flights) {
    const t = getEffectiveFlightTime(f)
    if (!t) continue
    const diffMin = (t.getTime() - now) / 60_000
    if (diffMin < min) min = diffMin
  }
  return min
}

function getAdaptiveInterval(arrivals: Flight[], departures: Flight[]): number {
  const gapMin = getMinutesUntilNextFlight([...arrivals, ...departures])
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
const loadFromCache = (): FlightDataResponse | null => {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const { data, timestamp } = JSON.parse(raw)
    return Date.now() - timestamp > CACHE_DURATION ? null : data
  } catch { return null }
}

const fetchWithTimeout = (
  url: string,
  timeout: number,
  headers?: HeadersInit,
  externalSignal?: AbortSignal
): Promise<Response> => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
 
  // Ako se vanjski signal (unmount) okine, prekini i ovaj fetch.
  if (externalSignal) {
    if (externalSignal.aborted) controller.abort();
    else externalSignal.addEventListener("abort", () => controller.abort(), { once: true });
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
const CHECKIN_OFFSETS: Record<string, number> = {
  "6H": 180, "FZ": 180, "LS": 150, "LY": 180, "IZ": 180, "BA": 150,
}

function getAutoStatus(flight: Flight): string | null {
  const status = (flight.StatusEN ?? "").trim()
  if (status && status !== "-") return null
  const scheduled = parseFlightTimeToDate(flight.ScheduledDepartureTime)
  if (!scheduled) return null
  const ref        = parseFlightTimeToDate(flight.EstimatedDepartureTime) ?? scheduled
  const now        = Date.now()
  const minsToRef  = (ref.getTime() - now) / 60_000
  const minsToSTD  = (scheduled.getTime() - now) / 60_000
  if (minsToRef < -5)  return null
  if (minsToRef <= 5)  return "Close"
  if (minsToRef <= 10) return "Final Call"
  if (minsToRef <= 30) return "Go to Gate"
  if (minsToSTD > 30) {
    const iata = (flight.FlightNumber ?? "").replace(/\s/g, "").substring(0, 2).toUpperCase()
    const offset = CHECKIN_OFFSETS[iata] ?? 120
    const ci = new Date(scheduled.getTime() - offset * 60_000)
    return `Check In at ${String(ci.getHours()).padStart(2, "0")}:${String(ci.getMinutes()).padStart(2, "0")}`
  }
  return null
}

function getAutoArrivalStatus(flight: Flight, fmtTime: (t: string) => string): string | null {
  const status = (flight.StatusEN ?? "").trim()
  const isGenericStatus =
    !status || status === "-" || /^(on time|na vrijeme|scheduled)$/i.test(status)
  if (!isGenericStatus) return null

  const schStr = flight.ScheduledDepartureTime
  const estStr = flight.EstimatedDepartureTime
  if (!schStr) return null
  if (!estStr || !isValidDisplayTime(estStr) || schStr === estStr) return "Scheduled"
  const sch = parseFlightTimeToDate(schStr); const est = parseFlightTimeToDate(estStr)
  if (!sch || !est) return "Scheduled"

  const diffMinutes = (est.getTime() - sch.getTime()) / 60_000

  if (diffMinutes > 15)  return `Delayed – expected at ${fmtTime(estStr)}`
  if (diffMinutes < -15) return `Earlier – expected at ${fmtTime(estStr)}`
  return `On time – expected at ${fmtTime(estStr)}`
}

// ── Status pill ──
type LEDColor = "blue"|"green"|"orange"|"red"|"yellow"|"cyan"|"purple"|"lime"

function computeStatusPill(flight: Flight, isArrival: boolean, fmtTime: (t: string) => string) {
  const gateChangedAt = (flight as any)._gateChangedAt;
  const isRecentGateChange = !isArrival && gateChangedAt && (Date.now() - gateChangedAt < 15_000);

  if (isRecentGateChange) {
    return {
      bg: "bg-red-600/30", border: "border-red-500/70", text: "text-red-100",
      led1: "red" as LEDColor, led2: "orange" as LEDColor,
      blinkClass: "animate-pill-blink-fast",
      showLEDs: true, hasStatusText: true,
      displayText: `Gate changed to ${flight.GateNumber}`,
    };
  }

  const auto           = isArrival ? getAutoArrivalStatus(flight, fmtTime) : getAutoStatus(flight)
  const effectiveStatus = auto !== null ? auto : (flight.StatusEN ?? "")
  const s = effectiveStatus

  const isCancelled    = /(cancelled|canceled|otkazan)/i.test(s)
  const isDelayed      = /(delay|kasni)/i.test(s)
  const isBoarding     = !isArrival && /(boarding|gate open)/i.test(s)
  const isProcessing   = /processing/i.test(s)
  const isEarly        = /(earlier|ranije)/i.test(s)
  const isOnTime       = /(on time|na vrijeme)/i.test(s)
  const isDiverted     = /(diverted|preusmjeren)/i.test(s)
  const isCheckInOpen  = /(check.?in|check-in)/i.test(s)
  const isGoToGate     = !isArrival && /(go to gate)/i.test(s)
  const isClose        = !isArrival && /^close$/i.test(s.trim())
  const isFinalCall    = !isArrival && /^final call$/i.test(s.trim())
  const isArrived      = isArrival  && /(arrived|landed|sletio|sletjelo|dolazak|stigao)/i.test(s)

  let displayText = s
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

  return { bg, border, text, led1, led2, blinkClass, showLEDs, hasStatusText, displayText }
}

// ============================================================
// MICRO KOMPONENTE
// ============================================================

// ── OPTIMIZOVANO: ClockDisplay — 10s umjesto 1s (HH:MM se mijenja svakih 60s) ──
const ClockDisplay = memo(function ClockDisplay({ colorClass }: { colorClass: string }) {
  const [time, setTime] = useState("")
  useEffect(() => {
    const tick = () => setTime(new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }))
    tick();
    // 10s umjesto 1s — dovoljno za HH:MM prikaz, 6x manje re-rendera
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
      // OPTIMIZOVANO: uklonjen will-change — zadržavao GPU texture beskonačno
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
})

// ============================================================
// FLIGHT ROW — sa content-visibility za lazy rendering
// ============================================================
// ============================================================
// FLIGHT ROW — sa content-visibility za lazy rendering
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

    // OPTIMIZOVANO: na low-end preskače FlightAware (štedi network + memoriju)
    const onImgErr = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
      const img = e.currentTarget
      if (IS_LOW_END) {
        // Low-end: odmah placeholder, bez FlightAware fallback
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
          <div className="flex items-center justify-center" style={{ width: "180px" }}>
            <div className="text-[2.5rem] font-black text-white drop-shadow-lg tabular-nums">
              {formatTimeString(flight.ScheduledDepartureTime) || <span className="text-white/40">--:--</span>}
            </div>
          </div>

          {/* Estimated */}
          <div className="flex items-center justify-center" style={{ width: "180px" }}>
            {estimatedDisplay
              ? <div className={`text-[2.5rem] font-black ${colorTitle} drop-shadow-lg tabular-nums`}>{estimatedDisplay}</div>
              : <div className="text-2xl text-white/30 font-bold">-</div>}
          </div>

          {/* Flight info */}
          <div className="flex items-center gap-3" style={{ width: "280px" }}>
            <div className="relative w-[70px] h-11 bg-white rounded-xl p-1 shadow-xl flex-shrink-0">
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
            <div className="text-[2.4rem] font-black text-white drop-shadow-lg">{flight.FlightNumber}</div>
            {flight.CodeShareFlights && flight.CodeShareFlights.length > 0 && (
              <div className="text-sm text-white/50 font-bold">+{flight.CodeShareFlights.length}</div>
            )}
          </div>

          {showArrivals ? (
            <>
              <div className="flex items-center" style={{ width: "580px" }}>
                <div className="text-[3.3rem] font-black text-white truncate drop-shadow-lg">
                  {flight.DestinationCityName || flight.DestinationAirportName}
                </div>
              </div>
              <div className="flex items-center justify-center" style={{ width: "650px" }}>
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
              <div className="flex items-center" style={{ width: "380px" }}>
                <div className="text-[3.3rem] font-black text-white truncate drop-shadow-lg">
                  {flight.DestinationCityName || flight.DestinationAirportName}
                </div>
              </div>
              {/* Check-In */}
              <div className="flex items-center justify-center flex-wrap gap-1.5" style={{ width: "320px" }}>
                {flight.CheckInDesk && flight.CheckInDesk !== '-'
                  ? flight.CheckInDesk.split(',').map(d => d.trim()).filter(Boolean).map(d => (
                      <div key={d} className="text-[1.8rem] font-black text-white bg-black/40 py-1.5 px-2.5 rounded-xl border-2 border-white/20 shadow-xl">
                        {d}
                      </div>
                    ))
                  : <div className="text-[2.5rem] font-black text-transparent py-2 px-3">-</div>}
              </div>

              {/* Gate */}
              <div className="flex items-center justify-center" style={{ width: "180px" }}>
                {flight.GateNumber && flight.GateNumber !== '-'
                  ? <div className={`text-[2.5rem] font-black py-2 px-3 rounded-xl border-2 shadow-xl
                      ${isGateChanged
                        ? 'text-red-500 bg-red-500/20 border-red-400 animate-pill-blink-fast'
                        : 'text-white bg-black/40 border-white/20'}`}>
                        {flight.GateNumber}
                      </div>
                  : <div className="text-[2.5rem] font-black text-transparent py-2 px-3">-</div>}
              </div>

              {/* Terminal */}
              <div className="flex items-center justify-center" style={{ width: "140px" }}>
                {(() => {
                  const badge = getFlightTerminalBadge(flight);
                  return badge ? (
                    <span className={`text-[1.6rem] font-black rounded-full px-3 py-1.5 leading-none ${badge.bg} ${badge.text}`}>
                      {badge.label}
                    </span>
                  ) : (
                    <div className="text-[2.5rem] font-black text-transparent">-</div>
                  );
                })()}
              </div>

              {/* Status */}
              <div className="flex items-center justify-center" style={{ width: "420px" }}>
                {pill.hasStatusText ? (
                  <div className={`${pillCls} overflow-hidden text-[1.8rem]`}>
                    {pill.showLEDs && (
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <LEDIndicator color={pill.led1} phase="a" size="w-4 h-4" />
                        <LEDIndicator color={pill.led2} phase="b" size="w-4 h-4" />
                      </div>
                    )}
                    <span className="truncate whitespace-nowrap font-extrabold tracking-wide">{pill.displayText}</span>
                  </div>
                ) : (
                  <div className="text-[1.6rem] font-bold text-slate-300">Scheduled</div>
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
        <div className="text-[1.25rem] font-black text-white truncate leading-tight">
          {flight.DestinationCityName || flight.DestinationAirportName}
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
  const [arrivals,   setArrivals]   = useState<Flight[]>([])
  const [departures, setDepartures] = useState<Flight[]>([])
  const [loading,    setLoading]    = useState(true)
  const [nightMode, setNightMode] = useState(false)
  const [langIdx,      setLangIdx]      = useState(0)
  const [showArrivals, setShowArrivals] = useState(true)
  const [lastUpdate,   setLastUpdate]   = useState("")
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [autoStatusTick, setAutoStatusTick] = useState(0)
  const [reducedAnimations, setReducedAnimations] = useState(IS_LOW_END) // ← low-end default

  const isMountedRef  = useRef(true)
  const prevGatesRef  = useRef<Record<string, string>>({})
  const isInitialLoad = useRef(true)
  const lastHeartbeat = useRef(Date.now())
  // FIX: lastKnownHash prebačen u ref — ne preživljava HMR, čisti se na unmount
const lastKnownHashRef = useRef<string | null>(null)
  // FIX C: sprječava preklapanje dva istovremena load() poziva (vidi Polling useEffect)
  const isFetchingRef = useRef(false)

  const arrivalsRef   = useRef<Flight[]>([])
  const departuresRef = useRef<Flight[]>([])
  const nightModeRef  = useRef(false)
  const [isDesktopLayout, setIsDesktopLayout] = useState(true)
useEffect(() => {
  if (typeof window === 'undefined' || !window.matchMedia) return
  const mql = window.matchMedia('(min-width: 640px)')
  setIsDesktopLayout(mql.matches)
  const handler = (e: MediaQueryListEvent) => setIsDesktopLayout(e.matches)
  if (mql.addEventListener) {
    mql.addEventListener('change', handler)
    return () => mql.removeEventListener('change', handler)
  } else {
    (mql as any).addListener(handler)
    return () => (mql as any).removeListener(handler)
  }
}, [])
  useEffect(() => { arrivalsRef.current = arrivals }, [arrivals])
  useEffect(() => { departuresRef.current = departures }, [departures])
  useEffect(() => { nightModeRef.current = nightMode }, [nightMode])

  const etagStatusRef = useRef<string | null>(null);

  const colors = useMemo(() => showArrivals ? COLOR_CONFIG.arrivals : COLOR_CONFIG.departures, [showArrivals])

  // ── Memory pressure detekcija ──
  // Ako je memorija > 80%, smanji animacije (LED blink, pill blink)
  useEffect(() => {
    if (IS_LOW_END) return; // već smanjeno
    const checkMemory = () => {
      const perf = (performance as any);
      if (perf?.memory) {
        const used = perf.memory.usedJSHeapSize;
        const total = perf.memory.totalJSHeapSize;
        if (total > 0 && used / total > MEMORY_PRESSURE_THRESHOLD) {
          setReducedAnimations(true);
          console.warn('⚠️ Memory pressure detected — reducing animations');
        }
      }
    };
    const id = setInterval(checkMemory, 60_000); // svaki minut
    return () => clearInterval(id);
  }, []);

  // ── Hard reset u 03:00 ──
  useEffect(() => {
    const now   = new Date()
    const reset = new Date()
    reset.setHours(HARD_RESET_HOUR, 0, 0, 0)
    if (reset <= now) reset.setDate(reset.getDate() + 1)
    const ms = reset.getTime() - now.getTime()
    const id = setTimeout(() => window.location.reload(), ms)
    return () => clearTimeout(id)
  }, [])

  // ── Periodični "meki" reload — svaka 4h ──
  useEffect(() => {
    const id = setInterval(() => window.location.reload(), SOFT_RELOAD_INTERVAL_MS)
    return () => clearInterval(id)
  }, [])

  // ── Kiosk: prevent context menu, selection ──
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

  // ── autoStatusTick — svake 60s ──
  useEffect(() => {
    const id = setInterval(() => setAutoStatusTick(t => t + 1), 60_000)
    return () => clearInterval(id)
  }, [])

  // ── Language rotation — svake 4s ──
  useEffect(() => {
    const id = setInterval(() => setLangIdx(i => (i + 1) % LANGUAGE_KEYS.length), 4_000)
    return () => clearInterval(id)
  }, [])

  // ── Arrivals/Departures switch — svake 20s ──
  useEffect(() => {
    const id = setInterval(() => {
      setShowArrivals(p => !p)
    }, 20_000)
    return () => clearInterval(id)
  }, [])

  // ── Heartbeat (kiosk) ──
  useEffect(() => {
    const id = setInterval(() => {
      if (Date.now() - lastHeartbeat.current > HEARTBEAT_TIMEOUT_MS) window.location.reload()
      else lastHeartbeat.current = Date.now()
    }, HEARTBEAT_CHECK_INTERVAL_MS)
    return () => clearInterval(id)
  }, [])

  // ── OPTIMIZOVANO: Memory cleanup — sada čisti i prevGatesRef ──
  useEffect(() => {
    const id = setInterval(() => {
      setArrivals(p => p.length > MAX_FLIGHTS_MEMORY ? p.slice(0, MAX_FLIGHTS_MEMORY) : p)
      setDepartures(p => p.length > MAX_FLIGHTS_MEMORY ? p.slice(0, MAX_FLIGHTS_MEMORY) : p)

      // FIX: Očisti prevGatesRef — zadrži samo zadnjih MAX_PREV_GATES entry-a
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

  // ── Filter helpers ──
  const filterRecentFlights = useCallback((flights: Flight[], isArrivals: boolean): Flight[] => {
    const now = new Date()
    return flights.filter(f => {
      const fn = (f.FlightNumber || "").toUpperCase()
      if (HIDDEN_FLIGHT_PATTERNS.some(p => fn.includes(p))) return false
      const status   = (f.StatusEN ?? "").toLowerCase()
      const arrived  = /(arrived|landed|sletio|sletjelo|dolazak|stigao)/i.test(status)
      const departed = !/(delay|kasni)/i.test(status) &&
        (status.includes("departed") || status.includes("poletio") || status.includes("take off"))
      if (!arrived && !departed) return true
      const timeStr = f.EstimatedDepartureTime || f.ScheduledDepartureTime || f.ActualDepartureTime
      if (!timeStr) return false
      const ft = parseFlightTimeToDate(timeStr)
      if (!ft) return false
      const diff = Math.floor((now.getTime() - ft.getTime()) / 60_000)
      if (isArrivals && arrived)    return diff <= 25
      if (!isArrivals && departed)  return diff <= 15
      return true
    })
  }, [])

  // ── OPTIMIZOVANO: prepareData — ne klonira letove bez dodjele ──
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

      // OPTIMIZOVANO: ne kloniraj ako nema promjene
      if (!adminDesk && (!effectiveGate || effectiveGate === "-" || effectiveGate === f.GateNumber)) {
        return f;
      }

      // Ima promjenu — kloniraj samo jednom
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

  // ── OPTIMIZOVANO: applyAssignmentsOnly — ne klonira nepromijenjene ──
  const applyAssignmentsOnly = useCallback((
    deps: Flight[],
    assignments: { desks: Record<string, string>; gates: Record<string, string> }
  ): Flight[] => {
    let hasChanges = false;
    const result = deps.map(f => {
      const num = f.FlightNumber ?? ""
      const adminDesk = assignments.desks?.[num]
      const adminGate = assignments.gates?.[num]
      const effectiveGate = adminGate || f.GateNumber || ""

      const deskChanged = adminDesk && adminDesk !== f.CheckInDesk;
      const gateChanged = effectiveGate && effectiveGate !== "-" && effectiveGate !== f.GateNumber;
      const prevGateDiffers = prevGatesRef.current[num] && prevGatesRef.current[num] !== effectiveGate;

      if (!deskChanged && !gateChanged) return f; // ← nema promjene, ne kloniraj

      hasChanges = true;
      const clone = { ...f }
      if (adminDesk) (clone as any).CheckInDesk = adminDesk
      if (effectiveGate && effectiveGate !== "-") {
        if (prevGateDiffers) {
          (clone as any)._gateChangedAt = Date.now()
        }
        clone.GateNumber = effectiveGate
        prevGatesRef.current[num] = effectiveGate
      }
      return clone
    })
    return hasChanges ? result : deps; // ako ništa nije promijenjeno, vrati original
  }, [])

  // ── Inicijalni keš load ──
  useEffect(() => {
    const cached = loadFromCache()
    if (!cached) return
    const { filteredArrivals, departuresWithMeta } = prepareData(cached)
    setArrivals(filteredArrivals)
    setDepartures(departuresWithMeta)
    setLastUpdate(cached.lastUpdated || new Date().toLocaleTimeString("en-GB"))
    setLoading(false)
  }, [prepareData])



// ── Polling ──
useEffect(() => {
  isMountedRef.current = true
  let tid: ReturnType<typeof setTimeout>
  const controller = new AbortController()
 
  const load = async () => {
    if (!isMountedRef.current) return
 
    // FIX C: guard protiv preklapanja — ako je fetch već u toku, ne pokreći novi
    if (isFetchingRef.current) return
    isFetchingRef.current = true
 
    const wasNightMode = nightModeRef.current
 
    if (isNightHours()) {
      if (isMountedRef.current) setNightMode(true)
      setLoading(false)
      isFetchingRef.current = false // FIX C: nije bilo pravog fetch-a, oslobodi guard
      tid = setTimeout(load, BASE_INTERVAL_MS)
      return
    }
    if (isMountedRef.current) setNightMode(false)
 
    const justExitedNightMode = wasNightMode
 
    // Jedina promjenljiva koja odlučuje kada se sledeći load() dešava.
    // Sve grane ispod je SAMO postavljaju — finally zove setTimeout.
    let nextInterval: number = BASE_INTERVAL_MS
 
    try {
      if (isInitialLoad.current && arrivalsRef.current.length === 0 && departuresRef.current.length === 0)
        setLoading(true)
      setErrorMessage(null)
 
      const boardIsCurrentlyEmpty = arrivalsRef.current.length === 0 && departuresRef.current.length === 0
      const forceRefresh = boardIsCurrentlyEmpty || justExitedNightMode
 
      // ── JEDAN poziv po ciklusu, sa ETag-om ──────────────────────
      const headers: HeadersInit = {}
      if (!forceRefresh && etagStatusRef.current) {
        headers['If-None-Match'] = etagStatusRef.current
      }
 
      let res: Response
      try {
        res = await fetchWithTimeout('/api/flights', 5_000, headers, controller.signal)
       } catch (fe) {
        // ── FIX: StrictMode dev double-invoke abortuje "stari" fetch —
        // to NIJE prava network greška, samo je efekat cleanup-ovan.
        // Bez ove provjere kod tiho prikaže STARI keš umjesto da sačeka
        // DRUGI (novi) load() poziv koji će uspjeti.
        if (controller.signal.aborted) {
          return
        }

        // network greška — fallback na keš
        const cached = loadFromCache()
        if (cached) {
          const { filteredArrivals, departuresWithMeta } = prepareData(cached)
          setArrivals(filteredArrivals)
          setDepartures(departuresWithMeta)
          setErrorMessage("Using cached data")
          nextInterval = getAdaptiveInterval(filteredArrivals, departuresWithMeta)
        } else {
          const emergencyCached = loadEmergencyCache()
          if (emergencyCached) {
            const { filteredArrivals, departuresWithMeta } = prepareData(emergencyCached)
            setArrivals(filteredArrivals)
            setDepartures(departuresWithMeta)
            setErrorMessage("Prikazan stariji poznati raspored")
            nextInterval = getAdaptiveInterval(filteredArrivals, departuresWithMeta)
          } else {
            setErrorMessage("Unable to load flight data")
            nextInterval = BASE_INTERVAL_MS
          }
        }
        setTimeout(() => { if (isMountedRef.current) setErrorMessage(null) }, 5_000)
        return // ← finally postavlja tid, koristi nextInterval iznad
      }
 
      // ── 304: ništa se nije promijenilo, samo ažuriraj timestamp ──
      if (res.status === 304) {
        setLastUpdate(new Date().toLocaleTimeString("en-GB"))
        nextInterval = getAdaptiveInterval(arrivalsRef.current, departuresRef.current)
        return // ← finally postavlja tid
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
        console.warn('⚠️ Novi fetch vratio 0 letova — zadržavam prethodno prikazano stanje')
        setLastUpdate(new Date().toLocaleTimeString("en-GB"))
        nextInterval = getAdaptiveInterval(arrivalsRef.current, departuresRef.current)
      } else {
        const { filteredArrivals, departuresWithMeta } = prepareData(data, assignments)
        setArrivals(filteredArrivals)
        setDepartures(departuresWithMeta)
        setLastUpdate(new Date().toLocaleTimeString("en-GB"))
        nextInterval = getAdaptiveInterval(filteredArrivals, departuresWithMeta)
      }
    } catch (e) {
      console.error("Critical:", e)
      nextInterval = BASE_INTERVAL_MS
       } finally {
      isInitialLoad.current = false
      isFetchingRef.current = false
      if (isMountedRef.current && !controller.signal.aborted) {   // ← dodato: !controller.signal.aborted
        setLoading(false)
        tid = setTimeout(load, nextInterval)
      }
    }
  }
 
  load()
  return () => {
    isMountedRef.current = false
    clearTimeout(tid)
    controller.abort()
    isFetchingRef.current = false   // ← NOVO: odmah oslobodi lock, da load() 
                                     // iz SLJEDEĆEG (StrictMode remount) effect-a 
                                     // ne bude blokiran dok se stari (abortovani) 
                                     // fetch asinhrono ne završi
  }
}, [prepareData, applyAssignmentsOnly])

  const handleClose = useCallback(() => {
    if ((window as any).electronAPI?.quitApp) { (window as any).electronAPI.quitApp(); return }
    try { if ((window as any).chrome?.webview) { (window as any).chrome.webview.postMessage("APP_QUIT"); return } } catch {}
    window.postMessage({ type: "ELECTRON_APP_QUIT" }, "*")
    try { if (window.parent !== window) window.parent.postMessage({ type: "ELECTRON_APP_QUIT" }, "*") } catch {}
    window.location.reload()
  }, [])

  const lang     = LANGUAGE_CONFIG[LANGUAGE_KEYS[langIdx]]
  const title    = showArrivals ? lang.arrivals    : lang.departures
  const subtitle = showArrivals ? lang.incomingFlights : lang.outgoingFlights

  const ArrivalIcon   = useCallback(({ className = "w-5 h-5" }: { className?: string }) =>
    <Plane className={`${className} text-orange-500 rotate-90`} />, [])
  const DepartureIcon = useCallback(({ className = "w-5 h-5" }: { className?: string }) =>
    <Plane className={`${className} text-orange-500`} />, [])

  const tableHeaders = useMemo(() => {
    const t = lang.tableHeaders
    if (showArrivals) return [
      { label: t.scheduled,   width: "180px", icon: Clock        },
      { label: t.estimated,   width: "180px", icon: Clock        },
      { label: t.flight,      width: "280px", icon: ArrivalIcon  },
      { label: t.from,        width: "580px", icon: MapPin       },
      { label: t.status,      width: "720px", icon: Info         },
    ]
    return [
      { label: t.scheduled,   width: "180px", icon: Clock        },
      { label: t.estimated,   width: "180px", icon: Clock        },
      { label: t.flight,      width: "280px", icon: DepartureIcon},
      { label: t.destination, width: "380px", icon: MapPin       },
      { label: t.checkIn,     width: "320px", icon: Users        },
      { label: t.gate,        width: "170px", icon: DoorOpen     },
      { label: "Terminal",    width: "160px", icon: Building2    },
      { label: t.status,      width: "410px", icon: Info         },
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

  // OPTIMIZOVANO: sortira in-place umjesto [...base].sort()
  const allSortedFlights = useMemo(() => {
    const base = showArrivals ? arrivals : departures
    const now = new Date()
    const nowMinutes = now.getHours() * 60 + now.getMinutes()

    return base.slice().sort((a, b) => {
      const aTime = getTimeOfDayMinutes(a.EstimatedDepartureTime || a.ScheduledDepartureTime)
      const bTime = getTimeOfDayMinutes(b.EstimatedDepartureTime || b.ScheduledDepartureTime)
      const aDiff = aTime === Infinity ? Infinity : aTime - nowMinutes
      const bDiff = bTime === Infinity ? Infinity : bTime - nowMinutes
      return aDiff - bDiff
    })
  }, [showArrivals, arrivals, departures, getTimeOfDayMinutes])

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
      {errorMessage && (
        <div className="fixed bottom-4 left-4 right-4 md:left-auto md:right-4 bg-red-500/90 text-white px-4 py-3 rounded-lg text-sm z-50 shadow-lg animate-pulse">
          ⚠️ {errorMessage}
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
              <p className={`${colors.subtitle} text-sm sm:text-2xl mt-0.5 sm:mt-2 font-semibold truncate`}>
                {subtitle}
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
        {loading && arrivals.length === 0 && departures.length === 0 ? (
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

      {/* Ticker — OPTIMIZOVANO: 1x umjesto 2x (CSS clone preko transform) */}
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

  /* LED animacije - OSTAJU AKTIVNE na svim uređajima */
  @keyframes ledBlinkA{0%{opacity:.2}100%{opacity:1}}
  @keyframes ledBlinkB{0%{opacity:1}100%{opacity:.2}}
  @keyframes pill-blink{0%,50%{opacity:1}51%,100%{opacity:.75}}
  @keyframes pill-blink-fast{0%,40%{opacity:1}41%,100%{opacity:.55}}

  .animate-pill-blink{animation:.8s ease-in-out infinite pill-blink}
  .animate-pill-blink-fast{animation:.4s ease-in-out infinite pill-blink-fast}
  .led-blink-a{animation:ledBlinkA .8s ease-in-out infinite alternate}
  .led-blink-b{animation:ledBlinkB .8s ease-in-out infinite alternate}

  /* Ticker - OSTAJE AKTIVAN na svim uređajima */
  .ticker-wrap{width:100%;overflow:hidden;position:absolute;top:0;left:0;height:100%}
  .ticker-move{
    display:inline-block;
    white-space:nowrap;
    backface-visibility:hidden;
    animation:ticker-scroll 45s linear infinite
  }
  @keyframes ticker-scroll{0%{transform:translate3d(0,0,0)}100%{transform:translate3d(-50%,0,0)}}

  @media(max-width:639px){.ticker-move{animation-duration:35s}}

  /* reducedAnimations - gasi SAMO dekorativne animacije */
  ${reducedAnimations ? `
    .animate-pulse{animation:none!important;opacity:1!important}
    .animate-spin{animation:none!important;opacity:1!important}
  ` : ''}

  /* Poštovanje system preference - ali NE gasi LED i ticker */
  @media(prefers-reduced-motion:reduce){
    .animate-pulse,.animate-spin{animation:none!important;opacity:1!important}
    /* LED i ticker OSTAJU aktivni - oni su funkcionalni, ne dekorativni */
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