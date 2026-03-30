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

// ============================================================
// KONSTANTE
// ============================================================
const REFRESH_INTERVAL_MS = 60_000
const FETCH_TIMEOUT_MS = 15_000
const MAX_RETRIES = 3
const RETRY_DELAY_MS = 1_000
const CACHE_KEY = "flight_board_cache"
const CACHE_DURATION = 5 * 60 * 1_000
const HEARTBEAT_TIMEOUT_MS = 120_000
const HEARTBEAT_CHECK_INTERVAL_MS = 30_000
const MEMORY_CLEANUP_INTERVAL_MS = 30 * 60 * 1_000
const MAX_FLIGHTS_DISPLAY = 9
const MAX_FLIGHTS_MEMORY = 15

// ✅ #5: Hard reset svakih 6 sati za Kiosk/TV aperate
const HARD_RESET_INTERVAL_MS = 6 * 60 * 60 * 1000 

// ✅ #6: Napredni filter za privatne/biznis letove
const HIDDEN_FLIGHT_PATTERNS = [
  "ZZZ",   // Biznis avijacija
  "G00",   // General Aviation
  "PVT",   // Privatni letovi
  "TST",   // Test flightovi
]

const COLOR_CONFIG = {
  arrivals: {
    background: "bg-gradient-to-br from-blue-950 via-blue-900 to-blue-950",
    accent: "bg-cyan-400",
    header: "bg-white",
    title: "text-white",
    subtitle: "text-cyan-200",
    border: "border-cyan-400",
    cardBg: "bg-blue-900/80",
  },
  departures: {
    background: "bg-gradient-to-br from-[#1F0218] via-[#7D185E] to-[#1F0218]",
    accent: "bg-purple-500",
    header: "bg-yellow-400",
    title: "text-yellow-400",
    subtitle: "text-purple-200",
    border: "border-purple-500",
    cardBg: "bg-[#3a0a30]/80",
  },
}

interface FlightDataResponse {
  departures: Flight[]
  arrivals: Flight[]
  lastUpdated: string
  source?: "live" | "cached" | "fallback" | "backup" | "auto-processed" | "emergency"
  error?: string
  warning?: string
}

// Language configuration
const LANGUAGE_CONFIG = {
  en: {
    arrivals: "ARRIVALS",
    departures: "DEPARTURES",
    realTimeInfo: "Real-time flight information",
    incomingFlights: "Incoming flights",
    outgoingFlights: "Outgoing flights",
    tableHeaders: {
      scheduled: "Scheduled",
      estimated: "Estimated",
      flight: "Flight",
      from: "From",
      destination: "Destination",
      checkIn: "Check-In",
      gate: "Gate",
      status: "Status",
    },
  },
  bs: {
    arrivals: "DOLASCI",
    departures: "POLASCI",
    realTimeInfo: "Informacije o letovima u realnom vremenu",
    incomingFlights: "Dolazni letovi",
    outgoingFlights: "Odlazni letovi",
    tableHeaders: {
      scheduled: "Planirano",
      estimated: "Očekivano",
      flight: "Let",
      from: "Od",
      destination: "Destinacija",
      checkIn: "Check-In",
      gate: "Izlaz",
      status: "Status",
    },
  },
  de: {
    arrivals: "ANKÜNFTE",
    departures: "ABFLÜGE",
    realTimeInfo: "Echtzeit-Fluginformationen",
    incomingFlights: "Ankommende Flüge",
    outgoingFlights: "Abfliegende Flüge",
    tableHeaders: {
      scheduled: "Geplant",
      estimated: "Geschätzt",
      flight: "Flug",
      from: "Von",
      destination: "Ziel",
      checkIn: "Check-In",
      gate: "Gate",
      status: "Status",
    },
  },
  fr: {
    arrivals: "ARRIVÉES",
    departures: "DÉPARTS",
    realTimeInfo: "Informations de vol en temps réel",
    incomingFlights: "Vols entrants",
    outgoingFlights: "Vols sortants",
    tableHeaders: {
      scheduled: "Prévu",
      estimated: "Estimé",
      flight: "Vol",
      from: "De",
      destination: "Destination",
      checkIn: "Enregist.",
      gate: "Porte",
      status: "Statut",
    },
  },
  he: {
    arrivals: "טיסות נכנסות",
    departures: "טיסות יוצאות",
    realTimeInfo: "מידע טיסות בזמן אמת",
    incomingFlights: "טיסות נכנסות",
    outgoingFlights: "טיסות יוצאות",
    tableHeaders: {
      scheduled: "מתוכנן",
      estimated: "משוער",
      flight: "טיסה",
      from: "מ",
      destination: "יעד",
      checkIn: "צ׳ק-אין",
      gate: "שער",
      status: "סטטוס",
    },
  },
  tr: {
    arrivals: "Varış",
    departures: "Kalkış",
    realTimeInfo: "Gerçek Zamanlı Uçuş Bilgisi",
    incomingFlights: "Varış Uçuşları",
    outgoingFlights: "Kalkış Uçuşları",
    tableHeaders: {
      scheduled: "Planlanan",
      estimated: "Tahmini",
      flight: "Uçuş",
      from: "Kalkış Yeri",
      destination: "Varış Yeri",
      checkIn: "Check-in",
      gate: "Kapı",
      status: "Durum",
    },
  },
}

const SECURITY_MESSAGES = [
  {
    text: "⚠️ DEAR PASSENGERS, PLEASE DO NOT LEAVE YOUR BAGGAGE UNATTENDED AT THE AIRPORT - UNATTENDED BAGGAGE WILL BE CONFISCATED AND DESTROYED •",
    language: "en",
  },
  {
    text: "⚠️ POŠTOVANI PUTNICI, MOLIMO VAS DA NE OSTAVLJATE SVOJ PRTLJAG BEZ NADZORA NA AERODROMU - NENADZIRANI PRTLJAG ĆE BITI ODUZET I UNIŠTEN •",
    language: "cnr",
  },
]

// ============================================================
// ERROR BOUNDARY
// ============================================================
interface ErrorBoundaryState {
  hasError: boolean
  errorMessage: string
}

class FlightBoardErrorBoundary extends Component<
  { children: ReactNode; fallback?: ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: ReactNode; fallback?: ReactNode }) {
    super(props)
    this.state = { hasError: false, errorMessage: "" }
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, errorMessage: error.message }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("🚨 FlightBoard ErrorBoundary caught:", error, info)
    setTimeout(() => {
      this.setState({ hasError: false, errorMessage: "" })
    }, 10_000)
  }

  render() {
    if (this.state.hasError) {
      return (
        this.props.fallback || (
          <div className="h-screen bg-blue-950 flex flex-col items-center justify-center text-white gap-6">
            <Plane className="w-24 h-24 opacity-30 animate-pulse" />
            <div className="text-4xl font-bold opacity-70">Reconnecting...</div>
            <div className="text-xl opacity-40">{this.state.errorMessage}</div>
          </div>
        )
      )
    }
    return this.props.children
  }
}

// ============================================================
// HELPER FUNKCIJE
// ============================================================
const getFlightawareLogoURL = (icaoCode: string): string => {
  if (!icaoCode) return ""
  return `https://www.flightaware.com/images/airline_logos/180px/${icaoCode}.png`
}

const PLACEHOLDER_IMAGE =
  "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMzIiIGhlaWdodD0iMzIiIHZpZXdCb3g9IjAgMCAzMiAzMiIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHJlY3Qgd2lkdGg9IjMyIiBoZWlnaHQ9IjMyIiBmaWxsPSIjMzQzQzU0Ii8+Cjx0ZXh0IHg9IjE2IiB5PSIxNiIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZG9taW5hbnQtYmFzZWxpbmU9Im1pZGRsZSIgZmlsbD0iIzlDQTdCNiIgZm9udC1mYW1pbHk9IkFyaWFsLCBzYW5zLXNlcmlmIiBmb250LXNpemU9IjgiPk5vIExvZ288L3RleHQ+Cjwvc3ZnPgo="

const parseDepartureTimeLocal = (timeString: string): Date | null => {
  if (!timeString) return null
  try {
    if (timeString.includes("T")) {
      const d = new Date(timeString)
      return isNaN(d.getTime()) ? null : d
    }
    const clean = timeString.replace(":", "")
    if (clean.length !== 4) return null
    const hours = parseInt(clean.substring(0, 2), 10)
    const minutes = parseInt(clean.substring(2, 4), 10)
    if (isNaN(hours) || isNaN(minutes)) return null
    const now = new Date()
    const d = new Date(now)
    d.setHours(hours, minutes, 0, 0)
    return d
  } catch {
    return null
  }
}

// ─── Cache ───────────────────────────────────────────────────
const saveToCache = (data: FlightDataResponse) => {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ data, timestamp: Date.now() }))
  } catch (e) {
    console.warn("Failed to save to cache:", e)
  }
}

const loadFromCache = (): FlightDataResponse | null => {
  try {
    const cached = localStorage.getItem(CACHE_KEY)
    if (!cached) return null
    const { data, timestamp } = JSON.parse(cached)
    if (Date.now() - timestamp > CACHE_DURATION) return null
    return data
  } catch {
    return null
  }
}

// ─── Fetch with timeout & retry ──────────────────────────────
const fetchWithTimeout = async (url: string, timeoutMs: number): Promise<Response> => {
  const controller = new AbortController()
  const id = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "Cache-Control": "no-cache, no-store, must-revalidate",
        Pragma: "no-cache",
        Expires: "0",
      },
    })
    clearTimeout(id)
    return res
  } catch (err) {
    clearTimeout(id)
    throw err
  }
}

const fetchWithRetry = async (
  url: string,
  maxRetries = MAX_RETRIES,
  delayMs = RETRY_DELAY_MS
): Promise<FlightDataResponse> => {
  let lastError: Error | null = null
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await fetchWithTimeout(url, FETCH_TIMEOUT_MS)
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      return await response.json()
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))
      if (attempt < maxRetries - 1) {
        await new Promise((r) => setTimeout(r, delayMs * Math.pow(2, attempt)))
      }
    }
  }
  throw lastError || new Error("All fetch attempts failed")
}

// ─── Status checkers ─────────────────────────────────────────
const checkStatus = {
  isDelayed:      (f: Flight) => /(delay|kasni)/i.test(f.StatusEN),
  isBoarding:     (f: Flight) => /(boarding|gate open)/i.test(f.StatusEN),
  isProcessing:   (f: Flight) => /processing/i.test(f.StatusEN),
  isEarly:        (f: Flight) => /(earlier|ranije)/i.test(f.StatusEN),
  isCancelled:    (f: Flight) => /(cancelled|canceled|otkazan)/i.test(f.StatusEN),
  isOnTime:       (f: Flight) => /(on time|na vrijeme)/i.test(f.StatusEN),
  isDiverted:     (f: Flight) => /(diverted|preusmjeren)/i.test(f.StatusEN),
  isCheckInOpen:  (f: Flight) => /(check.?in|check-in)/i.test(f.StatusEN),
  isArrived:      (f: Flight) => /(arrived|landed|sletio|sletjelo|dolazak|stigao)/i.test(f.StatusEN),
  isGoToGate:     (f: Flight) => /(go to gate)/i.test(f.StatusEN),
  isClose:        (f: Flight) => /^close$/i.test(f.StatusEN),
  isFinalCall:    (f: Flight) => /^final call$/i.test(f.StatusEN), // ✅ #4
}

// ============================================================
// AUTO-STATUS LOGIKA
// ============================================================
const EARLY_CHECKIN_AIRLINES = new Set(["6H", "FZ"])

function parseFlightTimeToDate(timeStr: string): Date | null {
  if (!timeStr) return null
  if (timeStr.includes("T")) {
    const d = new Date(timeStr)
    return isNaN(d.getTime()) ? null : d
  }
  const clean = timeStr.replace(":", "")
  if (clean.length !== 4) return null
  const hours = parseInt(clean.substring(0, 2), 10)
  const minutes = parseInt(clean.substring(2, 4), 10)
  if (isNaN(hours) || isNaN(minutes)) return null
  const now = new Date()
  const d = new Date(now)
  d.setHours(hours, minutes, 0, 0)
  
  // ✅ #1: Midnight Rollover Fix
  if (d.getTime() < now.getTime() - 12 * 60 * 60 * 1000) {
    d.setDate(d.getDate() + 1)
  }
  
  return d
}

// ── Auto-status za DEPARTURES ────────────────────────────────
function getAutoStatus(flight: Flight): string | null {
  const status = (flight.StatusEN || "").trim()
  if (status && status !== "-") return null

  const scheduledStr = flight.ScheduledDepartureTime
  const estimatedStr = flight.EstimatedDepartureTime

  if (!scheduledStr) return null

  const scheduled = parseFlightTimeToDate(scheduledStr)
  if (!scheduled) return null

  const referenceTime = estimatedStr
    ? (parseFlightTimeToDate(estimatedStr) ?? scheduled)
    : scheduled

  const now = new Date()
  const minsToReference = (referenceTime.getTime() - now.getTime()) / 60_000

  const airlineIata = (flight.FlightNumber ?? "").substring(0, 2).toUpperCase()
  const checkInLeadMin = EARLY_CHECKIN_AIRLINES.has(airlineIata) ? 180 : 120

  if (minsToReference < -5) return null
  if (minsToReference <= 5) return "Close"
  
  // ✅ #4: Dodan Final Call status
  if (minsToReference <= 10) return "Final Call"
  
  if (minsToReference <= 30) return "Go to Gate"

  const checkInTime = new Date(scheduled.getTime() - checkInLeadMin * 60 * 1000)
  const hh = String(checkInTime.getHours()).padStart(2, "0")
  const mm = String(checkInTime.getMinutes()).padStart(2, "0")
  return `Check In at ${hh}:${mm}`
}

// ── Auto-status za ARRIVALS (Earlier/Delayed) ────────────────
function getAutoArrivalStatus(flight: Flight, formatTime: (t: string) => string): string | null {
  const status = (flight.StatusEN || "").trim()
  if (status && status !== "-") return null

  const scheduledStr = flight.ScheduledDepartureTime
  const estimatedStr = flight.EstimatedDepartureTime

  if (!scheduledStr || !estimatedStr || scheduledStr === estimatedStr) return null

  const scheduled = parseFlightTimeToDate(scheduledStr)
  const estimated = parseFlightTimeToDate(estimatedStr)

  if (!scheduled || !estimated) return null

  const diffMins = (scheduled.getTime() - estimated.getTime()) / 60_000

  if (diffMins >= 15) {
    return `Arriving early – expected at ${formatTime(estimatedStr)}`
  }

  if (diffMins <= -15) {
    return `Delayed at ${formatTime(estimatedStr)}`
  }

  return null
}

// ============================================================
// IZOLOVANI SAT
// ============================================================
const ClockDisplay = memo(function ClockDisplay({
  colorClass,
}: {
  colorClass: string
}) {
  const [time, setTime] = useState("")
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
    const tick = () =>
      setTime(new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }))
    tick()
    const id = setInterval(tick, 1_000)
    return () => clearInterval(id)
  }, [])

  if (!mounted) return <div className="text-[7rem] font-black text-white leading-none">--:--</div>

  return (
    <div className={`text-[7rem] font-black ${colorClass} drop-shadow-2xl leading-none`}>
      {time}
    </div>
  )
})

// ============================================================
// LED
// ============================================================
const LEDIndicator = memo(function LEDIndicator({
  color,
  phase = "a",
  size = "w-3 h-3",
}: {
  color: "blue" | "green" | "orange" | "red" | "yellow" | "cyan" | "purple" | "lime"
  phase?: "a" | "b"
  size?: string
}) {
  const colorMap: Record<typeof color, string> = {
    blue:   "led-blue",
    green:  "led-green",
    orange: "led-orange",
    red:    "led-red",
    yellow: "led-yellow",
    cyan:   "led-cyan",
    purple: "led-purple",
    lime:   "led-lime",
  }
  return (
    <div
      className={`${size} rounded-full led-base ${colorMap[color]} ${phase === "b" ? "led-phase-b" : ""}`}
    />
  )
})

// ============================================================
// TABLE HEADERS
// ============================================================
const TableHeaders = memo(function TableHeaders({
  headers,
  headerBg,
}: {
  headers: { label: string; width: string; icon: React.ComponentType<{ className?: string }> }[]
  headerBg: string
}) {
  return (
    <div
      className={`flex gap-2 p-2 ${headerBg} border-b-4 border-black/30 font-black text-black text-[1.3rem] uppercase tracking-wider flex-shrink-0 shadow-xl`}
    >
      {headers.map((header) => {
        const IconComponent = header.icon
        return (
          <div
            key={header.label}
            className="flex items-stretch justify-center gap-1 px-1 h-full"
            style={{ width: header.width }}
          >
            <IconComponent className="w-5 h-5 self-center" />
            <span className="truncate self-center">{header.label}</span>
          </div>
        )
      })}
    </div>
  )
})

// ============================================================
// STATUS PILL — helper za stilove
// ============================================================
const getStatusPillStyle = (flight: Flight, isArrival: boolean, formatTime: (t: string) => string) => {
  const autoArrivalStatus = isArrival ? getAutoArrivalStatus(flight, formatTime) : null
  const autoDepartureStatus = !isArrival ? getAutoStatus(flight) : null
  const autoStatus = autoArrivalStatus || autoDepartureStatus

  const effectiveFlight: Flight = autoStatus
    ? { ...flight, StatusEN: autoStatus }
    : flight

  const isCancelledFlight    = checkStatus.isCancelled(effectiveFlight)
  const isDelayedFlight      = checkStatus.isDelayed(effectiveFlight)
  const isBoardingFlight     = !isArrival && checkStatus.isBoarding(effectiveFlight)
  const isProcessingFlight   = checkStatus.isProcessing(effectiveFlight)
  const isEarlyFlight        = checkStatus.isEarly(effectiveFlight)
  const isOnTimeFlight       = checkStatus.isOnTime(effectiveFlight)
  const isDivertedFlight     = checkStatus.isDiverted(effectiveFlight)
  const isCheckInOpenFlight  = checkStatus.isCheckInOpen(effectiveFlight)
  const isArrivedFlight      = isArrival && checkStatus.isArrived(effectiveFlight)
  const isGoToGateFlight     = !isArrival && checkStatus.isGoToGate(effectiveFlight)
  const isCloseFlight        = !isArrival && checkStatus.isClose(effectiveFlight)
  const isFinalCallFlight    = !isArrival && checkStatus.isFinalCall(effectiveFlight) // ✅ #4

  let statusDisplayText = effectiveFlight.StatusEN || ""
  if (isProcessingFlight) statusDisplayText = "Check-In"
  if (isArrivedFlight) {
    const t =
      effectiveFlight.EstimatedDepartureTime ||
      effectiveFlight.ScheduledDepartureTime  ||
      effectiveFlight.ActualDepartureTime
    statusDisplayText = `Arrived at ${t ? formatTime(t) : ""}`
  }

  const hasStatusText = !!effectiveFlight.StatusEN?.trim()

  const shouldBlink =
    isArrivedFlight  ||
    isCancelledFlight ||
    isBoardingFlight  ||
    isGoToGateFlight  ||
    isCloseFlight     ||
    isFinalCallFlight // ✅ #4

  const showLEDs =
    isBoardingFlight    ||
    isProcessingFlight  ||
    isCheckInOpenFlight ||
    isArrivedFlight     ||
    isCancelledFlight   ||
    isDivertedFlight    ||
    isDelayedFlight     ||
    isEarlyFlight       ||
    isGoToGateFlight    ||
    isCloseFlight       ||
    isFinalCallFlight   // ✅ #4

  type LEDColor = "blue" | "green" | "orange" | "red" | "yellow" | "cyan" | "purple" | "lime"
  let bg         = "bg-white/10"
  let border     = "border-white/30"
  let text       = "text-white"
  let led1: LEDColor = "blue"
  let led2: LEDColor = "green"
  let blinkClass = ""

  if (isCancelledFlight) {
    bg = "bg-red-500/20"; border = "border-red-500/50"; text = "text-red-100"
    led1 = "red"; led2 = "orange"
    blinkClass = "animate-pill-blink"

  } else if (isCloseFlight) {
    bg = "bg-red-600/30"; border = "border-red-500/70"; text = "text-red-100"
    led1 = "red"; led2 = "orange"
    blinkClass = "animate-pill-blink-fast"

  // ✅ #4: Final Call stilovi
  } else if (isFinalCallFlight) {
    bg = "bg-orange-600/30"; border = "border-orange-500/70"; text = "text-orange-100"
    led1 = "orange"; led2 = "red"
    blinkClass = "animate-pill-blink-fast"

  } else if (isGoToGateFlight) {
    bg = "bg-blue-500/20"; border = "border-blue-500/50"; text = "text-blue-100"
    led1 = "blue"; led2 = "cyan"
    blinkClass = "animate-pill-blink"

  } else if (isDelayedFlight) {
    bg = "bg-yellow-500/20"; border = "border-yellow-500/50"; text = "text-yellow-100"
    led1 = "yellow"; led2 = "orange"

  } else if (isEarlyFlight) {
    bg = "bg-purple-500/20"; border = "border-purple-500/50"; text = "text-purple-100"
    led1 = "purple"; led2 = "blue"

  } else if (isBoardingFlight) {
    bg = "bg-cyan-500/20"; border = "border-cyan-500/50"; text = "text-cyan-100"
    led1 = "cyan"; led2 = "blue"
    blinkClass = "animate-pill-blink"

  } else if (isCheckInOpenFlight || isProcessingFlight) {
    bg = "bg-green-500/20"; border = "border-green-500/50"; text = "text-green-100"
    led1 = "green"; led2 = "lime"

  } else if (isDivertedFlight) {
    bg = "bg-orange-500/20"; border = "border-orange-500/50"; text = "text-orange-100"
    led1 = "orange"; led2 = "red"

  } else if (isOnTimeFlight) {
    bg = "bg-lime-500/20"; border = "border-lime-500/50"; text = "text-lime-100"
    led1 = "lime"; led2 = "green"

  } else if (isArrivedFlight) {
    bg = "bg-green-500/20"; border = "border-green-500/50"; text = "text-green-100"
    led1 = "green"; led2 = "lime"
    blinkClass = "animate-pill-blink"

  } else if (shouldBlink) {
    bg = "bg-green-500/20"; border = "border-green-500/50"; text = "text-green-100"
    led1 = "green"; led2 = "lime"
    blinkClass = "animate-pill-blink"
  }

  return {
    bg, border, text, led1, led2, blinkClass,
    showLEDs, hasStatusText, statusDisplayText,
  }
}

// ============================================================
// FLIGHT ROW
// ============================================================
const FlightRow = memo(
  function FlightRow({
    flight,
    index,
    showArrivals,
    colorTitle,
  }: {
    flight: Flight
    index: number
    showArrivals: boolean
    colorTitle: string
  }) {
    const formatTime = useCallback((timeString: string): string => {
      if (!timeString) return ""
      const c = timeString.replace(":", "")
      return c.length === 4 ? `${c.substring(0, 2)}:${c.substring(2, 4)}` : timeString
    }, [])

    const pill = useMemo(
      () => getStatusPillStyle(flight, showArrivals, formatTime),
      [flight, showArrivals, formatTime]
    )

    const logoURL = useMemo(() => getFlightawareLogoURL(flight.AirlineICAO), [flight.AirlineICAO])
    const rowColor = index % 2 === 0 ? "bg-white/15" : "bg-white/5"

    const handleImgError = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
      e.currentTarget.src = PLACEHOLDER_IMAGE
    }, [])

    // ✅ #3: Gate Change Highlighting logika
    const gateChangedAt = (flight as any)._gateChangedAt
    const isGateChanged = gateChangedAt && (Date.now() - gateChangedAt < 15000)

    const statusFontSize = showArrivals ? "text-[2rem]" : "text-[1.3rem]"
    const pillClassName = `w-[90%] flex items-center justify-center gap-3 ${statusFontSize} font-bold rounded-2xl border-2 px-3 py-1.5 transition-colors duration-300 ${pill.bg} ${pill.border} ${pill.text} ${pill.blinkClass}`

    return (
      <div
        className={`flex gap-2 p-1 border-b border-white/10 ${rowColor}`}
        style={{ minHeight: "68px", contain: "layout style" }}
      >
        {/* Scheduled */}
        <div className="flex items-center justify-center" style={{ width: "180px" }}>
          <div className="text-[2.5rem] font-black text-white drop-shadow-lg">
            {flight.ScheduledDepartureTime ? (
              formatTime(flight.ScheduledDepartureTime)
            ) : (
              <span className="text-white/40">--:--</span>
            )}
          </div>
        </div>

        {/* Estimated */}
        <div className="flex items-center justify-center" style={{ width: "180px" }}>
          {flight.EstimatedDepartureTime &&
          flight.EstimatedDepartureTime !== flight.ScheduledDepartureTime ? (
            <div className={`text-[2.5rem] font-black ${colorTitle} drop-shadow-lg`}>
              {formatTime(flight.EstimatedDepartureTime)}
            </div>
          ) : (
            <div className="text-2xl text-white/30 font-bold">-</div>
          )}
        </div>

        {/* Flight Info */}
        <div className="flex items-center gap-3" style={{ width: "280px" }}>
          <div className="relative w-[70px] h-11 bg-white rounded-xl p-1 shadow-xl flex-shrink-0">
            <img
              src={logoURL || PLACEHOLDER_IMAGE}
              alt={`${flight.AirlineName} logo`}
              className="object-contain w-full h-full"
              onError={handleImgError}
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
            {/* From */}
            <div className="flex items-center" style={{ width: "580px" }}>
              <div className="text-[3.3rem] font-black text-white truncate drop-shadow-lg">
                {flight.DestinationCityName || flight.DestinationAirportName}
              </div>
            </div>

            {/* Status — Arrivals */}
            <div className="flex items-center justify-center" style={{ width: "650px" }}>
              {pill.hasStatusText ? (
                <div
                  className={`${pillClassName} overflow-hidden relative`}
                  style={{
                    paddingLeft:  pill.showLEDs ? "3.5rem" : "1rem",
                    paddingRight: "1rem",
                    width:        "95%",
                  }}
                >
                  {pill.showLEDs && (
                    <div className="absolute left-3 top-1/2 -translate-y-1/2 flex items-center gap-1 z-10">
                      <LEDIndicator color={pill.led1} phase="a" size="w-4 h-4" />
                      <LEDIndicator color={pill.led2} phase="b" size="w-4 h-4" />
                    </div>
                  )}
                  <div
                    className="overflow-hidden text-center whitespace-nowrap"
                    style={{ marginLeft: pill.showLEDs ? "2.5rem" : "0", width: "100%" }}
                  >
                    {pill.statusDisplayText}
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
            <div className="flex items-center" style={{ width: "380px" }}>
              <div className="text-[3.3rem] font-black text-white truncate drop-shadow-lg">
                {flight.DestinationCityName || flight.DestinationAirportName}
              </div>
            </div>

            {/* Check-In */}
            <div className="flex items-center justify-center" style={{ width: "320px" }}>
              {flight.CheckInDesk && flight.CheckInDesk !== "-" ? (
                <div className="text-[2.5rem] font-black text-white bg-black/40 py-2 px-3 rounded-xl border-2 border-white/20 shadow-xl">
                  {flight.CheckInDesk}
                </div>
              ) : (
                <div className="text-[2.5rem] font-black text-transparent py-2 px-3">-</div>
              )}
            </div>

            {/* Gate — ✅ #3: Sa Gate Change Highlighting */}
            <div className="flex items-center justify-center" style={{ width: "180px" }}>
              {flight.GateNumber && flight.GateNumber !== "-" ? (
                <div className={`text-[2.5rem] font-black py-2 px-3 rounded-xl border-2 shadow-xl
                  ${isGateChanged 
                    ? "text-red-500 bg-red-500/20 border-red-400 animate-pill-blink-fast" 
                    : "text-white bg-black/40 border-white/20"}`}>
                  {flight.GateNumber}
                </div>
              ) : (
                <div className="text-[2.5rem] font-black text-transparent py-2 px-3">-</div>
              )}
            </div>

            {/* Status — Departures */}
            <div className="flex items-center justify-center" style={{ width: "420px" }}>
              {pill.hasStatusText ? (
                <div className={pillClassName}>
                  {pill.showLEDs && (
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <LEDIndicator color={pill.led1} phase="a" size="w-4 h-4" />
                      <LEDIndicator color={pill.led2} phase="b" size="w-4 h-4" />
                    </div>
                  )}
                  {pill.statusDisplayText}
                </div>
              ) : (
                <div className="text-[1.3rem] font-bold text-slate-300">Scheduled</div>
              )}
            </div>
          </>
        )}
      </div>
    )
  },
  // Custom comparator
  (prev, next) =>
    prev.flight.FlightNumber            === next.flight.FlightNumber            &&
    prev.flight.StatusEN                === next.flight.StatusEN                &&
    (prev.flight as any)._autoStatusTick === (next.flight as any)._autoStatusTick &&
    (prev.flight as any)._gateChangedAt === (next.flight as any)._gateChangedAt &&
    prev.flight.EstimatedDepartureTime  === next.flight.EstimatedDepartureTime  &&
    prev.flight.ScheduledDepartureTime  === next.flight.ScheduledDepartureTime  &&
    prev.flight.GateNumber              === next.flight.GateNumber              &&
    prev.flight.CheckInDesk             === next.flight.CheckInDesk             &&
    prev.showArrivals                   === next.showArrivals                   &&
    prev.colorTitle                     === next.colorTitle                     &&
    prev.index                          === next.index
)

// ============================================================
// GLAVNA KOMPONENTA
// ============================================================
export default function CombinedPage(): JSX.Element {
  return (
    <FlightBoardErrorBoundary>
      <FlightBoard />
    </FlightBoardErrorBoundary>
  )
}

function FlightBoard(): JSX.Element {
  const [arrivals, setArrivals]                   = useState<Flight[]>([])
  const [departures, setDepartures]               = useState<Flight[]>([])
  const [loading, setLoading]                     = useState<boolean>(true)
  const [showArrivals, setShowArrivals]           = useState<boolean>(true)
  const [lastUpdate, setLastUpdate]               = useState<string>("")
  const [currentLanguageIndex, setCurrentLanguageIndex] = useState<number>(0)
  const [currentMessageIndex, setCurrentMessageIndex]   = useState<number>(0)
  const [errorMessage, setErrorMessage]           = useState<string | null>(null)
  const [isRecovering, setIsRecovering]           = useState<boolean>(false)

  const [autoStatusTick, setAutoStatusTick] = useState<number>(0)

  const isMountedRef   = useRef(true)
  const lastHeartbeat  = useRef(Date.now())
  
  // ✅ #3: Ref za praćenje promjene Gate-ova
  const prevGatesRef = useRef<Record<string, string>>({})

  const currentColors = useMemo(
    () => (showArrivals ? COLOR_CONFIG.arrivals : COLOR_CONFIG.departures),
    [showArrivals]
  )

  useEffect(() => {
    const id = setInterval(() => {
      setAutoStatusTick((t) => t + 1)
    }, 60_000)
    return () => clearInterval(id)
  }, [])

  // ✅ #5: Hard Reset za Kiosk/TV svakih 6 sati
  useEffect(() => {
    const id = setTimeout(() => {
      console.log("🔄 Scheduled hard reset (6h)...")
      if ((window as any).electronAPI?.restartApp) {
        ;(window as any).electronAPI.restartApp()
      } else {
        window.location.reload()
      }
    }, HARD_RESET_INTERVAL_MS)
    return () => clearTimeout(id)
  }, [])

  const formatTime = useCallback((timeString: string): string => {
    if (!timeString) return ""
    const clean = timeString.replace(":", "")
    return clean.length === 4 ? `${clean.substring(0, 2)}:${clean.substring(2, 4)}` : timeString
  }, [])

  const sortFlightsByScheduledTime = useCallback(
    (flights: Flight[]): Flight[] =>
      [...flights].sort((a, b) =>
        (a.ScheduledDepartureTime || "99:99").localeCompare(b.ScheduledDepartureTime || "99:99")
      ),
    []
  )

  const filterRecentFlights = useCallback((flights: Flight[], isArrivals: boolean): Flight[] => {
    const now = new Date()
    return flights.filter((flight) => {
      // ✅ #6: Napredni filter za skrivanje privatnih letova
      const flightNum = (flight.FlightNumber || "").toUpperCase()
      if (HIDDEN_FLIGHT_PATTERNS.some(p => flightNum.includes(p))) return false

      const status    = flight.StatusEN?.toLowerCase() || ""
      const isArrived = checkStatus.isArrived(flight)
      const isDeparted =
        !checkStatus.isDelayed(flight) &&
        (status.includes("departed") || status.includes("poletio") || status.includes("take off"))

      if (!isArrived && !isDeparted) return true

      const timeStr =
        flight.EstimatedDepartureTime ||
        flight.ScheduledDepartureTime  ||
        flight.ActualDepartureTime
      if (!timeStr) return !isArrived && !isDeparted

      const flightTime = parseDepartureTimeLocal(timeStr)
      if (!flightTime) return false

      const minutesDiff = Math.floor((now.getTime() - flightTime.getTime()) / 60_000)

      if (isArrivals  && isArrived)  return minutesDiff <= 20
      if (!isArrivals && isDeparted) return minutesDiff <= 20
      return true
    })
  }, [])

  useEffect(() => {
    const update = () => { lastHeartbeat.current = Date.now() }
    const check  = setInterval(() => {
      if (Date.now() - lastHeartbeat.current > HEARTBEAT_TIMEOUT_MS) {
        console.warn("⚠️ Heartbeat timeout — reloading")
        window.location.reload()
      }
    }, HEARTBEAT_CHECK_INTERVAL_MS)
    window.addEventListener("mousemove",  update, { passive: true })
    window.addEventListener("keypress",   update, { passive: true })
    window.addEventListener("touchstart", update, { passive: true })
    return () => {
      clearInterval(check)
      window.removeEventListener("mousemove",  update)
      window.removeEventListener("keypress",   update)
      window.removeEventListener("touchstart", update)
    }
  }, [])

  useEffect(() => {
    const onError = (e: ErrorEvent) => {
      console.error("Global error:", e.error)
      const msg = e.error?.message || ""
      if (
        msg.includes("Out of memory")  ||
        msg.includes("stack overflow") ||
        msg.includes("JavaScript heap")
      ) {
        setErrorMessage("Critical error. Restarting...")
        setTimeout(() => window.location.reload(), 2_000)
      }
    }
    const onRejection = (e: PromiseRejectionEvent) => {
      console.error("Unhandled rejection:", e.reason)
      const msg = e.reason?.message || ""
      if (msg.includes("network") || msg.includes("fetch")) {
        setErrorMessage("Network error. Retrying...")
        setTimeout(() => setErrorMessage(null), 5_000)
      }
    }
    window.addEventListener("error",             onError)
    window.addEventListener("unhandledrejection", onRejection)
    return () => {
      window.removeEventListener("error",             onError)
      window.removeEventListener("unhandledrejection", onRejection)
    }
  }, [])

  useEffect(() => {
    const id = setInterval(() => {
      setArrivals(  (prev) => (prev.length > 20 ? prev.slice(0, MAX_FLIGHTS_MEMORY) : prev))
      setDepartures((prev) => (prev.length > 20 ? prev.slice(0, MAX_FLIGHTS_MEMORY) : prev))
      if ((window as any).gc) (window as any).gc()
    }, MEMORY_CLEANUP_INTERVAL_MS)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    let recoveryTimeout: ReturnType<typeof setTimeout>
    const id = setInterval(() => {
      if (!loading && arrivals.length === 0 && departures.length === 0 && !isRecovering) {
        setIsRecovering(true)
        recoveryTimeout = setTimeout(() => {
          if (arrivals.length === 0 && departures.length === 0) {
            window.location.reload()
          }
          setIsRecovering(false)
        }, 30_000)
      }
    }, 10_000)
    return () => {
      clearInterval(id)
      clearTimeout(recoveryTimeout)
    }
  }, [loading, arrivals.length, departures.length, isRecovering])

  useEffect(() => {
    const id = setInterval(
      () => setCurrentLanguageIndex((p) => (p + 1) % Object.keys(LANGUAGE_CONFIG).length),
      4_000
    )
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    const id = setInterval(
      () => setCurrentMessageIndex((p) => (p + 1) % SECURITY_MESSAGES.length),
      20_000
    )
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    isMountedRef.current = true
    let timeoutId: ReturnType<typeof setTimeout>

    const loadFlights = async (): Promise<void> => {
      if (!isMountedRef.current) return
      let data: FlightDataResponse | null = null
      let usedCache = false

      try {
        setLoading(true)
        setErrorMessage(null)

        try {
          data = await fetchWithRetry("/api/flights", MAX_RETRIES, RETRY_DELAY_MS)
          if (data && isMountedRef.current) saveToCache(data)
        } catch (fetchError) {
          console.error("Fetch failed, trying cache:", fetchError)
          setErrorMessage("Network error. Using cached data.")
          const cached = loadFromCache()
          if (cached) {
            data      = cached
            usedCache = true
          } else {
            throw fetchError
          }
        }

        if (!isMountedRef.current || !data) return

        const filteredArrivals   = filterRecentFlights(data.arrivals, true).slice(0, MAX_FLIGHTS_DISPLAY)
        const rawDepartures = getUniqueDeparturesWithDeparted(
          filterRecentFlights(data.departures, false)
        ).slice(0, MAX_FLIGHTS_DISPLAY)

        // ✅ #3: Detekcija promjene Gate-a
        const departuresWithGateChange = rawDepartures.map(f => {
          const flightClone = { ...f }
          const flightNum = f.FlightNumber ?? ""
          const prevGate = prevGatesRef.current[flightNum]
          
          if (prevGate && f.GateNumber && prevGate !== f.GateNumber) {
            (flightClone as any)._gateChangedAt = Date.now()
          }
          
          if (f.GateNumber && f.GateNumber !== "-") {
            prevGatesRef.current[flightNum] = f.GateNumber
          }
          
          return flightClone
        })

        setArrivals(filteredArrivals)
        setDepartures(departuresWithGateChange)
        setLastUpdate(new Date().toLocaleTimeString("en-GB"))

        if (usedCache) {
          setTimeout(() => setErrorMessage(null), 5_000)
        } else {
          setErrorMessage(null)
        }
      } catch (error) {
        console.error("❌ Critical error:", error)
        setErrorMessage("Unable to load flight data. Check connection.")
      } finally {
        if (isMountedRef.current) {
          setLoading(false)
          timeoutId = setTimeout(loadFlights, REFRESH_INTERVAL_MS)
        }
      }
    }

    loadFlights()

    return () => {
      isMountedRef.current = false
      clearTimeout(timeoutId)
    }
  }, [filterRecentFlights])

  useEffect(() => {
    const id = setInterval(() => setShowArrivals((p) => !p), 20_000)
    return () => clearInterval(id)
  }, [])

  const handleClose = useCallback(() => {
    if ((window as any).electronAPI?.quitApp) {
      ;(window as any).electronAPI.quitApp()
      return
    }
    try {
      if ((window as any).chrome?.webview) {
        ;(window as any).chrome.webview.postMessage("APP_QUIT")
        return
      }
    } catch {}
    window.postMessage({ type: "ELECTRON_APP_QUIT" }, "*")
    try {
      if (window.parent !== window) window.parent.postMessage({ type: "ELECTRON_APP_QUIT" }, "*")
    } catch {}
    window.location.reload()
  }, [])

  const currentLanguage = useMemo(() => {
    const langs = Object.keys(LANGUAGE_CONFIG)
    return LANGUAGE_CONFIG[langs[currentLanguageIndex] as keyof typeof LANGUAGE_CONFIG]
  }, [currentLanguageIndex])

  const title    = useMemo(() => (showArrivals ? currentLanguage.arrivals    : currentLanguage.departures),    [showArrivals, currentLanguage])
  const subtitle = useMemo(() => (showArrivals ? currentLanguage.incomingFlights : currentLanguage.outgoingFlights), [showArrivals, currentLanguage])

  const ArrivalIcon = useCallback(
    ({ className = "w-5 h-5" }: { className?: string }) => (
      <Plane className={`${className} text-orange-500 rotate-90`} />
    ),
    []
  )
  const DepartureIcon = useCallback(
    ({ className = "w-5 h-5" }: { className?: string }) => (
      <Plane className={`${className} text-orange-500`} />
    ),
    []
  )

  const tableHeaders = useMemo(() => {
    const t = currentLanguage.tableHeaders
    if (showArrivals) {
      return [
        { label: t.scheduled, width: "180px", icon: Clock      },
        { label: t.estimated, width: "180px", icon: Clock      },
        { label: t.flight,    width: "240px", icon: ArrivalIcon },
        { label: t.from,      width: "480px", icon: MapPin     },
        { label: t.status,    width: "620px", icon: Info       },
      ]
    }
    return [
      { label: t.scheduled,   width: "180px", icon: Clock       },
      { label: t.estimated,   width: "180px", icon: Clock       },
      { label: t.flight,      width: "240px", icon: DepartureIcon },
      { label: t.destination, width: "380px", icon: MapPin      },
      { label: t.checkIn,     width: "320px", icon: Users       },
      { label: t.gate,        width: "180px", icon: DoorOpen    },
      { label: t.status,      width: "420px", icon: Info        },
    ]
  }, [showArrivals, currentLanguage, ArrivalIcon, DepartureIcon])

  const departuresWithTick = useMemo(
    () =>
      departures.map((f) =>
        ({ ...f, _autoStatusTick: autoStatusTick } as unknown as Flight)
      ),
    [departures, autoStatusTick]
  )

  const currentFlightsWithTick = useMemo(
    () => (showArrivals ? arrivals : departuresWithTick),
    [showArrivals, arrivals, departuresWithTick]
  )

  const sortedCurrentFlightsWithTick = useMemo(
    () => sortFlightsByScheduledTime(currentFlightsWithTick).slice(0, MAX_FLIGHTS_DISPLAY),
    [currentFlightsWithTick, sortFlightsByScheduledTime]
  )

  return (
    <div
      className={`h-screen ${currentColors.background} text-white p-4 transition-colors duration-700 flex flex-col select-none`}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => e.preventDefault()}
    >
      {errorMessage && (
        <div className="fixed bottom-4 left-4 right-4 md:left-auto md:right-4 md:bottom-4 bg-red-500/90 text-white px-4 py-3 rounded-lg text-sm z-50 shadow-lg animate-pulse">
          ⚠️ {errorMessage}
        </div>
      )}

      <button
        onClick={handleClose}
        className="absolute top-6 right-6 w-10 h-10 flex items-center justify-center rounded-full bg-black/40 hover:bg-black/60 active:bg-black/80 text-white shadow-2xl cursor-pointer z-50 transition-all duration-200 hover:scale-110 active:scale-95 border-2 border-white/20"
        title="Close App"
        type="button"
      >
        <span className="text-2xl font-bold leading-none flex items-center justify-center w-full h-full pointer-events-none">
          ×
        </span>
      </button>

      <div className="w-full mx-auto mb-4 flex-shrink-0">
        <div className="flex justify-between items-center gap-4">
          <div className="flex items-center gap-6">
            <div className={`p-4 bg-transparent rounded-2xl shadow-2xl border-2 border-orange-500`}>
              {showArrivals ? (
                <Plane className="w-16 h-16 text-orange-500 rotate-90" />
              ) : (
                <Plane className="w-16 h-16 text-orange-500" />
              )}
            </div>
            <div>
              <h1 className={`text-[6rem] font-black ${currentColors.title} leading-none tracking-tight drop-shadow-2xl`}>
                {title}
              </h1>
              <p className={`${currentColors.subtitle} text-2xl mt-2 font-semibold`}>{subtitle}</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <ClockDisplay colorClass="text-white" />
            <div className={`w-6 h-6 rounded-full ${currentColors.accent} animate-pulse shadow-2xl flex-shrink-0`} />
          </div>
        </div>
      </div>

      <div className="w-full mx-auto flex-1 min-h-0">
        {loading && sortedCurrentFlightsWithTick.length === 0 ? (
          <div className="text-center p-8 h-full flex items-center justify-center">
            <div className="inline-flex items-center gap-4">
              <div className={`w-8 h-8 border-4 ${currentColors.border} border-t-transparent rounded-full animate-spin`} />
              <span className="text-2xl text-white font-semibold">Loading flight information...</span>
            </div>
          </div>
        ) : (
          <div
            className={`${currentColors.cardBg} rounded-3xl border-4 border-white/20 shadow-2xl overflow-hidden h-full flex flex-col`}
          >
            <TableHeaders headers={tableHeaders} headerBg={currentColors.header} />

            <div className="flex-1 overflow-y-auto">
              {sortedCurrentFlightsWithTick.length === 0 ? (
                <div className="p-8 text-center text-white/60 h-full flex flex-col items-center justify-center">
                  <Plane className="w-16 h-16 mx-auto mb-4 opacity-50" />
                  <div className="text-2xl font-semibold">No {title.toLowerCase()} scheduled</div>
                </div>
              ) : (
                sortedCurrentFlightsWithTick.map((flight, index) => (
                  <FlightRow
                    key={`${flight.FlightNumber}-${flight.ScheduledDepartureTime}-${index}`}
                    flight={flight}
                    index={index}
                    showArrivals={showArrivals}
                    colorTitle={currentColors.title}
                  />
                ))
              )}
            </div>
          </div>
        )}
      </div>

      {/* ✅ #2: Animirani Ticker za sigurnosne poruke */}
      <div className="w-full mx-auto mt-4 flex-shrink-0 overflow-hidden bg-black/30 rounded-full border-2 border-white/10 h-10 relative">
        <div className="ticker-wrap">
          <div className={`ticker-move ${currentColors.title} font-bold text-xl flex items-center h-full`}>
            {SECURITY_MESSAGES.map((msg, i) => (
              <span key={i} className="mx-8 whitespace-nowrap">{msg.text}</span>
            ))}
            {SECURITY_MESSAGES.map((msg, i) => (
              <span key={`dup-${i}`} className="mx-8 whitespace-nowrap">{msg.text}</span>
            ))}
          </div>
        </div>
      </div>

      <style jsx global>{`
        #__next, body, html { height: 100vh }
        * { -webkit-font-smoothing: antialiased }

        .led-base {
          will-change: opacity, box-shadow;
          animation: 1s ease-in-out infinite alternate led-pulse;
        }
        .led-phase-b { animation-delay: .5s }
        .led-blue   { background: #1e3a5f }
        .led-green  { background: #14532d }
        .led-orange { background: #7c2d12 }
        .led-red    { background: #7f1d1d }
        .led-yellow { background: #713f12 }
        .led-cyan   { background: #164e63 }
        .led-purple { background: #4a1d96 }
        .led-lime   { background: #365314 }

        @keyframes led-pulse { 0% { opacity: .25; box-shadow: none } 100% { opacity: 1 } }

        @keyframes led-pulse-blue   { 100% { background: #60a5fa; box-shadow: 0 0 8px #60a5fa88 } }
        @keyframes led-pulse-green  { 100% { background: #4ade80; box-shadow: 0 0 8px #4ade8088 } }
        @keyframes led-pulse-orange { 100% { background: #fb923c; box-shadow: 0 0 8px #fb923c88 } }
        @keyframes led-pulse-red    { 100% { background: #f87171; box-shadow: 0 0 8px #f8717188 } }
        @keyframes led-pulse-yellow { 100% { background: #facc15; box-shadow: 0 0 8px #facc1588 } }
        @keyframes led-pulse-cyan   { 100% { background: #22d3ee; box-shadow: 0 0 8px #22d3ee88 } }
        @keyframes led-pulse-purple { 100% { background: #a78bfa; box-shadow: 0 0 8px #a78bfa88 } }
        @keyframes led-pulse-lime   { 100% { background: #a3e635; box-shadow: 0 0 8px #a3e63588 } }

        .led-blue.led-base:not(.led-phase-b)   { animation-name: led-pulse-blue   }
        .led-green.led-base:not(.led-phase-b)  { animation-name: led-pulse-green  }
        .led-orange.led-base:not(.led-phase-b) { animation-name: led-pulse-orange }
        .led-red.led-base:not(.led-phase-b)    { animation-name: led-pulse-red    }
        .led-yellow.led-base:not(.led-phase-b) { animation-name: led-pulse-yellow }
        .led-cyan.led-base:not(.led-phase-b)   { animation-name: led-pulse-cyan   }
        .led-purple.led-base:not(.led-phase-b) { animation-name: led-pulse-purple }
        .led-lime.led-base:not(.led-phase-b)   { animation-name: led-pulse-lime   }

        @keyframes pill-blink {
          0%, 50%  { opacity: 1    }
          51%, 100% { opacity: .75 }
        }
        @keyframes pill-blink-fast {
          0%, 40%  { opacity: 1    }
          41%, 100% { opacity: .55 }
        }
        .animate-pill-blink      { animation: .8s ease-in-out infinite pill-blink;      will-change: opacity }
        .animate-pill-blink-fast { animation: .4s ease-in-out infinite pill-blink-fast; will-change: opacity }

        /* ✅ #2: Ticker CSS */
        .ticker-wrap { width: 100%; overflow: hidden; position: absolute; top: 0; left: 0; height: 100%; }
        .ticker-move { display: inline-block; white-space: nowrap; animation: ticker-scroll 45s linear infinite; }
        @keyframes ticker-scroll { 0% { transform: translateX(0); } 100% { transform: translateX(-50%); } }

        @media (prefers-reduced-motion: reduce) {
          .animate-blink,
          .animate-pill-blink,
          .animate-pill-blink-fast,
          .animate-pulse,
          .animate-spin,
          .led-base,
          .ticker-move { animation: none !important; opacity: 1 !important }
        }

        ::-webkit-scrollbar       { width: 6px }
        ::-webkit-scrollbar-track { background: rgba(0,0,0,.3); border-radius: 3px }
        ::-webkit-scrollbar-thumb { background: rgba(255,255,255,.4); border-radius: 3px }
        ::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,.6) }

        body, html { overflow: hidden; margin: 0; padding: 0 }
        .flight-row-contain { contain: layout style }
      `}</style>
    </div>
  )
}