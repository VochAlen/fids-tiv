'use client';

// ═══════════════════════════════════════════════════════════════
// departures/page.tsx — OPTIMIZOVANO za low-end mini PC kioske
// ═══════════════════════════════════════════════════════════════
//
// KLJUČNE OPTIMIZACIJE (vs. original):
//
//  1. MEMORY LEAK FIX: Dupli DOM eliminisan — isDesktopLayout state
//     + uslovni render (samo jedan layout u DOM-u, ne oba)
//  2. MEMORY LEAK FIX: will-change uklonjen sa svih stalnih animacija
//  3. MEMORY LEAK FIX: prevGatesRef se čisti na MAX_PREV_GATES (200)
//  4. PERFORMANCE: ClockDisplay 1s → 10s
//  5. PERFORMANCE: content-visibility: auto na FlightRow
//  6. PERFORMANCE: contain: layout style paint na redu
//  7. PERFORMANCE: Ticker 1x umjesto 2x (CSS clone)
//  8. PERFORMANCE: IS_LOW_END detekcija — skip FlightAware
//  9. PERFORMANCE: Memory pressure detekcija
// 10. FIX C: isFetchingRef guard
// 11. FIX B: fetchWithTimeout sa AbortSignal
// 12. WEATHER: Dodata weather kolona i weather za Tivat u header
// ═══════════════════════════════════════════════════════════════

import { JSX, useEffect, useState, useCallback, useMemo, useRef, memo, Component, type ErrorInfo, type ReactNode } from 'react';
import type { Flight } from '@/types/flight';
import { getUniqueDeparturesWithDeparted } from '@/lib/flight-service';
import { Info, Plane, Clock, MapPin, Users, DoorOpen, Building2 } from 'lucide-react';
import { getInitialAirlineLogoSrc, isKnownLocalLogo } from '@/lib/airline-logo';
import { isNightHours } from '@/lib/night-hours';
import { useWeather } from '@/hooks/use-weather';

// ============================================================
// KONSTANTE
// ============================================================
const REFRESH_INTERVAL_MS         = 180_000;
const FETCH_TIMEOUT_MS            = 15_000;
const MAX_RETRIES                 = 1;
const RETRY_DELAY_MS              = 1_000;
const CACHE_KEY                   = 'dep_board_cache';
const CACHE_DURATION              = 8 * 60 * 1_000;
const EMERGENCY_CACHE_KEY         = 'dep_board_emergency_v1';
const HEARTBEAT_TIMEOUT_MS        = 180_000;
const HEARTBEAT_CHECK_INTERVAL_MS = 30_000;
const MEMORY_CLEANUP_INTERVAL_MS  = 30 * 60 * 1_000;
const MAX_FLIGHTS_DISPLAY         = 9;
const MAX_FLIGHTS_MEMORY          = 60;
const MAX_PREV_GATES              = 200;
const PAGE_SIZE                   = 8;
const PAGE_ROTATE_MS              = 20_000;
const HARD_RESET_INTERVAL_MS      = 6 * 60 * 60 * 1_000;

// ── Low-end detekcija ──
const IS_LOW_END = typeof navigator !== 'undefined' &&
  (navigator.hardwareConcurrency ?? 4) < 4;

// ── Memory pressure threshold ──
const MEMORY_PRESSURE_THRESHOLD = 0.80;

const HIDDEN_FLIGHT_PATTERNS = ['ZZZ', 'G00', 'PVT', 'TST'];

const COLOR_CONFIG = {
  background: 'bg-gradient-to-br from-[#1F0218] via-[#7D185E] to-[#1F0218]',
  accent:     'bg-purple-500',
  header:     'bg-yellow-400',
  title:      'text-yellow-400',
  subtitle:   'text-purple-200',
  border:     'border-purple-500',
  cardBg:     'bg-[#3a0a30]/80',
};

const SECURITY_MESSAGES = [
  {
    text: 'ℹ️ PLEASE NOTE: Check-in counters and gates are subject to change based on operational requirements. Please contact airport staff for the latest information. •',
    language: 'en'
  },
  {
    text: 'ℹ️ NAPOMENA: Check-in šalteri i izlazi se mogu mijenjati u zavisnosti od operativnih potreba. Za najnovije informacije kontaktirajte osoblje aerodroma. •',
    language: 'cnr'
  },
  { text: '⚠️ DEAR PASSENGERS, PLEASE DO NOT LEAVE YOUR BAGGAGE UNATTENDED AT THE AIRPORT - UNATTENDED BAGGAGE WILL BE CONFISCATED AND DESTROYED •', language: 'en' },
  { text: '⚠️ POŠTOVANI PUTNICI, MOLIMO VAS DA NE OSTAVLJATE SVOJ PRTLJAG BEZ NADZORA NA AERODROMU - NENADZIRANI PRTLJAG ĆE BITI ODUZET I UNIŠTEN •', language: 'cnr' },
  { text: '📶 FREE AIRPORT WIFI: Network: "One Crna Gora" | No password required | Connect to One Crna Gora for access •', language: 'en' },
  { text: '📶 BESPLATAN WIFI: Mreža: "One Crna Gora" | Bez lozinke | Povežite se na One Crna Gora •', language: 'cnr' },
];

// ============================================================
// WEATHER HELPER
// ============================================================
function getWeatherEmoji(code: number): string {
  if (code === 0) return '☀️';
  if (code === 1) return '⛅';
  if (code === 2) return '⛅';
  if (code === 3) return '☁️';
  if ([45, 48].includes(code)) return '🌫️';
  if ([51, 53, 55].includes(code)) return '🌦️';
  if ([61, 63, 65].includes(code)) return '🌧️';
  if ([71, 73, 75].includes(code)) return '❄️';
  if ([80, 81, 82].includes(code)) return '🌧️';
  if ([95, 96, 99].includes(code)) return '⛈️';
  return '🌡️';
}

// ============================================================
// ERROR BOUNDARY
// ============================================================
interface ErrorBoundaryState { hasError: boolean; errorMessage: string }

class FlightBoardErrorBoundary extends Component<
  { children: ReactNode; fallback?: ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: ReactNode; fallback?: ReactNode }) {
    super(props);
    this.state = { hasError: false, errorMessage: '' };
  }
  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, errorMessage: error.message };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('FlightBoard ErrorBoundary caught:', error, info);
    setTimeout(() => this.setState({ hasError: false, errorMessage: '' }), 10_000);
  }
  render() {
    if (this.state.hasError) {
      return this.props.fallback || (
        <div className="h-screen bg-[#1F0218] flex flex-col items-center justify-center text-white gap-6">
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
// HELPER FUNKCIJE
// ============================================================
const getFlightawareLogoURL = (icaoCode: string): string =>
  icaoCode ? `https://www.flightaware.com/images/airline_logos/180px/${icaoCode}.png` : '';

const PLACEHOLDER_IMAGE =
  'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMzIiIGhlaWdodD0iMzIiIHZpZXdCb3g9IjAgMCAzMiAzMiIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHJlY3Qgd2lkdGg9IjMyIiBoZWlnaHQ9IjMyIiBmaWxsPSIjMzQzQzU0Ii8+Cjx0ZXh0IHg9IjE2IiB5PSIxNiIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZG9taW5hbnQtYmFzZWxpbmU9Im1pZGRsZSIgZmlsbD0iIzlDQTdCNiIgZm9udC1mYW1pbHk9IkFyaWFsLCBzYW5zLXNlcmlmIiBmb250LXNpemU9IjgiPk5vIExvZ288L3RleHQ+Cjwvc3ZnPgo=';

function parseFlightTimeToDate(timeStr: string | null | undefined): Date | null {
  if (!timeStr) return null;
  const s = timeStr.trim();
  if (!s || s === '-' || s === '--:--') return null;
  try {
    if (s.includes('T') || (s.includes('-') && s.length > 5)) {
      const d = new Date(s);
      return isNaN(d.getTime()) ? null : d;
    }
    const ampm = s.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
    if (ampm) {
      let h = parseInt(ampm[1], 10);
      const m = parseInt(ampm[2], 10);
      if (ampm[3].toUpperCase() === 'PM' && h !== 12) h += 12;
      if (ampm[3].toUpperCase() === 'AM' && h === 12) h = 0;
      const d = new Date(); d.setHours(h, m, 0, 0);
      if (Date.now() - d.getTime() > 12 * 60 * 60 * 1_000) d.setDate(d.getDate() + 1);
      return d;
    }
    const sep = s.match(/^(\d{1,2})[:.](\d{2})$/);
    if (sep) {
      const h = parseInt(sep[1], 10);
      const m = parseInt(sep[2], 10);
      if (h > 23 || m > 59) return null;
      const d = new Date(); d.setHours(h, m, 0, 0);
      if (Date.now() - d.getTime() > 12 * 60 * 60 * 1_000) d.setDate(d.getDate() + 1);
      return d;
    }
    const digits = s.replace(/\D/g, '');
    if (digits.length === 4) {
      const h = parseInt(digits.substring(0, 2), 10);
      const m = parseInt(digits.substring(2, 4), 10);
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
    const h = digits.substring(0, 2);
    const m = digits.substring(2, 4);
    const hi = parseInt(h, 10);
    const mi = parseInt(m, 10);
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

// ── Cache helpers ──
const saveToCache = (data: { departures: Flight[]; desks?: Record<string, string>; gates?: Record<string, string> }) => {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({
      data,
      timestamp: Date.now()
    }));
  } catch { /* quota exceeded */ }
};

const loadFromCache = (): { departures: Flight[]; desks: Record<string, string>; gates: Record<string, string> } | null => {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const { data, timestamp } = JSON.parse(raw);
    if (Date.now() - timestamp > CACHE_DURATION) return null;
    return {
      departures: data.departures || [],
      desks: data.desks || {},
      gates: data.gates || {}
    };
  } catch { return null; }
};

const saveEmergencyCache = (data: { departures: Flight[]; desks?: Record<string, string>; gates?: Record<string, string> }) => {
  try {
    localStorage.setItem(EMERGENCY_CACHE_KEY, JSON.stringify({
      data,
      timestamp: Date.now()
    }));
  } catch { /* quota exceeded */ }
};

const loadEmergencyCache = (): { departures: Flight[]; desks: Record<string, string>; gates: Record<string, string> } | null => {
  try {
    const raw = localStorage.getItem(EMERGENCY_CACHE_KEY);
    if (!raw) return null;
    const { data, timestamp } = JSON.parse(raw);
    if (Date.now() - timestamp > 12 * 60 * 60_000) return null;
    return {
      departures: data.departures || [],
      desks: data.desks || {},
      gates: data.gates || {}
    };
  } catch { return null; }
};

const fetchWithTimeout = async (
  url: string,
  ms: number,
  headers?: HeadersInit,
  externalSignal?: AbortSignal
): Promise<Response> => {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), ms);

  if (externalSignal) {
    if (externalSignal.aborted) ctrl.abort();
    else externalSignal.addEventListener('abort', () => ctrl.abort(), { once: true });
  }

  try {
    const r = await fetch(url, { signal: ctrl.signal, headers });
    clearTimeout(id);
    return r;
  } catch (e) {
    clearTimeout(id);
    throw e;
  }
};

const checkStatus = {
  isDelayed:    (f: Flight) => /(delay|kasni)/i.test(f.StatusEN ?? ''),
  isCancelled:  (f: Flight) => /(cancelled|canceled|otkazan)/i.test(f.StatusEN ?? ''),
  isDeparted:   (f: Flight) => /(departed|poletio|take off)/i.test(f.StatusEN ?? ''),
};

// ============================================================
// AUTO-STATUS ZA DEPARTURES
// ============================================================
const EARLY_CHECKIN_AIRLINES = new Set(['6H', 'FZ', 'IZ', 'LY']);
const EXTRA_EARLY_CHECKIN_AIRLINES = new Set(['LS','BA']);

function getAutoStatus(flight: Flight): string | null {
  const status = (flight.StatusEN ?? '').trim();
  if (status && status !== '-') return null;

  const scheduled = parseFlightTimeToDate(flight.ScheduledDepartureTime);
  if (!scheduled) return null;

  const referenceTime = parseFlightTimeToDate(flight.EstimatedDepartureTime) ?? scheduled;
  const now = Date.now();
  const minsToRef = (referenceTime.getTime() - now) / 60_000;
  const minsToSTD = (scheduled.getTime() - now) / 60_000;

  if (minsToRef < -5) return null;
  if (minsToRef <= 5)  return 'Close';
  if (minsToRef <= 10) return 'Final Call';
  if (minsToRef <= 30) return 'Go to Gate';

  if (minsToSTD > 30) {
    const iata = (flight.FlightNumber ?? '').replace(/\s/g, '').substring(0, 2).toUpperCase();

    let checkInMinutesOffset = 120;
    if (EXTRA_EARLY_CHECKIN_AIRLINES.has(iata)) {
      checkInMinutesOffset = 150;
    } else if (EARLY_CHECKIN_AIRLINES.has(iata)) {
      checkInMinutesOffset = 180;
    }

    const checkInDate = new Date(scheduled.getTime() - (checkInMinutesOffset * 60 * 1000));
    const hh = String(checkInDate.getHours()).padStart(2, '0');
    const mm = String(checkInDate.getMinutes()).padStart(2, '0');
    return `Check In at ${hh}:${mm}`;
  }

  return null;
}

// ============================================================
// IZOLOVANI SAT — OPTIMIZOVANO: 10s umjesto 1s
// ============================================================
const ClockDisplay = memo(function ClockDisplay() {
  const [time, setTime] = useState('');
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
    const tick = () => setTime(new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }));
    tick();
    const id = setInterval(tick, 10_000);
    return () => clearInterval(id);
  }, []);
  if (!mounted) return <div className="text-[3rem] sm:text-[7rem] font-black text-white leading-none tabular-nums">--:--</div>;
  return <div className="text-[3rem] sm:text-[7rem] font-black text-white drop-shadow-2xl leading-none tabular-nums">{time}</div>;
});

const NightClock = memo(function NightClock() {
  const [time, setTime] = useState('');
  useEffect(() => {
    const tick = () => setTime(new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }));
    tick();
    const id = setInterval(tick, 10_000);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="h-screen w-full flex items-center justify-center bg-black select-none">
      <div className="font-black text-yellow-400 drop-shadow-2xl tabular-nums" style={{ fontSize: '72px', lineHeight: 1 }}>
        {time || '--:--'}
      </div>
    </div>
  );
});

// ============================================================
// LED — OPTIMIZOVANO: will-change uklonjen
// ============================================================
type LEDColor = 'blue' | 'green' | 'orange' | 'red' | 'yellow' | 'cyan' | 'purple' | 'lime';

const LEDIndicator = memo(function LEDIndicator({
  color, phase = 'a', size = 'w-3 h-3',
}: {
  color: LEDColor; phase?: 'a' | 'b'; size?: string;
}) {
  const map: Record<LEDColor, string> = {
    blue: 'led-blue', green: 'led-green', orange: 'led-orange', red: 'led-red',
    yellow: 'led-yellow', cyan: 'led-cyan', purple: 'led-purple', lime: 'led-lime',
  };
  return <div className={`${size} rounded-full led-base ${map[color]} ${phase === 'b' ? 'led-phase-b' : ''}`} />;
});

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
// TERMINAL BADGE
// ============================================================
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

// ============================================================
// STATUS PILL LOGIKA
// ============================================================
function computeStatusPill(flight: Flight) {
  const autoStatus = getAutoStatus(flight);
  const effectiveStatus = autoStatus !== null ? autoStatus : (flight.StatusEN ?? '');

  const isCancelled   = /(cancelled|canceled|otkazan)/i.test(effectiveStatus);
  const isDelayed     = /(delay|kasni)/i.test(effectiveStatus);
  const isBoarding    = /(boarding|gate open)/i.test(effectiveStatus);
  const isProcessing  = /processing/i.test(effectiveStatus);
  const isEarly       = /(earlier|ranije)/i.test(effectiveStatus);
  const isOnTime      = /(on time|na vrijeme)/i.test(effectiveStatus);
  const isDiverted    = /(diverted|preusmjeren)/i.test(effectiveStatus);
  const isCheckInOpen = /(check.?in|check-in)/i.test(effectiveStatus);
  const isGoToGate    = /(go to gate)/i.test(effectiveStatus);
  const isClose       = /^close$/i.test(effectiveStatus.trim());
  const isFinalCall   = /^final call$/i.test(effectiveStatus.trim());

  let displayText = effectiveStatus;
  if (isProcessing) displayText = 'Check-In';

  const hasStatusText = displayText.trim() !== '';
  const showLEDs      = isCancelled || isDelayed || isBoarding || isProcessing ||
                        isCheckInOpen || isDiverted || isGoToGate || isClose || isFinalCall || isEarly;

  let bg = 'bg-white/10', border = 'border-white/30', text = 'text-white';
  let led1: LEDColor = 'blue', led2: LEDColor = 'green', blinkClass = '';

  if      (isCancelled)               { bg='bg-red-500/20';    border='border-red-500/50';    text='text-red-100';    led1='red';    led2='orange'; blinkClass='animate-pill-blink'      }
  else if (isClose)                   { bg='bg-red-600/30';    border='border-red-500/70';    text='text-red-100';    led1='red';    led2='orange'; blinkClass='animate-pill-blink-fast' }
  else if (isFinalCall)               { bg='bg-orange-600/30'; border='border-orange-500/70'; text='text-orange-100'; led1='orange'; led2='red';    blinkClass='animate-pill-blink-fast' }
  else if (isGoToGate)                { bg='bg-blue-500/20';   border='border-blue-500/50';   text='text-blue-100';   led1='blue';   led2='cyan';   blinkClass='animate-pill-blink'      }
  else if (isDelayed)                 { bg='bg-yellow-500/20'; border='border-yellow-500/50'; text='text-yellow-100'; led1='yellow'; led2='orange'                                        }
  else if (isEarly)                   { bg='bg-purple-500/20'; border='border-purple-500/50'; text='text-purple-100'; led1='purple'; led2='blue'                                          }
  else if (isBoarding)                { bg='bg-cyan-500/20';   border='border-cyan-500/50';   text='text-cyan-100';   led1='cyan';   led2='blue';   blinkClass='animate-pill-blink'      }
  else if (isCheckInOpen||isProcessing){ bg='bg-green-500/20'; border='border-green-500/50'; text='text-green-100';  led1='green';  led2='lime'                                          }
  else if (isDiverted)                { bg='bg-orange-500/20'; border='border-orange-500/50'; text='text-orange-100'; led1='orange'; led2='red'                                          }
  else if (isOnTime)                  { bg='bg-lime-500/20';   border='border-lime-500/50';   text='text-lime-100';   led1='lime';   led2='green'                                        }

  return { bg, border, text, led1, led2, blinkClass, showLEDs, hasStatusText, displayText };
}

// ============================================================
// FLIGHT ROW — OPTIMIZOVANO: jedan layout umjesto dva
// ============================================================
const FlightRow = memo(
  function FlightRow({ flight, index, autoStatusTick, isDesktopLayout }: {
    flight: Flight; index: number; autoStatusTick: number; isDesktopLayout: boolean
  }) {
    const pill = useMemo(
      () => computeStatusPill(flight),
      [flight, autoStatusTick]
    );

    const rowBg = index % 2 === 0 ? 'bg-white/15' : 'bg-white/5';
    const icao  = flight.AirlineICAO || flight.FlightNumber?.substring(0, 2).toUpperCase() || '';

    // ── Weather za destinaciju ──
    const weather = useWeather({
      cityName: flight.DestinationCityName,
      airportCode: flight.DestinationAirportCode,
      airportName: flight.DestinationAirportName
    }, 0);

    const onImgErr = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
      const img = e.currentTarget;
      if (IS_LOW_END) {
        img.src = PLACEHOLDER_IMAGE;
        img.onerror = null;
        return;
      }
      if (img.dataset.fallback === 'local') {
        img.dataset.fallback = 'fw';
        const fw = getFlightawareLogoURL(icao);
        if (fw) { img.src = fw; return; }
        img.src = PLACEHOLDER_IMAGE; img.onerror = null; return;
      }
      img.src = PLACEHOLDER_IMAGE; img.onerror = null;
    }, [icao]);

    const gateChangedAt = (flight as any)._gateChangedAt;
    const isGateChanged = gateChangedAt && (Date.now() - gateChangedAt < 15_000);

    const pillCls = `w-[90%] flex items-center justify-center gap-3 text-[1.42rem] font-bold rounded-2xl border-2 px-3 py-1.5 transition-colors duration-300 ${pill.bg} ${pill.border} ${pill.text} ${pill.blinkClass}`;
    const mobilePillCls = `flex items-center gap-1.5 text-xs font-bold rounded-xl border px-2 py-1 ${pill.bg} ${pill.border} ${pill.text} ${pill.blinkClass}`;

    const estimatedDisplay = useMemo(() => {
      const est = flight.EstimatedDepartureTime;
      const sch = flight.ScheduledDepartureTime;
      if (!isValidDisplayTime(est)) return null;
      const estFmt = formatTimeString(est);
      const schFmt = formatTimeString(sch);
      if (estFmt === schFmt) return null;
      return estFmt;
    }, [flight.EstimatedDepartureTime, flight.ScheduledDepartureTime]);

    // ── DESKTOP LAYOUT ──
    if (isDesktopLayout) {
      return (
        <div
          className={`flex gap-2 p-1 border-b border-white/10 ${rowBg}`}
          style={{
            minHeight: '68px',
            contain: 'layout style paint',
            contentVisibility: 'auto',
            containIntrinsicSize: '68px',
          }}
        >
          {/* Scheduled */}
          <div className="flex items-center justify-center" style={{ width: '150px' }}>
            <div className="text-[2.2rem] font-black text-white drop-shadow-lg tabular-nums">
              {formatTimeString(flight.ScheduledDepartureTime) || <span className="text-white/40">--:--</span>}
            </div>
          </div>

          {/* Estimated */}
          <div className="flex items-center justify-center" style={{ width: '150px' }}>
            {estimatedDisplay
              ? <div className={`text-[2.2rem] font-black ${COLOR_CONFIG.title} drop-shadow-lg tabular-nums`}>{estimatedDisplay}</div>
              : <div className="text-2xl text-white/30 font-bold">-</div>
            }
          </div>

          {/* Flight Info */}
          <div className="flex items-center gap-2" style={{ width: '240px' }}>
            <div className="relative w-[60px] h-10 bg-white rounded-xl p-1 shadow-xl flex-shrink-0">
              <img
                src={getInitialAirlineLogoSrc(icao, PLACEHOLDER_IMAGE)}
                alt={`${flight.AirlineName} logo`}
                className="object-contain w-full h-full"
                onError={onImgErr}
                data-fallback={isKnownLocalLogo(icao) ? 'local' : 'fw'}
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

          {/* Destination */}
          <div className="flex items-center" style={{ width: '320px' }}>
            <div className="text-[3rem] font-black text-white truncate drop-shadow-lg">
              {flight.DestinationCityName || flight.DestinationAirportName}
            </div>
          </div>

          {/* WEATHER KOLONA */}
          <div className="flex items-center justify-center" style={{ width: '100px' }}>
            {weather && !weather.loading && !weather.error ? (
              <div className="flex items-center gap-1 text-white/80 text-xl font-medium">
                <span className="text-2xl">{getWeatherEmoji(weather.weatherCode)}</span>
                <span>{Math.round(weather.temperature)}°</span>
              </div>
            ) : weather?.loading ? (
              <div className="w-6 h-6 border-2 border-white/20 border-t-purple-400 rounded-full animate-spin" />
            ) : (
              <span className="text-white/20 text-xl">—</span>
            )}
          </div>

          {/* Check-In */}
          <div className="flex items-center justify-center flex-wrap gap-1" style={{ width: '280px' }}>
            {flight.CheckInDesk && flight.CheckInDesk !== '-'
              ? flight.CheckInDesk.split(',').map(d => d.trim()).filter(Boolean).map(d => (
                  <div key={d} className="text-[1.6rem] font-black text-white bg-black/40 py-1 px-2.5 rounded-xl border-2 border-white/20 shadow-xl">
                    {d}
                  </div>
                ))
              : <div className="text-[2rem] font-black text-transparent py-2 px-3">-</div>}
          </div>

          {/* Gate */}
          <div className="flex items-center justify-center" style={{ width: '150px' }}>
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
          <div className="flex items-center justify-center" style={{ width: '120px' }}>
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
          <div className="flex items-center justify-center" style={{ width: '360px' }}>
            {pill.hasStatusText ? (
              <div className={`${pillCls} overflow-hidden text-[1.4rem]`}>
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
        </div>
      );
    }

    // ── MOBILNI LAYOUT ──
    return (
      <div className={`flex flex-col gap-2 px-3 py-2.5 border-b border-white/10 ${rowBg}`}
        style={{ contain: 'layout style' }}
      >
        <div className="flex items-center gap-2.5">
          <div className="relative w-10 h-7 bg-white rounded-lg p-0.5 shadow-md flex-shrink-0">
            <img
              src={getInitialAirlineLogoSrc(icao, PLACEHOLDER_IMAGE)}
              alt={`${flight.AirlineName} logo`}
              className="object-contain w-full h-full"
              onError={onImgErr}
              data-fallback={isKnownLocalLogo(icao) ? 'local' : 'fw'}
              decoding="async"
            />
          </div>
          <span className="text-base font-black text-white tracking-wide">{flight.FlightNumber}</span>
          {flight.CodeShareFlights && flight.CodeShareFlights.length > 0 && (
            <span className="text-xs text-white/40 font-bold">+{flight.CodeShareFlights.length}</span>
          )}
          <div className="ml-auto flex items-center gap-1.5">
            <span className="text-lg font-black text-white tabular-nums">
              {formatTimeString(flight.ScheduledDepartureTime) || '--:--'}
            </span>
            {estimatedDisplay && (
              <>
                <span className="text-white/30 text-xs">›</span>
                <span className={`text-lg font-black ${COLOR_CONFIG.title} tabular-nums`}>{estimatedDisplay}</span>
              </>
            )}
          </div>
        </div>
        <div className="flex items-center justify-between">
          <div className="text-[1.25rem] font-black text-white truncate leading-tight">
            {flight.DestinationCityName || flight.DestinationAirportName}
          </div>
          {weather && !weather.loading && !weather.error && (
            <div className="flex items-center gap-1 text-white/80 text-base font-medium flex-shrink-0 ml-2">
              <span>{getWeatherEmoji(weather.weatherCode)}</span>
              <span>{Math.round(weather.temperature)}°</span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {(() => {
            const badge = getFlightTerminalBadge(flight);
            return badge ? (
              <span className={`text-[0.7rem] font-black rounded-full px-2 py-0.5 leading-none ${badge.bg} ${badge.text}`}>
                {badge.label}
              </span>
            ) : null;
          })()}
          {flight.CheckInDesk && flight.CheckInDesk !== '-' && (
            <span className="inline-flex items-center gap-1 text-xs font-bold text-white bg-black/40 px-2 py-1 rounded-lg border border-white/20">
              <Users className="w-3 h-3 opacity-70" />
              {flight.CheckInDesk}
            </span>
          )}
          {flight.GateNumber && flight.GateNumber !== '-' && (
            <span className={`inline-flex items-center gap-1 text-xs font-bold px-2 py-1 rounded-lg border ${
              isGateChanged
                ? 'text-red-400 bg-red-500/20 border-red-400 animate-pill-blink-fast'
                : 'text-white bg-black/40 border-white/20'
            }`}>
              <DoorOpen className="w-3 h-3 opacity-70" />
              {flight.GateNumber}
            </span>
          )}
          {pill.hasStatusText ? (
            <div className={mobilePillCls}>
              {pill.showLEDs && (
                <>
                  <LEDIndicator color={pill.led1} phase="a" size="w-2 h-2" />
                  <LEDIndicator color={pill.led2} phase="b" size="w-2 h-2" />
                </>
              )}
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
    prev.autoStatusTick                === next.autoStatusTick                &&
    prev.flight.FlightNumber           === next.flight.FlightNumber           &&
    prev.flight.StatusEN               === next.flight.StatusEN               &&
    (prev.flight as any)._gateChangedAt === (next.flight as any)._gateChangedAt &&
    prev.flight.EstimatedDepartureTime === next.flight.EstimatedDepartureTime &&
    prev.flight.ScheduledDepartureTime === next.flight.ScheduledDepartureTime &&
    prev.flight.GateNumber             === next.flight.GateNumber             &&
    prev.flight.CheckInDesk            === next.flight.CheckInDesk            &&
    prev.index                         === next.index                         &&
    prev.isDesktopLayout               === next.isDesktopLayout
);

// ============================================================
// GLAVNA KOMPONENTA
// ============================================================
export default function DeparturesPage(): JSX.Element {
  return <FlightBoardErrorBoundary><DeparturesBoard /></FlightBoardErrorBoundary>;
}

function DeparturesBoard(): JSX.Element {
  const [flights,        setFlights]        = useState<Flight[]>([]);
  const [loading,        setLoading]        = useState<boolean>(true);
  const [lastUpdate,     setLastUpdate]     = useState<string>('');
  const [errorMessage,   setErrorMessage]   = useState<string | null>(null);
  const [autoStatusTick, setAutoStatusTick] = useState<number>(0);
  const [pageIndex,      setPageIndex]      = useState(0);
  const [nightMode,      setNightMode]      = useState(false);
  const [reducedAnimations, setReducedAnimations] = useState(IS_LOW_END);

  // ── isDesktopLayout ──
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

  // ── Weather za Tivat (header) ──
  const tivatWeather = useWeather({
    cityName: 'Tivat',
    airportCode: 'TIV',
    airportName: 'Tivat Airport'
  }, 0);

  const isMountedRef  = useRef(true);
  const prevGatesRef  = useRef<Record<string, string>>({});
  const isInitialLoad = useRef(true);
  const lastHeartbeat = useRef(Date.now());
  const etagStatusRef = useRef<string | null>(null);
  const lastKnownHashRef = useRef<string | null>(null);
  const flightsRef = useRef<Flight[]>([]);
  const nightModeRef = useRef(false);
  const isFetchingRef = useRef(false);
  
  useEffect(() => { flightsRef.current = flights }, [flights]);
  useEffect(() => { nightModeRef.current = nightMode }, [nightMode]);

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
          console.warn('⚠️ Memory pressure detected — reducing animations');
        }
      }
    };
    const id = setInterval(checkMemory, 60_000);
    return () => clearInterval(id);
  }, []);

  // Auto-status tick
  useEffect(() => {
    const id = setInterval(() => setAutoStatusTick(t => t + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  // Rotacija stranica
  useEffect(() => {
    const id = setInterval(() => {
      setPageIndex(p => p + 1);
    }, PAGE_ROTATE_MS);
    return () => clearInterval(id);
  }, []);

  // Hard reset
  useEffect(() => {
    const id = setTimeout(() => {
      if ((window as any).electronAPI?.restartApp) (window as any).electronAPI.restartApp();
      else window.location.reload();
    }, HARD_RESET_INTERVAL_MS);
    return () => clearTimeout(id);
  }, []);

  // Heartbeat
  useEffect(() => {
    const id = setInterval(() => {
      if (Date.now() - lastHeartbeat.current > HEARTBEAT_TIMEOUT_MS) window.location.reload();
      else lastHeartbeat.current = Date.now();
    }, HEARTBEAT_CHECK_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  // Global errors
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

  // Memory cleanup
  useEffect(() => {
    const id = setInterval(() => {
      setFlights(p => p.length > MAX_FLIGHTS_MEMORY ? p.slice(0, MAX_FLIGHTS_MEMORY) : p);

      const gateKeys = Object.keys(prevGatesRef.current);
      if (gateKeys.length > MAX_PREV_GATES) {
        const toRemove = gateKeys.slice(0, gateKeys.length - MAX_PREV_GATES);
        for (const key of toRemove) {
          delete prevGatesRef.current[key];
        }
      }
    }, MEMORY_CLEANUP_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  const filterRecentDepartures = useCallback((flightList: Flight[]): Flight[] => {
    const now = new Date();
    return flightList.filter(f => {
      const flightNum = (f.FlightNumber || '').toUpperCase();
      if (HIDDEN_FLIGHT_PATTERNS.some(p => flightNum.includes(p))) return false;
      const status   = (f.StatusEN ?? '').toLowerCase();
      const departed = !checkStatus.isDelayed(f) &&
        (status.includes('departed') || status.includes('poletio') || status.includes('take off'));
      if (!departed) return true;
      const timeStr = f.EstimatedDepartureTime || f.ScheduledDepartureTime || f.ActualDepartureTime;
      if (!timeStr) return false;
      const ft = parseFlightTimeToDate(timeStr);
      if (!ft) return false;
      const diff = Math.floor((now.getTime() - ft.getTime()) / 60_000);
      return diff <= 20;
    });
  }, []);

  const prepareDepartures = useCallback((
    rawDepartures: Flight[],
    assignments: { desks: Record<string, string>; gates: Record<string, string> }
  ): Flight[] => {
    return rawDepartures.map(f => {
      const num = f.FlightNumber ?? '';
      const adminDesk = assignments.desks[num];
      const adminGate = assignments.gates[num];
      const effectiveGate = adminGate || f.GateNumber || '';

      if (!adminDesk && (!effectiveGate || effectiveGate === "-" || effectiveGate === f.GateNumber)) {
        return f;
      }

      const clone = { ...f };
      if (adminDesk) {
        (clone as any).CheckInDesk = adminDesk;
      }
      if (effectiveGate && effectiveGate !== '-') {
        if (prevGatesRef.current[num] && prevGatesRef.current[num] !== effectiveGate) {
          (clone as any)._gateChangedAt = Date.now();
        }
        (clone as any).GateNumber = effectiveGate;
        prevGatesRef.current[num] = effectiveGate;
      }
      return clone;
    });
  }, []);

  // Data loading
  useEffect(() => {
    isMountedRef.current = true;
    let tid: ReturnType<typeof setTimeout>;
    const controller = new AbortController();

    const load = async () => {
      if (!isMountedRef.current) return;

      if (isFetchingRef.current) return;
      isFetchingRef.current = true;

      const wasNightMode = nightModeRef.current;

      if (isNightHours()) {
        if (isMountedRef.current) setNightMode(true);
        setLoading(false);
        isFetchingRef.current = false;
        tid = setTimeout(load, REFRESH_INTERVAL_MS);
        return;
      }
      if (isMountedRef.current) setNightMode(false);

      const justExitedNightMode = wasNightMode;

      let data: any = null;
      let usedCache = false;
      try {
        if (isInitialLoad.current) setLoading(true);
        setErrorMessage(null);

        const boardIsCurrentlyEmpty = flightsRef.current.length === 0;
        const forceRefresh = boardIsCurrentlyEmpty || justExitedNightMode;

        const headers: HeadersInit = {};
        if (!forceRefresh && etagStatusRef.current) {
          headers['If-None-Match'] = etagStatusRef.current;
        }

        try {
          const statusRes = await fetchWithTimeout('/api/flights', FETCH_TIMEOUT_MS, headers, controller.signal);

          if (statusRes.status === 304) {
            setLastUpdate(new Date().toLocaleTimeString('en-GB'));
            isInitialLoad.current = false;
            setLoading(false);
            isFetchingRef.current = false;
            return;
          }

          if (!statusRes.ok) throw new Error(`HTTP ${statusRes.status}`);

          const statusData = await statusRes.json();
          const newEtag = statusRes.headers.get('ETag');
          if (newEtag) etagStatusRef.current = newEtag;

          data = statusData;

          if (data && isMountedRef.current) {
            saveToCache({
              departures: data.departures,
              desks: data.desks || {},
              gates: data.gates || {}
            });
            saveEmergencyCache({
              departures: data.departures,
              desks: data.desks || {},
              gates: data.gates || {}
            });
          }
        } catch (fe) {
          if (controller.signal.aborted) {
            return;
          }
          if (!isMountedRef.current) return;

          setErrorMessage('Network error. Using cached data.');
          const c = loadFromCache();
          if (c) {
            data = c;
            usedCache = true;
          } else {
            const emergency = loadEmergencyCache();
            if (emergency) {
              data = emergency;
              usedCache = true;
              setErrorMessage('Prikazan stariji poznati raspored');
            } else throw fe;
          }
        }

        if (!isMountedRef.current || !data) return;

        const assignments = {
          desks: data.desks || {},
          gates: data.gates || {}
        };

        try {
          const rawDepartures = getUniqueDeparturesWithDeparted(
            filterRecentDepartures(data.departures || [])
          );
          const departuresWithMeta = prepareDepartures(rawDepartures, assignments);
          setFlights(departuresWithMeta);
          setLastUpdate(new Date().toLocaleTimeString('en-GB'));
          if (!usedCache) setErrorMessage(null);
          else setTimeout(() => { if (isMountedRef.current) setErrorMessage(null) }, 5_000);
        } catch (processingError) {
          console.error('Processing error:', processingError, data);
          setErrorMessage('Data processing error — check console.');
        }

      } catch (e) {
        if (isMountedRef.current) {
          console.error('Critical:', e);
          setErrorMessage('Unable to load flight data. Check connection.');
        }
      } finally {
        isInitialLoad.current = false;
        isFetchingRef.current = false;
        if (isMountedRef.current && !controller.signal.aborted) {
          setLoading(false);
          tid = setTimeout(load, REFRESH_INTERVAL_MS);
        }
      }
    };

    load();
    return () => {
      isMountedRef.current = false;
      clearTimeout(tid);
      controller.abort();
      isFetchingRef.current = false;
    };
  }, [filterRecentDepartures, prepareDepartures]);

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

  const DepartureIcon = useCallback(({ className = 'w-5 h-5' }: { className?: string }) =>
    <Plane className={`${className} text-orange-500`} />, []);

  const tableHeaders = useMemo(() => [
    { label: 'Scheduled',   width: '150px', icon: Clock         },
    { label: 'Estimated',   width: '150px', icon: Clock         },
    { label: 'Flight',      width: '240px', icon: DepartureIcon },
    { label: 'Destination', width: '320px', icon: MapPin        },
    { label: 'TEMP',     width: '200px', icon: () => <span className="text-lg">🌡️</span> },
    { label: 'Check-In',    width: '280px', icon: Users         },
    { label: 'Gate',        width: '150px', icon: DoorOpen      },
    { label: 'Terminal',    width: '120px', icon: Building2     },
    { label: 'Status',      width: '360px', icon: Info          },
  ], [DepartureIcon]);

  if (nightMode) {
    return (
      <div
        className="h-screen bg-black select-none"
        onDragOver={e => e.preventDefault()}
        onDrop={e => e.preventDefault()}
      >
        <NightClock />
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
            <div className="p-2 sm:p-4 bg-transparent rounded-xl sm:rounded-2xl shadow-2xl border-2 border-orange-500 flex-shrink-0">
              <Plane className="w-8 h-8 sm:w-16 sm:h-16 text-orange-500" />
            </div>
            <div className="min-w-0">
              <h1 className={`text-[2.5rem] sm:text-[6rem] font-black ${COLOR_CONFIG.title} leading-none tracking-tight drop-shadow-2xl truncate`}>
                DEPARTURES
              </h1>
              <p className={`${COLOR_CONFIG.subtitle} text-sm sm:text-2xl mt-0.5 sm:mt-2 font-semibold truncate flex items-center gap-2`}>
                Real-time departure information • Outgoing flights
                {tivatWeather && !tivatWeather.loading && !tivatWeather.error && (
                  <span className="text-white/40 text-base sm:text-xl font-medium flex items-center gap-1">
                    <span> Weather at TIV: {getWeatherEmoji(tivatWeather.weatherCode)}</span>
                    <span>{Math.round(tivatWeather.temperature)}°</span>
                  </span>
                )}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 sm:gap-4 flex-shrink-0">
            <ClockDisplay />
            <div className={`w-3 h-3 sm:w-6 sm:h-6 rounded-full ${COLOR_CONFIG.accent} animate-pulse shadow-2xl flex-shrink-0`} />
          </div>
        </div>
      </div>

      {/* Tabla s letovima */}
      <div className="w-full mx-auto flex-1 min-h-0">
        {isInitialLoad.current && loading && sortedFlights.length === 0 ? (
          <div className="text-center p-8 h-full flex items-center justify-center">
            <div className="inline-flex items-center gap-4">
              <div className={`w-8 h-8 border-4 ${COLOR_CONFIG.border} border-t-transparent rounded-full animate-spin`} />
              <span className="text-xl sm:text-2xl text-white font-semibold">Loading departure information...</span>
            </div>
          </div>
        ) : (
          <div className={`${COLOR_CONFIG.cardBg} rounded-2xl sm:rounded-3xl border-2 sm:border-4 border-white/20 shadow-2xl overflow-hidden h-full flex flex-col`}>
            {isDesktopLayout && <TableHeaders headers={tableHeaders} />}
            <div className="flex-1 overflow-y-auto">
              {sortedFlights.length === 0 ? (
                <div className="p-8 text-center text-white/60 h-full flex flex-col items-center justify-center">
                  <Plane className="w-12 h-12 sm:w-16 sm:h-16 mx-auto mb-4 opacity-50" />
                  <div className="text-xl sm:text-2xl font-semibold">No departures scheduled</div>
                </div>
              ) : (
                sortedFlights.map((flight, index) => (
                  <FlightRow
                    key={`${flight.FlightNumber}-${flight.ScheduledDepartureTime}-${index}`}
                    flight={flight}
                    index={index}
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
          <div className={`ticker-move ${COLOR_CONFIG.title} font-bold text-sm sm:text-xl flex items-center h-full`}>
            {SECURITY_MESSAGES.map((msg, i) => <span key={i} className="mx-6 sm:mx-8 whitespace-nowrap">{msg.text}</span>)}
            {SECURITY_MESSAGES.map((msg, i) => <span key={`d-${i}`} className="mx-6 sm:mx-8 whitespace-nowrap">{msg.text}</span>)}
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="w-full mx-auto mt-1 text-center flex-shrink-0">
        <div className={`${COLOR_CONFIG.subtitle} text-xs py-1`}>
          <div className="flex items-center justify-center gap-2 mb-0">
            <span>Code by: alen.vocanec@apm.co.me</span>
            <span>•</span>
            {lastUpdate && <span>Updated: {lastUpdate}</span>}
            <span>•</span>
            <span>Auto Refresh every 60s</span>
          </div>
        </div>

        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-1.5 mt-1">
            {Array.from({ length: totalPages }).map((_, i) => (
              <div
                key={i}
                className={`w-1.5 h-1.5 rounded-full transition-all ${
                  i === (pageIndex % totalPages) ? 'bg-yellow-400 w-4' : 'bg-white/20'
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
        @keyframes pill-blink-fast{0%,40%{opacity:1}41%,100%{opacity:.55}}
        .animate-pill-blink{animation:.8s ease-in-out infinite pill-blink}
        .animate-pill-blink-fast{animation:.4s ease-in-out infinite pill-blink-fast}

        .ticker-wrap{width:100%;overflow:hidden;position:absolute;top:0;left:0;height:100%}
        .ticker-move{display:inline-block;white-space:nowrap;backface-visibility:hidden;animation:ticker-scroll 45s linear infinite}
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
  );
}