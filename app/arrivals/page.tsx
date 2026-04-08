'use client';

import type React from "react"
import {
  type JSX,
  useEffect,
  useState,
  useCallback,
  useMemo,
  memo,
  Component,
  type ErrorInfo,
  type ReactNode,
  useRef,
} from 'react';
import type { Flight } from '@/types/flight';
import { fetchFlightData } from '@/lib/flight-service';
import { Info, Plane, Clock, MapPin } from 'lucide-react';

// ============================================================
// KONSTANTE
// ============================================================
const REFRESH_INTERVAL_MS = 60_000;
const FETCH_TIMEOUT_MS = 15_000;
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1_000;
const CACHE_KEY = "arrivals_board_cache";
const CACHE_DURATION = 5 * 60 * 1_000;
const HARD_RESET_INTERVAL_MS = 6 * 60 * 60 * 1000;
const MAX_FLIGHTS_DISPLAY = 12;
const HIDDEN_FLIGHT_PATTERNS = ["ZZZ", "G00", "PVT", "TST"];

const PLACEHOLDER_IMAGE =
  "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMzIiIGhlaWdodD0iMzIiIHZpZXdCb3g9IjAgMCAzMiAzMiIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHJlY3Qgd2lkdGg9IjMyIiBoZWlnaHQ9IjMyIiBmaWxsPSIjMzQzQzU0Ii8+Cjx0ZXh0IHg9IjE2IiB5PSIxNiIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZG9taW5hbnQtYmFzZWxpbmU9Im1pZGRsZSIgZmlsbD0iIzlDQTdCNiIgZm9udC1mYW1pbHk9IkFyaWFsLCBzYW5zLXNlcmlmIiBmb250LXNpemU9IjgiPk5vIExvZ288L3RleHQ+Cjwvc3ZnPgo=";

// ============================================================
// ERROR BOUNDARY
// ============================================================
interface ErrorBoundaryState { hasError: boolean; errorMessage: string }

class ArrivalsErrorBoundary extends Component<
  { children: ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: ReactNode }) { super(props); this.state = { hasError: false, errorMessage: "" }; }
  static getDerivedStateFromError(error: Error): ErrorBoundaryState { return { hasError: true, errorMessage: error.message }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error("Arrivals ErrorBoundary:", error, info); setTimeout(() => this.setState({ hasError: false, errorMessage: "" }), 10_000); }
  render() {
    if (this.state.hasError) return (
      <div className="h-screen bg-blue-950 flex flex-col items-center justify-center text-white gap-6">
        <Plane className="w-24 h-24 opacity-30 animate-pulse" />
        <div className="text-4xl font-bold opacity-70">Reconnecting...</div>
      </div>
    );
    return this.props.children;
  }
}

// ============================================================
// PARSERI I HELPERI (Iz combined page)
// ============================================================
const getFlightawareLogoURL = (icaoCode: string): string =>
  icaoCode ? `https://www.flightaware.com/images/airline_logos/180px/${icaoCode}.png` : "";

function parseFlightTimeToDate(timeStr: string | null | undefined): Date | null {
  if (!timeStr) return null; const s = timeStr.trim(); if (!s || s === "-" || s === "--:--") return null;
  try {
    if (s.includes("T") || (s.includes("-") && s.length > 5)) { const d = new Date(s); return isNaN(d.getTime()) ? null : d; }
    const sep = s.match(/^(\d{1,2})[:.](\d{2})$/);
    if (sep) { const h = parseInt(sep[1], 10), m = parseInt(sep[2], 10); if (h > 23 || m > 59) return null; const d = new Date(); d.setHours(h, m, 0, 0); if (Date.now() - d.getTime() > 12 * 60 * 60 * 1_000) d.setDate(d.getDate() + 1); return d; }
    const digits = s.replace(/\D/g, "");
    if (digits.length === 4) { const h = parseInt(digits.substring(0, 2), 10), m = parseInt(digits.substring(2, 4), 10); if (h > 23 || m > 59) return null; const d = new Date(); d.setHours(h, m, 0, 0); if (Date.now() - d.getTime() > 12 * 60 * 60 * 1_000) d.setDate(d.getDate() + 1); return d; }
    return null;
  } catch { return null; }
}

function formatTimeString(timeStr: string | null | undefined): string {
  if (!timeStr) return ""; const s = timeStr.trim(); if (!s || s === "-" || s === "--:--") return "";
  if (s.includes("T")) { const d = new Date(s); if (!isNaN(d.getTime())) return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }); }
  if (/^\d{2}:\d{2}$/.test(s)) return s;
  const digits = s.replace(/\D/g, "");
  if (digits.length === 4) { const h = digits.substring(0, 2), m = digits.substring(2, 4); const hi = parseInt(h, 10), mi = parseInt(m, 10); if (hi > 23 || mi > 59) return ""; if (hi === 0 && mi === 0) return ""; return `${h}:${m}`; }
  return "";
}

function isValidDisplayTime(timeStr: string | null | undefined): boolean {
  if (!timeStr) return false; const formatted = formatTimeString(timeStr); return formatted !== "" && formatted !== "00:00";
}

// ─── Cache ────────────────────────────────────────────────────
const saveToCache = (data: any) => { try { localStorage.setItem(CACHE_KEY, JSON.stringify({ data, timestamp: Date.now() })) } catch {} };
const loadFromCache = (): any | null => { try { const raw = localStorage.getItem(CACHE_KEY); if (!raw) return null; const { data, timestamp } = JSON.parse(raw); return Date.now() - timestamp > CACHE_DURATION ? null : data; } catch { return null; } };

// ─── Fetch ────────────────────────────────────────────────────
const fetchWithTimeout = async (url: string, ms: number): Promise<Response> => {
  const ctrl = new AbortController(); const id = setTimeout(() => ctrl.abort(), ms);
  try { const r = await fetch(url, { signal: ctrl.signal, headers: { "Cache-Control": "no-cache" } }); clearTimeout(id); return r; } catch (e) { clearTimeout(id); throw e; }
};
const fetchWithRetry = async (url: string, retries = MAX_RETRIES, delay = RETRY_DELAY_MS): Promise<any> => {
  let last: Error | null = null;
  for (let i = 0; i < retries; i++) { try { const r = await fetchWithTimeout(url, FETCH_TIMEOUT_MS); if (!r.ok) throw new Error(`HTTP ${r.status}`); return await r.json(); } catch (e) { last = e instanceof Error ? e : new Error(String(e)); if (i < retries - 1) await new Promise(r => setTimeout(r, delay * Math.pow(2, i))); } }
  throw last || new Error("All retries failed");
};

// ============================================================
// AUTO-STATUS ZA ARRIVALS (Iz combined page)
// ============================================================
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
// LED & STATUS PILL LOGIKA (Iz combined page)
// ============================================================
type LEDColor = "blue" | "green" | "orange" | "red" | "yellow" | "cyan" | "purple" | "lime";

const LEDIndicator = memo(function LEDIndicator({ color, phase = "a", size = "w-3 h-3" }: { color: LEDColor; phase?: "a" | "b"; size?: string }) {
  const map: Record<LEDColor, string> = { blue: "led-blue", green: "led-green", orange: "led-orange", red: "led-red", yellow: "led-yellow", cyan: "led-cyan", purple: "led-purple", lime: "led-lime" };
  return <div className={`${size} rounded-full led-base ${map[color]} ${phase === "b" ? "led-phase-b" : ""}`} />;
});

function computeStatusPill(flight: Flight, fmtTime: (t: string) => string) {
  const autoStatus = getAutoArrivalStatus(flight, fmtTime);
  const effectiveStatus = autoStatus !== null ? autoStatus : (flight.StatusEN ?? "");

  const isCancelled = /(cancelled|canceled|otkazan)/i.test(effectiveStatus);
  const isDelayed = /(delay|kasni)/i.test(effectiveStatus);
  const isEarly = /(earlier|ranije)/i.test(effectiveStatus);
  const isOnTime = /(on time|na vrijeme)/i.test(effectiveStatus);
  const isDiverted = /(diverted|preusmjeren)/i.test(effectiveStatus);
const isArrivedRaw = /(arrived|landed|sletio|sletjelo|dolazak|stigao)/i.test(effectiveStatus);
const isArrived = (() => {
  if (!isArrivedRaw) return false;
  
  // Ako je "actual" time 00:00 ili prazan — let sigurno nije stigao
  const actual = flight.ActualDepartureTime || '';
  const actualDigits = actual.replace(/\D/g, '');
  if (actualDigits === '0000' || actualDigits === '') return false;
  
  // Vremenska provjera — scheduled mora biti u prošlosti
  const timeStr = flight.EstimatedDepartureTime || flight.ScheduledDepartureTime;
  if (!timeStr) return true;
  const flightTime = parseFlightTimeToDate(timeStr);
  if (!flightTime) return true;
  return flightTime.getTime() - Date.now() <= 5 * 60 * 1000;
})();

  let displayText = effectiveStatus;
  if (isArrived) { const t = flight.EstimatedDepartureTime || flight.ScheduledDepartureTime || flight.ActualDepartureTime; displayText = `Arrived at ${t ? fmtTime(t) : ""}`; }

  const hasStatusText = displayText.trim() !== "";
  const showLEDs = isCancelled || isDelayed || isArrived || isDiverted || isEarly;

  let bg = "bg-white/10", border = "border-white/30", text = "text-white";
  let led1: LEDColor = "blue", led2: LEDColor = "green", blinkClass = "";

  if (isCancelled) { bg = "bg-red-500/20"; border = "border-red-500/50"; text = "text-red-100"; led1 = "red"; led2 = "orange"; blinkClass = "animate-pill-blink"; }
  else if (isDelayed) { bg = "bg-yellow-500/20"; border = "border-yellow-500/50"; text = "text-yellow-100"; led1 = "yellow"; led2 = "orange"; }
  else if (isEarly) { bg = "bg-purple-500/20"; border = "border-purple-500/50"; text = "text-purple-100"; led1 = "purple"; led2 = "blue"; }
  else if (isDiverted) { bg = "bg-orange-500/20"; border = "border-orange-500/50"; text = "text-orange-100"; led1 = "orange"; led2 = "red"; }
  else if (isOnTime) { bg = "bg-lime-500/20"; border = "border-lime-500/50"; text = "text-lime-100"; led1 = "lime"; led2 = "green"; }
  else if (isArrived) { bg = "bg-green-500/20"; border = "border-green-500/50"; text = "text-green-100"; led1 = "green"; led2 = "lime"; blinkClass = "animate-pill-blink"; }

  return { bg, border, text, led1, led2, blinkClass, showLEDs, hasStatusText, displayText };
}

// ============================================================
// FLIGHT ROW MEMO
// ============================================================
const FlightRow = memo(function FlightRow({ flight, index, autoStatusTick }: { flight: Flight; index: number; autoStatusTick: number }) {
  const formatTime = useCallback((t: string) => formatTimeString(t), []);
  const pill = useMemo(() => computeStatusPill(flight, formatTime), [flight, formatTime, autoStatusTick]);

  const icao = flight.AirlineICAO || flight.FlightNumber?.substring(0, 2).toUpperCase() || '';
  const logoURL = useMemo(() => getFlightawareLogoURL(icao), [icao]);
  const rowBg = index % 2 === 0 ? "bg-white/15" : "bg-white/5";

  const onImgErr = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    if (img.dataset.fallback === 'png') { img.src = PLACEHOLDER_IMAGE; img.onerror = null; return; }
    if (img.dataset.fallback === 'jpg') { img.dataset.fallback = 'png'; img.src = `/airlines/${icao}.png`; return; }
    if (icao) { img.dataset.fallback = 'jpg'; img.src = `/airlines/${icao}.jpg`; } else { img.src = PLACEHOLDER_IMAGE; img.onerror = null; }
  }, [icao]);

  const estimatedDisplay = useMemo(() => {
    const est = flight.EstimatedDepartureTime, sch = flight.ScheduledDepartureTime;
    if (!isValidDisplayTime(est)) return null;
    const estFmt = formatTimeString(est), schFmt = formatTimeString(sch);
    return estFmt === schFmt ? null : estFmt;
  }, [flight.EstimatedDepartureTime, flight.ScheduledDepartureTime]);

  const pillCls = `w-[90%] flex items-center justify-center gap-3 text-[2.5rem] font-bold rounded-2xl border-2 px-3 py-1.5 transition-colors duration-300 ${pill.bg} ${pill.border} ${pill.text} ${pill.blinkClass}`;

  return (
    <div className={`flex gap-2 p-1 border-b border-white/10 ${rowBg}`} style={{ minHeight: "68px", contain: "layout style" }}>
      <div className="flex items-center justify-center" style={{ width: "180px" }}>
        <div className="text-[2.5rem] font-black text-white drop-shadow-lg">
          {formatTimeString(flight.ScheduledDepartureTime) || <span className="text-white/40">--:--</span>}
        </div>
      </div>
      <div className="flex items-center justify-center" style={{ width: "180px" }}>
        {estimatedDisplay ? <div className="text-[2.5rem] font-black text-cyan-300 drop-shadow-lg">{estimatedDisplay}</div> : <div className="text-2xl text-white/30 font-bold">-</div>}
      </div>
      <div className="flex items-center gap-3" style={{ width: "280px" }}>
        <div className="relative w-[70px] h-11 bg-white rounded-xl p-1 shadow-xl flex-shrink-0">
          <img src={logoURL || PLACEHOLDER_IMAGE} alt={`${flight.AirlineName} logo`} className="object-contain w-full h-full" onError={onImgErr} decoding="async" loading="eager" />
        </div>
        <div className="text-[2.4rem] font-black text-white drop-shadow-lg">{flight.FlightNumber}</div>
      </div>
      <div className="flex items-center" style={{ width: "580px" }}>
        <div className="text-[3.3rem] font-black text-white truncate drop-shadow-lg">{flight.DestinationCityName || flight.DestinationAirportName}</div>
      </div>
      <div className="flex items-center justify-center flex-1 min-w-[400px]">
        {pill.hasStatusText ? (
          <div className={`${pillCls} overflow-hidden relative`} style={{ paddingLeft: pill.showLEDs ? "3.5rem" : "1rem", paddingRight: "1rem", width: "95%" }}>
            {pill.showLEDs && (
              <div className="absolute left-3 top-1/2 -translate-y-1/2 flex items-center gap-1 z-10">
                <LEDIndicator color={pill.led1} phase="a" size="w-4 h-4" />
                <LEDIndicator color={pill.led2} phase="b" size="w-4 h-4" />
              </div>
            )}
            <div className="overflow-hidden text-center whitespace-nowrap" style={{ marginLeft: pill.showLEDs ? "2.5rem" : "0", width: "100%" }}>{pill.displayText}</div>
          </div>
        ) : (
          <div className="text-[2.5rem] font-bold text-slate-300">Scheduled</div>
        )}
      </div>
    </div>
  );
}, (prev, next) => prev.autoStatusTick === next.autoStatusTick && prev.flight.FlightNumber === next.flight.FlightNumber && prev.flight.StatusEN === next.flight.StatusEN && prev.flight.EstimatedDepartureTime === next.flight.EstimatedDepartureTime && prev.flight.ScheduledDepartureTime === next.flight.ScheduledDepartureTime && prev.index === next.index);

// ============================================================
// TABLE HEADERS MEMO
// ============================================================
const TableHeaders = memo(function TableHeaders({ headers }: { headers: { label: string; width: string; icon: React.ComponentType<{ className?: string }> }[] }) {
  return (
    <div className="flex gap-2 p-2 bg-white border-b-4 border-black/30 font-black text-black text-[1.3rem] uppercase tracking-wider flex-shrink-0 shadow-xl">
      {headers.map(h => { const Icon = h.icon; return (<div key={h.label} className="flex items-stretch justify-center gap-1 px-1 h-full" style={{ width: h.width }}><Icon className="w-5 h-5 self-center" /><span className="truncate self-center">{h.label}</span></div>); })}
    </div>
  );
});

// ============================================================
// GLAVNA KOMPONENTA
// ============================================================
export default function ArrivalsPage(): JSX.Element {
  return <ArrivalsErrorBoundary><ArrivalsBoard /></ArrivalsErrorBoundary>;
}

function ArrivalsBoard(): JSX.Element {
  const [flights, setFlights] = useState<Flight[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [currentTime, setCurrentTime] = useState<string>("");
  const [autoStatusTick, setAutoStatusTick] = useState<number>(0);
  const isMountedRef = useRef(true);

  useEffect(() => { const tick = () => setCurrentTime(new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })); tick(); const id = setInterval(tick, 1_000); return () => clearInterval(id); }, []);
  useEffect(() => { const id = setInterval(() => setAutoStatusTick(t => t + 1), 60_000); return () => clearInterval(id); }, []);
  useEffect(() => { const id = setTimeout(() => window.location.reload(), HARD_RESET_INTERVAL_MS); return () => clearTimeout(id); }, []);

  const filterRecentFlights = useCallback((allFlights: Flight[]): Flight[] => {
    const now = new Date();
    return allFlights.filter(f => {
      const flightNum = (f.FlightNumber || "").toUpperCase();
      if (HIDDEN_FLIGHT_PATTERNS.some(p => flightNum.includes(p))) return false;
      const status = (f.StatusEN ?? "").toLowerCase();
      const arrived = /(arrived|landed|sletio|sletjelo|dolazak|stigao)/i.test(status);
      if (!arrived) return true;
      const timeStr = f.EstimatedDepartureTime || f.ScheduledDepartureTime || f.ActualDepartureTime;
      if (!timeStr) return false;
      const ft = parseFlightTimeToDate(timeStr);
      if (!ft) return false;
      return Math.floor((now.getTime() - ft.getTime()) / 60_000) <= 20;
    });
  }, []);

  useEffect(() => {
    isMountedRef.current = true; let tid: ReturnType<typeof setTimeout>;
    const load = async () => {
      if (!isMountedRef.current) return; let data: any | null = null; let usedCache = false;
      try {
        setLoading(true);
        try { data = await fetchWithRetry("/api/flights"); if (data && isMountedRef.current) saveToCache(data); } catch { const c = loadFromCache(); if (c) { data = c; usedCache = true; } else throw new Error("No cache"); }
        if (!isMountedRef.current || !data) return;
        setFlights(filterRecentFlights(data.arrivals).slice(0, MAX_FLIGHTS_DISPLAY));
      } catch (e) { console.error("Arrivals load error:", e); } finally { if (isMountedRef.current) { setLoading(false); tid = setTimeout(load, REFRESH_INTERVAL_MS); } }
    };
    load(); return () => { isMountedRef.current = false; clearTimeout(tid); };
  }, [filterRecentFlights]);

  const sortedFlights = useMemo(() => [...flights].sort((a, b) => (a.ScheduledDepartureTime || "99:99").localeCompare(b.ScheduledDepartureTime || "99:99")), [flights]);

  const ArrivalIcon = useCallback(({ className = "w-5 h-5" }: { className?: string }) => <Plane className={`${className} text-orange-500 rotate-90`} />, []);

  const tableHeaders = useMemo(() => [
    { label: "Scheduled", width: "180px", icon: Clock },
    { label: "Estimated", width: "180px", icon: Clock },
    { label: "Flight", width: "280px", icon: ArrivalIcon },
    { label: "From", width: "580px", icon: MapPin },
    { label: "Status", width: "450px", icon: Info },
  ], [ArrivalIcon]);

  return (
    <div className="h-screen bg-gradient-to-br from-blue-950 via-blue-900 to-blue-950 text-white p-4 transition-all duration-500 flex flex-col select-none">
      <div className="w-full mx-auto mb-4 flex-shrink-0">
        <div className="flex justify-between items-center gap-4">
          <div className="flex items-center gap-6">
            <div className="p-4 bg-transparent rounded-2xl shadow-2xl border-2 border-cyan-400"><Plane className="w-16 h-16 text-cyan-400 rotate-90" /></div>
            <div>
              <h1 className="text-[6rem] font-black text-white leading-none tracking-tight drop-shadow-2xl">ARRIVALS</h1>
              <p className="text-cyan-200 text-2xl mt-2 font-semibold">Incoming flights</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-[7rem] font-black text-white drop-shadow-2xl leading-none">{currentTime || '--:--'}</div>
            <div className="w-6 h-6 rounded-full bg-cyan-400 animate-pulse shadow-2xl flex-shrink-0" />
          </div>
        </div>
      </div>

      <div className="w-full mx-auto flex-1 min-h-0">
        {loading && sortedFlights.length === 0 ? (
          <div className="text-center p-8 h-full flex items-center justify-center">
            <div className="inline-flex items-center gap-4"><div className="w-8 h-8 border-4 border-cyan-400 border-t-transparent rounded-full animate-spin" /><span className="text-2xl text-white font-semibold">Loading arrival information...</span></div>
          </div>
        ) : (
          <div className="bg-blue-900/80 rounded-3xl border-4 border-white/20 shadow-2xl overflow-hidden h-full flex flex-col">
            <TableHeaders headers={tableHeaders} />
            <div className="flex-1 overflow-y-auto">
              {sortedFlights.length === 0 ? (
                <div className="p-8 text-center text-white/60 h-full flex flex-col items-center justify-center"><Plane className="w-16 h-16 mx-auto mb-4 opacity-50" /><div className="text-2xl font-semibold">No arrivals scheduled</div></div>
              ) : sortedFlights.map((flight, index) => <FlightRow key={`${flight.FlightNumber}-${flight.ScheduledDepartureTime}-${index}`} flight={flight} index={index} autoStatusTick={autoStatusTick} />)}
            </div>
          </div>
        )}
      </div>

      <style jsx global>{`
        #__next,body,html{height:100vh}*{-webkit-font-smoothing:antialiased}
        .led-base{will-change:opacity,box-shadow;animation:1s ease-in-out infinite alternate led-pulse}.led-phase-b{animation-delay:.5s}
        .led-blue{background:#1e3a5f}.led-green{background:#14532d}.led-orange{background:#7c2d12}.led-red{background:#7f1d1d}.led-yellow{background:#713f12}.led-cyan{background:#164e63}.led-purple{background:#4a1d96}.led-lime{background:#365314}
        @keyframes led-pulse{0%{opacity:.25;box-shadow:none}100%{opacity:1}}
        @keyframes led-pulse-blue{100%{background:#60a5fa;box-shadow:0 0 8px #60a5fa88}}@keyframes led-pulse-green{100%{background:#4ade80;box-shadow:0 0 8px #4ade8088}}@keyframes led-pulse-orange{100%{background:#fb923c;box-shadow:0 0 8px #fb923c88}}@keyframes led-pulse-red{100%{background:#f87171;box-shadow:0 0 8px #f8717188}}@keyframes led-pulse-yellow{100%{background:#facc15;box-shadow:0 0 8px #facc1588}}@keyframes led-pulse-cyan{100%{background:#22d3ee;box-shadow:0 0 8px #22d3ee88}}@keyframes led-pulse-purple{100%{background:#a78bfa;box-shadow:0 0 8px #a78bfa88}}@keyframes led-pulse-lime{100%{background:#a3e635;box-shadow:0 0 8px #a3e63588}}
        .led-blue.led-base:not(.led-phase-b){animation-name:led-pulse-blue}.led-green.led-base:not(.led-phase-b){animation-name:led-pulse-green}.led-orange.led-base:not(.led-phase-b){animation-name:led-pulse-orange}.led-red.led-base:not(.led-phase-b){animation-name:led-pulse-red}.led-yellow.led-base:not(.led-phase-b){animation-name:led-pulse-yellow}.led-cyan.led-base:not(.led-phase-b){animation-name:led-pulse-cyan}.led-purple.led-base:not(.led-phase-b){animation-name:led-pulse-purple}.led-lime.led-base:not(.led-phase-b){animation-name:led-pulse-lime}
        @keyframes pill-blink{0%,50%{opacity:1}51%,100%{opacity:.75}}.animate-pill-blink{animation:.8s ease-in-out infinite pill-blink;will-change:opacity}
        ::-webkit-scrollbar{width:6px}::-webkit-scrollbar-track{background:rgba(0,0,0,.3);border-radius:3px}::-webkit-scrollbar-thumb{background:rgba(255,255,255,.4);border-radius:3px}
        body,html{overflow:hidden;margin:0;padding:0}
      `}</style>
    </div>
  );
}