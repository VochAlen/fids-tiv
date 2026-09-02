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
import { Info, Plane, Clock, MapPin, Building2, Shield, Luggage } from 'lucide-react';
import { getInitialAirlineLogoSrc, isKnownLocalLogo } from '@/lib/airline-logo';
import { isNightHours } from '@/lib/night-hours';

// ============================================================
// KONSTANTE — Vercel Free Tier optimizacija
// ============================================================
const REFRESH_INTERVAL_MS      = 180_000;   // 90s umjesto 60s → -33% poziva
// FIX (podaci se ne učitavaju oko 4h ujutro): vidi objašnjenje u
// app/combined/CombinedPageClient.tsx — server (/api/flights) može
// legitimno trebati do ~25s na noć→dan prelazu (FETCH_LOCK wait,
// LOCK_WAIT_MAX_MS=25000 u lib/flight-data-service.ts). Podignuto na 30s.
const FETCH_TIMEOUT_MS         = 30_000; // 30s (bilo 10s)
const CACHE_KEY                = "arr_cache_v1";
const CACHE_DURATION           = 8 * 60_000; // 8 min — duži TTL
const HARD_RESET_HOUR          = 3;
const MAX_FLIGHTS_DISPLAY      = 12;
const ARRIVED_SHOW_MINUTES     = 60;        // ← prikaži 45 min nakon dolaska
const CANCELLED_SHOW_MINUTES   = 15;        // ← prikaži cancelled letove 15 minuta
const HIDDEN_PATTERNS          = ["ZZZ", "G00", "PVT", "TST"];

// let lastKnownHash: string | null = null;
// ── Low-end detekcija ──
const IS_LOW_END = typeof navigator !== 'undefined' &&
  (navigator.hardwareConcurrency ?? 4) < 4;

// ── Memory pressure threshold ──
const MEMORY_PRESSURE_THRESHOLD = 0.80;

const PLACEHOLDER =
  "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAiIGhlaWdodD0iMjYiIHZpZXdCb3g9IjAgMCA0MCAyNiIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iNDAiIGhlaWdodD0iMjYiIHJ4PSI0IiBmaWxsPSIjMjMzMjQ0Ii8+PHRleHQgeD0iMjAiIHk9IjE2IiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmaWxsPSIjNDc2MDdBIiBmb250LXNpemU9IjciIGZvbnQtZmFtaWx5PSJtb25vc3BhY2UiPk5PIExPR088L3RleHQ+PC9zdmc+";

  
// ============================================================
// ERROR BOUNDARY
// ============================================================
class ArrivalsErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean }
> {
  constructor(p: { children: ReactNode }) { super(p); this.state = { hasError: false }; }
  static getDerivedStateFromError() { return { hasError: true }; }
  componentDidCatch(e: Error, i: ErrorInfo) {
    console.error("Arrivals EB:", e, i);
    setTimeout(() => this.setState({ hasError: false }), 10_000);
  }
  render() {
    if (this.state.hasError) return (
      <div className="h-screen bg-blue-950 flex flex-col items-center justify-center text-white gap-6">
        <Plane className="w-20 h-20 opacity-30 animate-pulse" />
        <div className="text-3xl font-bold opacity-70">Reconnecting…</div>
      </div>
    );
    return this.props.children;
  }
}

// ============================================================
// HELPERS
// ============================================================
function parseTime(t: string | null | undefined): Date | null {
  if (!t) return null;
  const s = t.trim();
  if (!s || s === "-" || s === "--:--") return null;
  try {
    if (s.includes("T") || (s.includes("-") && s.length > 5)) {
      const d = new Date(s); return isNaN(d.getTime()) ? null : d;
    }
    const m = s.match(/^(\d{1,2})[:.](\d{2})$/);
    if (m) {
      const h = +m[1], min = +m[2];
      if (h > 23 || min > 59) return null;
      const d = new Date(); d.setHours(h, min, 0, 0);
      if (Date.now() - d.getTime() > 12 * 3600_000) d.setDate(d.getDate() + 1);
      return d;
    }
    const dg = s.replace(/\D/g, "");
    if (dg.length === 4) {
      const h = +dg.slice(0, 2), min = +dg.slice(2);
      if (h > 23 || min > 59) return null;
      const d = new Date(); d.setHours(h, min, 0, 0);
      if (Date.now() - d.getTime() > 12 * 3600_000) d.setDate(d.getDate() + 1);
      return d;
    }
  } catch {}
  return null;
}

function fmt(t: string | null | undefined): string {
  if (!t) return "";
  const s = t.trim();
  if (/^\d{2}:\d{2}$/.test(s)) return s;
  if (s.includes("T")) {
    const d = new Date(s);
    if (!isNaN(d.getTime())) return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  }
  const dg = s.replace(/\D/g, "");
  if (dg.length === 4) {
    const h = +dg.slice(0, 2), m = +dg.slice(2);
    if (h > 23 || m > 59 || (h === 0 && m === 0)) return "";
    return `${dg.slice(0, 2)}:${dg.slice(2)}`;
  }
  return "";
}

function validTime(t: string | null | undefined): boolean {
  const f = fmt(t); return f !== "" && f !== "00:00";
}


// ── Fetch s timeoutom ────────────────────────────────────────
const fetchWithTimeout = async (url: string, ms: number, options?: RequestInit): Promise<Response> => {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { 
      ...options, 
      signal: ctrl.signal 
    });
    clearTimeout(id);
    return r;
  } catch (e) {
    clearTimeout(id);
    throw e;
  }
};
// ============================================================
// ── Cache ─────────────────────────────────────────────────────
const saveCache = (data: { arrivals: Flight[] }) => {
  try { 
    localStorage.setItem(CACHE_KEY, JSON.stringify({ 
      data, 
      ts: Date.now() 
    })); 
  } catch { /* quota exceeded */ }
};

const loadCache = (): { arrivals: Flight[] } | null => {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const { data, ts } = JSON.parse(raw);
    if (Date.now() - ts > CACHE_DURATION) return null;
    return { arrivals: data.arrivals || [] };
  } catch { return null; }
};

function getAutoArrivalStatus(flight: Flight, fmtTime: (t: string) => string): string | null {
  const status = (flight.StatusEN ?? "").trim()

  // ── Auto-status se računa i kad API vrati generički "On time" /
  // "Scheduled" tekst, ne samo kad je status prazan ili "-" — novi
  // izvor (tiv.nais.aero) šalje eksplicitan "On time" umjesto praznog
  // stringa. Operativno značajni statusi (Cancelled, Boarding,
  // Processing, Diverted i sl.) i dalje prolaze NEIZMIJENJENI ispod.
  const isGenericStatus =
    !status || status === "-" || /^(on time|na vrijeme|scheduled)$/i.test(status)
  if (!isGenericStatus) return null

  const schStr = flight.ScheduledDepartureTime
  const estStr = flight.EstimatedDepartureTime
  if (!schStr) return null
  if (!estStr || !validTime(estStr) || schStr === estStr) return "Scheduled"
  const sch = parseTime(schStr); const est = parseTime(estStr)
  if (!sch || !est) return "Scheduled"

  // Razlika PO PREDZNAKU (ne apsolutna vrijednost):
  //   diff > 0  → estimated je KASNIJE od scheduled (kašnjenje)
  //   diff < 0  → estimated je RANIJE od scheduled (dolazak prije plana)
  const diffMinutes = (est.getTime() - sch.getTime()) / 60_000

  if (diffMinutes > 15)  return `Delayed – expected at ${fmtTime(estStr)}`
  if (diffMinutes < -15) return `Earlier – expected at ${fmtTime(estStr)}`
  return `On time – expected at ${fmtTime(estStr)}`
}

// ============================================================
// STATUS LOGIKA — POPRAVLJENA
// ============================================================
type LEDColor = "blue" | "green" | "orange" | "red" | "yellow" | "cyan" | "purple" | "lime";

interface Pill {
  pillStyle: React.CSSProperties;
  led1: LEDColor; led2: LEDColor;
  blinkClass: string; showLEDs: boolean;
  hasStatusText: boolean; displayText: string;
}


function computePill(flight: Flight): Pill {
  const rawStatus = (flight.StatusEN ?? "").trim();
  const lowerRaw = rawStatus.toLowerCase();

  // ── 1. CANCELLED (uvijek prvo) ──
  if (/(cancelled|canceled|otkazan)/i.test(lowerRaw)) {
    return {
      pillStyle: { background: 'rgba(239,68,68,0.2)', border: '2px solid rgba(239,68,68,0.5)', color: '#fecaca' },
      led1: "red", led2: "orange", blinkClass: "animate-pill-blink",
      showLEDs: true, hasStatusText: true, displayText: "Cancelled",
    };
  }
  

  // ── 2. AUTO-STATUS ako je StatusEN prazan ili "-" ──
 const auto = getAutoArrivalStatus(flight, fmt);
  const finalStatusText = auto !== null ? auto : rawStatus;

  // ── 3. NADJEDI pojedinačne riječi iz finalStatusText ──
  const lowerFinal = finalStatusText.toLowerCase();
  const isArrived  = /(arrived|landed|sletio|sletjelo|dolazak|stigao)/i.test(lowerFinal) || /(arrived|landed)/i.test(lowerRaw);
  const isDiverted = /(diverted|preusmjeren)/i.test(lowerFinal) || /(diverted)/i.test(lowerRaw);
  const isDelayed  = /(delay|kasni|delayed)/i.test(lowerFinal) || /(delay|delayed)/i.test(lowerRaw);
  const isEarly    = /(earlier|ranije|arriving early)/i.test(lowerFinal) || /(earlier)/i.test(lowerRaw);
  const isOnTime   = /(on time|na vrijeme|ontime)/i.test(lowerFinal) || /(on time)/i.test(lowerRaw);

  // ── 4. Formatiranje display teksta ──
  // Napomena: "Arrived HH:MM" (bez riječi "at") — kraći tekst da stane
  // u status kolonu na manjim TV ekranima bez sečenja teksta.
// ── 4. Formatiranje display teksta ──
  // finalStatusText već sadrži pun tekst (uključujući "expected at
  // HH:MM") iz getAutoArrivalStatus() ili iz sirovog API statusa —
  // Earlier/Delayed/On time se više ne rekonstruišu, samo prolaze kroz.
  let displayText = finalStatusText;
  if (isArrived) {
    const t = flight.EstimatedDepartureTime || flight.ScheduledDepartureTime || flight.ActualDepartureTime;
    displayText = `Arrived at ${t ? fmt(t) : ""}`.trim();
  }

  // ── 5. BOJE (samo na temelju finalnog statusa) ──
  let pillStyle: React.CSSProperties = { background: 'rgba(255,255,255,0.08)', border: '2px solid rgba(255,255,255,0.2)', color: '#fff' };
  let led1: LEDColor = "blue", led2: LEDColor = "green";
  let blinkClass = "";
  let showLEDs = true;

  if (isDiverted) {
    pillStyle = { background: 'rgba(249,115,22,0.2)', border: '2px solid rgba(249,115,22,0.5)', color: '#fed7aa' };
    led1 = "orange"; led2 = "red";
  } else if (isDelayed) {
    pillStyle = { background: '#f97316', border: '2px solid #ea580c', color: '#000000' };
    led1 = "yellow"; led2 = "orange";
  } else if (isEarly) {
    pillStyle = { background: '#38bdf8', border: '2px solid #0ea5e9', color: '#000000' };
    led1 = "cyan"; led2 = "blue";
  } else if (isOnTime) {
    pillStyle = { background: '#22c55e', border: '2px solid #16a34a', color: '#000000' };
    led1 = "lime"; led2 = "green";
  } else if (isArrived) {
    pillStyle = { background: 'rgba(34,197,94,0.2)', border: '2px solid rgba(34,197,94,0.5)', color: '#bbf7d0' };
    led1 = "green"; led2 = "lime"; blinkClass = "animate-pill-blink";
  } else {
    showLEDs = false;
  }

  const hasStatusText = displayText.trim() !== "" && displayText !== "Scheduled";

  return { pillStyle, led1, led2, blinkClass, showLEDs, hasStatusText, displayText };
}

// ============================================================
// LED
// ============================================================
const LEDIndicator = memo(function LED({ color, phase = "a" }: { color: LEDColor; phase?: "a" | "b" }) {
  const map: Record<LEDColor, string> = { blue:"led-blue", green:"led-green", orange:"led-orange", red:"led-red", yellow:"led-yellow", cyan:"led-cyan", purple:"led-purple", lime:"led-lime" };
  return <div className={`w-3.5 h-3.5 rounded-full led-base ${map[color]} ${phase === "b" ? "led-phase-b" : ""}`} />;
});

// ============================================================
// FLIGHT ROW
// ============================================================
const FlightRow = memo(function FlightRow({ flight, index, tick }: { flight: Flight; index: number; tick: number }) {
  const pill = useMemo(() => computePill(flight), [flight, tick]);
  const icao = flight.AirlineICAO || (flight.FlightNumber ?? "").slice(0, 2).toUpperCase();
  const rowBg = index % 2 === 0 ? "bg-white/15" : "bg-white/5";

const onErr = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
  const img = e.currentTarget;
  if (IS_LOW_END) {
    img.src = PLACEHOLDER;
    img.onerror = null;
    return;
  }
  if (img.dataset.t === 'local') {
    img.dataset.t = 'fa';
    const fw = `https://www.flightaware.com/images/airline_logos/180px/${icao}.png`;
    if (icao) { img.src = fw; return; }
    img.src = PLACEHOLDER; img.onerror = null; return;
  }
  img.src = PLACEHOLDER; img.onerror = null;
}, [icao]);

  const estDisplay = useMemo(() => {
    const e = fmt(flight.EstimatedDepartureTime);
    const s = fmt(flight.ScheduledDepartureTime);
    return validTime(flight.EstimatedDepartureTime) && e !== s ? e : null;
  }, [flight.EstimatedDepartureTime, flight.ScheduledDepartureTime]);

  const airlineName = flight.AirlineName
    ? flight.AirlineName.length > 20
      ? flight.AirlineName.slice(0, 19) + "…"
      : flight.AirlineName
    : icao;

  return (
<div
  className={`fids-row flex gap-0 p-0 border-b border-white/10 ${rowBg}`}
  style={{ contain: "layout style paint", contentVisibility: "auto", containIntrinsicSize: "auto 68px" }}
>
      <div className="fids-cell fids-w-sch flex items-center justify-center">
        <span className="fids-time">{fmt(flight.ScheduledDepartureTime) || <span className="text-white/30">--:--</span>}</span>
      </div>

      <div className="fids-cell fids-w-est flex items-center justify-center">
        {estDisplay
          ? <span className="fids-time fids-est">{estDisplay}</span>
          : <span className="fids-dash">–</span>}
      </div>

      <div className="fids-cell fids-w-logo flex items-center justify-center">
        <div className="fids-logo-wrap">
<img
  src={getInitialAirlineLogoSrc(icao, PLACEHOLDER)}
  alt=""
  className="object-contain w-full h-full"
  onError={onErr}
  data-t={isKnownLocalLogo(icao) ? 'local' : 'fa'}
  decoding="async"
  loading={index < 9 ? "eager" : "lazy"}
/>
        </div>
      </div>

      <div className="fids-cell fids-w-airline flex items-center">
        <span className="fids-airline-name">{airlineName}</span>
      </div>

      <div className="fids-cell fids-w-fn flex items-center justify-center">
        <span className="fids-flnum">{flight.FlightNumber}</span>
      </div>

      <div className="fids-cell fids-w-city flex items-center">
        <span className="fids-city truncate">{flight.DestinationCityName || flight.DestinationAirportName || "—"}</span>
      </div>

      <div className="fids-cell fids-w-status flex items-center justify-center">
        {pill.hasStatusText ? (
          <div className={`fids-pill ${pill.blinkClass}`} style={pill.pillStyle}>
            {pill.showLEDs && (
              <div className="fids-leds">
                <LEDIndicator color={pill.led1} phase="a" />
                <LEDIndicator color={pill.led2} phase="b" />
              </div>
            )}
            <span className="fids-pill-text">{pill.displayText}</span>
          </div>
        ) : (
          <span className="fids-scheduled">Scheduled</span>
        )}
      </div>
    </div>
  );
}, (p, n) =>
  p.tick === n.tick &&
  p.index === n.index &&
  p.flight.FlightNumber === n.flight.FlightNumber &&
  p.flight.StatusEN === n.flight.StatusEN &&
  p.flight.EstimatedDepartureTime === n.flight.EstimatedDepartureTime &&
  p.flight.ScheduledDepartureTime === n.flight.ScheduledDepartureTime
);

// ============================================================
// CLOCK
// ============================================================
const ClockDisplay = memo(function ClockDisplay() {
  const [t, setT] = useState("");
  useEffect(() => {
    const tick = () => setT(new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }));
    tick();
    const id = setInterval(tick, 10_000); // ← bilo 1_000
    return () => clearInterval(id);
  }, []);
  return <span className="fids-clock">{t || "--:--"}</span>;
});

// ============================================================
// FOOTER
// ============================================================
const FooterMessage = memo(function FooterMessage() {
  return (
    <div className="fids-footer">
      <div className="fids-footer-icons">
        <Shield className="w-5 h-5" />
        <Luggage className="w-5 h-5" />
      </div>
      <div className="fids-footer-text">
        <span>Welcome to Montenegro. May your stay be enjoyable and memorable.</span>
        <span className="fids-footer-separator">•</span>
        <span>Keep your personal belongings with you at all times.</span>
                <span className="fids-footer-separator">•</span>
        {/* <span>Passengers must declare goods exceeding duty-free allowances at Customs Control.</span>
                  <span className="fids-footer-separator">•</span>
        <span>Free Wi-Fi available throughout the terminal.</span> */}
      </div>
    </div>
  );
});

// ============================================================
// MAIN EXPORT
// ============================================================
export default function ArrivalsPageClient(): JSX.Element {
    return <ArrivalsErrorBoundary><ArrivalsBoard /></ArrivalsErrorBoundary>;
}

// ============================================================
// BOARD
// ============================================================
function ArrivalsBoard(): JSX.Element {
  const [flights, setFlights]   = useState<Flight[]>([]);
  const [loading, setLoading]   = useState(true);
  const [tick, setTick]         = useState(0);
   const [reducedAnimations, setReducedAnimations] = useState(IS_LOW_END); // ← novo
  const mounted                 = useRef(true);
  const lastHeartbeat = useRef(Date.now());
useEffect(() => {
  const id = setInterval(() => {
    if (Date.now() - lastHeartbeat.current > 120_000) window.location.reload();
    // ← NEMA više 'else' grane ovdje — samo provjerava, ne ažurira
  }, 30_000);
  return () => clearInterval(id);
}, []);

// ── FIX (24/7 rad bez nadzora): border ranije nije imao NI globalni
// error handler NI handler za neuhvaćene odbijene promise-e — obje
// greške VAN React render stabla (event handleri, tajmeri, async kod)
// koje Error Boundary NE hvata. Vidi identičan obrazac u
// CombinedPageClient.tsx / departures/page.tsx. ──
useEffect(() => {
  const onErr = (e: ErrorEvent) => {
    const m = e.error?.message || '';
    if (m.includes('Out of memory') || m.includes('stack overflow') || m.includes('heap')) {
      setTimeout(() => window.location.reload(), 2_000);
    }
  };
  window.addEventListener('error', onErr);
  return () => window.removeEventListener('error', onErr);
}, []);

useEffect(() => {
  const onRejection = (e: PromiseRejectionEvent) => {
    console.error('[border] Neuhvaćena odbijena promise:', e.reason?.message || e.reason);
  };
  window.addEventListener('unhandledrejection', onRejection);
  return () => window.removeEventListener('unhandledrejection', onRejection);
}, []);

  // ── Dodaj na vrh komponente, zajedno sa ostalim ref-ovima ──
const etagRef = useRef<string | null>(null);
const tidRef = useRef<ReturnType<typeof setTimeout> | null>(null);
const isLoadingRef = useRef(false);
 useEffect(() => {
    if (IS_LOW_END) return;
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
    const id = setInterval(checkMemory, 60_000);
    return () => clearInterval(id);
  }, []);



  // Inject CSS on client
 useEffect(() => {
  const existing = document.getElementById('arr-styles');
  if (existing) existing.remove(); // ← ukloni stari da može da se update-uje
  const el = document.createElement('style');
  el.id = 'arr-styles';
    el.textContent = `
        html,body,#__next{height:100vh;margin:0;padding:0;overflow:hidden}
        *{box-sizing:border-box;-webkit-font-smoothing:antialiased}

        .fids-root{
          height:100vh;
          background:linear-gradient(135deg,#0c1a35 0%,#0d2151 50%,#0c1a35 100%);
          color:#fff;
          display:flex;
          flex-direction:column;
          padding:0.6rem 0.8rem 0.4rem;
          gap:0.5rem;
          user-select:none;
          font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
        }

        .fids-header{
          display:flex;align-items:center;justify-content:space-between;
          flex-shrink:0;
          padding-bottom:0.4rem;
          border-bottom:2px solid rgba(34,211,238,0.25);
        }
        .fids-header-left{display:flex;align-items:center;gap:0.75rem}
        .fids-plane-wrap{
          padding:0.5rem;
          border:2px solid rgba(34,211,238,0.5);
          border-radius:0.75rem;
          flex-shrink:0;
        }
        .fids-plane-icon{width:2rem;height:2rem;color:#22d3ee;transform:rotate(90deg)}
        .fids-title{
          font-size:clamp(2rem,5vw,3.5rem);
          font-weight:900;
          line-height:1;
          letter-spacing:-0.02em;
          color:#fff;
          text-shadow:0 2px 8px rgba(0,0,0,0.5);
        }
        .fids-subtitle{
          font-size:clamp(0.7rem,1.5vw,1rem);
          color:#93c5fd;
          margin-top:0.15rem;
          font-weight:500;
        }
        .fids-header-right{display:flex;align-items:center;gap:0.75rem}
        .fids-clock{
          font-size:clamp(2rem,6vw,4.5rem);
          font-weight:900;
          font-variant-numeric:tabular-nums;
          letter-spacing:0.05em;
          line-height:1;
          text-shadow:0 2px 8px rgba(0,0,0,0.4);
        }
        .fids-pulse-dot{
          width:0.85rem;height:0.85rem;border-radius:50%;
          background:#22d3ee;
          box-shadow:0 0 8px #22d3ee;
          animation:pdot 2s ease-in-out infinite;
        }
        @keyframes pdot{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.4;transform:scale(.85)}}

        .fids-table-wrap{flex:1;min-height:0;display:flex;flex-direction:column}
        .fids-table{
          background:rgba(15,30,60,0.75);
          border:2px solid rgba(255,255,255,0.12);
          border-radius:1rem;
          overflow:hidden;
          display:flex;
          flex-direction:column;
          height:100%;
        }

        .fids-w-sch    {width:clamp(110px,9vw,160px);flex-shrink:0}
        .fids-w-est    {width:clamp(110px,9vw,160px);flex-shrink:0}
        .fids-w-logo   {width:clamp(60px,5vw,90px);flex-shrink:0}
        .fids-w-airline{width:clamp(120px,12vw,200px);flex-shrink:0}
        .fids-w-fn     {width:clamp(110px,9vw,160px);flex-shrink:0}
        .fids-w-city   {flex:1;min-width:0}
       .fids-w-status {width:clamp(240px,24vw,420px);flex-shrink:0}

        .fids-thead{
          display:flex;gap:0;
          background:#fff;
          border-bottom:3px solid rgba(0,0,0,0.2);
          flex-shrink:0;
        }
        .fids-th{
          display:flex;align-items:center;justify-content:center;gap:0.3rem;
          padding:0.4rem 0.5rem;
          font-size:clamp(0.65rem,1.2vw,0.85rem);
          font-weight:900;
          color:#000;
          text-transform:uppercase;
          letter-spacing:0.08em;
          white-space:nowrap;
        }

        .fids-tbody{flex:1;overflow-y:auto}
        .fids-tbody::-webkit-scrollbar{width:5px}
        .fids-tbody::-webkit-scrollbar-track{background:rgba(0,0,0,.2)}
        .fids-tbody::-webkit-scrollbar-thumb{background:rgba(255,255,255,.3);border-radius:3px}

        .fids-row{
          display:flex;align-items:center;
          min-height:clamp(52px,6.5vh,74px);
          border-bottom:1px solid rgba(255,255,255,0.08);
        }

        .fids-cell{
          padding:0.3rem 0.5rem;
          display:flex;align-items:center;
          height:100%;
          border-right:1px solid rgba(255,255,255,0.06);
        }
        .fids-cell:last-child{border-right:none}

        .fids-time{
          font-size:clamp(1.25rem,2.2vw,1.9rem);
          font-weight:900;
          font-variant-numeric:tabular-nums;
          letter-spacing:0.02em;
          white-space:nowrap;
        }
        .fids-est{color:#fcd34d}
        .fids-dash{font-size:1.2rem;color:rgba(255,255,255,0.2);font-weight:700}

        .fids-logo-wrap{
          width:clamp(44px,4.5vw,66px);
          height:clamp(26px,2.8vw,40px);
          background:#fff;
          border-radius:5px;
          padding:2px;
          overflow:hidden;
          display:flex;align-items:center;justify-content:center;
        }

        .fids-airline-name{
          font-size:clamp(0.75rem,1.4vw,1.05rem);
          font-weight:600;
          color:rgba(255,255,255,0.8);
          white-space:nowrap;
          overflow:hidden;
          text-overflow:ellipsis;
          max-width:100%;
        }

        .fids-flnum{
          font-size:clamp(1.1rem,2vw,1.7rem);
          font-weight:900;
          letter-spacing:0.03em;
          white-space:nowrap;
        }

        .fids-city{
          font-size:clamp(1.3rem,2.4vw,2.1rem);
          font-weight:900;
          letter-spacing:-0.01em;
          line-height:1.1;
        }
.fids-pill{
  display:flex;align-items:center;justify-content:center;
  gap:0.4rem;
  width:96%;
  padding:0.3rem 0.6rem;
  border-radius:0.6rem;
  border-style:solid;
  font-size:clamp(0.8rem,1.5vw,1.2rem);
  font-weight:700;
  text-align:center;
  position:relative;
  overflow:hidden;
}
        .fids-leds{display:flex;gap:4px;flex-shrink:0}
.fids-pill-text{
  overflow:hidden;
  display:-webkit-box;
  -webkit-line-clamp:2;
  -webkit-box-orient:vertical;
  white-space:normal;
  line-height:1.15;
  text-align:center;
  word-break:break-word;
  font-size:clamp(0.65rem, 1.1vw, 0.98rem) !important;
}
        .fids-scheduled{
          font-size:clamp(0.8rem,1.4vw,1.1rem);
          font-weight:600;
          color:rgba(255,255,255,0.45);
        }

      .led-base{animation:1s ease-in-out infinite alternate led-pulse-generic}
        .led-phase-b{animation-delay:.55s}
        @keyframes led-pulse-generic{0%{opacity:.2}100%{opacity:1}}
        .led-blue  {background:#60a5fa;box-shadow:0 0 6px #60a5fa80}
        .led-green {background:#4ade80;box-shadow:0 0 6px #4ade8080}
        .led-orange{background:#fb923c;box-shadow:0 0 6px #fb923c80}
        .led-red   {background:#f87171;box-shadow:0 0 6px #f8717180}
        .led-yellow{background:#facc15;box-shadow:0 0 6px #facc1580}
        .led-cyan  {background:#22d3ee;box-shadow:0 0 6px #22d3ee80}
        .led-purple{background:#a78bfa;box-shadow:0 0 6px #a78bfa80}
        .led-lime  {background:#a3e635;box-shadow:0 0 6px #a3e63580}

        @keyframes pill-blink{0%,50%{opacity:1}51%,100%{opacity:.7}}
     .animate-pill-blink{animation:.9s ease-in-out infinite pill-blink}

        .fids-loading{
          flex:1;display:flex;flex-direction:column;
          align-items:center;justify-content:center;
          gap:1rem;color:rgba(255,255,255,0.5);
          font-size:1.1rem;
        }
        .fids-spinner{
          width:2rem;height:2rem;
          border:3px solid rgba(255,255,255,0.15);
          border-top-color:#22d3ee;
          border-radius:50%;
          animation:spin .8s linear infinite;
        }
        @keyframes spin{to{transform:rotate(360deg)}}
        .fids-empty{
          padding:3rem;text-align:center;
          color:rgba(255,255,255,0.35);
          font-size:1.3rem;font-weight:600;
        }

        /* ── Footer ─────────────────────────────────── */
        .fids-footer{
          flex-shrink:0;
          margin-top:0.5rem;
          padding:0.6rem 1rem;
          background:rgba(0,0,0,0.3);
          border-radius:0.75rem;
          backdrop-filter:blur(8px);
          border:1px solid rgba(34,211,238,0.2);
          display:flex;
          align-items:center;
          justify-content:center;
          gap:1rem;
          flex-wrap:wrap;
        }
        .fids-footer-icons{
          display:flex;
          align-items:center;
          gap:0.5rem;
          color:#22d3ee;
          opacity:0.8;
        }
        .fids-footer-text{
          display:flex;
          align-items:center;
          gap:0.75rem;
          flex-wrap:wrap;
          justify-content:center;
          font-size:clamp(0.7rem,1.2vw,0.85rem);
          font-weight:500;
          color:rgba(255,255,255,0.85);
          letter-spacing:0.3px;
        }
        .fids-footer-separator{
          color:#22d3ee;
          opacity:0.6;
          font-size:0.8rem;
        }

        @media (max-width: 768px) {
          .fids-footer-text{
            gap:0.4rem;
          }
          .fids-footer-separator{
            display:none;
          }
          .fids-footer-text{
            flex-direction:column;
            gap:0.2rem;
          }
        }

        /* ── Manji TV ekrani — status kolona nije imala dovoljno
           prostora da ispiše "Arrived HH:MM" bez sečenja teksta.
           Oslobađamo prostor smanjenjem manje bitnih kolona
           (airline / flight number) i dajemo status koloni veći
           minimum, uz kompaktniji pill (manji padding/gap/LED-ovi
           i font koji se dodatno smanjuje na uskim ekranima). ── */
      @media (max-width: 1000px) {
  .fids-row{min-height:clamp(58px,7.5vh,84px)}
  .fids-w-airline{width:clamp(80px,8vw,140px)}
  .fids-w-fn     {width:clamp(90px,7vw,130px)}
  .fids-w-sch    {width:clamp(90px,7vw,140px)}
  .fids-w-est    {width:clamp(90px,7vw,140px)}
  .fids-w-status {width:clamp(210px,30vw,420px)}
  .fids-pill{padding:0.22rem 0.4rem;gap:0.28rem;width:98%}
  .fids-pill-text{font-size:clamp(0.62rem,1.9vw,1rem)}
  .fids-leds{gap:2px}
  .fids-leds > div{width:10px;height:10px}
}
@media (max-width: 700px) {
  .fids-row{min-height:clamp(64px,9vh,90px)}
  .fids-w-status {width:clamp(180px,34vw,420px)}
  .fids-pill-text{font-size:clamp(0.56rem,2.1vw,0.9rem)}
}
 

     @media(prefers-reduced-motion:reduce){
  /* Gasimo SAMO dekorativne animacije, NE LED i pill-blink (funkcionalni su) */
  .fids-pulse-dot{animation:none!important;opacity:1!important}
  .fids-spinner{animation:none!important;opacity:1!important}
  /* LED i pill-blink OSTAJU aktivni */
}
${reducedAnimations ? `
.animate-pulse{animation:none!important;opacity:1!important}
.fids-spinner{animation:none!important;opacity:1!important}
/* LED i pill-blink OSTAJU aktivni */
` : ''}
      `;
 document.head.appendChild(el);
  return () => { document.getElementById('arr-styles')?.remove(); };
}, [reducedAnimations]); // ← dodaj zavisnost

  // Auto-status tick svake 60s
  useEffect(() => { const id = setInterval(() => setTick(t => t + 1), 60_000); return () => clearInterval(id); }, []);

  // Hard reset u 03:00
  useEffect(() => {
    const now = new Date(), reset = new Date();
    reset.setHours(HARD_RESET_HOUR, 0, 0, 0);
    if (reset <= now) reset.setDate(reset.getDate() + 1);
    const id = setTimeout(() => window.location.reload(), reset.getTime() - now.getTime());
    return () => clearTimeout(id);
  }, []);

  // Kiosk — bez context menu
  useEffect(() => {
    const p = (e: Event) => e.preventDefault();
    document.addEventListener("contextmenu", p);
    document.addEventListener("selectstart", p);
    return () => { document.removeEventListener("contextmenu", p); document.removeEventListener("selectstart", p); };
  }, []);

  // Filter letova
  const filter = useCallback((all: Flight[]): Flight[] => {
    const now = Date.now();
    return all.filter(f => {
      const fn = (f.FlightNumber ?? "").toUpperCase();
      if (HIDDEN_PATTERNS.some(p => fn.includes(p))) return false;

      const s = (f.StatusEN ?? "").toLowerCase();
      const isCancelled = /(cancelled|canceled|otkazan)/.test(s);
      const isArrived = /(arrived|landed|sletio|sletjelo|dolazak|stigao)/.test(s);

      if (isCancelled) {
        const tStr = f.ScheduledDepartureTime;
        const t = parseTime(tStr);
        if (!t) return false;
        return (now - t.getTime()) / 60_000 <= CANCELLED_SHOW_MINUTES;
      }

      if (isArrived) {
        const tStr = f.ActualDepartureTime || f.EstimatedDepartureTime || f.ScheduledDepartureTime;
        const t = parseTime(tStr);
        if (!t) return false;
        return (now - t.getTime()) / 60_000 <= ARRIVED_SHOW_MINUTES;
      }

      return true;
    });
  }, []);
  // ── Load funkcija (definisana prije useEffect) ──────────────
// ── Load funkcija ─────────────────────────────────────────────
const load = useCallback(async () => {
  // Spriječi istovremene pozive
  if (isLoadingRef.current) {
    console.log('⏳ load already in progress, skipping');
    return;
  }
  isLoadingRef.current = true;

  if (!mounted.current) {
    isLoadingRef.current = false;
    return;
  }

  // ── NOĆNI REŽIM ──
  if (isNightHours()) {
    setLoading(false);
    isLoadingRef.current = false;
    clearTimeout(tidRef.current!);
    tidRef.current = setTimeout(load, REFRESH_INTERVAL_MS);
    return;
  }

  try {
    const headers: HeadersInit = {};
    if (etagRef.current) {
      headers["If-None-Match"] = etagRef.current;
    }

    // ✅ KORISTI fetchWithTimeout S cache opcijom
const res = await fetchWithTimeout("/api/flights", FETCH_TIMEOUT_MS, {
  headers,
  cache: 'force-cache',  // ← Vercel edge cache
});

    // ✅ 304 - ništa se nije promijenilo
    if (res.status === 304) {
      const newEtag = res.headers.get('ETag');
      if (newEtag) etagRef.current = newEtag;
      setLoading(false);
      lastHeartbeat.current = Date.now(); // ← Ažuriraj heartbeat
      clearTimeout(tidRef.current!);
      tidRef.current = setTimeout(load, REFRESH_INTERVAL_MS);
      return;
    }

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json();
    const newEtag = res.headers.get('ETag');
    if (newEtag) etagRef.current = newEtag;

    if (mounted.current) {
      // ✅ Spremi SAMO arrivals u cache
      saveCache({ arrivals: data.arrivals || [] });
      
      if (data?.arrivals) {
        setFlights(filter(data.arrivals).slice(0, MAX_FLIGHTS_DISPLAY));
        setLoading(false);
        lastHeartbeat.current = Date.now(); // ← Ažuriraj heartbeat
      }
    }
  } catch (err) {
    // ✅ Ako je AbortError, samo izađi (timeout)
    if ((err as Error).name === 'AbortError') {
      console.log('⏱️ Fetch timeout, using cache if available');
    } else {
      console.error("Arrivals load error:", err);
    }

    // ✅ Koristi cache na bilo kojem erroru
    const c = loadCache();
    if (c?.arrivals && mounted.current) {
      setFlights(filter(c.arrivals).slice(0, MAX_FLIGHTS_DISPLAY));
      setLoading(false);
      lastHeartbeat.current = Date.now(); // ← Ažuriraj heartbeat i na erroru
    }
  } finally {
    isLoadingRef.current = false;
    if (mounted.current) {
      clearTimeout(tidRef.current!);
      tidRef.current = setTimeout(load, REFRESH_INTERVAL_MS);
    }
  }
}, [filter, etagRef, tidRef, isLoadingRef, mounted]);

  // Load
// Load
// Load
// ── Inicijalni load i polling ──────────────────────────────
useEffect(() => {
  mounted.current = true;
  const cached = loadCache();
  if (cached?.arrivals) {
    setFlights(filter(cached.arrivals).slice(0, MAX_FLIGHTS_DISPLAY));
    setLoading(false);
    tidRef.current = setTimeout(load, REFRESH_INTERVAL_MS); // ← pokreni petlju i iz keš-grane
  } else {
    load();
  }
  return () => {
    mounted.current = false;
    clearTimeout(tidRef.current!);
    tidRef.current = null;
  };
}, [filter, load]);

  const sorted = useMemo(() =>
    [...flights].sort((a, b) =>
      (a.ScheduledDepartureTime ?? "99:99").localeCompare(b.ScheduledDepartureTime ?? "99:99")
    ), [flights]);

  const ArrIcon = useCallback(({ className = "w-4 h-4" }: { className?: string }) =>
    <Plane className={`${className} text-orange-500 rotate-90`} />, []);

  const headers: { label: string; cls: string; icon: React.ComponentType<{ className?: string }> }[] = useMemo(() => [
    { label: "Scheduled", cls: "fids-w-sch",     icon: Clock },
    { label: "Estimated", cls: "fids-w-est",     icon: Clock },
    { label: "",          cls: "fids-w-logo",    icon: ArrIcon },
    { label: "Airline",   cls: "fids-w-airline", icon: Building2 },
    { label: "Flight",    cls: "fids-w-fn",      icon: ArrIcon },
    { label: "From",      cls: "fids-w-city",    icon: MapPin },
    { label: "Status",    cls: "fids-w-status",  icon: Info },
  ], [ArrIcon]);

  return (
    <div className="fids-root">
      {/* Header */}
      <div className="fids-header">
        <div className="fids-header-left">
          <div className="fids-plane-wrap">
            <Plane className="fids-plane-icon" />
          </div>
          <div>
            <h1 className="fids-title">ARRIVALS</h1>
            <p className="fids-subtitle">Incoming flights · Tivat International Airport</p>
          </div>
        </div>
        <div className="fids-header-right">
          <ClockDisplay />
          <div className="fids-pulse-dot" />
        </div>
      </div>

      {/* Table */}
      <div className="fids-table-wrap">
        {loading && sorted.length === 0 ? (
          <div className="fids-loading">
            <div className="fids-spinner" />
            <span>Loading arrival data…</span>
          </div>
        ) : (
          <div className="fids-table">
            <div className="fids-thead">
              {headers.map(h => {
                const Icon = h.icon;
                return (
                  <div key={h.label} className={`fids-th ${h.cls}`}>
                    <Icon className="w-4 h-4 flex-shrink-0" />
                    {h.label && <span>{h.label}</span>}
                  </div>
                );
              })}
            </div>
            <div className="fids-tbody">
              {sorted.length === 0 ? (
                <div className="fids-empty">
                  <Plane className="w-12 h-12 opacity-30 mx-auto mb-3" />
                  <div>No arrivals scheduled</div>
                </div>
              ) : sorted.map((f, i) => (
                <FlightRow key={`${f.FlightNumber}-${f.ScheduledDepartureTime}-${i}`} flight={f} index={i} tick={tick} />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <FooterMessage />
    </div>
  );
}