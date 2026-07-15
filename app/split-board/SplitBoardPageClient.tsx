// app/split-board/page.tsx
'use client';

import type React from "react";
import {
  JSX,
  useEffect,
  useState,
  useCallback,
  useMemo,
  useRef,
  memo,
  Component,
  type ErrorInfo,
  type ReactNode,
} from "react";
import type { Flight } from "@/types/flight";
import { fetchFlightData, getUniqueDeparturesWithDeparted } from "@/lib/flight-service";
import { Info, Plane, Clock, MapPin, Users, DoorOpen } from "lucide-react";
import { getInitialAirlineLogoSrc, isKnownLocalLogo } from '@/lib/airline-logo';
import { isNightHours } from '@/lib/night-hours';

// ============================================================
// KONSTANTE
// ============================================================
const REFRESH_INTERVAL_MS          = 100_000;
const FETCH_TIMEOUT_MS             = 15_000;
const MAX_RETRIES                  = 3;
const RETRY_DELAY_MS               = 1_000;
const CACHE_KEY                    = "flight_board_cache";
const CACHE_DURATION               = 5 * 60 * 1_000;
const HEARTBEAT_TIMEOUT_MS         = 120_000;
const HEARTBEAT_CHECK_INTERVAL_MS  = 30_000;
const MEMORY_CLEANUP_INTERVAL_MS   = 30 * 60 * 1_000;
const MAX_FLIGHTS_DISPLAY          = 18;
const MAX_FLIGHTS_MEMORY           = 15;
const HARD_RESET_INTERVAL_MS       = 6 * 60 * 60 * 1000;
const HIDDEN_FLIGHT_PATTERNS = ["ZZZ", "G00", "PVT", "TST"];
let lastKnownHash: string | null = null;

// ============================================================
// ERROR BOUNDARY
// ============================================================
interface ErrorBoundaryState { hasError: boolean; errorMessage: string }
class SplitBoardErrorBoundary extends Component<{ children: ReactNode; fallback?: ReactNode }, ErrorBoundaryState> {
  constructor(props: { children: ReactNode; fallback?: ReactNode }) {
    super(props);
    this.state = { hasError: false, errorMessage: "" };
  }
  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, errorMessage: error.message };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("SplitBoard ErrorBoundary caught:", error, info);
    setTimeout(() => this.setState({ hasError: false, errorMessage: "" }), 10_000);
  }
  render() {
    if (this.state.hasError) {
      return this.props.fallback || (
        <div className="h-screen bg-black flex flex-col items-center justify-center text-white gap-6">
          <Plane className="w-24 h-24 opacity-30 animate-pulse" />
          <div className="text-4xl font-bold opacity-70">Reconnecting...</div>
          <div className="text-xl opacity-40">{this.state.errorMessage}</div>
        </div>
      );
    }
    return this.props.children;
  }
}

// ============================================================
// HELPER FUNKCIJE (nepromijenjene)
// ============================================================
const getFlightawareLogoURL = (icaoCode: string): string =>
  icaoCode ? `https://www.flightaware.com/images/airline_logos/180px/${icaoCode}.png` : "";

const PLACEHOLDER_IMAGE =
  "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMzIiIGhlaWdodD0iMzIiIHZpZXdCb3g9IjAgMCAzMiAzMiIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHJlY3Qgd2lkdGg9IjMyIiBoZWlnaHQ9IjMyIiBmaWxsPSIjMzQzQzU0Ii8+Cjx0ZXh0IHg9IjE2IiB5PSIxNiIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZG9taW5hbnQtYmFzZWxpbmU9Im1pZGRsZSIgZmlsbD0iIzlDQTdCNiIgZm9udC1mYW1pbHk9IkFyaWFsLCBzYW5zLXNlcmlmIiBmb250LXNpemU9IjgiPk5vIExvZ288L3RleHQ+Cjwvc3ZnPgo=";

function parseFlightTimeToDate(timeStr: string | null | undefined): Date | null {
  if (!timeStr) return null;
  const s = timeStr.trim();
  if (!s || s === "-" || s === "--:--") return null;

  try {
    if (s.includes("T") || (s.includes("-") && s.length > 5)) {
      const d = new Date(s);
      return isNaN(d.getTime()) ? null : d;
    }
    const ampm = s.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
    if (ampm) {
      let h = parseInt(ampm[1], 10);
      const m = parseInt(ampm[2], 10);
      if (ampm[3].toUpperCase() === "PM" && h !== 12) h += 12;
      if (ampm[3].toUpperCase() === "AM" && h === 12) h = 0;
      const d = new Date(); d.setHours(h, m, 0, 0);
      if (Date.now() - d.getTime() > 12 * 60 * 60 * 1000) d.setDate(d.getDate() + 1);
      return d;
    }
    const sep = s.match(/^(\d{1,2})[:.](\d{2})$/);
    if (sep) {
      const h = parseInt(sep[1], 10);
      const m = parseInt(sep[2], 10);
      if (h > 23 || m > 59) return null;
      const d = new Date(); d.setHours(h, m, 0, 0);
      if (Date.now() - d.getTime() > 12 * 60 * 60 * 1000) d.setDate(d.getDate() + 1);
      return d;
    }
    const digits = s.replace(/\D/g, "");
    if (digits.length === 4) {
      const h = parseInt(digits.substring(0, 2), 10);
      const m = parseInt(digits.substring(2, 4), 10);
      if (h > 23 || m > 59) return null;
      const d = new Date(); d.setHours(h, m, 0, 0);
      if (Date.now() - d.getTime() > 12 * 60 * 60 * 1000) d.setDate(d.getDate() + 1);
      return d;
    }
    return null;
  } catch { return null; }
}

const formatTimeString = (timeStr: string | null | undefined): string => {
  if (!timeStr) return "";
  const s = timeStr.trim();
  if (!s || s === "-" || s === "--:--") return "";
  if (s.includes("T")) {
    const d = new Date(s);
    if (!isNaN(d.getTime())) return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  }
  if (/^\d{2}:\d{2}$/.test(s)) return s;
  const digits = s.replace(/\D/g, "");
  if (digits.length === 4) {
    const h = digits.substring(0, 2);
    const m = digits.substring(2, 4);
    const hi = parseInt(h, 10);
    const mi = parseInt(m, 10);
    if (hi > 23 || mi > 59) return "";
    if (hi === 0 && mi === 0) return "";
    return `${h}:${m}`;
  }
  return "";
};

const isValidDisplayTime = (timeStr: string | null | undefined): boolean => {
  if (!timeStr) return false;
  const formatted = formatTimeString(timeStr);
  return formatted !== "" && formatted !== "00:00";
};

const saveToCache = (data: { arrivals: Flight[]; departures: Flight[]; lastUpdated: string }) => {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify({ data, timestamp: Date.now() })); }
  catch (e) { console.warn("Failed to save to cache:", e); }
};
const loadFromCache = (): { arrivals: Flight[]; departures: Flight[]; lastUpdated: string } | null => {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const { data, timestamp } = JSON.parse(raw);
    return Date.now() - timestamp > CACHE_DURATION ? null : data;
  } catch { return null; }
};

const fetchWithTimeout = async (url: string, ms: number): Promise<Response> => {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    clearTimeout(id); return r;
  } catch (e) { clearTimeout(id); throw e; }
};

const filterRecentFlights = (flights: Flight[], isArrivals: boolean): Flight[] => {
  const now = new Date();
  return flights.filter(f => {
    const flightNum = (f.FlightNumber || "").toUpperCase();
    if (HIDDEN_FLIGHT_PATTERNS.some(p => flightNum.includes(p))) return false;
    const status = (f.StatusEN ?? "").toLowerCase();
    const arrived = /(arrived|landed|sletio|sletjelo|dolazak|stigao)/i.test(status);
    const departed = !/(delay|kasni)/i.test(status) && /(departed|poletio|take off)/i.test(status);
    if (!arrived && !departed) return true;
    const timeStr = f.EstimatedDepartureTime || f.ScheduledDepartureTime || f.ActualDepartureTime;
    if (!timeStr) return !arrived && !departed;
    const ft = parseFlightTimeToDate(timeStr);
    if (!ft) return false;
    const diff = Math.floor((now.getTime() - ft.getTime()) / 60_000);
    if (isArrivals && arrived) return diff <= 20;
    if (!isArrivals && departed) return diff <= 20;
    return true;
  });
};



// const fetchAssignments = async (): Promise<{
//   desks: Record<string, string>;
//   gates: Record<string, string>;
// }> => {
//   try {
//     // Popravljeno: /api/test/stats?type=assignments nikad nije radio —
//     // ta ruta ne čita query parametar i vraća flight-meta hash, ne
//     // desk/gate podatke. /api/test/assignments je ispravan izvor,
//     // čita oba Redis ključa paralelno na backend-u.
//     const res = await fetchWithTimeout('/api/test/assignments', 5_000);
//     if (!res.ok) return { desks: {}, gates: {} };
//     const data = await res.json();
//     return {
//       desks: data.desks ?? {},
//       gates: data.gates ?? {},
//     };
//   } catch {
//     return { desks: {}, gates: {} };
//   }
// };

// ============================================================
// AUTO-STATUS (isti)
// ============================================================
const CHECKIN_OFFSETS: Record<string, number> = {
  "6H": 180, "FZ": 180, "LS": 150, "LY": 180, "IZ": 180,"BA": 150,
};

function getAutoStatus(flight: Flight): string | null {
  const status = (flight.StatusEN ?? "").trim();
  if (status && status !== "-") return null;
  const scheduled = parseFlightTimeToDate(flight.ScheduledDepartureTime);
  if (!scheduled) return null;
  const referenceTime = parseFlightTimeToDate(flight.EstimatedDepartureTime) ?? scheduled;
  const now = Date.now();
  const minsToRef = (referenceTime.getTime() - now) / 60_000;
  const minsToSTD = (scheduled.getTime() - now) / 60_000;
  if (minsToRef < -5) return null;
  if (minsToRef <= 5) return "Close";
  if (minsToRef <= 10) return "Final Call";
  if (minsToRef <= 30) return "Go to Gate";
  if (minsToSTD > 30) {
    const iata = (flight.FlightNumber ?? "").replace(/\s/g, "").substring(0, 2).toUpperCase();
    const checkInMinutesOffset = CHECKIN_OFFSETS[iata] ?? 120;
    const checkInDate = new Date(scheduled.getTime() - (checkInMinutesOffset * 60 * 1000));
    const hh = String(checkInDate.getHours()).padStart(2, "0");
    const mm = String(checkInDate.getMinutes()).padStart(2, "0");
    return `Check In at ${hh}:${mm}`;
  }
  return null;
}

function getAutoArrivalStatus(flight: Flight, fmtTime: (t: string) => string): string | null {
  const status = (flight.StatusEN ?? "").trim();
  if (status && status !== "-") return null;
  const scheduledStr = flight.ScheduledDepartureTime;
  const estimatedStr = flight.EstimatedDepartureTime;
  if (!scheduledStr) return null;
  if (!estimatedStr || !isValidDisplayTime(estimatedStr) || scheduledStr === estimatedStr) return "Scheduled";
  const scheduled = parseFlightTimeToDate(scheduledStr);
  const estimated = parseFlightTimeToDate(estimatedStr);
  if (!scheduled || !estimated) return "Scheduled";
  const diffMins = (scheduled.getTime() - estimated.getTime()) / 60_000;
  if (diffMins > 15) return `Arriving early – expected at ${fmtTime(estimatedStr)}`;
  if (diffMins < -15) return `Delayed – expected at ${fmtTime(estimatedStr)}`;
  return "On time";
}

// ============================================================
// KOMPONENTE
// ============================================================
const LEDIndicator = memo(function LEDIndicator({
  color, phase = "a", size = "w-3 h-3",
}: { color: "blue"|"green"|"orange"|"red"|"yellow"|"cyan"|"purple"|"lime"; phase?: "a"|"b"; size?: string }) {
  const colorMap: Record<string, string> = {
    blue: "bg-blue-500", green: "bg-green-500", orange: "bg-orange-500",
    red: "bg-red-500", yellow: "bg-yellow-400", cyan: "bg-cyan-400",
    purple: "bg-purple-500", lime: "bg-lime-500",
  };
  const animationName = phase === "a" ? "ledBlinkA" : "ledBlinkB";
  return (
    <div
      className={`${size} rounded-full ${colorMap[color]}`}
      style={{ animation: `${animationName} 0.8s ease-in-out infinite alternate` }}
    />
  );
});

const ClockDisplay = memo(function ClockDisplay() {
  const [time, setTime] = useState("");
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
    const tick = () => setTime(new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }));
    tick(); const id = setInterval(tick, 1000); return () => clearInterval(id);
  }, []);
  if (!mounted) return <div className="text-5xl font-black text-white leading-none">--:--</div>;
  return <div className="text-5xl font-black text-white drop-shadow-2xl leading-none">{time}</div>;
});

// ── NOĆNI SAT — pun ekran, HH:MM, font 72px, žuta boja, po centru ──
const NightClock = memo(function NightClock() {
  const [time, setTime] = useState("");
  useEffect(() => {
    const tick = () => setTime(new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }));
    tick(); const id = setInterval(tick, 1_000); return () => clearInterval(id);
  }, []);
  return (
    <div className="h-screen w-full flex items-center justify-center bg-black select-none">
      <div className="font-black text-yellow-400 drop-shadow-2xl tabular-nums" style={{ fontSize: "72px", lineHeight: 1 }}>
        {time || "--:--"}
      </div>
    </div>
  );
});

type LEDColor = "blue"|"green"|"orange"|"red"|"yellow"|"cyan"|"purple"|"lime";
function computeStatusPill(flight: Flight, isArrival: boolean, fmtTime: (t: string) => string) {
  const autoStatus = isArrival ? getAutoArrivalStatus(flight, fmtTime) : getAutoStatus(flight);
  const effectiveStatus = autoStatus !== null ? autoStatus : (flight.StatusEN ?? "");
  const isCancelled   = /(cancelled|canceled|otkazan)/i.test(effectiveStatus);
  const isDelayed     = /(delay|kasni)/i.test(effectiveStatus);
  const isBoarding    = !isArrival && /(boarding|gate open)/i.test(effectiveStatus);
  const isProcessing  = /processing/i.test(effectiveStatus);
  const isEarly       = /(earlier|ranije)/i.test(effectiveStatus);
  const isOnTime      = /(on time|na vrijeme)/i.test(effectiveStatus);
  const isDiverted    = /(diverted|preusmjeren)/i.test(effectiveStatus);
  const isCheckInOpen = /(check.?in|check-in)/i.test(effectiveStatus);
  const isGoToGate    = !isArrival && /(go to gate)/i.test(effectiveStatus);
  const isClose       = !isArrival && /^close$/i.test(effectiveStatus.trim());
  const isFinalCall   = !isArrival && /^final call$/i.test(effectiveStatus.trim());
  const isArrived     = isArrival  && /(arrived|landed|sletio|sletjelo|dolazak|stigao)/i.test(effectiveStatus);
  let displayText = effectiveStatus;
  if (isProcessing) displayText = "Check-In";
  if (isArrived) {
    const t = flight.EstimatedDepartureTime || flight.ScheduledDepartureTime || flight.ActualDepartureTime;
    displayText = `Arrived at ${t ? fmtTime(t) : ""}`;
  }
  const hasStatusText = displayText.trim() !== "";
  const showLEDs = isCancelled || isDelayed  || isBoarding || isProcessing ||
                   isCheckInOpen || isArrived || isDiverted || isGoToGate || isClose || isFinalCall || isEarly;
  let bg = "bg-white/10", border = "border-white/30", text = "text-white";
  let led1: LEDColor = "blue", led2: LEDColor = "green", blinkClass = "";
  if      (isCancelled)             { bg="bg-red-500/20";    border="border-red-500/50";    text="text-red-100";    led1="red";    led2="orange"; blinkClass="animate-pill-blink"      }
  else if (isClose)                 { bg="bg-red-600/30";    border="border-red-500/70";    text="text-red-100";    led1="red";    led2="orange"; blinkClass="animate-pill-blink-fast" }
  else if (isFinalCall)             { bg="bg-orange-600/30"; border="border-orange-500/70"; text="text-orange-100"; led1="orange"; led2="red";    blinkClass="animate-pill-blink-fast" }
  else if (isGoToGate)              { bg="bg-blue-500/20";   border="border-blue-500/50";   text="text-blue-100";   led1="blue";   led2="cyan";   blinkClass="animate-pill-blink"      }
  else if (isDelayed)               { bg="bg-yellow-500/20"; border="border-yellow-500/50"; text="text-yellow-100"; led1="yellow"; led2="orange"                                        }
  else if (isEarly)                 { bg="bg-purple-500/20"; border="border-purple-500/50"; text="text-purple-100"; led1="purple"; led2="blue"                                         }
  else if (isBoarding)              { bg="bg-cyan-500/20";   border="border-cyan-500/50";   text="text-cyan-100";   led1="cyan";   led2="blue";   blinkClass="animate-pill-blink"      }
  else if (isCheckInOpen||isProcessing){ bg="bg-green-500/20";border="border-green-500/50"; text="text-green-100";  led1="green";  led2="lime"                                          }
  else if (isDiverted)              { bg="bg-orange-500/20"; border="border-orange-500/50"; text="text-orange-100"; led1="orange"; led2="red"                                          }
  else if (isOnTime)                { bg="bg-lime-500/20";   border="border-lime-500/50";   text="text-lime-100";   led1="lime";   led2="green"                                        }
  else if (isArrived)               { bg="bg-green-500/20";  border="border-green-500/50";  text="text-green-100";  led1="green";  led2="lime";   blinkClass="animate-pill-blink"      }
  return { bg, border, text, led1, led2, blinkClass, showLEDs, hasStatusText, displayText };
}

// ----------------------------------------------
// FlightRow - prilagođena za 1rem font
// ----------------------------------------------
const FlightRow = memo(function FlightRow({
  flight, index, isArrival, titleColor, autoStatusTick,
}: {
  flight: Flight; index: number; isArrival: boolean; titleColor: string; autoStatusTick: number;
}) {
  const formatTime = useCallback((t: string) => formatTimeString(t), []);
  const pill = useMemo(
    () => computeStatusPill(flight, isArrival, formatTime),
    [flight, isArrival, formatTime, autoStatusTick]
  );
  const icao = flight.AirlineICAO || flight.FlightNumber?.substring(0, 2).toUpperCase() || '';
const onImgErr = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
  const img = e.currentTarget;
  if (img.dataset.tried === 'local') {
    img.dataset.tried = 'fw';
    const fw = getFlightawareLogoURL(icao);
    if (fw) { img.src = fw; return; }
    img.src = PLACEHOLDER_IMAGE; img.onerror = null; return;
  }
  img.src = PLACEHOLDER_IMAGE; img.onerror = null;
}, [icao]);

  const gateChangedAt = (flight as any)._gateChangedAt;
  const isGateChanged = gateChangedAt && (Date.now() - gateChangedAt < 15_000);
  const estimatedDisplay = useMemo(() => {
    const est = flight.EstimatedDepartureTime;
    const sch = flight.ScheduledDepartureTime;
    if (!isValidDisplayTime(est)) return null;
    const estFmt = formatTimeString(est);
    const schFmt = formatTimeString(sch);
    if (estFmt === schFmt) return null;
    return estFmt;
  }, [flight.EstimatedDepartureTime, flight.ScheduledDepartureTime]);

  const rowBg = index % 2 === 0 ? "bg-white/15" : "bg-white/5";
  const pillCls = `w-[95%] flex items-center justify-center gap-2 text-base font-extrabold rounded-2xl border-2 px-3 py-1.5 transition-colors duration-300 ${pill.bg} ${pill.border} ${pill.text} ${pill.blinkClass}`;
  const mobilePillCls = `flex items-center gap-1 text-xs font-bold rounded-xl border px-2 py-1 ${pill.bg} ${pill.border} ${pill.text} ${pill.blinkClass}`;

  return (
    <>
      {/* Desktop (min-width 1024px) - SVI FONTOVI 1rem */}
      <div className={`hidden lg:flex gap-2 p-1 border-b border-white/10 ${rowBg}`} style={{ minHeight: "48px", contain: "layout style" }}>
        {/* Scheduled */}
        <div className="flex items-center justify-center w-[140px]">
          <div className="text-base font-black text-white drop-shadow-lg">
            {formatTimeString(flight.ScheduledDepartureTime) || <span className="text-white/40">--:--</span>}
          </div>
        </div>
        {/* Estimated */}
        <div className="flex items-center justify-center w-[140px]">
          {estimatedDisplay
            ? <div className={`text-base font-black ${titleColor} drop-shadow-lg`}>{estimatedDisplay}</div>
            : <div className="text-base text-white/30 font-bold">-</div>
          }
        </div>
        {/* Flight + Logo */}
        <div className="flex items-center gap-2 w-[240px]">
          <div className="relative w-[50px] h-8 bg-white rounded-lg p-0.5 shadow-xl flex-shrink-0">
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
          <div className="text-xl font-black text-white drop-shadow-lg">{flight.FlightNumber}</div>
          {flight.CodeShareFlights && flight.CodeShareFlights.length > 0 && (
            <div className="text-xs text-white/50 font-bold">+{flight.CodeShareFlights.length}</div>
          )}
        </div>
        {isArrival ? (
          <div className="flex items-center w-[500px]">
            <div className="text-2xl font-black text-white truncate drop-shadow-lg">
              {flight.DestinationCityName || flight.DestinationAirportName}
            </div>
          </div>
        ) : (
          <div className="flex items-center w-[320px]">
            <div className="text-2xl font-black text-white truncate drop-shadow-lg">
              {flight.DestinationCityName || flight.DestinationAirportName}
            </div>
          </div>
        )}
        {isArrival ? (
          <div className="flex items-center justify-center w-[600px]">
            {pill.hasStatusText ? (
              <div className={`${pillCls} overflow-hidden relative`} style={{ paddingLeft: pill.showLEDs ? "1.8rem" : "0.75rem", paddingRight: "0.75rem", width: "95%" }}>
                {pill.showLEDs && <div className="absolute left-2 top-1/2 -translate-y-1/2 flex items-center gap-1 z-10"><LEDIndicator color={pill.led1} phase="a" size="w-2.5 h-2.5" /><LEDIndicator color={pill.led2} phase="b" size="w-2.5 h-2.5" /></div>}
                <div className="overflow-hidden text-center whitespace-nowrap text-base" style={{ marginLeft: pill.showLEDs ? "1.2rem" : "0", width: "100%" }}>{pill.displayText}</div>
              </div>
            ) : <div className="text-base font-bold text-slate-300">Scheduled</div>}
          </div>
        ) : (
          <>
            <div className="flex items-center justify-center w-[280px]">
              {flight.CheckInDesk && flight.CheckInDesk !== "-"
                ? <div className="text-base font-black text-white bg-black/40 py-1 px-2 rounded-lg border border-white/20 shadow-xl">{flight.CheckInDesk}</div>
                : <div className="text-base font-black text-transparent py-1 px-2">-</div>}
            </div>
            <div className="flex items-center justify-center w-[180px]">
              {flight.GateNumber && flight.GateNumber !== "-"
                ? <div className={`text-base font-black py-1 px-2 rounded-lg border shadow-xl ${isGateChanged ? "text-red-500 bg-red-500/20 border-red-400 animate-pill-blink-fast" : "text-white bg-black/40 border-white/20"}`}>{flight.GateNumber}</div>
                : <div className="text-base font-black text-transparent py-1 px-2">-</div>}
            </div>
            <div className="flex items-center justify-center w-[420px]">
              {pill.hasStatusText ? (
                <div className={`${pillCls} overflow-hidden text-base`}>
                  {pill.showLEDs && <div className="flex items-center gap-1 flex-shrink-0"><LEDIndicator color={pill.led1} phase="a" size="w-2.5 h-2.5" /><LEDIndicator color={pill.led2} phase="b" size="w-2.5 h-2.5" /></div>}
                  <span className="truncate whitespace-nowrap font-extrabold tracking-wide text-base">{pill.displayText}</span>
                </div>
              ) : <div className="text-base font-bold text-slate-300">Scheduled</div>}
            </div>
          </>
        )}
      </div>

      {/* Mobilni prikaz (ispod 1024px) */}
      <div className={`flex lg:hidden flex-col gap-1.5 px-3 py-2 border-b border-white/10 ${rowBg}`}>
        <div className="flex items-center gap-2">
    <div className="relative w-8 h-6 bg-white rounded-md p-0.5 shadow-md flex-shrink-0">
  <img
    src={getInitialAirlineLogoSrc(icao, PLACEHOLDER_IMAGE)}
    alt="logo"
    className="object-contain w-full h-full"
    onError={onImgErr}
    data-tried={isKnownLocalLogo(icao) ? 'local' : 'fw'}
    decoding="async"
  />
</div>
          <span className="text-lg font-black text-white tracking-wide">{flight.FlightNumber}</span>
          {flight.CodeShareFlights && flight.CodeShareFlights.length > 0 && <span className="text-[10px] text-white/40 font-bold">+{flight.CodeShareFlights.length}</span>}
          <div className="ml-auto flex items-center gap-1">
            <span className="text-sm font-black text-white tabular-nums">{formatTimeString(flight.ScheduledDepartureTime) || "--:--"}</span>
            {estimatedDisplay && <><span className="text-white/30 text-[10px]">›</span><span className={`text-sm font-black ${titleColor} tabular-nums`}>{estimatedDisplay}</span></>}
          </div>
        </div>
        <div className="text-sm font-black text-white truncate leading-tight">{flight.DestinationCityName || flight.DestinationAirportName}</div>
        <div className="flex items-center gap-1.5 flex-wrap">
          {!isArrival && flight.CheckInDesk && flight.CheckInDesk !== "-" && <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-white bg-black/40 px-1.5 py-0.5 rounded-md border border-white/20"><Users className="w-2.5 h-2.5 opacity-70" />{flight.CheckInDesk}</span>}
          {!isArrival && flight.GateNumber && flight.GateNumber !== "-" && <span className={`inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded-md border ${isGateChanged ? "text-red-400 bg-red-500/20 border-red-400 animate-pill-blink-fast" : "text-white bg-black/40 border-white/20"}`}><DoorOpen className="w-2.5 h-2.5 opacity-70" />{flight.GateNumber}</span>}
          {pill.hasStatusText ? (
            <div className={mobilePillCls}>
              {pill.showLEDs && <><LEDIndicator color={pill.led1} phase="a" size="w-1.5 h-1.5" /><LEDIndicator color={pill.led2} phase="b" size="w-1.5 h-1.5" /></>}
              <span className="truncate max-w-[180px] text-[10px]">{pill.displayText}</span>
            </div>
          ) : <span className="text-[10px] text-white/40 font-semibold">Scheduled</span>}
        </div>
      </div>
    </>
  );
}, (prev, next) =>
  prev.autoStatusTick === next.autoStatusTick &&
  prev.flight.FlightNumber === next.flight.FlightNumber &&
  prev.flight.StatusEN === next.flight.StatusEN &&
  (prev.flight as any)._gateChangedAt === (next.flight as any)._gateChangedAt &&
  prev.flight.EstimatedDepartureTime === next.flight.EstimatedDepartureTime &&
  prev.flight.ScheduledDepartureTime === next.flight.ScheduledDepartureTime &&
  prev.flight.GateNumber === next.flight.GateNumber &&
  prev.flight.CheckInDesk === next.flight.CheckInDesk &&
  prev.isArrival === next.isArrival &&
  prev.index === next.index
);

// ============================================================
// GLAVNA KOMPONENTA SPLIT BOARD
// ============================================================
const SECURITY_MESSAGES = [
  { text: "⚠️ DEAR PASSENGERS, PLEASE DO NOT LEAVE YOUR BAGGAGE UNATTENDED AT THE AIRPORT - UNATTENDED BAGGAGE WILL BE CONFISCATED AND DESTROYED •", language: "en" },
  { text: "⚠️ POŠTOVANI PUTNICI, MOLIMO VAS DA NE OSTAVLJATE SVOJ PRTLJAG BEZ NADZORA NA AERODROMU - NENADZIRANI PRTLJAG ĆE BITI ODUZET I UNIŠTEN •", language: "cnr" },
  { text: "📶 FREE AIRPORT WIFI: Network: \"One Crna Gora\" | No password required | Connect to One Crna Gora for access •", language: "en" },
  { text: "📶 BESPLATAN WIFI: Mreža: \"One Crna Gora\" | Bez lozinke | Povežite se na One Crna Gora •", language: "cnr" },
];
export default function SplitBoardPageClient(): JSX.Element {
  return <SplitBoardErrorBoundary><SplitBoard /></SplitBoardErrorBoundary>;
}

function SplitBoard(): JSX.Element {
  const [arrivals, setArrivals] = useState<Flight[]>([]);
  const [departures, setDepartures] = useState<Flight[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [autoStatusTick, setAutoStatusTick] = useState(0);
  const [currentMessageIndex, setCurrentMessageIndex] = useState(0);

  // ── Noćni režim — kad je true, prikazuje se samo NightClock,
  // bez ijednog network poziva. Prvi ciklus poslije 04:00 automatski
  // vraća normalan prikaz — self-healing, isti princip kao hash-check.
  const [nightMode, setNightMode] = useState(false);

  const isMountedRef = useRef(true);
  const lastHeartbeat = useRef(Date.now());
  const prevGatesRef = useRef<Record<string, string>>({});
  const isInitialLoad = useRef(true);
  const tickerIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // ── Dodaj na vrh komponente, zajedno sa ostalim ref-ovima ──
const etagStatusRef = useRef<string | null>(null);

  const applyAssignmentsOnly = useCallback((
  deps: Flight[],
  assignments: { desks: Record<string, string>; gates: Record<string, string> }
): Flight[] => {
  return deps.map(f => {
    const num = f.FlightNumber ?? '';
    const clone = { ...f };

    const adminDesk = assignments.desks[num];
    if (adminDesk) (clone as any).CheckInDesk = adminDesk;

    const adminGate = assignments.gates[num];
    const effectiveGate = adminGate || f.GateNumber || '';
    if (effectiveGate && effectiveGate !== '-') {
      const prevGate = prevGatesRef.current[num];
      if (prevGate && prevGate !== effectiveGate) {
        (clone as any)._gateChangedAt = Date.now();
      }
      clone.GateNumber = effectiveGate;
      prevGatesRef.current[num] = effectiveGate;
    }

    return clone;
  });
}, []);
  // Auto-status tick
  useEffect(() => {
    const id = setInterval(() => setAutoStatusTick(t => t + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  // Hard reset
  useEffect(() => {
    const id = setTimeout(() => window.location.reload(), HARD_RESET_INTERVAL_MS);
    return () => clearTimeout(id);
  }, []);

  // Heartbeat
  useEffect(() => {
    const update = () => { lastHeartbeat.current = Date.now(); };
    const check = setInterval(() => {
      if (Date.now() - lastHeartbeat.current > HEARTBEAT_TIMEOUT_MS) window.location.reload();
    }, HEARTBEAT_CHECK_INTERVAL_MS);
    window.addEventListener("mousemove", update, { passive: true });
    window.addEventListener("keypress", update, { passive: true });
    window.addEventListener("touchstart", update, { passive: true });
    return () => { clearInterval(check); window.removeEventListener("mousemove", update); window.removeEventListener("keypress", update); window.removeEventListener("touchstart", update); };
  }, []);

  // Memory cleanup
  useEffect(() => {
    const id = setInterval(() => {
      setArrivals(p => p.length > 20 ? p.slice(0, MAX_FLIGHTS_MEMORY) : p);
      setDepartures(p => p.length > 20 ? p.slice(0, MAX_FLIGHTS_MEMORY) : p);
    }, MEMORY_CLEANUP_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  // Ticker rotacija
  useEffect(() => {
    tickerIntervalRef.current = setInterval(() => {
      setCurrentMessageIndex(prev => (prev + 1) % SECURITY_MESSAGES.length);
    }, 20_000);
    return () => { if (tickerIntervalRef.current) clearInterval(tickerIntervalRef.current); };
  }, []);

  // Učitavanje podataka
const loadData = useCallback(async () => {
  if (!isMountedRef.current) return;

  // ── NOĆNI REŽIM ──
  // Noću (21:00-04:00) ne radimo NIKAKAV network poziv — ni hash-check,
  // ni pun fetch, ni fetchAssignments. Prikazuje se samo NightClock.
  // Čim isNightHours() vrati false (prvi ciklus poslije 04:00), ovaj
  // blok se preskače i nastavlja se normalan tok — self-healing.
  if (isNightHours()) {
    if (isMountedRef.current) setNightMode(true);
    setLoading(false);
    return;
  }
  if (isMountedRef.current) setNightMode(false);

  try {
    if (isInitialLoad.current) setLoading(true);
    setErrorMessage(null);

    // ── HASH CHECK ──
    // Ako trenutno NEMA prikazanih letova, ne vjeruj hash-u — moguća
    // desinhronizacija (stale meta, noćni prelaz i sl.). U tom slučaju
    // UVIJEK radi pun fetch, da se ekran sam "izliječi".
const boardIsCurrentlyEmpty = arrivals.length === 0 && departures.length === 0;
    let hashChanged = true;
    let statusAssignments: { desks: Record<string, string>; gates: Record<string, string> } | null = null;

// ── Status ruta sa ETag ──────────────────────────────────────
try {
  const headers: HeadersInit = {};
  if (etagStatusRef.current) {
    headers['If-None-Match'] = etagStatusRef.current;
  }

  const statusRes = await fetch('/api/flights/status', { headers });
  
  // Ako je 304, nema promjene – ni hash ni dodjele – preskoči sve
  if (statusRes.status === 304) {
    // Sačuvaj novi ETag (ako stigne)
    const newEtag = statusRes.headers.get('ETag');
    if (newEtag) etagStatusRef.current = newEtag;
    
    setLastUpdate(new Date().toLocaleTimeString('en-GB'));
    isInitialLoad.current = false;
    setLoading(false);
    return; // preskoči čitav ciklus
  }

  if (statusRes.ok) {
    const statusData = await statusRes.json();
    // Sačuvaj novi ETag iz headera
    const newEtag = statusRes.headers.get('ETag');
    if (newEtag) etagStatusRef.current = newEtag;

    statusAssignments = { desks: statusData.desks ?? {}, gates: statusData.gates ?? {} };

    if (!boardIsCurrentlyEmpty && statusData.hash === lastKnownHash && lastKnownHash !== null) {
      hashChanged = false;
    } else {
      lastKnownHash = statusData.hash;
    }
  }
} catch {
  // ignoriši grešku, nastavi na pun fetch kao fallback
}

    if (!hashChanged) {
      if (statusAssignments) {
        setDepartures(prev => applyAssignmentsOnly(prev, statusAssignments!));
      }
      setLastUpdate(new Date().toLocaleTimeString('en-GB'));
      isInitialLoad.current = false;
      setLoading(false);
      return;
    }

    // ── PUN FETCH ──
    let data: any = null;
    let usedCache = false;
    try {
      const res = await fetchWithTimeout('/api/flights', FETCH_TIMEOUT_MS);
      if (!res.ok) throw new Error('Network error');
      data = await res.json();
      if (isMountedRef.current) {
        saveToCache({ arrivals: data.arrivals || [], departures: data.departures || [], lastUpdated: new Date().toLocaleTimeString('en-GB') });
      }
    } catch (err) {
      setErrorMessage('Network error. Using cached data.');
      const cached = loadFromCache();
      if (cached) { data = { arrivals: cached.arrivals, departures: cached.departures }; usedCache = true; }
      else throw err;
    }
    if (!isMountedRef.current || !data) return;

const assignments = statusAssignments ?? { desks: {}, gates: {} };

    let rawArrivals = filterRecentFlights(data.arrivals || [], true);
    rawArrivals = rawArrivals.slice(0, MAX_FLIGHTS_DISPLAY);
    let rawDepartures = getUniqueDeparturesWithDeparted(filterRecentFlights(data.departures || [], false));
    rawDepartures = rawDepartures.slice(0, MAX_FLIGHTS_DISPLAY);

    const departuresWithMeta = rawDepartures.map(f => {
      const clone = { ...f };
      const num = f.FlightNumber ?? '';

      const adminDesk = assignments.desks[num];
      if (adminDesk) {
        (clone as any).CheckInDesk = adminDesk;
      }

      const adminGate = assignments.gates[num];
      const effectiveGate = adminGate || f.GateNumber || '';
      if (effectiveGate && effectiveGate !== '-') {
        const prevGate = prevGatesRef.current[num];
        if (prevGate && prevGate !== effectiveGate) {
          (clone as any)._gateChangedAt = Date.now();
        }
        clone.GateNumber = effectiveGate;
        prevGatesRef.current[num] = effectiveGate;
      }

      return clone;
    });

    setArrivals(rawArrivals);
    setDepartures(departuresWithMeta);
    setLastUpdate(new Date().toLocaleTimeString('en-GB'));
    if (!usedCache) setErrorMessage(null);
    else setTimeout(() => setErrorMessage(null), 5_000);
  } catch (err) {
    console.error('Split board load error:', err);
    setErrorMessage('Unable to load flight data. Check connection.');
  } finally {
    isInitialLoad.current = false;
    if (isMountedRef.current) setLoading(false);
  }
}, [arrivals.length, departures.length]);

  useEffect(() => {
    isMountedRef.current = true;
    let intervalId: ReturnType<typeof setInterval>;
    loadData().then(() => {
      intervalId = setInterval(loadData, REFRESH_INTERVAL_MS);
    });
    return () => {
      isMountedRef.current = false;
      if (intervalId) clearInterval(intervalId);
    };
  }, [loadData]);

  const handleClose = useCallback(() => {
    if ((window as any).electronAPI?.quitApp) { (window as any).electronAPI.quitApp(); return; }
    try { if ((window as any).chrome?.webview) { (window as any).chrome.webview.postMessage("APP_QUIT"); return; } } catch {}
    window.postMessage({ type: "ELECTRON_APP_QUIT" }, "*");
    try { if (window.parent !== window) window.parent.postMessage({ type: "ELECTRON_APP_QUIT" }, "*"); } catch {}
    window.location.reload();
  }, []);

  const sortedArrivals = useMemo(
    () => [...arrivals].sort((a, b) => (a.ScheduledDepartureTime || "99:99").localeCompare(b.ScheduledDepartureTime || "99:99")),
    [arrivals]
  );
  const sortedDepartures = useMemo(
    () => [...departures].sort((a, b) => (a.ScheduledDepartureTime || "99:99").localeCompare(b.ScheduledDepartureTime || "99:99")),
    [departures]
  );

  // ── NOĆNI PRIKAZ — pun ekran, samo sat, bez kolona/tickera/headera ──
  if (nightMode) {
    return (
      <div className="h-screen bg-black select-none">
        <NightClock />
      </div>
    );
  }

  if (loading && arrivals.length === 0 && departures.length === 0) {
    return (
      <div className="h-screen bg-black flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-white/30 border-t-orange-500 rounded-full animate-spin mx-auto mb-4" />
          <div className="text-white text-xl">Loading flight data...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen bg-black text-white flex flex-col select-none overflow-hidden">
      {/* Dugme za zatvaranje */}
      <button
        onClick={handleClose}
        className="absolute top-3 right-3 z-50 w-10 h-10 flex items-center justify-center rounded-full bg-black/40 hover:bg-black/60 active:bg-black/80 text-white shadow-2xl transition-all duration-200 hover:scale-110 active:scale-95 border-2 border-white/20"
        type="button"
        title="Close App"
      >
        <span className="text-2xl font-bold leading-none">×</span>
      </button>

      {/* Sat */}
      <div className="flex justify-end p-4">
        <ClockDisplay />
      </div>

      {/* Dvije kolone */}
      <div className="flex-1 flex flex-row gap-4 px-4 pb-4 min-h-0 overflow-hidden">
        {/* LIJEVA KOLONA – ARRIVALS */}
        <div className="flex-1 flex flex-col min-w-0 bg-black/40 rounded-2xl border border-white/10 overflow-hidden">
          <div className="p-3 border-b border-white/15 flex-shrink-0">
            <h2 className="text-5xl font-black text-orange-500 tracking-tight drop-shadow-lg">ARRIVALS</h2>
            <p className="text-white/50 text-sm uppercase tracking-wider mt-1">Incoming flights</p>
          </div>
          <div className="flex-1 overflow-y-auto custom-scroll">
            {sortedArrivals.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-white/40 gap-3 p-8">
                <Plane className="w-12 h-12 opacity-40" />
                <div className="text-lg">No arrivals scheduled</div>
              </div>
            ) : (
              sortedArrivals.map((flight, idx) => (
                <FlightRow
                  key={`arr-${flight.FlightNumber}-${flight.ScheduledDepartureTime}-${idx}`}
                  flight={flight}
                  index={idx}
                  isArrival={true}
                  titleColor="text-orange-400"
                  autoStatusTick={autoStatusTick}
                />
              ))
            )}
          </div>
        </div>

        {/* DESNA KOLONA – DEPARTURES */}
        <div className="flex-1 flex flex-col min-w-0 bg-black/40 rounded-2xl border border-white/10 overflow-hidden">
          <div className="p-3 border-b border-white/15 flex-shrink-0">
            <h2 className="text-5xl font-black text-sky-400 tracking-tight drop-shadow-lg">DEPARTURES</h2>
            <p className="text-white/50 text-sm uppercase tracking-wider mt-1">Outgoing flights</p>
          </div>
          <div className="flex-1 overflow-y-auto custom-scroll">
            {sortedDepartures.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-white/40 gap-3 p-8">
                <Plane className="w-12 h-12 opacity-40" />
                <div className="text-lg">No departures scheduled</div>
              </div>
            ) : (
              sortedDepartures.map((flight, idx) => (
                <FlightRow
                  key={`dep-${flight.FlightNumber}-${flight.ScheduledDepartureTime}-${idx}`}
                  flight={flight}
                  index={idx}
                  isArrival={false}
                  titleColor="text-sky-400"
                  autoStatusTick={autoStatusTick}
                />
              ))
            )}
          </div>
        </div>
      </div>

      {/* Globalni stilovi */}
      <style jsx global>{`
        * { -webkit-font-smoothing: antialiased; }
        .custom-scroll::-webkit-scrollbar { width: 6px; }
        .custom-scroll::-webkit-scrollbar-track { background: rgba(255,255,255,0.1); border-radius: 3px; }
        .custom-scroll::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.4); border-radius: 3px; }
        .custom-scroll::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.6); }
        @keyframes ledBlinkA { 0% { opacity: 0.2; } 100% { opacity: 1; } }
        @keyframes ledBlinkB { 0% { opacity: 1; } 100% { opacity: 0.2; } }
        @keyframes pill-blink { 0%,50%{opacity:1} 51%,100%{opacity:.75} }
        @keyframes pill-blink-fast { 0%,40%{opacity:1} 41%,100%{opacity:.55} }
        .animate-pill-blink { animation: .8s ease-in-out infinite pill-blink; will-change: opacity; }
        .animate-pill-blink-fast { animation: .4s ease-in-out infinite pill-blink-fast; will-change: opacity; }
        .ticker-wrap { width: 100%; overflow: hidden; position: absolute; top: 0; left: 0; height: 100%; }
        .ticker-move { display: inline-block; white-space: nowrap; will-change: transform; backface-visibility: hidden; animation: ticker-scroll 45s linear infinite; }
        @keyframes ticker-scroll { 0% { transform: translate3d(0,0,0); } 100% { transform: translate3d(-50%,0,0); } }
        @media (max-width: 639px) { .ticker-move { animation-duration: 35s; } }
        @media (prefers-reduced-motion: reduce) { .animate-pill-blink, .animate-pill-blink-fast, .ticker-move { animation: none !important; opacity: 1 !important; } }
      `}</style>
    </div>
  );
}