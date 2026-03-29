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
import { AlertCircle, Info, Plane, Clock, MapPin, Users, Luggage, DoorOpen, Cloud } from "lucide-react"
import WeatherIcon from "@/components/weather-icon"
import { useWeather } from "@/hooks/use-weather"

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

// ⚡ POZADINSKE BOJE — bez backdrop-blur za niski GPU teret
const COLOR_CONFIG = {
  arrivals: {
    // Solidna poluprovidna pozadina umjesto backdrop-blur
    background: "bg-gradient-to-br from-blue-950 via-blue-900 to-blue-950",
    accent: "bg-cyan-400",
    header: "bg-white",
    title: "text-white",
    subtitle: "text-cyan-200",
    border: "border-cyan-400",
    cardBg: "bg-blue-900/80", // <-- solidno, bez blur
  },
  departures: {
    background: "bg-gradient-to-br from-[#1F0218] via-[#7D185E] to-[#1F0218]",
    accent: "bg-purple-500",
    header: "bg-yellow-400",
    title: "text-yellow-400",
    subtitle: "text-purple-200",
    border: "border-purple-500",
    cardBg: "bg-[#3a0a30]/80", // <-- solidno, bez blur
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
      weather: "Weather",
      terminal: "Ter.",
      checkIn: "Check-In",
      gate: "Gate",
      status: "Status",
      baggageBelt: "Baggage Belt",
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
      weather: "Vrijeme",
      terminal: "Ter.",
      checkIn: "Check-In",
      gate: "Izlaz",
      status: "Status",
      baggageBelt: "Traka za prtljag",
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
      weather: "Wetter",
      terminal: "Ter.",
      checkIn: "Check-In",
      gate: "Gate",
      status: "Status",
      baggageBelt: "Gepäckband",
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
      weather: "Météo",
      terminal: "Ter.",
      checkIn: "Enregist.",
      gate: "Porte",
      status: "Statut",
      baggageBelt: "Tapis à bagages",
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
      weather: "מזג אוויר",
      terminal: "טרמינל",
      checkIn: "צ׳ק-אין",
      gate: "שער",
      status: "סטטוס",
      baggageBelt: "מסוע מזוודות",
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
      weather: "Hava Durumu",
      terminal: "Ter.",
      checkIn: "Check-in",
      gate: "Kapı",
      status: "Durum",
      baggageBelt: "Bagaj Bandı",
    },
  },
}

// Poruke za security announcement
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
// ERROR BOUNDARY — spriječava bijeli/prazan ekran
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
    // Auto-recovery nakon 10 sekundi
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
    
    // 🔥 UKLONI SVE LOGIKE ZA DODAVANJE DANA
    // Vrijeme je uvijek današnje
    
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
  isDelayed: (f: Flight) => /(delay|kasni)/i.test(f.StatusEN),
  isBoarding: (f: Flight) => /(boarding|gate open)/i.test(f.StatusEN),
  isProcessing: (f: Flight) => /processing/i.test(f.StatusEN),
  isEarly: (f: Flight) => /(earlier|ranije)/i.test(f.StatusEN),
  isCancelled: (f: Flight) => /(cancelled|canceled|otkazan)/i.test(f.StatusEN),
  isOnTime: (f: Flight) => /(on time|na vrijeme)/i.test(f.StatusEN),
  isDiverted: (f: Flight) => /(diverted|preusmjeren)/i.test(f.StatusEN),
  isCheckInOpen: (f: Flight) => /(check.?in)/i.test(f.StatusEN),
  // 🔥 POPRAVLJENO: prepoznaje "Arrived", "Arrived at 12:47", "Landed", "Sletio", itd.
  isArrived: (f: Flight) => /arrived|landed|sletio|sletjelo|dolazak|stigao/i.test(f.StatusEN),
  isDeparted: (f: Flight) => /departed|poletio|take off/i.test(f.StatusEN),
}

// ============================================================
// IZOLOVANI SAT — rerenderira samo sebe, nikad cijelu stranicu
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
// LED — čisto CSS animacija, NULA JS state-a
// ============================================================
const LEDIndicator = memo(function LEDIndicator({
  color,
  phase = "a",
  size = "w-3 h-3",
}: {
  color: "blue" | "green" | "orange" | "red" | "yellow" | "cyan" | "purple" | "lime"
  phase?: "a" | "b" // "a" pali na pari, "b" pali na neparnom taktu
  size?: string
}) {
  const colorMap: Record<typeof color, string> = {
    blue: "led-blue",
    green: "led-green",
    orange: "led-orange",
    red: "led-red",
    yellow: "led-yellow",
    cyan: "led-cyan",
    purple: "led-purple",
    lime: "led-lime",
  }
  return (
    <div
      className={`${size} rounded-full led-base ${colorMap[color]} ${phase === "b" ? "led-phase-b" : ""}`}
    />
  )
})

// ============================================================
// WEATHER DISPLAY
// ============================================================
const WeatherDisplay = memo(function WeatherDisplay({
  flight,
}: {
  flight: Flight
}) {
  const destination = useMemo(
    () => ({
      cityName: flight.DestinationCityName,
      airportCode: flight.DestinationAirportCode,
      airportName: flight.DestinationAirportName,
    }),
    [flight.DestinationCityName, flight.DestinationAirportCode, flight.DestinationAirportName]
  )
  const weather = useWeather(destination, 0)

  if (weather.loading) {
    return (
      <div className="flex items-center justify-center w-full h-full">
        <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
      </div>
    )
  }
  if (weather.error || !weather.weatherCode || weather.temperature == null) {
    return (
      <div className="flex items-center justify-center w-full h-full">
        <Cloud className="w-5 h-5 text-white/30" />
      </div>
    )
  }
  return (
    <div className="flex items-center justify-center w-full h-full">
      <WeatherIcon code={weather.weatherCode} temperature={weather.temperature} size={18} textSize={24} />
    </div>
  )
})

// ============================================================
// TABLE HEADERS — memorizovano, ne rerenderuje se bez promjene
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
// STATUS PILL — helper za stilove (čisto računanje, bez side-effecta)
// ============================================================
const getStatusPillStyle = (flight: Flight, isArrival: boolean, formatTime: (t: string) => string) => {
  const isCancelledFlight = checkStatus.isCancelled(flight)
  const isDelayedFlight = checkStatus.isDelayed(flight)
  const isBoardingFlight = !isArrival && checkStatus.isBoarding(flight)
  const isProcessingFlight = checkStatus.isProcessing(flight)
  const isEarlyFlight = checkStatus.isEarly(flight)
  const isOnTimeFlight = checkStatus.isOnTime(flight)
  const isDivertedFlight = checkStatus.isDiverted(flight)
  const isCheckInOpenFlight = checkStatus.isCheckInOpen(flight)
  const isArrivedFlight = isArrival && checkStatus.isArrived(flight)

  let statusDisplayText = flight.StatusEN || ""
  if (isProcessingFlight) statusDisplayText = "Check-In"
  if (isArrivedFlight) {
    const t =
      flight.EstimatedDepartureTime || flight.ScheduledDepartureTime || flight.ActualDepartureTime
    statusDisplayText = `Arrived at ${t ? formatTime(t) : ""}`
  }

  const hasStatusText = !!flight.StatusEN?.trim()

  // shouldBlink → CSS klasa, ne JS interval
  const shouldBlink = isArrivedFlight || isCancelledFlight || isBoardingFlight
  const showLEDs =
    isBoardingFlight ||
    isProcessingFlight ||
    isCheckInOpenFlight ||
    isArrivedFlight ||
    isCancelledFlight ||
    isDivertedFlight ||
    isDelayedFlight

  type LEDColor = "blue" | "green" | "orange" | "red" | "yellow" | "cyan" | "purple" | "lime"
  let bg = "bg-white/10"
  let border = "border-white/30"
  let text = "text-white"
  let led1: LEDColor = "blue"
  let led2: LEDColor = "green"
  let blinkClass = ""

  if (isCancelledFlight) {
    bg = "bg-red-500/20"; border = "border-red-500/50"; text = "text-red-100"
    led1 = "red"; led2 = "orange"; blinkClass = shouldBlink ? "animate-pill-blink" : ""
  } else if (isDelayedFlight) {
    bg = "bg-yellow-500/20"; border = "border-yellow-500/50"; text = "text-yellow-100"
    led1 = "yellow"; led2 = "orange"
  } else if (isBoardingFlight) {
    bg = "bg-cyan-500/20"; border = "border-cyan-500/50"; text = "text-cyan-100"
    led1 = "cyan"; led2 = "blue"; blinkClass = shouldBlink ? "animate-pill-blink" : ""
  } else if (isProcessingFlight || isCheckInOpenFlight) {
    bg = "bg-green-500/20"; border = "border-green-500/50"; text = "text-green-100"
    led1 = "green"; led2 = "lime"
  } else if (isEarlyFlight) {
    bg = "bg-purple-500/20"; border = "border-purple-500/50"; text = "text-purple-100"
    led1 = "purple"; led2 = "blue"
  } else if (isDivertedFlight) {
    bg = "bg-orange-500/20"; border = "border-orange-500/50"; text = "text-orange-100"
    led1 = "orange"; led2 = "red"
  } else if (isOnTimeFlight) {
    bg = "bg-lime-500/20"; border = "border-lime-500/50"; text = "text-lime-100"
    led1 = "lime"; led2 = "green"
  } else if (isArrivedFlight) {
    bg = "bg-green-500/20"; border = "border-green-500/50"; text = "text-green-100"
    led1 = "green"; led2 = "lime"; blinkClass = shouldBlink ? "animate-pill-blink" : ""
  } else if (shouldBlink) {
    bg = "bg-green-500/20"; border = "border-green-500/50"; text = "text-green-100"
    led1 = "green"; led2 = "lime"; blinkClass = "animate-pill-blink"
  }

  return { bg, border, text, led1, led2, blinkClass, showLEDs, hasStatusText, statusDisplayText }
}

// ============================================================
// FLIGHT ROW — memorizovan, rerenderuje se SAMO kad se let promijeni
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

    const formatTerminal = useCallback((terminal?: string): string => {
      if (!terminal) return "-"
      return terminal.replace("T0", "T").replace("T", "T ")
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

    const pillClassName = `w-[90%] flex items-center justify-center gap-3 text-[2rem] font-bold rounded-2xl border-2 px-3 py-1.5 transition-colors duration-300 ${pill.bg} ${pill.border} ${pill.text} ${pill.blinkClass}`

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
        <div className="flex items-center gap-3" style={{ width: "240px" }}>
          <div className="relative w-[70px] h-11 bg-white rounded-xl p-1 shadow-xl flex-shrink-0">
            <img
              src={logoURL || PLACEHOLDER_IMAGE}
              alt={`${flight.AirlineName} logo`}
              className="object-contain w-full h-full"
              onError={handleImgError}
              decoding="async"
              // loading="lazy"
              // za prvih 5 letova:
  loading={index < 9 ? "eager" : "lazy"}
  fetchPriority={index < 8 ? "high" : "auto"}  // <-- DODAJ OVO
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
            <div className="flex items-center" style={{ width: "380px" }}>
              <div className="text-[3.3rem] font-black text-white truncate drop-shadow-lg">
                {flight.DestinationCityName || flight.DestinationAirportName}
              </div>
            </div>

            {/* Weather */}
            <div className="flex items-center justify-center" style={{ width: "120px" }}>
              <WeatherDisplay flight={flight} />
            </div>

            {/* Status — Arrivals */}
            <div className="flex items-center justify-center" style={{ width: "380px" }}>
              {pill.hasStatusText ? (
                <div
                  className={`${pillClassName} overflow-hidden relative`}
                  style={{
                    paddingLeft: pill.showLEDs ? "3.5rem" : "1rem",
                    paddingRight: "1rem",
                    width: "95%",
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

            {/* Baggage */}
            <div className="flex items-center justify-center" style={{ width: "200px" }}>
              <div className="text-[2.5rem] font-black text-white bg-black/40 py-2 px-4 rounded-xl border-2 border-white/20 shadow-xl">
                {flight.BaggageReclaim || "-"}
              </div>
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

            {/* Terminal */}
            <div className="flex items-center justify-center" style={{ width: "120px" }}>
              <div
                className={`inline-flex items-center justify-center w-16 h-16 rounded-full font-black text-[1.8rem] shadow-xl border-4
                  ${
                    flight.Terminal === "T1" || flight.Terminal === "T01"
                      ? "bg-cyan-500 text-white border-cyan-300"
                      : flight.Terminal === "T2" || flight.Terminal === "T02"
                        ? "bg-orange-500 text-white border-orange-300"
                        : "bg-black/40 text-white border-white/20"
                  }`}
              >
                {formatTerminal(flight.Terminal)}
              </div>
            </div>

            {/* Check-In */}
            <div className="flex items-center justify-center" style={{ width: "280px" }}>
              {flight.CheckInDesk && flight.CheckInDesk !== "-" ? (
                <div className="text-[2.5rem] font-black text-white bg-black/40 py-2 px-3 rounded-xl border-2 border-white/20 shadow-xl">
                  {flight.CheckInDesk}
                </div>
              ) : (
                <div className="text-[2.5rem] font-black text-transparent py-2 px-3">-</div>
              )}
            </div>

            {/* Gate */}
            <div className="flex items-center justify-center" style={{ width: "160px" }}>
              {flight.GateNumber && flight.GateNumber !== "-" ? (
                <div className="text-[2.5rem] font-black text-white bg-black/40 py-2 px-3 rounded-xl border-2 border-white/20 shadow-xl">
                  {flight.GateNumber}
                </div>
              ) : (
                <div className="text-[2.5rem] font-black text-transparent py-2 px-3">-</div>
              )}
            </div>

            {/* Status — Departures */}
            <div className="flex items-center justify-center" style={{ width: "360px" }}>
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
                <div className="text-[2rem] font-bold text-slate-300">Scheduled</div>
              )}
            </div>
          </>
        )}
      </div>
    )
  },
  // Custom comparator — rerenderuj SAMO ako su stvarno promijenjeni podaci o letu
  (prev, next) =>
    prev.flight.FlightNumber === next.flight.FlightNumber &&
    prev.flight.StatusEN === next.flight.StatusEN &&
    prev.flight.EstimatedDepartureTime === next.flight.EstimatedDepartureTime &&
    prev.flight.GateNumber === next.flight.GateNumber &&
    prev.flight.CheckInDesk === next.flight.CheckInDesk &&
    prev.flight.BaggageReclaim === next.flight.BaggageReclaim &&
    prev.showArrivals === next.showArrivals &&
    prev.colorTitle === next.colorTitle &&
    prev.index === next.index
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
  const [arrivals, setArrivals] = useState<Flight[]>([])
  const [departures, setDepartures] = useState<Flight[]>([])
  const [loading, setLoading] = useState<boolean>(true)
  const [showArrivals, setShowArrivals] = useState<boolean>(true)
  const [lastUpdate, setLastUpdate] = useState<string>("")
  const [currentLanguageIndex, setCurrentLanguageIndex] = useState<number>(0)
  const [currentMessageIndex, setCurrentMessageIndex] = useState<number>(0)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [isRecovering, setIsRecovering] = useState<boolean>(false)

  const isMountedRef = useRef(true)
  const lastHeartbeat = useRef(Date.now())

  const currentColors = useMemo(
    () => (showArrivals ? COLOR_CONFIG.arrivals : COLOR_CONFIG.departures),
    [showArrivals]
  )

  // ── Formatiranje vremena ────────────────────────────────────
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
  console.log(`[FILTER] ===== ${isArrivals ? 'ARRIVALS' : 'DEPARTURES'} at ${now.toLocaleTimeString()} =====`)
  
  const result = flights.filter((flight) => {
    const isArrived = checkStatus.isArrived(flight)
    const isDeparted = checkStatus.isDeparted(flight)

    if (!isArrived && !isDeparted) return true

    // Za dolaske koristi Aktuelno (ActualDepartureTime)
    const timeStr = flight.ActualDepartureTime || flight.EstimatedDepartureTime || flight.ScheduledDepartureTime
    if (!timeStr) return false

    const flightTime = parseDepartureTimeLocal(timeStr)
    if (!flightTime) return false

    const minutesDiff = Math.floor((now.getTime() - flightTime.getTime()) / 60_000)
    
    let shouldKeep = true
    if (isArrivals && isArrived) {
      shouldKeep = minutesDiff <= 20
      console.log(`[ARRIVAL] ${flight.FlightNumber}: status="${flight.StatusEN}", actual=${timeStr}, diff=${minutesDiff}min, KEEP=${shouldKeep}`)
    }
    
    return shouldKeep
  })
  
  console.log(`[FILTER] Result: ${result.length}/${flights.length} kept`)
  return result
}, [])

  // ── Heartbeat monitor ───────────────────────────────────────
  useEffect(() => {
    const update = () => { lastHeartbeat.current = Date.now() }
    const check = setInterval(() => {
      if (Date.now() - lastHeartbeat.current > HEARTBEAT_TIMEOUT_MS) {
        console.warn("⚠️ Heartbeat timeout — reloading")
        window.location.reload()
      }
    }, HEARTBEAT_CHECK_INTERVAL_MS)
    window.addEventListener("mousemove", update, { passive: true })
    window.addEventListener("keypress", update, { passive: true })
    window.addEventListener("touchstart", update, { passive: true })
    return () => {
      clearInterval(check)
      window.removeEventListener("mousemove", update)
      window.removeEventListener("keypress", update)
      window.removeEventListener("touchstart", update)
    }
  }, [])

  // ── Global error handler ────────────────────────────────────
  useEffect(() => {
    const onError = (e: ErrorEvent) => {
      console.error("Global error:", e.error)
      const msg = e.error?.message || ""
      if (
        msg.includes("Out of memory") ||
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
    window.addEventListener("error", onError)
    window.addEventListener("unhandledrejection", onRejection)
    return () => {
      window.removeEventListener("error", onError)
      window.removeEventListener("unhandledrejection", onRejection)
    }
  }, [])

  // ── Memory cleanup ──────────────────────────────────────────
  useEffect(() => {
    const id = setInterval(() => {
      setArrivals((prev) => (prev.length > 20 ? prev.slice(0, MAX_FLIGHTS_MEMORY) : prev))
      setDepartures((prev) => (prev.length > 20 ? prev.slice(0, MAX_FLIGHTS_MEMORY) : prev))
      if ((window as any).gc) (window as any).gc()
    }, MEMORY_CLEANUP_INTERVAL_MS)
    return () => clearInterval(id)
  }, [])

  // ── Auto-recovery ───────────────────────────────────────────
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

  // ── Language rotation ───────────────────────────────────────
  useEffect(() => {
    const id = setInterval(
      () => setCurrentLanguageIndex((p) => (p + 1) % Object.keys(LANGUAGE_CONFIG).length),
      4_000
    )
    return () => clearInterval(id)
  }, [])

  // ── Security message rotation ───────────────────────────────
  useEffect(() => {
    const id = setInterval(
      () => setCurrentMessageIndex((p) => (p + 1) % SECURITY_MESSAGES.length),
      20_000
    )
    return () => clearInterval(id)
  }, [])

  // ── Data loading ────────────────────────────────────────────
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
            data = cached
            usedCache = true
          } else {
            throw fetchError
          }
        }

        if (!isMountedRef.current || !data) return

        // Hard limit odmah na fetchu — štedi DOM memoriju
        const filteredArrivals = filterRecentFlights(data.arrivals, true).slice(0, MAX_FLIGHTS_DISPLAY)
        const filteredDepartures = getUniqueDeparturesWithDeparted(
          filterRecentFlights(data.departures, false)
        ).slice(0, MAX_FLIGHTS_DISPLAY)

        setArrivals(filteredArrivals)
        setDepartures(filteredDepartures)
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

  // ── Arrivals/Departures switch ──────────────────────────────
  useEffect(() => {
    const id = setInterval(() => setShowArrivals((p) => !p), 20_000)
    return () => clearInterval(id)
  }, [])

  // ── Close handler ───────────────────────────────────────────
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

  // ── Derived/computed values ─────────────────────────────────
  const currentFlights = useMemo(
    () => (showArrivals ? arrivals : departures),
    [showArrivals, arrivals, departures]
  )

  const sortedCurrentFlights = useMemo(
    () => sortFlightsByScheduledTime(currentFlights).slice(0, MAX_FLIGHTS_DISPLAY),
    [currentFlights, sortFlightsByScheduledTime]
  )

  const currentLanguage = useMemo(() => {
    const langs = Object.keys(LANGUAGE_CONFIG)
    return LANGUAGE_CONFIG[langs[currentLanguageIndex] as keyof typeof LANGUAGE_CONFIG]
  }, [currentLanguageIndex])

  const title = useMemo(
    () => (showArrivals ? currentLanguage.arrivals : currentLanguage.departures),
    [showArrivals, currentLanguage]
  )
  const subtitle = useMemo(
    () => (showArrivals ? currentLanguage.incomingFlights : currentLanguage.outgoingFlights),
    [showArrivals, currentLanguage]
  )

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
        { label: t.scheduled, width: "180px", icon: Clock },
        { label: t.estimated, width: "180px", icon: Clock },
        { label: t.flight, width: "240px", icon: ArrivalIcon },
        { label: t.from, width: "380px", icon: MapPin },
        { label: t.weather, width: "120px", icon: Cloud },
        { label: t.status, width: "380px", icon: Info },
        { label: t.baggageBelt, width: "200px", icon: Luggage },
      ]
    }
    return [
      { label: t.scheduled, width: "180px", icon: Clock },
      { label: t.estimated, width: "180px", icon: Clock },
      { label: t.flight, width: "240px", icon: DepartureIcon },
      { label: t.destination, width: "380px", icon: MapPin },
      { label: t.terminal, width: "120px", icon: DoorOpen },
      { label: t.checkIn, width: "280px", icon: Users },
      { label: t.gate, width: "160px", icon: DoorOpen },
      { label: t.status, width: "360px", icon: Info },
    ]
  }, [showArrivals, currentLanguage, ArrivalIcon, DepartureIcon])

  return (
    <div
      className={`h-screen ${currentColors.background} text-white p-4 transition-colors duration-700 flex flex-col select-none`}
      // Sprječava slučajni drag-and-drop / selekciju u kiosk modu
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => e.preventDefault()}
    >
      {/* Error toast */}
      {errorMessage && (
        <div className="fixed bottom-4 left-4 right-4 md:left-auto md:right-4 md:bottom-4 bg-red-500/90 text-white px-4 py-3 rounded-lg text-sm z-50 shadow-lg animate-pulse">
          ⚠️ {errorMessage}
        </div>
      )}

      {/* Close button */}
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

      {/* Header */}
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
            {/* Izolovani sat — ne uzrokuje rerenderovanje letova */}
            <ClockDisplay colorClass="text-white" />
            <div className={`w-6 h-6 rounded-full ${currentColors.accent} animate-pulse shadow-2xl flex-shrink-0`} />
          </div>
        </div>
      </div>

      {/* Flight board */}
      <div className="w-full mx-auto flex-1 min-h-0">
        {loading && sortedCurrentFlights.length === 0 ? (
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
  {sortedCurrentFlights.length === 0 ? (
    <div className="p-8 text-center text-white/60 h-full flex flex-col items-center justify-center">
      <Plane className="w-16 h-16 mx-auto mb-4 opacity-50" />
      <div className="text-2xl font-semibold">No {title.toLowerCase()} scheduled</div>
    </div>
  ) : (
    sortedCurrentFlights.map((flight, index) => (
      <FlightRow
        key={`${flight.FlightNumber}-${flight.ScheduledDepartureTime}-${showArrivals ? arrivals.length : departures.length}-${index}`}
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

      {/* Security message ticker */}
      <div className="w-full mx-auto mt-4 flex-shrink-0">
        <div className="overflow-hidden relative bg-black/30 rounded-full py-2 border-2 border-white/10">
          <div className="whitespace-nowrap text-center">
            <span className={`${currentColors.title} font-bold text-xl mx-4`}>
              {SECURITY_MESSAGES[currentMessageIndex].text}
            </span>
          </div>
        </div>
      </div>

      {/* ── CSS: GPU-only animacije, prefers-reduced-motion, LED ── */}
      <style jsx global>{`#__next,body,html{height:100vh}*{-webkit-font-smoothing:antialiased}.led-base{will-change:opacity,box-shadow;animation:1s ease-in-out infinite alternate led-pulse}.led-phase-b{animation-delay:.5s}.led-blue{background:#1e3a5f}.led-green{background:#14532d}.led-orange{background:#7c2d12}.led-red{background:#7f1d1d}.led-yellow{background:#713f12}.led-cyan{background:#164e63}.led-purple{background:#4a1d96}.led-lime{background:#365314}@keyframes led-pulse{0%{opacity:.25;box-shadow:none}100%{opacity:1}}.led-blue.led-base:not(.led-phase-b){animation-name:led-pulse-blue}.led-green.led-base:not(.led-phase-b){animation-name:led-pulse-green}.led-orange.led-base:not(.led-phase-b){animation-name:led-pulse-orange}.led-red.led-base:not(.led-phase-b){animation-name:led-pulse-red}.led-yellow.led-base:not(.led-phase-b){animation-name:led-pulse-yellow}.led-cyan.led-base:not(.led-phase-b){animation-name:led-pulse-cyan}.led-purple.led-base:not(.led-phase-b){animation-name:led-pulse-purple}.led-lime.led-base:not(.led-phase-b){animation-name:led-pulse-lime}@keyframes led-pulse-blue{100%{background:#60a5fa;box-shadow:0 0 8px #60a5fa88}}@keyframes led-pulse-green{100%{background:#4ade80;box-shadow:0 0 8px #4ade8088}}@keyframes led-pulse-orange{100%{background:#fb923c;box-shadow:0 0 8px #fb923c88}}@keyframes led-pulse-red{100%{background:#f87171;box-shadow:0 0 8px #f8717188}}@keyframes led-pulse-yellow{100%{background:#facc15;box-shadow:0 0 8px #facc1588}}@keyframes led-pulse-cyan{100%{background:#22d3ee;box-shadow:0 0 8px #22d3ee88}}@keyframes led-pulse-purple{100%{background:#a78bfa;box-shadow:0 0 8px #a78bfa88}}@keyframes led-pulse-lime{100%{background:#a3e635;box-shadow:0 0 8px #a3e63588}}@keyframes pill-blink{0%,50%{opacity:1}100%,51%{opacity:.75}}.animate-pill-blink{animation:.8s ease-in-out infinite pill-blink;will-change:opacity}@media (prefers-reduced-motion:reduce){.animate-blink,.animate-pill-blink,.animate-pulse,.animate-spin,.led-base{animation:none!important;opacity:1!important}}::-webkit-scrollbar{width:6px}::-webkit-scrollbar-track{background:rgba(0,0,0,.3);border-radius:3px}::-webkit-scrollbar-thumb{background:rgba(255,255,255,.4);border-radius:3px}::-webkit-scrollbar-thumb:hover{background:rgba(255,255,255,.6)}body,html{overflow:hidden;margin:0;padding:0}.flight-row-contain{contain:layout style}
      `}</style>
    </div>
  )
}