'use client';


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
import { Info, Plane, Clock, MapPin, Users, DoorOpen } from "lucide-react"
import { getInitialAirlineLogoSrc, isKnownLocalLogo } from '@/lib/airline-logo';
 import { isNightHours } from '@/lib/night-hours';


// ============================================================
// KONSTANTE
// ============================================================
const REFRESH_INTERVAL_MS         = 120_000   // ↑ 60s→90s: -33% Vercel poziva
const CACHE_DURATION              = 6 * 60_000  // ↑ 5min→10min: manje fetcha iz browsera
const CACHE_KEY                   = "flight_board_cache_v2"  // v2: čisti stari cache
const HARD_RESET_HOUR             = 3         // reload u 03:00 (ne interval)
const MAX_FLIGHTS_DISPLAY         = 9
const MAX_FLIGHTS_MEMORY          = 60
const MEMORY_CLEANUP_INTERVAL_MS  = 30 * 60_000
const HEARTBEAT_TIMEOUT_MS        = 120_000
const HEARTBEAT_CHECK_INTERVAL_MS = 30_000
const PAGE_SIZE           = 8
const PAGE_ROTATE_MS      = 6_000   // svakih 6s nova stranica — podesi po želji (5-8s je dobar opseg)
let lastKnownHash: string | null = null;

// UKLONJEN fetchWithRetry i fetchWithTimeout — nisu se koristili,
// a generirale su retry pozive koji troše Vercel invocations.
// Sada: jedan fetch, na grešku → keš, na prazno → zadržava staro.

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
  departures:  Flight[]
  arrivals:    Flight[]
  lastUpdated: string
  source?:     "live" | "cached" | "fallback" | "backup" | "auto-processed" | "emergency"
  error?:      string
  warning?:    string
}

const EMERGENCY_CACHE_KEY = "flight_board_emergency_v1"

const saveEmergencyCache = (data: FlightDataResponse) => {
  try { localStorage.setItem(EMERGENCY_CACHE_KEY, JSON.stringify({ data, timestamp: Date.now() })) }
  catch { /* quota exceeded — ništa */ }
}

const loadEmergencyCache = (): FlightDataResponse | null => {
  try {
    const raw = localStorage.getItem(EMERGENCY_CACHE_KEY)
    if (!raw) return null
    const { data, timestamp } = JSON.parse(raw)
    // Emergency cache vrijedi do 12h — bolje stariji podaci nego prazan ekran
    return Date.now() - timestamp > 1 * 60 * 60_000 ? null : data
  } catch { return null }
}
// ============================================================
// I18N — statički objekt (nema state rotacije po pitanju alociranja)
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

// ============================================================
// PLACEHOLDER (inline base64 — bez network poziva)
// ============================================================
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

// ── Cache helpers ─────────────────────────────────────────────
const saveToCache = (data: FlightDataResponse) => {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify({ data, timestamp: Date.now() })) }
  catch { /* quota exceeded — ništa */ }
}
const loadFromCache = (): FlightDataResponse | null => {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const { data, timestamp } = JSON.parse(raw)
    return Date.now() - timestamp > CACHE_DURATION ? null : data
  } catch { return null }
}

const fetchWithTimeout = (url: string, timeout: number, headers?: HeadersInit): Promise<Response> => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  return fetch(url, { signal: controller.signal, headers })
    .finally(() => clearTimeout(timeoutId))
    .catch(err => {
      if (err.name === 'AbortError') {
        throw new Error(`Request to ${url} timed out after ${timeout}ms`);
      }
      throw err;
    });
};

const fetchAssignments = async (): Promise<{
  desks: Record<string, string>;
  gates: Record<string, string>;
}> => {
  try {
    const res = await fetchWithTimeout('/api/test/assignments', 5_000);
    if (!res.ok) return { desks: {}, gates: {} };
    const data = await res.json();
    return {
      desks: data.desks ?? {},
      gates: data.gates ?? {},
    };
  } catch {
    return { desks: {}, gates: {} };
  }
};
// ── Auto-status logika ────────────────────────────────────────

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
  if (status && status !== "-") return null
  const schStr = flight.ScheduledDepartureTime
  const estStr = flight.EstimatedDepartureTime
  if (!schStr) return null
  if (!estStr || !isValidDisplayTime(estStr) || schStr === estStr) return "Scheduled"
  const sch = parseFlightTimeToDate(schStr); const est = parseFlightTimeToDate(estStr)
  if (!sch || !est) return "Scheduled"
  const diff = (sch.getTime() - est.getTime()) / 60_000
  if (diff > 15)  return `Arriving early – expected at ${fmtTime(estStr)}`
  if (diff < -15) return `Delayed – expected at ${fmtTime(estStr)}`
  return "On time"
}

// ── Status pill ───────────────────────────────────────────────
type LEDColor = "blue"|"green"|"orange"|"red"|"yellow"|"cyan"|"purple"|"lime"

function computeStatusPill(flight: Flight, isArrival: boolean, fmtTime: (t: string) => string) {
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

// Jedan ClockDisplay (bez duplog hidden/block bloka)
const ClockDisplay = memo(function ClockDisplay({ colorClass }: { colorClass: string }) {
  const [time, setTime] = useState("")
  useEffect(() => {
    const tick = () => setTime(new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }))
    tick(); const id = setInterval(tick, 1_000); return () => clearInterval(id)
  }, [])
  return <div className={`text-[3rem] sm:text-[7rem] font-black ${colorClass} drop-shadow-2xl leading-none`}>{time || "--:--"}</div>
})

// ── NOĆNI SAT — pun ekran, HH:MM, font 72px, žuta boja, po centru ──
const NightClock = memo(function NightClock() {
  const [time, setTime] = useState("")
  useEffect(() => {
    const tick = () => setTime(new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }))
    tick(); const id = setInterval(tick, 1_000); return () => clearInterval(id)
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
      className={`${size} rounded-full ${colorMap[color]}`}
      style={{ animation: `${phase === "a" ? "ledBlinkA" : "ledBlinkB"} 0.8s ease-in-out infinite alternate` }}
    />
  )
})

const TableHeaders = memo(function TableHeaders({
  headers, headerBg,
}: { headers: { label: string; width: string; icon: React.ComponentType<{ className?: string }> }[]; headerBg: string }) {
  return (
    <div className={`hidden sm:flex gap-2 p-2 ${headerBg} border-b-4 border-black/30 font-black text-black text-[1.3rem] uppercase tracking-wider flex-shrink-0 shadow-xl`}>
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
// FLIGHT ROW
// ============================================================
const FlightRow = memo(
  function FlightRow({ flight, index, showArrivals, colorTitle, autoStatusTick }: {
    flight: Flight; index: number; showArrivals: boolean; colorTitle: string; autoStatusTick: number
  }) {
    const formatTime = useCallback((t: string) => formatTimeString(t), [])

    const pill = useMemo(
      () => computeStatusPill(flight, showArrivals, formatTime),
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [flight, showArrivals, formatTime, autoStatusTick]
    )

    const icao = flight.AirlineICAO || flight.FlightNumber?.substring(0, 2).toUpperCase() || ""

    // Logo fallback: public/airlines/{ICAO}.png → .jpg → FlightAware → placeholder
const onImgErr = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
  const img = e.currentTarget
  // Lokalni fajl (png/jpg) je promašio → idi na FlightAware
  if (img.dataset.tried === 'local') {
    img.dataset.tried = 'fw'
    const fw = getFlightawareLogoURL(icao)
    if (fw) { img.src = fw; return }
    img.src = PLACEHOLDER_IMAGE; img.onerror = null; return
  }
  // FlightAware je promašio → placeholder
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

    return (
      <>
        {/* ── DESKTOP (sm+) ────────────────────────────────── */}
        <div className={`hidden sm:flex gap-2 p-1 border-b border-white/10 ${rowBg}`} style={{ minHeight: "68px", contain: "layout style" }}>

          {/* Scheduled */}
          <div className="flex items-center justify-center" style={{ width: "180px" }}>
            <div className="text-[2.5rem] font-black text-white drop-shadow-lg">
              {formatTimeString(flight.ScheduledDepartureTime) || <span className="text-white/40">--:--</span>}
            </div>
          </div>

          {/* Estimated */}
          <div className="flex items-center justify-center" style={{ width: "180px" }}>
            {estimatedDisplay
              ? <div className={`text-[2.5rem] font-black ${colorTitle} drop-shadow-lg`}>{estimatedDisplay}</div>
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
              <div className="flex items-center justify-center" style={{ width: "320px" }}>
                {flight.CheckInDesk && flight.CheckInDesk !== "-"
                  ? <div className="text-[2.5rem] font-black text-white bg-black/40 py-2 px-3 rounded-xl border-2 border-white/20 shadow-xl">{flight.CheckInDesk}</div>
                  : <div className="text-[2.5rem] font-black text-transparent py-2 px-3">-</div>}
              </div>
              <div className="flex items-center justify-center" style={{ width: "180px" }}>
                {flight.GateNumber && flight.GateNumber !== "-"
                  ? <div className={`text-[2.5rem] font-black py-2 px-3 rounded-xl border-2 shadow-xl ${isGateChanged ? "text-red-500 bg-red-500/20 border-red-400 animate-pill-blink-fast" : "text-white bg-black/40 border-white/20"}`}>
                      {flight.GateNumber}
                    </div>
                  : <div className="text-[2.5rem] font-black text-transparent py-2 px-3">-</div>}
              </div>
              <div className="flex items-center justify-center" style={{ width: "500px" }}>
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

        {/* ── MOBILNI LAYOUT ───────────────────────────────── */}
        <div className={`flex sm:hidden flex-col gap-2 px-3 py-2.5 border-b border-white/10 ${rowBg}`}>
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
      </>
    )
  },
  (prev, next) =>
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

  // ── Noćni režim — kad je true, prikazuje se samo NightClock,
  // bez ijednog network poziva (/api/flights, /api/flights/status,
  // override rute). Prvi request nakon isteka noći (04:00) automatski
  // vraća normalan prikaz — self-healing, isti princip kao hash-check.
  const [nightMode, setNightMode] = useState(false)

  // Jezik: indeks rotira CSS animacijom — bez state update
  const [langIdx,      setLangIdx]      = useState(0)
  const [showArrivals, setShowArrivals] = useState(true)
  const [lastUpdate,   setLastUpdate]   = useState("")
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [autoStatusTick, setAutoStatusTick] = useState(0)

//   const [arrivalsPage,   setArrivalsPage]   = useState(0)
// const [departuresPage, setDeparturesPage] = useState(0)
// const [toggleCount, setToggleCount] = useState(0)

const [pageIndex, setPageIndex] = useState(0)

  const isMountedRef  = useRef(true)
  const prevGatesRef  = useRef<Record<string, string>>({})
  const isInitialLoad = useRef(true)
  const lastHeartbeat = useRef(Date.now())

  // unutar FlightBoard komponente
const etagStatusRef = useRef<string | null>(null);

  const colors = useMemo(() => showArrivals ? COLOR_CONFIG.arrivals : COLOR_CONFIG.departures, [showArrivals])

  // ── Hard reset u 03:00 (ne interval) ─────────────────────
  useEffect(() => {
    const now   = new Date()
    const reset = new Date()
    reset.setHours(HARD_RESET_HOUR, 0, 0, 0)
    if (reset <= now) reset.setDate(reset.getDate() + 1)
    const ms = reset.getTime() - now.getTime()
    const id = setTimeout(() => window.location.reload(), ms)
    return () => clearTimeout(id)
  }, [])

  // ── Kiosk: prevent context menu, selection ───────────────
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

  // ── autoStatusTick — svake 60s, ažurira auto-status pillove ──
  useEffect(() => {
    const id = setInterval(() => setAutoStatusTick(t => t + 1), 60_000)
    return () => clearInterval(id)
  }, [])

  // ── Language rotation — svake 4s ──────────────────────────
  useEffect(() => {
    const id = setInterval(() => setLangIdx(i => (i + 1) % LANGUAGE_KEYS.length), 4_000)
    return () => clearInterval(id)
  }, [])

  // ── Arrivals/Departures switch — svake 20s ────────────────
useEffect(() => {
  const id = setInterval(() => {
    setShowArrivals(p => !p)
    // setPageIndex(0)   // ⭐ reset — nova lista uvijek počinje od prve stranice
  }, 20_000)
  return () => clearInterval(id)
}, [])


  // ── Rotacija stranica unutar trenutno prikazane liste (brže od 20s switcha) ──
  // useEffect(() => {
  //   const id = setInterval(() => {
  //     setPageIndex(p => p + 1)
  //   }, PAGE_ROTATE_MS)
  //   return () => clearInterval(id)
  // }, [])

  // ── Heartbeat (kiosk — bez mouse/key listenera) ───────────
  useEffect(() => {
    const id = setInterval(() => {
      if (Date.now() - lastHeartbeat.current > HEARTBEAT_TIMEOUT_MS) window.location.reload()
      else lastHeartbeat.current = Date.now()  // Kiosk: ažurira sam sebe
    }, HEARTBEAT_CHECK_INTERVAL_MS)
    return () => clearInterval(id)
  }, [])

  // ── Memory cleanup ────────────────────────────────────────
  useEffect(() => {
    const id = setInterval(() => {
      setArrivals(p => p.length > MAX_FLIGHTS_MEMORY ? p.slice(0, MAX_FLIGHTS_MEMORY) : p)
      setDepartures(p => p.length > MAX_FLIGHTS_MEMORY ? p.slice(0, MAX_FLIGHTS_MEMORY) : p)
    }, MEMORY_CLEANUP_INTERVAL_MS)
    return () => clearInterval(id)
  }, [])

  // ── Global error handler ──────────────────────────────────
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

  // ── Filter helpers ────────────────────────────────────────
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

  // ── Pripremi letove iz sirovih podataka ───────────────────
const prepareData = useCallback((
  data: FlightDataResponse,
  assignments?: { desks: Record<string, string>; gates: Record<string, string> }
) => {
const filteredArrivals = filterRecentFlights(data.arrivals, true)
const rawDep = getUniqueDeparturesWithDeparted(filterRecentFlights(data.departures, false))

  const departuresWithMeta = rawDep.map(f => {
    const clone = { ...f }
    const num = f.FlightNumber ?? ""

    const adminDesk = assignments?.desks?.[num]
    if (adminDesk) {
      (clone as any).CheckInDesk = adminDesk
    }

    const adminGate = assignments?.gates?.[num]
    const effectiveGate = adminGate || f.GateNumber || ""
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

// ── Primjenjuje samo desk/gate dodjele na VEĆ obrađene departures,
// bez ponovnog filtriranja/transformacije — koristi se kad se hash
// letova NIJE promijenio, ali dodjele možda jesu (svaki ciklus). ──
const applyAssignmentsOnly = useCallback((
  deps: Flight[],
  assignments: { desks: Record<string, string>; gates: Record<string, string> }
): Flight[] => {
  return deps.map(f => {
    const num = f.FlightNumber ?? ""
    const clone = { ...f }

    const adminDesk = assignments.desks?.[num]
    if (adminDesk) (clone as any).CheckInDesk = adminDesk

    const adminGate = assignments.gates?.[num]
    const effectiveGate = adminGate || f.GateNumber || ""
    if (effectiveGate && effectiveGate !== "-") {
      if (prevGatesRef.current[num] && prevGatesRef.current[num] !== effectiveGate) {
        (clone as any)._gateChangedAt = Date.now()
      }
      clone.GateNumber = effectiveGate
      prevGatesRef.current[num] = effectiveGate
    }

    return clone
  })
}, [])

  // ── Inicijalni keš load ───────────────────────────────────
  useEffect(() => {
    const cached = loadFromCache()
    if (!cached) return
    const { filteredArrivals, departuresWithMeta } = prepareData(cached)
    setArrivals(filteredArrivals)
    setDepartures(departuresWithMeta)
    setLastUpdate(cached.lastUpdated || new Date().toLocaleTimeString("en-GB"))
    setLoading(false)
  }, [prepareData])

  // ── Polling: jedan fetch, bez retry (Vercel optimizacija) ──
useEffect(() => {
  isMountedRef.current = true
  let tid: ReturnType<typeof setTimeout>
  const controller = new AbortController()

const load = async () => {
  if (!isMountedRef.current) return

  // ── NOĆNI REŽIM ──
  // Noću (21:00-04:00) ne radimo NIKAKAV network poziv — ni hash-check,
  // ni pun fetch, ni fetchAssignments. Prikazuje se samo NightClock.
  // Čim isNightHours() vrati false (prvi ciklus poslije 04:00), ovaj
  // blok se preskače i nastavlja se normalan tok — self-healing, isti
  // princip kao "odbaci noćni cache" logika na backendu.
const wasNightMode = nightMode  // vrijednost PRIJE ovog ciklusa

if (isNightHours()) {
  if (isMountedRef.current) setNightMode(true)
  setLoading(false)
  tid = setTimeout(load, REFRESH_INTERVAL_MS)
  return
}
if (isMountedRef.current) setNightMode(false)

// ── Prelaz noć → dan: forsiraj svjež fetch bez obzira na hash-check
// ovog ciklusa. Sprečava (rijedak, ali moguć) rubni slučaj gdje bi se
// stari, jučerašnji dnevni podaci u state-u poklopili sa server hash-om
// prije nego server stigne odbaciti svoj noćni cache. ─────────────────
const justExitedNightMode = wasNightMode

  try {
    if (isInitialLoad.current && arrivals.length === 0 && departures.length === 0)
      setLoading(true)
    setErrorMessage(null)

    // ── HASH CHECK ──
    // Ako trenutno NEMA prikazanih letova, ne vjeruj hash-u — moglo je doći
    // do desinhronizacije (stale meta u Redisu, noćni prelaz i sl.).
    // U tom slučaju UVIJEK radi pun fetch, da se ekran sam "izliječi".
const boardIsCurrentlyEmpty = arrivals.length === 0 && departures.length === 0
const forceRefresh = boardIsCurrentlyEmpty || justExitedNightMode
    let hashChanged = true
    let statusAssignments: { desks: Record<string, string>; gates: Record<string, string> } | null = null

    // ── Status ruta se sad ZOVE UVIJEK (ne samo kad je board pun) —
    // nosi i hash i desk/gate dodjele u istom odgovoru, pa nam više
    // ne treba poseban poziv na /api/test/assignments nikad. ────────
    try {
// ── Status ruta sa ETag ──────────────────────────────────────
const headers: HeadersInit = {};
if (etagStatusRef.current) {
  headers['If-None-Match'] = etagStatusRef.current;
}

try {
  const statusRes = await fetchWithTimeout('/api/flights/status', 5_000, headers); // ⬅️ dodaj headers
  if (statusRes.status === 304) {
    // Nema promjene – ni hash ni dodjele – preskoči sve
    setLastUpdate(new Date().toLocaleTimeString("en-GB"));
    isInitialLoad.current = false;
    setLoading(false);
    tid = setTimeout(load, REFRESH_INTERVAL_MS);
    return;
  }
if (statusRes.ok) {
    const statusData = await statusRes.json();
    const newEtag = statusRes.headers.get('ETag');
    if (newEtag) etagStatusRef.current = newEtag;

    statusAssignments = { desks: statusData.desks ?? {}, gates: statusData.gates ?? {} };
    if (isMountedRef.current) setNightMode(!!statusData.isNightMode);   // ← NOVO

if (!forceRefresh && statusData.hash === lastKnownHash && lastKnownHash !== null) {
  hashChanged = false;
}
lastKnownHash = statusData.hash;
}
} catch {
  // ignoriši grešku, nastavi na pun fetch
}
    } catch {
      // ignoriši grešku statusne provjere, nastavi na pun fetch kao fallback
    }

    if (!hashChanged) {
      // ── Hash letova se nije promijenio, ali dodjele šaltera/gate-ova
      // MOGU biti — primijeni ih na već prikazane departures. ──────
      if (statusAssignments) {
        setDepartures(prev => applyAssignmentsOnly(prev, statusAssignments!))
      }
      setLastUpdate(new Date().toLocaleTimeString("en-GB"))
      isInitialLoad.current = false
      setLoading(false)
      tid = setTimeout(load, REFRESH_INTERVAL_MS)
      return
    }
    

    // ── PUN FETCH (samo ako se hash promijenio, ekran je prazan, ili status check nije uspio) ──
    let data: FlightDataResponse | null = null
    if (hashChanged) {
      try {
        const res = await fetch("/api/flights", {
          signal: controller.signal,
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        data = await res.json()
        if (isMountedRef.current && data) {
          saveToCache(data)
          saveEmergencyCache(data)
        }
      } catch (fe) {
        if ((fe as Error).name === "AbortError") return
        const cached = loadFromCache()
        if (cached) {
          data = cached
          setErrorMessage("Using cached data")
        } else {
          const emergencyCached = loadEmergencyCache()
          if (emergencyCached) {
            data = emergencyCached
            setErrorMessage("Prikazan stariji poznati raspored")
          } else {
            setErrorMessage("Unable to load flight data")
          }
        }
        setTimeout(() => { if (isMountedRef.current) setErrorMessage(null) }, 5_000)
      }
    }

    if (!isMountedRef.current || !data) return

    const incomingTotal = (data.departures?.length || 0) + (data.arrivals?.length || 0)
    const currentlyHasData = arrivals.length > 0 || departures.length > 0

    // ── SIGURNOSNA MREŽA: ne dozvoli da prazan/sumnjiv odgovor obriše već prikazane letove ──
    if (incomingTotal === 0 && currentlyHasData) {
      console.warn('⚠️ Novi fetch vratio 0 letova — zadržavam prethodno prikazano stanje umjesto da praznim ekran')
      setLastUpdate(new Date().toLocaleTimeString("en-GB")) // pokaži da je pokušano, ali ne mijenjaj listu
    } else {
const assignments = statusAssignments ?? { desks: {}, gates: {} }
      const { filteredArrivals, departuresWithMeta } = prepareData(data, assignments)
      setArrivals(filteredArrivals)
      setDepartures(departuresWithMeta)
      setLastUpdate(new Date().toLocaleTimeString("en-GB"))
    }
  } catch (e) {
    console.error("Critical:", e)
  } finally {
    isInitialLoad.current = false
    if (isMountedRef.current) {
      setLoading(false)
      tid = setTimeout(load, REFRESH_INTERVAL_MS)
    }
  }
}

  load()
  return () => {
    isMountedRef.current = false
    clearTimeout(tid)
    controller.abort()
  }
}, [prepareData]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Close handler ─────────────────────────────────────────
  const handleClose = useCallback(() => {
    if ((window as any).electronAPI?.quitApp) { (window as any).electronAPI.quitApp(); return }
    try { if ((window as any).chrome?.webview) { (window as any).chrome.webview.postMessage("APP_QUIT"); return } } catch {}
    window.postMessage({ type: "ELECTRON_APP_QUIT" }, "*")
    try { if (window.parent !== window) window.parent.postMessage({ type: "ELECTRON_APP_QUIT" }, "*") } catch {}
    window.location.reload()
  }, [])

  // ── Derived ───────────────────────────────────────────────
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
      { label: t.checkIn,     width: "340px", icon: Users        },
      { label: t.gate,        width: "220px", icon: DoorOpen     },
      { label: t.status,      width: "500px", icon: Info         },
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
  const base = showArrivals ? arrivals : departures
  const now = new Date()
  const nowMinutes = now.getHours() * 60 + now.getMinutes()

  return [...base].sort((a, b) => {
    const aTime = getTimeOfDayMinutes(a.EstimatedDepartureTime || a.ScheduledDepartureTime)
    const bTime = getTimeOfDayMinutes(b.EstimatedDepartureTime || b.ScheduledDepartureTime)
    const aDiff = aTime === Infinity ? Infinity : aTime - nowMinutes
    const bDiff = bTime === Infinity ? Infinity : bTime - nowMinutes
    return aDiff - bDiff
  })
}, [showArrivals, arrivals, departures, getTimeOfDayMinutes])

// const totalPages = Math.max(1, Math.ceil(allSortedFlights.length / PAGE_SIZE))

// const sortedFlights = useMemo(() => {
//   if (allSortedFlights.length === 0) return []
//   const currentPage = pageIndex % totalPages
//   const start = currentPage * PAGE_SIZE
//   return allSortedFlights.slice(start, start + PAGE_SIZE)
// }, [allSortedFlights, pageIndex, totalPages])
const sortedFlights = useMemo(
  () => allSortedFlights.slice(0, MAX_FLIGHTS_DISPLAY),
  [allSortedFlights]
)

  // ── Render ────────────────────────────────────────────────

  // ── NOĆNI PRIKAZ — pun ekran, samo sat, bez tabele/tickera/headera ──
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

      {/* ── Header ─────────────────────────────────────────── */}
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

      {/* ── Tablica ─────────────────────────────────────────── */}
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
            <TableHeaders headers={tableHeaders} headerBg={colors.header} />
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
                  />
                ))
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── Ticker ──────────────────────────────────────────── */}
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
        .animate-pill-blink{animation:.8s ease-in-out infinite pill-blink;will-change:opacity}
        .animate-pill-blink-fast{animation:.4s ease-in-out infinite pill-blink-fast;will-change:opacity}
        .ticker-wrap{width:100%;overflow:hidden;position:absolute;top:0;left:0;height:100%}
        .ticker-move{display:inline-block;white-space:nowrap;will-change:transform;backface-visibility:hidden;animation:ticker-scroll 45s linear infinite}
        @keyframes ticker-scroll{0%{transform:translate3d(0,0,0)}100%{transform:translate3d(-50%,0,0)}}
        @media(max-width:639px){.ticker-move{animation-duration:35s}}
        @media(prefers-reduced-motion:reduce){.animate-pill-blink,.animate-pill-blink-fast,.animate-pulse,.animate-spin,.ticker-move{animation:none!important;opacity:1!important}}
        ::-webkit-scrollbar{width:6px}::-webkit-scrollbar-track{background:rgba(0,0,0,.3);border-radius:3px}
        ::-webkit-scrollbar-thumb{background:rgba(255,255,255,.4);border-radius:3px}::-webkit-scrollbar-thumb:hover{background:rgba(255,255,255,.6)}
        body,html{overflow:hidden;margin:0;padding:0}
      `}</style>
    </div>
  )
}

// ============================================================
// EXPORT
// ============================================================
export default function CombinedPageClient(): JSX.Element {
  return <FlightBoardErrorBoundary><FlightBoard /></FlightBoardErrorBoundary>
}