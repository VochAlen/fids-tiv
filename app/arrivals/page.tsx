/* eslint-disable react-hooks/set-state-in-effect */
/* eslint-disable react-hooks/purity */
/* eslint-disable react-hooks/refs */
/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import { JSX, useEffect, useState, useCallback, useMemo, useRef, memo, Component, type ErrorInfo, type ReactNode } from 'react';
import type { Flight } from '@/types/flight';
import { Info, Plane, Clock, MapPin, Building2 } from 'lucide-react';
import { getInitialAirlineLogoSrc, isKnownLocalLogo } from '@/lib/airline-logo';
import { isNightHours } from '@/lib/night-hours';
import { useRealtimeFlightData } from '@/hooks/useRealtimeFlightData';
import { useWeather } from '@/hooks/use-weather';
import WeatherIcon from '@/components/weather-icon';

// ── v4.2: Per-flight weather cell for arrivals (origin city) ──
const ArrivalWeatherCell = memo(function ArrivalWeatherCell({
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
const HARD_RESET_INTERVAL_MS = 6 * 60 * 60 * 1000;
const HEARTBEAT_TIMEOUT_MS = 120_000;
const HEARTBEAT_CHECK_INTERVAL_MS = 30_000;
const MEMORY_CLEANUP_INTERVAL_MS = 30 * 60_000;
const MAX_FLIGHTS_MEMORY = 60;
const PAGE_SIZE = 9;
const PAGE_ROTATE_MS = 20_000;
const HIDDEN_FLIGHT_PATTERNS = ['ZZZ', 'G00', 'PVT', 'TST'];

const COLOR_CONFIG = {
  background: 'bg-gradient-to-br from-blue-950 via-blue-900 to-blue-950',
  accent:     'bg-cyan-400',
  header:     'bg-white',
  title:      'text-white',
  subtitle:   'text-cyan-200',
  border:     'border-cyan-400',
  cardBg:     'bg-blue-900/80',
};

const PLACEHOLDER_IMAGE =
  'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMzIiIGhlaWdodD0iMzIiIHZpZXdCb3g9IjAgMCAzMiAzMiIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHJlY3Qgd2lkdGg9IjMyIiBoZWlnaHQ9IjMyIiBmaWxsPSIjMzQzQzU0Ii8+Cjx0ZXh0IHg9IjE2IiB5PSIxNiIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZG9taW5hbnQtYmFzZWxpbmU9Im1pZGRsZSIgZmlsbD0iIzlDQTdCNiIgZm9udC1mYW1pbHk9IkFyaWFsLCBzYW5zLXNlcmlmIiBmb250LXNpemU9IjgiPk5vIExvZ288L3RleHQ+Cjwvc3ZnPgo=';

// ============================================================
// ERROR BOUNDARY
// ============================================================
interface EBState { hasError: boolean; errorMessage: string }
class ArrivalsErrorBoundary extends Component<{ children: ReactNode }, EBState> {
  constructor(props: { children: ReactNode }) { super(props); this.state = { hasError: false, errorMessage: '' }; }
  static getDerivedStateFromError(e: Error): EBState { return { hasError: true, errorMessage: e.message }; }
  componentDidCatch(e: Error, i: ErrorInfo) { console.error('Arrivals ErrorBoundary:', e, i); setTimeout(() => this.setState({ hasError: false, errorMessage: '' }), 10_000); }
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
// HELPER FUNKCIJE
// ============================================================
const getFlightawareLogoURL = (icaoCode: string): string =>
  icaoCode ? `https://www.flightaware.com/images/airline_logos/180px/${icaoCode}.png` : '';

function parseFlightTimeToDate(timeStr: string | null | undefined): Date | null {
  if (!timeStr) return null;
  const s = timeStr.trim();
  if (!s || s === '-' || s === '--:--') return null;
  try {
    if (s.includes('T') || (s.includes('-') && s.length > 5)) {
      const d = new Date(s); return isNaN(d.getTime()) ? null : d;
    }
    const sep = s.match(/^(\d{1,2})[:.](\d{2})$/);
    if (sep) {
      const h = parseInt(sep[1], 10), m = parseInt(sep[2], 10);
      if (h > 23 || m > 59) return null;
      const d = new Date(); d.setHours(h, m, 0, 0);
      if (Date.now() - d.getTime() > 12 * 60 * 60 * 1_000) d.setDate(d.getDate() + 1);
      return d;
    }
    return null;
  } catch { return null; }
}

function formatTimeString(timeStr: string | null | undefined): string {
  if (!timeStr) return '';
  const s = timeStr.trim();
  if (!s || s === '-' || s === '--:--') return '';
  if (s.includes('T')) {
    const d = new Date(s);
    if (!isNaN(d.getTime())) return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  }
  if (/^\d{2}:\d{2}$/.test(s)) return s;
  const digits = s.replace(/\D/g, '');
  if (digits.length === 4) {
    const h = digits.substring(0, 2), m = digits.substring(2, 4);
    const hi = parseInt(h, 10), mi = parseInt(m, 10);
    if (hi > 23 || mi > 59) return '';
    if (hi === 0 && mi === 0) return '';
    return `${h}:${m}`;
  }
  return '';
}

function isValidDisplayTime(timeStr: string | null | undefined): boolean {
  if (!timeStr) return false;
  const formatted = formatTimeString(timeStr);
  return formatted !== '' && formatted !== '00:00';
}

// ============================================================
// AUTO-STATUS ZA ARRIVALS
// ============================================================
function getAutoArrivalStatus(flight: Flight, fmtTime: (t: string) => string): string | null {
  const status = (flight.StatusEN ?? '').trim();
  const isGenericStatus =
    !status || status === '-' || /^(on time|na vrijeme|scheduled)$/i.test(status);
  if (!isGenericStatus) return null;

  const scheduledStr = flight.ScheduledDepartureTime;
  const estimatedStr = flight.EstimatedDepartureTime;
  if (!scheduledStr) return null;
  if (!estimatedStr || !isValidDisplayTime(estimatedStr) || scheduledStr === estimatedStr) return 'Scheduled';
  const scheduled = parseFlightTimeToDate(scheduledStr);
  const estimated = parseFlightTimeToDate(estimatedStr);
  if (!scheduled || !estimated) return 'Scheduled';

  const diffMinutes = (estimated.getTime() - scheduled.getTime()) / 60_000;

  if (diffMinutes > 15) return `Delayed – expected at ${fmtTime(estimatedStr)}`;
  if (diffMinutes < -15) return `Earlier – expected at ${fmtTime(estimatedStr)}`;
  return `On time – expected at ${fmtTime(estimatedStr)}`;
}

// ============================================================
// LED & STATUS PILL LOGIKA
// ============================================================
type LEDColor = 'blue' | 'green' | 'orange' | 'red' | 'yellow' | 'cyan' | 'purple' | 'lime';

const LEDIndicator = memo(function LEDIndicator({ color, phase = 'a', size = 'w-3 h-3' }: { color: LEDColor; phase?: 'a' | 'b'; size?: string }) {
  const map: Record<LEDColor, string> = {
    blue: 'led-blue', green: 'led-green', orange: 'led-orange', red: 'led-red',
    yellow: 'led-yellow', cyan: 'led-cyan', purple: 'led-purple', lime: 'led-lime',
  };
  return <div className={`${size} rounded-full led-base ${map[color]} ${phase === 'b' ? 'led-phase-b' : ''}`} />;
});

function computeStatusPill(flight: Flight, fmtTime: (t: string) => string) {
  const autoStatus = getAutoArrivalStatus(flight, fmtTime);
  const effectiveStatus = autoStatus !== null ? autoStatus : (flight.StatusEN ?? '');

  const isCancelled = /(cancelled|canceled|otkazan)/i.test(effectiveStatus);
  const isDelayed = /(delay|kasni)/i.test(effectiveStatus);
  const isEarly = /(earlier|ranije)/i.test(effectiveStatus);
  const isOnTime = /(on time|na vrijeme)/i.test(effectiveStatus);
  const isDiverted = /(diverted|preusmjeren)/i.test(effectiveStatus);
  const isArrived = /(arrived|landed|sletio|sletjelo|dolazak|stigao)/i.test(effectiveStatus);

  let displayText = effectiveStatus;
  if (isArrived) {
    const t = flight.EstimatedDepartureTime || flight.ScheduledDepartureTime || flight.ActualDepartureTime;
    displayText = `Arrived at ${t ? fmtTime(t) : ''}`;
  }

  const hasStatusText = displayText.trim() !== '';
  const showLEDs = isCancelled || isDelayed || isArrived || isDiverted || isEarly;

  let bg = 'bg-white/10', border = 'border-white/30', text = 'text-white';
  let led1: LEDColor = 'blue', led2: LEDColor = 'green', blinkClass = '';

  if (isCancelled) { bg = 'bg-red-500/20'; border = 'border-red-500/50'; text = 'text-red-100'; led1 = 'red'; led2 = 'orange'; blinkClass = 'animate-pill-blink'; }
  else if (isDelayed) { bg = 'bg-yellow-500/20'; border = 'border-yellow-500/50'; text = 'text-yellow-100'; led1 = 'yellow'; led2 = 'orange'; }
  else if (isEarly) { bg = 'bg-purple-500/20'; border = 'border-purple-500/50'; text = 'text-purple-100'; led1 = 'purple'; led2 = 'blue'; }
  else if (isDiverted) { bg = 'bg-orange-500/20'; border = 'border-orange-500/50'; text = 'text-orange-100'; led1 = 'orange'; led2 = 'red'; }
  else if (isOnTime) { bg = 'bg-lime-500/20'; border = 'border-lime-500/50'; text = 'text-lime-100'; led1 = 'lime'; led2 = 'green'; }
  else if (isArrived) { bg = 'bg-green-500/20'; border = 'border-green-500/50'; text = 'text-green-100'; led1 = 'green'; led2 = 'lime'; blinkClass = 'animate-pill-blink'; }

  return { bg, border, text, led1, led2, blinkClass, showLEDs, hasStatusText, displayText };
}

// ============================================================
// FLIGHT ROW
// ============================================================
const FlightRow = memo(
  function FlightRow({ flight, index, autoStatusTick }: {
    flight: Flight; index: number; autoStatusTick: number
  }) {
    const formatTime = useCallback((t: string) => formatTimeString(t), []);
    const pill = useMemo(
      () => computeStatusPill(flight, formatTime),
      [flight, formatTime, autoStatusTick]
    );

    const icao = flight.AirlineICAO || flight.FlightNumber?.substring(0, 2).toUpperCase() || '';

    const rowBg = index % 2 === 0 ? 'bg-white/15' : 'bg-white/5';

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

    const estimatedDisplay = useMemo(() => {
      const est = flight.EstimatedDepartureTime;
      const sch = flight.ScheduledDepartureTime;
      if (!isValidDisplayTime(est)) return null;
      const estFmt = formatTimeString(est);
      const schFmt = formatTimeString(sch);
      return estFmt === schFmt ? null : estFmt;
    }, [flight.EstimatedDepartureTime, flight.ScheduledDepartureTime]);

    const pillCls = `w-[90%] flex items-center justify-center gap-3 text-[1.9rem] font-extrabold rounded-2xl border-2 px-3 py-1.5 transition-colors duration-300 ${pill.bg} ${pill.border} ${pill.text} ${pill.blinkClass}`;

    return (
      <div
        className={`flex gap-2 p-1 border-b border-white/10 ${rowBg}`}
        style={{ minHeight: '68px', contain: 'layout style paint', contentVisibility: 'auto', containIntrinsicSize: '68px' }}
      >
        {/* Scheduled */}
        <div className="flex items-center justify-center" style={{ width: '180px' }}>
          <div className="text-[2.5rem] font-black text-white drop-shadow-lg tabular-nums">
            {formatTimeString(flight.ScheduledDepartureTime) || <span className="text-white/40">--:--</span>}
          </div>
        </div>

        {/* Estimated */}
        <div className="flex items-center justify-center" style={{ width: '180px' }}>
          {estimatedDisplay
            ? <div className="text-[2.5rem] font-black text-cyan-300 drop-shadow-lg tabular-nums">{estimatedDisplay}</div>
            : <div className="text-2xl text-white/30 font-bold">-</div>}
        </div>

        {/* Flight info */}
        <div className="flex items-center gap-3" style={{ width: '280px' }}>
          <div className="relative w-[70px] h-11 bg-white rounded-xl p-1 shadow-xl flex-shrink-0">
            <img
              src={getInitialAirlineLogoSrc(icao, PLACEHOLDER_IMAGE)}
              alt={`${flight.AirlineName} logo`}
              className="object-contain w-full h-full"
              onError={onImgErr}
              data-tried={isKnownLocalLogo(icao) ? 'local' : 'fw'}
              decoding="async"
              loading={index < 9 ? 'eager' : 'lazy'}
              fetchPriority={index < 8 ? 'high' : 'auto'}
            />
          </div>
          <div className="text-[2.4rem] font-black text-white drop-shadow-lg">{flight.FlightNumber}</div>
          {flight.CodeShareFlights && flight.CodeShareFlights.length > 0 && (
            <div className="text-sm text-white/50 font-bold">+{flight.CodeShareFlights.length}</div>
          )}
        </div>

        {/* From (origin city) */}
        <div className="flex items-center" style={{ width: '300px' }}>
          <div className="text-[3.3rem] font-black text-white truncate drop-shadow-lg">
            {flight.DestinationCityName || flight.DestinationAirportName}
          </div>
        </div>

        {/* Weather (origin city) */}
        <ArrivalWeatherCell flight={flight} />

        {/* Baggage reclaim */}
        <div className="flex items-center justify-center" style={{ width: '180px' }}>
          {flight.BaggageReclaim && flight.BaggageReclaim !== '-'
            ? <div className="text-[2.5rem] font-black text-white bg-black/40 py-2 px-3 rounded-xl border-2 border-white/20 shadow-xl">{flight.BaggageReclaim}</div>
            : <div className="text-[2.5rem] font-black text-transparent py-2 px-3">-</div>}
        </div>

        {/* Status */}
        <div className="flex items-center justify-center flex-1 min-w-[640px]">
          {pill.hasStatusText ? (
            <div className={`${pillCls} relative`}
              style={{ paddingLeft: pill.showLEDs ? '3.5rem' : '1rem', paddingRight: '1rem', width: '95%' }}>
              {pill.showLEDs && (
                <div className="absolute left-3 top-1/2 -translate-y-1/2 flex items-center gap-1 z-10">
                  <LEDIndicator color={pill.led1} phase="a" size="w-4 h-4" />
                  <LEDIndicator color={pill.led2} phase="b" size="w-4 h-4" />
                </div>
              )}
              <div className="text-center whitespace-nowrap"
                style={{ marginLeft: pill.showLEDs ? '2.5rem' : '0', width: '100%' }}>
                {pill.displayText}
              </div>
            </div>
          ) : (
            <div className="text-[2.5rem] font-bold text-slate-300">Scheduled</div>
          )}
        </div>
      </div>
    );
  },
  (prev, next) =>
    prev.autoStatusTick === next.autoStatusTick &&
    prev.flight.FlightNumber === next.flight.FlightNumber &&
    prev.flight.StatusEN === next.flight.StatusEN &&
    prev.flight.EstimatedDepartureTime === next.flight.EstimatedDepartureTime &&
    prev.flight.ScheduledDepartureTime === next.flight.ScheduledDepartureTime &&
    prev.flight.BaggageReclaim === next.flight.BaggageReclaim &&
    prev.index === next.index
);

// ============================================================
// TABLE HEADERS
// ============================================================
const TableHeaders = memo(function TableHeaders({
  headers,
}: {
  headers: { label: string; width: string; icon: React.ComponentType<{ className?: string }> }[];
}) {
  return (
    <div className={`flex gap-2 p-2 ${COLOR_CONFIG.header} border-b-4 border-black/30 font-black text-black text-[1.3rem] uppercase tracking-wider flex-shrink-0 shadow-xl`}>
      {headers.map(h => {
        const Icon = h.icon;
        return (
          <div key={h.label} className="flex items-stretch justify-center gap-1 px-1 h-full" style={{ width: h.width }}>
            <Icon className="w-5 h-5 self-center" /><span className="truncate self-center">{h.label}</span>
          </div>
        );
      })}
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
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [autoStatusTick, setAutoStatusTick] = useState(0);
  const [nightMode, setNightMode] = useState(false);
  const [pageIndex, setPageIndex] = useState(0);
  const [isDesktopLayout, setIsDesktopLayout] = useState(true);

  const isMountedRef = useRef(true);
  const isInitialLoad = useRef(true);
  const lastHeartbeat = useRef(Date.now());

  // ── v4.2: Ably real-time hook ───────────────────────────
  // Kao i departures, arrivals koristi useRealtimeFlightData()
  // za live podatke. Nema polling-a — flight data dolazi push-om.
  const { data: liveFlightData } = useRealtimeFlightData('arrivals');

  useEffect(() => { isMountedRef.current = true; return () => { isMountedRef.current = false; }; }, []);

  // ── Resize detection ──
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mql = window.matchMedia('(min-width: 640px)');
    setIsDesktopLayout(mql.matches);
    const handler = (e: MediaQueryListEvent) => setIsDesktopLayout(e.matches);
    if (mql.addEventListener) {
      mql.addEventListener('change', handler);
      return () => mql.removeEventListener('change', handler);
    } else {
      (mql as any).addListener(handler);
      return () => (mql as any).removeListener(handler);
    }
  }, []);

  // ── Auto-status tick ──
  useEffect(() => {
    const id = setInterval(() => setAutoStatusTick(t => t + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  // ── Page rotation ──
  useEffect(() => {
    const id = setInterval(() => {
      setPageIndex(p => p + 1);
    }, PAGE_ROTATE_MS);
    return () => clearInterval(id);
  }, []);

  // ── Hard reset ──
  useEffect(() => {
    const id = setTimeout(() => window.location.reload(), HARD_RESET_INTERVAL_MS);
    return () => clearTimeout(id);
  }, []);

  
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
// ── Heartbeat ──
  useEffect(() => {
    const id = setInterval(() => {
      if (Date.now() - lastHeartbeat.current > HEARTBEAT_TIMEOUT_MS) window.location.reload();
      else lastHeartbeat.current = Date.now();
    }, HEARTBEAT_CHECK_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  // ── Memory cleanup ──
  useEffect(() => {
    const id = setInterval(() => {
      setFlights(p => p.length > MAX_FLIGHTS_MEMORY ? p.slice(0, MAX_FLIGHTS_MEMORY) : p);
    }, MEMORY_CLEANUP_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  // ── Global errors ──
  useEffect(() => {
    const onErr = (e: ErrorEvent) => {
      const m = e.error?.message || '';
      if (m.includes('Out of memory') || m.includes('stack overflow') || m.includes('JavaScript heap')) {
        setErrorMessage('Critical error. Restarting...');
        setTimeout(() => window.location.reload(), 2_000);
      }
    };
    window.addEventListener('error', onErr);
    return () => window.removeEventListener('error', onErr);
  }, []);

  // ── Filter recent arrivals (keep arrived flights for 20 min) ──
  const filterRecentArrivals = useCallback((flightList: Flight[]): Flight[] => {
    const now = new Date();
    return flightList.filter(f => {
      const flightNum = (f.FlightNumber || '').toUpperCase();
      if (HIDDEN_FLIGHT_PATTERNS.some(p => flightNum.includes(p))) return false;
      const status = (f.StatusEN ?? '').toLowerCase();
      const arrived = /(arrived|landed|sletio|sletjelo|dolazak|stigao)/i.test(status);
      if (!arrived) return true;
      const timeStr = f.EstimatedDepartureTime || f.ScheduledDepartureTime || f.ActualDepartureTime;
      if (!timeStr) return false;
      const ft = parseFlightTimeToDate(timeStr);
      if (!ft) return false;
      return Math.floor((now.getTime() - ft.getTime()) / 60_000) <= 20;
    });
  }, []);

  // ── Process flight data from Ably ──
  useEffect(() => {
    if (!liveFlightData) return;

    if (isNightHours()) {
      setNightMode(true);
      setLoading(false);
      return;
    }
    setNightMode(false);

    const arrivals = filterRecentArrivals(liveFlightData.arrivals || []);
    setFlights(arrivals);
    setLastUpdate(new Date().toLocaleTimeString('en-GB'));
    setErrorMessage(null);
    setLoading(false);
    isInitialLoad.current = false;
  }, [liveFlightData, filterRecentArrivals]);

  // ── Sort by time ──
  const allSortedFlights = useMemo(
    () => flights.slice().sort((a, b) =>
      (a.ScheduledDepartureTime || '99:99').localeCompare(b.ScheduledDepartureTime || '99:99')
    ),
    [flights]
  );

  const totalPages = Math.max(1, Math.ceil(allSortedFlights.length / PAGE_SIZE));

  const sortedFlights = useMemo(() => {
    if (allSortedFlights.length === 0) return [];
    const currentPage = pageIndex % totalPages;
    const start = currentPage * PAGE_SIZE;
    return allSortedFlights.slice(start, start + PAGE_SIZE);
  }, [allSortedFlights, pageIndex, totalPages]);

  const ArrivalIcon = useCallback(({ className = 'w-5 h-5' }: { className?: string }) =>
    <Plane className={`${className} text-cyan-400 rotate-90`} />, []);

  const tableHeaders = useMemo(() => [
    { label: 'Scheduled',   width: '180px', icon: Clock        },
    { label: 'Estimated',   width: '180px', icon: Clock        },
    { label: 'Flight',      width: '280px', icon: ArrivalIcon  },
    { label: 'From',        width: '300px', icon: MapPin       },
    { label: 'Weather',     width: '180px', icon: () => (
      <svg viewBox="0 0 24 24" className="w-5 h-5" fill="currentColor">
        <circle cx="12" cy="12" r="5" fill="#FBBF24"/>
        <circle cx="12" cy="12" r="4" fill="#F59E0B"/>
      </svg>
    ) },
    { label: 'Baggage',     width: '180px', icon: Building2    },
    { label: 'Status',      width: '640px', icon: Info         },
  ], [ArrivalIcon]);

  if (nightMode) {
    return (
      <div className="h-screen bg-black select-none" onDragOver={e => e.preventDefault()} onDrop={e => e.preventDefault()}>
        <div className="h-full flex items-center justify-center">
          <div className="font-black text-cyan-400 drop-shadow-2xl tabular-nums" style={{ fontSize: '72px', lineHeight: 1 }}>
            {new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) || '--:--'}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`h-screen ${COLOR_CONFIG.background} text-white p-2 sm:p-4 transition-colors duration-700 flex flex-col select-none`}
      onDragOver={e => e.preventDefault()}
      onDrop={e => e.preventDefault()}
    >
      {errorMessage && (
        <div className="fixed bottom-4 left-4 right-4 md:left-auto md:right-4 md:bottom-4 bg-red-500/90 text-white px-4 py-3 rounded-lg text-sm z-50 shadow-lg animate-pulse">
          ⚠️ {errorMessage}
        </div>
      )}

      {/* Header */}
      <div className="w-full mx-auto mb-2 sm:mb-4 flex-shrink-0">
        <div className="flex justify-between items-center gap-2 sm:gap-4">
          <div className="flex items-center gap-3 sm:gap-6 min-w-0">
            <div className="p-2 sm:p-4 bg-transparent rounded-xl sm:rounded-2xl shadow-2xl border-2 border-cyan-400 flex-shrink-0">
              <Plane className="w-8 h-8 sm:w-16 sm:h-16 text-cyan-400 rotate-90" />
            </div>
            <div className="min-w-0">
              <h1 className={`text-[2.5rem] sm:text-[6rem] font-black ${COLOR_CONFIG.title} leading-none tracking-tight drop-shadow-2xl truncate`}>
                ARRIVALS
              </h1>
              <p className={`${COLOR_CONFIG.subtitle} text-sm sm:text-2xl mt-0.5 sm:mt-2 font-semibold truncate`}>
                Real-time arrival information • Incoming flights
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 sm:gap-4 flex-shrink-0">
            <div className="text-[3rem] sm:text-[7rem] font-black text-white drop-shadow-2xl leading-none tabular-nums">
              {new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
            </div>
            <div className={`w-3 h-3 sm:w-6 sm:h-6 rounded-full ${COLOR_CONFIG.accent} animate-pulse shadow-2xl flex-shrink-0`} />
          </div>
        </div>
      </div>

      {/* Tablica */}
      <div className="w-full mx-auto flex-1 min-h-0">
        {isInitialLoad.current && loading && sortedFlights.length === 0 ? (
          <div className="text-center p-8 h-full flex items-center justify-center">
            <div className="inline-flex items-center gap-4">
              <div className={`w-8 h-8 border-4 ${COLOR_CONFIG.border} border-t-transparent rounded-full animate-spin`} />
              <span className="text-xl sm:text-2xl text-white font-semibold">Loading arrival information...</span>
            </div>
          </div>
        ) : (
          <div className={`${COLOR_CONFIG.cardBg} rounded-2xl sm:rounded-3xl border-2 sm:border-4 border-white/20 shadow-2xl overflow-hidden h-full flex flex-col`}>
            {isDesktopLayout && <TableHeaders headers={tableHeaders} />}
            <div className="flex-1 overflow-y-auto">
              {sortedFlights.length === 0 ? (
                <div className="p-8 text-center text-white/60 h-full flex flex-col items-center justify-center">
                  <Plane className="w-12 h-12 sm:w-16 sm:h-16 mx-auto mb-4 opacity-50" />
                  <div className="text-xl sm:text-2xl font-semibold">No arrivals scheduled</div>
                </div>
              ) : (
                sortedFlights.map((flight, index) => (
                  <FlightRow
                    // ── FIX (Chrome dugotrajan rad): vidi identičan komentar
                    // u app/departures/page.tsx — key bez '-${index}'.
                    key={`${flight.FlightNumber}-${flight.ScheduledDepartureTime}`}
                    flight={flight}
                    index={index}
                    autoStatusTick={autoStatusTick}
                  />
                ))
              )}
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="w-full mx-auto mt-1 text-center flex-shrink-0">
        <div className={`${COLOR_CONFIG.subtitle} text-xs py-1`}>
          <div className="flex items-center justify-center gap-2 mb-0">
            <span>Code by: alen.vocanec@apm.co.me</span>
            <span>•</span>
            {lastUpdate && <span>Updated: {lastUpdate}</span>}
          </div>
        </div>

        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-1.5 mt-1">
            {Array.from({ length: totalPages }).map((_, i) => (
              <div
                key={i}
                className={`w-1.5 h-1.5 rounded-full transition-all ${
                  i === (pageIndex % totalPages) ? 'bg-cyan-400 w-4' : 'bg-white/20'
                }`}
              />
            ))}
          </div>
        )}
      </div>

      <style jsx global>{`
        #__next,body,html{height:100vh}*{-webkit-font-smoothing:antialiased}

        .led-base{animation:1s ease-in-out infinite alternate led-pulse}
        .led-phase-b{animation-delay:.5s}
        .led-blue{background:#1e3a5f}.led-green{background:#14532d}.led-orange{background:#7c2d12}
        .led-red{background:#7f1d1d}.led-yellow{background:#713f12}.led-cyan{background:#164e63}
        .led-purple{background:#4a1d96}.led-lime{background:#365314}
        @keyframes led-pulse{0%{opacity:.25;box-shadow:none}100%{opacity:1}}
        @keyframes led-pulse-blue{100%{background:#60a5fa;box-shadow:0 0 8px #60a5fa88}}
        @keyframes led-pulse-green{100%{background:#4ade80;box-shadow:0 0 8px #4ade8088}}
        @keyframes led-pulse-orange{100%{background:#fb923c;box-shadow:0 0 8px #fb923c88}}
        @keyframes led-pulse-red{100%{background:#f87171;box-shadow:0 0 8px #f8717188}}
        @keyframes led-pulse-yellow{100%{background:#facc15;box-shadow:0 0 8px #facc1588}}
        @keyframes led-pulse-cyan{100%{background:#22d3ee;box-shadow:0 0 8px #22d3ee88}}
        @keyframes led-pulse-purple{100%{background:#a78bfa;box-shadow:0 0 8px #a78bfa88}}
        @keyframes led-pulse-lime{100%{background:#a3e635;box-shadow:0 0 8px #a3e63588}}
        .led-blue.led-base:not(.led-phase-b){animation-name:led-pulse-blue}
        .led-green.led-base:not(.led-phase-b){animation-name:led-pulse-green}
        .led-orange.led-base:not(.led-phase-b){animation-name:led-pulse-orange}
        .led-red.led-base:not(.led-phase-b){animation-name:led-pulse-red}
        .led-yellow.led-base:not(.led-phase-b){animation-name:led-pulse-yellow}
        .led-cyan.led-base:not(.led-phase-b){animation-name:led-pulse-cyan}
        .led-purple.led-base:not(.led-phase-b){animation-name:led-pulse-purple}
        .led-lime.led-base:not(.led-phase-b){animation-name:led-pulse-lime}

        @keyframes pill-blink{0%,50%{opacity:1}51%,100%{opacity:.75}}
        .animate-pill-blink{animation:.8s ease-in-out infinite pill-blink}

        ::-webkit-scrollbar{width:6px}::-webkit-scrollbar-track{background:rgba(0,0,0,.3);border-radius:3px}
        ::-webkit-scrollbar-thumb{background:rgba(255,255,255,.4);border-radius:3px}::-webkit-scrollbar-thumb:hover{background:rgba(255,255,255,.6)}
        body,html{overflow:hidden;margin:0;padding:0}
      `}</style>
    </div>
  );
}
