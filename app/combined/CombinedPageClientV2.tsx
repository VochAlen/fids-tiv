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
import { getUniqueDeparturesWithDeparted } from "@/lib/flight-service"
import { Info, Plane, Clock, MapPin, Users, DoorOpen, Wind } from "lucide-react"
import { getInitialAirlineLogoSrc, isKnownLocalLogo } from '@/lib/airline-logo';
import { useRealtimeFlightData } from '@/hooks/useRealtimeFlightData'; // ← NOVO (Faza 1)
import { useRealtimeAssignments } from '@/hooks/useRealtimeAssignments';
import { isNightHours } from '@/lib/night-hours';
import { getLastKnownDynamicNightMode } from '@/lib/ably-client';
import { useWeather } from '@/hooks/use-weather'
import WeatherIcon from '@/components/weather-icon'

// ── v4: Per-flight weather cell ──────────────────────────────
// Poziva useWeather hook za destinaciju leta. Posebna komponenta
// jer useWeather ne može biti pozvan u loop-u (Rules of Hooks).
const FlightWeatherCell = memo(function FlightWeatherCell({
  flight,
  size = 28,
  textSize = 18,
}: {
  flight: Flight;
  size?: number;
  textSize?: number;
}) {
  const weather = useWeather({
    cityName: flight.DestinationCityName,
    airportCode: flight.DestinationAirportCode,
    airportName: flight.DestinationAirportName,
  }, 0);

  if (weather.loading) {
    return (
      <div className="flex items-center justify-center" style={{ width: '180px' }}>
        <div className="w-6 h-6 border-2 border-white/20 border-t-cyan-400 rounded-full animate-spin" />
      </div>
    );
  }

  if (weather.error) {
    return (
      <div className="flex items-center justify-center" style={{ width: '180px' }}>
        <span className="text-white/20 text-xl">—</span>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center" style={{ width: '180px' }}>
      <WeatherIcon
        code={weather.weatherCode}
        temperature={weather.temperature}
        size={size}
        textSize={textSize}
      />
    </div>
  );
});

// ============================================================
// KONSTANTE
// ============================================================
const HARD_RESET_HOUR             = 3         // reload u 03:00 (ne interval)
const SOFT_RELOAD_INTERVAL_MS     = 4 * 60 * 60_000  // periodični "meki" reload svaka 4h — čisti akumuliranu memoriju/GC pritisak u kiosk browserima, ne čeka se samo 03:00
const MAX_FLIGHTS_DISPLAY         = 9
const MAX_FLIGHTS_MEMORY          = 60
const MEMORY_CLEANUP_INTERVAL_MS  = 30 * 60_000
const HEARTBEAT_TIMEOUT_MS        = 120_000
const HEARTBEAT_CHECK_INTERVAL_MS = 30_000
const PAGE_SIZE           = 8
const PAGE_ROTATE_MS      = 6_000   // svakih 6s nova stranica
const MAX_DELAY_MAP_ENTRIES = 800   // sigurnosni cap za kumulativne delay Map-e — spriječava neograničen rast ako 03:00 reset iz bilo kog razloga ne okine

// ── NOVO: assignments (desk/gate dodjele) i dalje na pollingu,
// ali sporije — real-time prelaz na Ably dolazi u Fazi 2. ──────


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
  isNightMode?: boolean
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

function computeAverageDelayMinutes(flights: Flight[]): number | null {
  const diffs: number[] = []
  flights.forEach(f => {
    const sch = parseFlightTimeToDate(f.ScheduledDepartureTime)
    const est = parseFlightTimeToDate(f.EstimatedDepartureTime)
    if (sch && est) {
      diffs.push((est.getTime() - sch.getTime()) / 60_000)
    }
  })
  if (diffs.length === 0) return null
  return Math.round((diffs.reduce((a, b) => a + b, 0) / diffs.length) * 10) / 10
}

// ── v3 FIX: getWeatherEmoji uklonjena — koristi se <WeatherIcon> SVG
// komponenta (font-independent, radi na svim kiosk uređajima bez
// obzira na instaliranost Segoe UI Emoji fonta). Vidi import gore.


// ── Auto-status logika ────────────────────────────────────────
const CHECKIN_OFFSETS: Record<string, number> = {
  "6H": 180, "FZ": 180, "LS": 150, "LY": 180, "IZ": 180, "BA": 150,
}

function getAutoStatus(flight: Flight): string | null {
  const status = (flight.StatusEN ?? "").trim()
  // v4.5 FIX: raniji uslov (`status !== "-"`) je odmah odustajao čim je API
  // vratio BILO KAKAV tekst — a "On Time"/"Scheduled" su upravo ono što API
  // (i ngrok i sekundarni izvor) najčešće vraća za let koji još nije aktivan.
  // Rezultat: getAutoStatus je VJEČNO vraćao null i tabla je uvijek prikazivala
  // sirovi "On Time" umjesto Check-In/Go to Gate/Final Call/Close. Sad se
  // auto-status i dalje računa dok god je status generički (prazan, "-",
  // "On Time", "Scheduled") — isti princip kao u getAutoArrivalStatus niže.
  const isGenericStatus = !status || status === "-" || /^(on time|na vrijeme|scheduled)$/i.test(status)
  if (!isGenericStatus) return null
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
  // v4.5 FIX: isti problem kao u getAutoStatus iznad — vidi komentar tamo.
  const isGenericStatus = !status || status === "-" || /^(on time|na vrijeme|scheduled)$/i.test(status)
  if (!isGenericStatus) return null
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
const ClockDisplay = memo(function ClockDisplay({ colorClass }: { colorClass: string }) {
  const [time, setTime] = useState("")
  useEffect(() => {
    const tick = () => setTime(new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }))
    tick(); const id = setInterval(tick, 1_000); return () => clearInterval(id)
  }, [])
  return <div className={`text-[3rem] sm:text-[7rem] font-black ${colorClass} drop-shadow-2xl leading-none`}>{time || "--:--"}</div>
})

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
      className={`${size} rounded-full ${colorMap[color]} ${phase === "a" ? "led-blink-a" : "led-blink-b"}`}
    />
  )
})
// NOVO (po zahtjevu — "Disruption Index" po uzoru na Flightradar24):
// FR24 NIJE objavio tačnu internu formulu — samo tri faktora (broj
// otkazanih letova, procenat/broj zakašnjelih letova, prosječno
// trajanje kašnjenja) i skalu 0.0-5.0. Formula ispod je RAZUMNA,
// transparentna aproksimacija tih faktora — NIJE identična FR24-ovoj
// (nepoznatoj) internoj formuli. Kalibrisana da:
//   - 0 otkazano, ~20% zakašnjelo, prosjek ~15 min -> ~1.1 (Good)
//   - 10% otkazano, ~40% zakašnjelo, prosjek ~45 min -> ~3.6 (Major)
// "Zakašnjeo" ovdje ISKLJUČUJE letove bez STVARNE procjene (Estimated
// === Scheduled, samo placeholder) — isti razlog kao popravka
// prosječnog kašnjenja ranije ove sesije (vidi computeAverageDelayMinutes/
// avgDelays useEffect) — inače bi se "nema još procjene" letovi lažno
// brojali kao "na vrijeme", vještački snižavajući index.
function computeDisruptionIndex(flights: Flight[]): { score: number; cancelled: number; delayed: number; total: number } {
  const total = flights.length;
  if (total === 0) return { score: 0, cancelled: 0, delayed: 0, total: 0 };

  let cancelled = 0;
  let delayed = 0;
  let delaySumMin = 0;

  flights.forEach(f => {
    const s = (f.StatusEN || '').toLowerCase();
    if (/(cancelled|canceled|otkazan)/.test(s)) {
      cancelled++;
      return;
    }
    const sch = parseFlightTimeToDate(f.ScheduledDepartureTime);
    const est = parseFlightTimeToDate(f.EstimatedDepartureTime);
    if (sch && est && est.getTime() !== sch.getTime()) {
      const diffMin = (est.getTime() - sch.getTime()) / 60_000;
      if (diffMin > 0) {
        delayed++;
        delaySumMin += diffMin;
      }
    }
  });

  const cancelRatio = cancelled / total;
  const delayRatio = delayed / total;
  const avgDelayOfDelayed = delayed > 0 ? delaySumMin / delayed : 0;

  const score = Math.min(5.0,
    cancelRatio * 100 * 0.05 +
    delayRatio * 100 * 0.02 +
    avgDelayOfDelayed * 0.05
  );

  return { score: Math.round(score * 10) / 10, cancelled, delayed, total };
}

function disruptionLevel(score: number): { label: string; color: string } {
  // FIX (po zahtjevu — engleski naziv, tačno prema Flightradar24 skali
  // koju si naveo): "Good traffic flow" / "Minor problems" / "Major
  // problems", ne lokalizovan naziv.
  if (score < 2.0) return { label: 'Good traffic flow', color: 'text-emerald-400' };
  if (score < 3.5) return { label: 'Minor problems', color: 'text-amber-400' };
  return { label: 'Major problems', color: 'text-red-400' };
}

const AirportStatusPill = memo(function AirportStatusPill({
  temperature, weatherCode, windSpeed, windDirection,
  avgArrivalDelay, avgDepartureDelay, disruption,
}: {
  temperature: number | null
  weatherCode: number | null
  windSpeed: number | null
  windDirection: number | null
  avgArrivalDelay: number | null
  avgDepartureDelay: number | null
  disruption: { score: number; cancelled: number; delayed: number; total: number }
}) {
  const fmtDelay = (v: number | null) =>
    v === null ? '—' : `${v > 0 ? '+' : ''}${v}m`
  const level = disruptionLevel(disruption.score)

  return (
<div className="flex flex-col gap-2 bg-black/30 backdrop-blur-sm border border-white/10 rounded-2xl px-5 py-3 shadow-xl min-w-[260px]">      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-bold tracking-wider text-white/70 uppercase">Tivat · TIV</span>
        <span className="flex items-center gap-1 text-[10px] font-bold text-emerald-400 bg-emerald-500/15 px-1.5 py-0.5 rounded-full">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" /> LIVE
        </span>
      </div>

      <div className="flex items-center gap-3">
        <span className="flex items-center gap-1.5 text-white font-bold text-base">
          <WeatherIcon code={weatherCode} temperature={temperature} size={24} textSize={16} />
        </span>
        <span className="flex items-center gap-1 text-white/70 text-sm font-mono">
          <Wind
            className="w-4 h-4"
            style={{ transform: `rotate(${windDirection ?? 0}deg)` }}
          />
          {windDirection !== null ? `${Math.round(windDirection)}°` : '--'}{' '}
          {windSpeed !== null ? `${Math.round(windSpeed)} kts` : ''}
        </span>
      </div>

      <div className="flex items-center gap-4">
        <span className="flex items-center gap-1.5 text-xs">
          <Plane className="w-3.5 h-3.5 text-white/50 rotate-90" />
          <span className="w-1.5 h-1.5 rounded-full bg-amber-400 flex-shrink-0" />
          <span className="text-white/80 font-mono font-semibold">{fmtDelay(avgArrivalDelay)}</span>
        </span>
        <span className="flex items-center gap-1.5 text-xs">
          <Plane className="w-3.5 h-3.5 text-white/50" />
          <span className="w-1.5 h-1.5 rounded-full bg-red-400 flex-shrink-0" />
          <span className="text-white/80 font-mono font-semibold">{fmtDelay(avgDepartureDelay)}</span>
        </span>
      </div>

      {/* NOVO (po zahtjevu — Disruption Index, po uzoru na Flightradar24,
          vidi opširan komentar uz computeDisruptionIndex iznad) */}
      <div className="flex items-center justify-between gap-3 pt-1.5 border-t border-white/10">
        <span className="text-[10px] font-bold tracking-wider text-white/50 uppercase">Disruption Index</span>
        <span className={`text-sm font-mono font-black ${level.color}`}>
          {disruption.score.toFixed(1)} <span className="text-[10px] font-semibold">{level.label}</span>
        </span>
      </div>
    </div>
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

    const onImgErr = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
      const img = e.currentTarget
      if (img.dataset.tried === 'local') {
        img.dataset.tried = 'fw'
        const fw = getFlightawareLogoURL(icao)
        if (fw) { img.src = fw; return }
        img.src = PLACEHOLDER_IMAGE; img.onerror = null; return
      }
      img.src = PLACEHOLDER_IMAGE; img.onerror = null
    }, [icao])

    const rowBg          = index % 2 === 0 ? "bg-white/15" : "bg-white/5"
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const gateChangedAt = flight._gateChangedAt
    // eslint-disable-next-line react-hooks/purity
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
        <div className={`hidden sm:flex gap-2 p-1 border-b border-white/10 ${rowBg}`} style={{ minHeight: '68px', contain: 'layout style paint', contentVisibility: 'auto', containIntrinsicSize: '68px' }}>
          <div className="flex items-center justify-center" style={{ width: "180px" }}>
            <div className="text-[2.5rem] font-black text-white drop-shadow-lg">
              {formatTimeString(flight.ScheduledDepartureTime) || <span className="text-white/40">--:--</span>}
            </div>
          </div>
          <div className="flex items-center justify-center" style={{ width: "180px" }}>
            {estimatedDisplay
              ? <div className={`text-[2.5rem] font-black ${colorTitle} drop-shadow-lg`}>{estimatedDisplay}</div>
              : <div className="text-2xl text-white/30 font-bold">-</div>}
          </div>
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
              <div className="flex items-center" style={{ width: "400px" }}>
                <div className="text-[3.3rem] font-black text-white truncate drop-shadow-lg">
                  {flight.DestinationCityName || flight.DestinationAirportName}
                </div>
              </div>
              <FlightWeatherCell flight={flight} />
              <div className="flex items-center justify-center" style={{ width: "640px" }}>
                {pill.hasStatusText ? (
                  <div className={`${pillCls} relative`}
                    style={{ paddingLeft: pill.showLEDs ? "3.5rem" : "1rem", paddingRight: "1rem", width: "95%" }}>
                    {pill.showLEDs && (
                      <div className="absolute left-3 top-1/2 -translate-y-1/2 flex items-center gap-1 z-10">
                        <LEDIndicator color={pill.led1} phase="a" size="w-4 h-4" />
                        <LEDIndicator color={pill.led2} phase="b" size="w-4 h-4" />
                      </div>
                    )}
                    <div className="text-center whitespace-nowrap"
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
              <div className="flex items-center" style={{ width: "320px" }}>
                <div className="text-[3.3rem] font-black text-white truncate drop-shadow-lg">
                  {flight.DestinationCityName || flight.DestinationAirportName}
                </div>
              </div>
              <div className="flex items-center justify-center" style={{ width: "260px" }}>
                {flight.CheckInDesk && flight.CheckInDesk !== "-"
                  ? <div className="text-[2.5rem] font-black text-white bg-black/40 py-2 px-3 rounded-xl border-2 border-white/20 shadow-xl">{flight.CheckInDesk}</div>
                  : <div className="text-[2.5rem] font-black text-transparent py-2 px-3">-</div>}
              </div>
              <div className="flex items-center justify-center" style={{ width: "200px" }}>
                {flight.GateNumber && flight.GateNumber !== "-"
                  ? <div className={`text-[2.5rem] font-black py-2 px-3 rounded-xl border-2 shadow-xl ${isGateChanged ? "text-red-500 bg-red-500/20 border-red-400 animate-pill-blink-fast" : "text-white bg-black/40 border-white/20"}`}>
                      {flight.GateNumber}
                    </div>
                  : <div className="text-[2.5rem] font-black text-transparent py-2 px-3">-</div>}
              </div>
              <div className="flex items-center justify-center" style={{ width: "580px" }}>
                {pill.hasStatusText ? (
                  <div className={`${pillCls} text-[1.8rem]`}>
                    {pill.showLEDs && (
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <LEDIndicator color={pill.led1} phase="a" size="w-4 h-4" />
                        <LEDIndicator color={pill.led2} phase="b" size="w-4 h-4" />
                      </div>
                    )}
                    <span className="whitespace-nowrap font-extrabold tracking-wide">{pill.displayText}</span>
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  prev.flight._gateChangedAt === next.flight._gateChangedAt &&
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
  const [showArrivals, setShowArrivals] = useState(true) // v4.3: počinje sa arrivals, pa switch na departures svakih 20s
  const [lastUpdate,   setLastUpdate]   = useState("")
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [autoStatusTick, setAutoStatusTick] = useState(0)

  const [arrivalsPage,   setArrivalsPage]   = useState(0)
  const [departuresPage, setDeparturesPage] = useState(0)
  const [pageIndex, setPageIndex] = useState(0)

  const prevGatesRef  = useRef<Record<string, string>>({})
  const isInitialLoad = useRef(true)
  // eslint-disable-next-line react-hooks/purity
  const lastHeartbeat = useRef(Date.now())

  const colors = useMemo(() => showArrivals ? COLOR_CONFIG.arrivals : COLOR_CONFIG.departures, [showArrivals])

  // ── Hard reset u 03:00 (ne interval) — NEPROMIJENJENO ─────
  useEffect(() => {
    const now   = new Date()
    const reset = new Date()
    reset.setHours(HARD_RESET_HOUR, 0, 0, 0)
    if (reset <= now) reset.setDate(reset.getDate() + 1)
    const ms = reset.getTime() - now.getTime()
    const id = setTimeout(() => window.location.reload(), ms)
    return () => clearTimeout(id)
  }, [])

  // ── Periodični "meki" reload — svaka 4h, dodatno uz 03:00 hard reset.
  // Ista logika kao u v1 fajlu: čisti akumuliranu memoriju/GC pritisak i
  // compositing layere u kiosk browserima koji rade non-stop po satima,
  // nezavisno od toga da li je izvor podataka polling ili Ably realtime. ──
  useEffect(() => {
    const id = setInterval(() => window.location.reload(), SOFT_RELOAD_INTERVAL_MS)
    return () => clearInterval(id)
  }, [])

  // ── Kiosk: prevent context menu, selection — NEPROMIJENJENO ──
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

  // ── autoStatusTick — svake 60s — NEPROMIJENJENO ───────────
  useEffect(() => {
    const id = setInterval(() => setAutoStatusTick(t => t + 1), 60_000)
    return () => clearInterval(id)
  }, [])

  // ── Language rotation — svake 4s — NEPROMIJENJENO ─────────
  useEffect(() => {
    const id = setInterval(() => setLangIdx(i => (i + 1) % LANGUAGE_KEYS.length), 4_000)
    return () => clearInterval(id)
  }, [])

  // ── v4.3: Arrivals/Departures switch — svakih 20s ──────────
  // Vraćeno: combined ekran alternira arrivals ↔ departures svakih 20s.
  // Page rotation (svakih 6s) je i dalje UKLONJENA — prikazuju se
  // samo trenutni letovi (prvih PAGE_SIZE), bez vrtenja kroz stranice.
  useEffect(() => {
    const id = setInterval(() => {
      setShowArrivals(p => !p)
    }, 20_000)
    return () => clearInterval(id)
  }, [])


  
  // ── v5: Memory pressure auto-reload ──────────────────────
  // Chrome na 24/7 kiosk ekranima polako curi memoriju (Ably
  // poruke, image cache, DOM čvorovi). Kad usedJSHeapSize pređe
  // 85% jsHeapSizeLimit (~2GB po tabu), radimo auto-reload prije
  // nego kiosk postane vidljivo spor/nezgledan.
  useEffect(() => {
    const checkMemory = () => {
      const perf = performance;
      if (perf?.memory) {
        const used = perf.memory.usedJSHeapSize;
        const limit = perf.memory.jsHeapSizeLimit;
        const pct = used / limit;
        if (pct > 0.85) {
          console.warn(`Memory pressure ${Math.round(pct * 100)}% — auto reload`);
          window.location.reload();
        }
      }
    };
    const id = setInterval(checkMemory, 60_000);
    return () => clearInterval(id);
  }, []);


  // ── v5.3: Network disconnection auto-recovery ────────────
  // Kad aerodromski WiFi/Ethernet padne, Ably pokušava reconnect
  // (svake 2s), a fallback polling pada. Kad se mreža vrati,
  // radimo full reload da sinhronizujemo React state sa serverom.
  useEffect(() => {
    const handleOnline = () => {
      console.warn('Network restored — reloading to resync state');
      window.location.reload();
    };
    const handleOffline = () => {
      console.warn('Network lost — Ably will retry, showing cached data');
    };
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // ── v5.3: Visibilitychange — auto-focus kiosk tab ────────
  // Ako neko otvori drugi prozor preko kiosk taba (Windows update
  // dialog, notifikacija), kiosk tab ode u pozadinu. Chrome ga
  // može throttlovati. Ovo vraća fokus, ili radi reload ako ne može.
  useEffect(() => {
    const handleVisibility = () => {
      if (document.hidden) {
        console.warn('Kiosk tab lost focus — attempting to refocus');
        window.focus();
        setTimeout(() => {
          if (document.hidden) {
            window.location.reload();
          }
        }, 2_000);
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, []);
// ── Heartbeat — NEPROMIJENJENO ────────────────────────────
  useEffect(() => {
    const id = setInterval(() => {
      if (Date.now() - lastHeartbeat.current > HEARTBEAT_TIMEOUT_MS) window.location.reload()
      else lastHeartbeat.current = Date.now()
    }, HEARTBEAT_CHECK_INTERVAL_MS)
    return () => clearInterval(id)
  }, [])

  // ── Memory cleanup — NEPROMIJENJENO ───────────────────────
  useEffect(() => {
    const id = setInterval(() => {
      setArrivals(p => p.length > MAX_FLIGHTS_MEMORY ? p.slice(0, MAX_FLIGHTS_MEMORY) : p)
      setDepartures(p => p.length > MAX_FLIGHTS_MEMORY ? p.slice(0, MAX_FLIGHTS_MEMORY) : p)
    }, MEMORY_CLEANUP_INTERVAL_MS)
    return () => clearInterval(id)
  }, [])

  // ── Global error handler — NEPROMIJENJENO ─────────────────
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

  // ── Filter helpers — NEPROMIJENJENO ───────────────────────
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

  // ── Pripremi letove iz sirovih podataka — NEPROMIJENJENO ──
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
      clone.CheckInDesk = adminDesk
      }

      const adminGate = assignments?.gates?.[num]
      const effectiveGate = adminGate || f.GateNumber || ""
      if (effectiveGate && effectiveGate !== "-") {
        if (prevGatesRef.current[num] && prevGatesRef.current[num] !== effectiveGate) {
       clone._gateChangedAt = Date.now()
        }
        clone.GateNumber = effectiveGate
        prevGatesRef.current[num] = effectiveGate
      }

      return clone
    })

    return { filteredArrivals, departuresWithMeta }
  }, [filterRecentFlights])

  // ── Primjenjuje samo desk/gate dodjele na već obrađene departures — NEPROMIJENJENO ──
  const applyAssignmentsOnly = useCallback((
    deps: Flight[],
    assignments: { desks: Record<string, string>; gates: Record<string, string> }
  ): Flight[] => {
    return deps.map(f => {
      const num = f.FlightNumber ?? ""
      const clone = { ...f }

      const adminDesk = assignments.desks?.[num]
      if (adminDesk) clone.CheckInDesk = adminDesk

      const adminGate = assignments.gates?.[num]
      const effectiveGate = adminGate || f.GateNumber || ""
      if (effectiveGate && effectiveGate !== "-") {
        if (prevGatesRef.current[num] && prevGatesRef.current[num] !== effectiveGate) {
        clone._gateChangedAt = Date.now()
        }
        clone.GateNumber = effectiveGate
        prevGatesRef.current[num] = effectiveGate
      }

      return clone
    })
  }, [])

  // ══════════════════════════════════════════════════════════
  // NOVO (Faza 1): Realtime flight data preko Ably umjesto pollinga
  // ══════════════════════════════════════════════════════════
  const { data: liveFlightData, connectionState } = useRealtimeFlightData('board');
  // ── Vremenska prognoza za TIV (aerodrom) ──────────────────
const tivWeather = useWeather({ airportCode: 'TIV' }, 0)

// ── Kumulativno kašnjenje — bilježi SVAKI let jednom kad dobije
// validnu Estimated vrijednost, nezavisno od filtera za prikaz.
// Reset se dešava prirodno pri hard reset-u u 03:00 (novi mount komponente).
// Sigurnosni cap (MAX_DELAY_MAP_ENTRIES) štiti od neograničenog rasta
// u rijetkom slučaju da 03:00 reset iz nekog razloga ne okine (npr. tab
// je bio suspendovan/offline preko ponoći) — bez capa bi Map rastao
// neograničeno tokom višednevnog rada bez reload-a.
const arrivalDelaysRef   = useRef<Map<string, number>>(new Map())
const departureDelaysRef = useRef<Map<string, number>>(new Map())

const recordDelay = (map: Map<string, number>, key: string, value: number) => {
  if (!map.has(key) && map.size >= MAX_DELAY_MAP_ENTRIES) {
    // Mapa je narasla preko sigurnosnog praga — očisti je i kreni ispočetka
    // umjesto da raste dalje. Prosjek će se privremeno računati na manjem
    // uzorku, što je bezopasno u odnosu na neograničen rast memorije.
    map.clear()
  }
  map.set(key, value)
}

const [avgDelays, setAvgDelays] = useState<{ arrivals: number | null; departures: number | null }>({
  arrivals: null, departures: null,
})
const lastDelayComputeRef = useRef(0)

// NOVO (po zahtjevu — Disruption Index): kombinovano iz arrivals I
// departures (isti princip kao Flightradar24 — jedan indeks za cio
// aerodrom, ne po smjeru).
const disruption = useMemo(
  () => computeDisruptionIndex([...arrivals, ...departures]),
  [arrivals, departures]
)

// Bilježi kašnjenje za svaki let čim su i sch i est validni —
// koristi FlightNumber+ScheduledTime kao ključ da se isti let ne broji duplo,
// i da se ažurira ako se estimate promijeni prije nego let stvarno krene.
useEffect(() => {
  arrivals.forEach(f => {
    const sch = parseFlightTimeToDate(f.ScheduledDepartureTime)
    const est = parseFlightTimeToDate(f.EstimatedDepartureTime)
    // FIX (KRITIČNO — prijavljen bug: "prosječno kašnjenje -1.3 min
    // kad samo JEDAN let ima stvarno odstupanje, ostali još nemaju
    // procjenu"): RANIJE je uslov bio samo `if (sch && est)` — ovo
    // NIJE provjeravalo da li est i sch STVARNO odstupaju. Kad
    // EstimatedDepartureTime za let još nije stiglo od aerodromskog
    // izvora, polje jednostavno pokazuje ScheduledDepartureTime kao
    // placeholder — est je tad VALIDAN datum, JEDNAK sch-u, pa je
    // prolazio ovaj uslov i upisivao se u prosjek sa "0 min
    // odstupanja". Svaki takav let (bez stvarnog praćenja) je
    // RAZBLAŽIVAO pravi signal iz letova koji STVARNO odstupaju —
    // npr. jedan let -30 min (30 min ranije) usred 22 leta bez
    // procjene daje prosjek -30/23 ≈ -1.3, umjesto pravih -30 min za
    // taj jedan let. Dodat eksplicitan uslov da est i sch MORAJU
    // stvarno odstupati — prosjek se sad računa isključivo iz letova
    // sa potvrđenim, stvarnim odstupanjem.
    if (sch && est && est.getTime() !== sch.getTime()) {
      const key = `${f.FlightNumber}-${f.ScheduledDepartureTime}`
      recordDelay(arrivalDelaysRef.current, key, (est.getTime() - sch.getTime()) / 60_000)
    }
  })
  departures.forEach(f => {
    const sch = parseFlightTimeToDate(f.ScheduledDepartureTime)
    const est = parseFlightTimeToDate(f.EstimatedDepartureTime)
    // FIX — isti razlog kao arrivals petlja iznad.
    if (sch && est && est.getTime() !== sch.getTime()) {
      const key = `${f.FlightNumber}-${f.ScheduledDepartureTime}`
      recordDelay(departureDelaysRef.current, key, (est.getTime() - sch.getTime()) / 60_000)
    }
  })
}, [arrivals, departures])

// Prikaz se osvježava najviše jednom na sat, ali računa se
// nad KUMULATIVNIM podacima (arrivalDelaysRef/departureDelaysRef),
// ne nad trenutnim filtriranim state-om.
useEffect(() => {
  const hasAnyData = arrivalDelaysRef.current.size > 0 || departureDelaysRef.current.size > 0
  if (!hasAnyData) return // još nema podataka — ne označavaj kao "izračunato", sačekaj sljedeći prolaz

  const now = Date.now()
  const oneHourPassed = now - lastDelayComputeRef.current >= 60 * 60 * 1000
  const neverComputed = lastDelayComputeRef.current === 0
  if (!oneHourPassed && !neverComputed) return

  const avg = (m: Map<string, number>): number | null => {
    if (m.size === 0) return null
    const vals = Array.from(m.values())
    return Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10
  }

  lastDelayComputeRef.current = now
  setAvgDelays({
    arrivals:   avg(arrivalDelaysRef.current),
    departures: avg(departureDelaysRef.current),
  })
}, [arrivals, departures])

  // ── Assignments (desk/gate) — I DALJE polling, sad na 60s ──
  // (Faza 2 ovo prebacuje na Ably; za sad ostaje nepromijenjeni mehanizam,
  // samo rjeđi interval nego original 100s-vezan-uz-flights ciklus).


// ── Zamjena za stari poll blok ──────────────────────────────
const { deskEntries, gateEntries } = useRealtimeAssignments('board');

// Transformiši AssignmentEntry mape u { desks, gates } oblik
// koji prepareData / applyAssignmentsOnly očekuju (Record<string,string>)
const assignments = useMemo(() => {
  const desks: Record<string, string> = {};
  const gates: Record<string, string> = {};

  // FIX (KRITIČNO — prijavljeno "kad se let dodijeli na 3 šaltera
  // (npr. 7,8,9), combined/departures ne pokazuje taj podatak, kao da
  // pokazuje stariji/sirov podatak"): deskEntries je organizovan PO
  // ŠALTERU (ključ je deskNumber) — kad se let dodijeli na VIŠE
  // šaltera istovremeno, to su VIŠE ODVOJENIH zapisa u deskEntries
  // (šalter 7 -> XY456, šalter 8 -> XY456, šalter 9 -> XY456).
  // RANIJE se ovdje gradila mapa "let -> JEDAN šalter"
  // (desks[entry.flightNumber] = deskNumber) — svaki naredni zapis je
  // PREPISIVAO prethodni, pa je na kraju ostajao samo POSLEDNJI šalter
  // po redoslijedu iteracije, ne sva tri. Popravljeno da AKUMULIRA sve
  // šaltere/gate-ove za isti let, zarezom odvojene (isti format kao
  // sirovi aerodromski podatak, npr. "10,11,12") — Set sprečava
  // duplikate ako isti broj nekako stigne dvaput.
  const deskSets: Record<string, Set<string>> = {};
  const gateSets: Record<string, Set<string>> = {};

  for (const [deskNumber, entry] of Object.entries(deskEntries)) {
    if (entry?.status === 'open' && entry.flightNumber) {
      (deskSets[entry.flightNumber] ??= new Set()).add(deskNumber);
    }
  }
  for (const [gateNumber, entry] of Object.entries(gateEntries)) {
    if (entry?.status === 'open' && entry.flightNumber) {
      (gateSets[entry.flightNumber] ??= new Set()).add(gateNumber);
    }
  }

  for (const [flightNumber, set] of Object.entries(deskSets)) {
    desks[flightNumber] = Array.from(set).sort().join(',');
  }
  for (const [flightNumber, set] of Object.entries(gateSets)) {
    gates[flightNumber] = Array.from(set).sort().join(',');
  }

  return { desks, gates };
}, [deskEntries, gateEntries]);

  // ── Kombinuj flight data (Ably) + assignments (poll) u prikaz ───
  useEffect(() => {
    if (!liveFlightData) return;

    const incomingTotal = (liveFlightData.departures?.length || 0) + (liveFlightData.arrivals?.length || 0);
    const currentlyHasData = arrivals.length > 0 || departures.length > 0;

    // Ista sigurnosna mreža kao original — ne prazni ekran na sumnjiv prazan odgovor
    if (incomingTotal === 0 && currentlyHasData) {
      console.warn('⚠️ Primljen prazan flight data preko Ably — zadržavam prethodno stanje');
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLastUpdate(new Date().toLocaleTimeString("en-GB"));
      return;
    }

    const { filteredArrivals, departuresWithMeta } = prepareData(liveFlightData, assignments);
    setArrivals(filteredArrivals);
    setDepartures(departuresWithMeta);
    // FIX (KRITIČNO — prijavljeno "ekran povremeno postane crn na oko
    // 5 min"): RANIJE se ovdje direktno primjenjivao sirov
    // liveFlightData.isNightMode flag — jedan prolazan/zastarjeli
    // signal (npr. ako fallback REST snapshot kratkotrajno vrati
    // stariji podatak, vidi hooks/useRealtimeFlightData.ts) je odmah,
    // bez ikakve zaštite, prebacivao CIJEL EKRAN na crn "noćni sat"
    // prikaz — putnici su to vidjeli kao iznenadan, neobjašnjen
    // "kvar". getLastKnownDynamicNightMode() koristi ISTU, već
    // dokazanu 2-uzastopna-izvještaja hysterezu koja se ranije
    // primjenjivala SAMO za gašenje Ably konekcije (lib/ably-client.ts)
    // — sad štiti i VIZUELAN prikaz od istog rizika. isNightHours()
    // (statička, sezonska provjera) ostaje kao siguran fallback koji
    // nikad ne kasni.
    setNightMode(isNightHours() || getLastKnownDynamicNightMode());
    setLastUpdate(new Date().toLocaleTimeString("en-GB"));
    setLoading(false);
    isInitialLoad.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveFlightData]);

  // ── Kad se PROMIJENE SAMO assignments (flight data isti) —
  // primijeni na već prikazane departures, bez čekanja na novu Ably poruku.
  // Poredi SADRŽAJ (JSON), ne samo referencu — `assignments` je nov objekat
  // svaki put kad useRealtimeAssignments vrati nove deskEntries/gateEntries
  // reference, čak i ako se stvarni desk/gate raspored nije promijenio.
  // Bez ove provjere bismo radili nepotreban setDepartures (i re-render
  // cijele liste letova) na svaki takav "prazan" update. ──────────────
  const prevAssignmentsKeyRef = useRef<string>("");
  useEffect(() => {
    const key = JSON.stringify(assignments);
    if (prevAssignmentsKeyRef.current === key) return;
    prevAssignmentsKeyRef.current = key;
    if (!liveFlightData) return; // prva primjena ionako pokrivena blokom iznad
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDepartures(prev => applyAssignmentsOnly(prev, assignments));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assignments]);

  // ── Debug/vizuelni log konekcije (opciono) ─────────────────
  useEffect(() => {
    if (connectionState === 'disconnected') {
      console.warn('⚠️ Ably konekcija prekinuta — prikazujem zadnje poznato stanje');
    }
  }, [connectionState]);

  // ── Close handler — NEPROMIJENJENO ────────────────────────
const handleClose = useCallback(() => {
  if (window.electronAPI?.quitApp) { window.electronAPI.quitApp(); return }
  try { if (window.chrome?.webview) { window.chrome.webview.postMessage("APP_QUIT"); return } } catch {}
  window.postMessage({ type: "ELECTRON_APP_QUIT" }, "*")
  try { if (window.parent !== window) window.parent.postMessage({ type: "ELECTRON_APP_QUIT" }, "*") } catch {}
  window.location.reload()
}, [])

  // ── Derived — NEPROMIJENJENO ──────────────────────────────
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
      { label: t.from,        width: "400px", icon: MapPin       },
      { label: "Weather",     width: "180px", icon: () => (
        <svg viewBox="0 0 24 24" className="w-5 h-5" fill="currentColor">
          <circle cx="12" cy="12" r="5" fill="#FBBF24"/>
          <circle cx="12" cy="12" r="4" fill="#F59E0B"/>
        </svg>
      ) },
      { label: t.status,      width: "640px", icon: Info         },
    ]
    return [
      { label: t.scheduled,   width: "180px", icon: Clock        },
      { label: t.estimated,   width: "180px", icon: Clock        },
      { label: t.flight,      width: "280px", icon: DepartureIcon},
      { label: t.destination, width: "320px", icon: MapPin       },
      { label: t.checkIn,     width: "260px", icon: Users        },
      { label: t.gate,        width: "200px", icon: DoorOpen     },
      { label: t.status,      width: "580px", icon: Info         },
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

  const totalPages = Math.max(1, Math.ceil(allSortedFlights.length / PAGE_SIZE))

  const sortedFlights = useMemo(() => {
    if (allSortedFlights.length === 0) return []
    const currentPage = pageIndex % totalPages
    const start = currentPage * PAGE_SIZE
    return allSortedFlights.slice(start, start + PAGE_SIZE)
  }, [allSortedFlights, pageIndex, totalPages])

  // ── Render — NEPROMIJENJEN ─────────────────────────────────
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
  <div className="relative flex justify-between items-center gap-2 sm:gap-4">
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

<div
  style={{
    position: 'absolute',
    left: '50%',
    top: '50%',
    // FIX (po zahtjevu — prijavljeno preklapanje "Departures"/"Arrivals"
    // naslova): AirportStatusPill je centriran preko left:50% na CIJEO
    // header kontejner, nezavisno od širine lijevog naslova. Kad je
    // pill nedavno proširen (200px -> 260px, +60px), lijeva ivica se
    // pomjerila 30px ulijevo (translateX(-50%) širi simetrično u oba
    // smjera od centralne tačke), prekrivajući dio zadnjeg slova
    // naslova. marginLeft: 30px (pola dodatne širine) vraća lijevu
    // ivicu pill-a približno na mjesto gdje je bila PRIJE proširenja —
    // novi, veći prostor se širi udesno, gdje ima više praznog
    // prostora prema clock indikatoru.
    transform: 'translate(-50%, -50%)',
    marginLeft: '30px',
  }}
>
  <AirportStatusPill
    temperature={tivWeather.loading ? null : tivWeather.temperature}
    weatherCode={tivWeather.loading ? null : tivWeather.weatherCode}
    windSpeed={tivWeather.loading ? null : tivWeather.windSpeed}
    windDirection={tivWeather.loading ? null : tivWeather.windDirection}
    avgArrivalDelay={avgDelays.arrivals}
    avgDepartureDelay={avgDelays.departures}
    disruption={disruption}
  />
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
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-1.5 mt-2">
          {Array.from({ length: totalPages }).map((_, i) => (
            <div
              key={i}
              className={`w-1.5 h-1.5 rounded-full transition-all ${
                i === ((showArrivals ? arrivalsPage : departuresPage) % totalPages)
                  ? `${colors.accent} w-4`
                  : 'bg-white/20'
              }`}
            />
          ))}
        </div>
      )}

      <style jsx global>{`
        #__next,body,html{height:100vh}*{-webkit-font-smoothing:antialiased}
        @keyframes ledBlinkA{0%{opacity:.2}100%{opacity:1}}
        @keyframes ledBlinkB{0%{opacity:1}100%{opacity:.2}}
        @keyframes pill-blink{0%,50%{opacity:1}51%,100%{opacity:.75}}
        @keyframes pill-blink-fast{0%,40%{opacity:1}41%,100%{opacity:.55}}
        .animate-pill-blink{animation:.8s ease-in-out infinite pill-blink;will-change:opacity}
        .animate-pill-blink-fast{animation:.4s ease-in-out infinite pill-blink-fast;will-change:opacity}
        .led-blink-a{animation:ledBlinkA .8s ease-in-out infinite alternate;will-change:opacity}
        .led-blink-b{animation:ledBlinkB .8s ease-in-out infinite alternate;will-change:opacity}
        .ticker-wrap{width:100%;overflow:hidden;position:absolute;top:0;left:0;height:100%}
        .ticker-move{display:inline-block;white-space:nowrap;will-change:transform;backface-visibility:hidden;animation:ticker-scroll 45s linear infinite}
        @keyframes ticker-scroll{0%{transform:translate3d(0,0,0)}100%{transform:translate3d(-50%,0,0)}}
        @media(max-width:639px){.ticker-move{animation-duration:35s}}
        @media(prefers-reduced-motion:reduce){.animate-pill-blink,.animate-pill-blink-fast,.led-blink-a,.led-blink-b,.animate-pulse,.animate-spin,.ticker-move{animation:none!important;opacity:1!important}}
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
export default function CombinedPageClientV2(): JSX.Element {
  return <FlightBoardErrorBoundary><FlightBoard /></FlightBoardErrorBoundary>
}