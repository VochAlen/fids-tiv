
'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import {
  RefreshCw,
  Trash2,
  LogOut,
  Home,
  CheckSquare,
  GitBranch,
  X,
  Plane,
  Clock,
  Sun,
  Moon,
  Fingerprint,
} from 'lucide-react';
import type { Flight } from '@/types/flight';

// ─────────────────────────────────────────────
// Konstante
// ─────────────────────────────────────────────

const isDevelopment = process.env.NODE_ENV === 'development';
const API_PREFIX = '/api/test'; // UVIJEK test za verziju 2

const DESKS = [
  ...Array.from({ length: 12 }, (_, i) => String(i + 1)),
  '21', '22', '23', '24', '25', '26',
];
const GATES = ['2', '3', '4', '5', '6', '21', '22', '23', '24', '25', '26', '27', '28', '29', '30', '31'];

const REFRESH_INTERVAL_MS = 60_000;
const TOUCH_TIMEOUT_MS = 8000;
const MIN_TOUCH_TARGET = 44; // px - Apple minimum

const CLASS_CYCLE = [null, 'ECONOMY', 'BUSINESS', 'PREMIUM', 'PRIORITY'] as const;
type ClassType = typeof CLASS_CYCLE[number];

const CLASS_BADGE_STYLES: Record<string, { bg: string; text: string; border: string }> = {
  ECONOMY:  { bg: 'rgba(37,99,235,0.15)',  text: '#93c5fd', border: '#3b82f6' },
  BUSINESS: { bg: 'rgba(194,65,12,0.20)',  text: '#fdba74', border: '#f97316' },
  PREMIUM:  { bg: 'rgba(109,40,217,0.20)', text: '#d8b4fe', border: '#a855f7' },
  PRIORITY: { bg: 'rgba(22,101,52,0.20)',  text: '#86efac', border: '#22c55e' },
};

const CLASS_EMOJI: Record<string, string> = {
  ECONOMY: '💺', BUSINESS: '💼', PREMIUM: '👑', PRIORITY: '⭐',
};
const isBAFlight = (flightNumber: string): boolean =>
  flightNumber.toUpperCase().startsWith('BA');

// ─────────────────────────────────────────────
// Tipovi
// ─────────────────────────────────────────────

interface Assignment {
  resourceId: string;
  flightNumber: string;
  airlineName: string;
  destinationCity: string;
  scheduledTime: string;
  assignedAt: string;
}

type TabType = 'checkin' | 'gate';

interface PendingOverride {
  flight: Flight;
  resourceId: string;
  resourceType: 'desk' | 'gate';
  existingFlight: string;
}

// ─────────────────────────────────────────────
// Helper funkcije
// ─────────────────────────────────────────────

const isDeparted = (flight: Flight): boolean => {
  const s = (flight.StatusEN || '').toLowerCase();
  return s.includes('departed') || s.includes('poletio');
};

const sortBySTD = (a: Flight, b: Flight) =>
  (a.ScheduledDepartureTime || '').localeCompare(b.ScheduledDepartureTime || '');

const processFlights = (departures: Flight[]): Flight[] =>
  departures.filter(f => !isDeparted(f)).sort(sortBySTD);

// ─────────────────────────────────────────────
// Komponenta: TouchFeedback (haptic like)
// ─────────────────────────────────────────────
const TAP_MOVE_THRESHOLD = 10; // px

const TouchFeedback = ({ children, onTap, disabled }: { children: React.ReactNode; onTap: () => void; disabled?: boolean }) => {
  const [ripple, setRipple] = useState(false);
  const touchStart = useRef<{ x: number; y: number } | null>(null);

  const handleTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0];
    touchStart.current = { x: t.clientX, y: t.clientY };
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (disabled || !touchStart.current) return;
    const t = e.changedTouches[0];
    const dx = Math.abs(t.clientX - touchStart.current.x);
    const dy = Math.abs(t.clientY - touchStart.current.y);
    touchStart.current = null;

    // Ako je prst pomjeren više od praga, to je scroll/drag, ne tap — ignoriši
    if (dx > TAP_MOVE_THRESHOLD || dy > TAP_MOVE_THRESHOLD) return;

    e.preventDefault();
    setRipple(true);
    onTap();
    setTimeout(() => setRipple(false), 150);
  };

  return (
    <div
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onClick={!disabled ? onTap : undefined}
      className={`relative transition-all duration-150 ${ripple ? 'scale-95' : 'scale-100'}`}
      style={{ touchAction: 'pan-y' }}
    >
      {ripple && (
        <div className="absolute inset-0 bg-white/20 rounded-xl animate-ping" style={{ animationDuration: '300ms' }} />
      )}
      {children}
    </div>
  );
};

// ─────────────────────────────────────────────
// Komponenta: ResourceCell (povećan za touch)
// ─────────────────────────────────────────────
interface ResourceCellProps {
  id: string;
  occupied?: Assignment;
  type: 'desk' | 'gate';
  flightReady: boolean;
  onAssign: () => void;
  isDark: boolean;
}

const ResourceCell: React.FC<ResourceCellProps> = ({
  id, occupied, type, flightReady, onAssign, isDark,
}) => {
  let variantClasses = '';
  let textColor = '';
  let subTextColor = '';

  // Touch optimizacija - minimalna visina
  const baseClasses = 'relative rounded-xl border text-center cursor-pointer transition-all duration-200 touch-manipulation select-none min-h-[70px] flex flex-col items-center justify-center';

  if (isDark) {
    if (occupied) {
      variantClasses = 'bg-red-500/20 border-red-500/50';
      textColor = 'text-red-300';
      subTextColor = 'text-red-400/80';
    } else if (flightReady) {
      variantClasses = type === 'desk'
        ? 'bg-sky-500/30 border-sky-400/70 shadow-lg shadow-sky-500/30 animate-pulse-subtle'
        : 'bg-emerald-500/30 border-emerald-400/70 shadow-lg shadow-emerald-500/30 animate-pulse-subtle';
      textColor = type === 'desk' ? 'text-sky-200' : 'text-emerald-200';
      subTextColor = 'text-white/70';
    } else {
      variantClasses = type === 'desk'
        ? 'bg-sky-500/10 border-sky-500/30'
        : 'bg-emerald-500/10 border-emerald-500/30';
      textColor = type === 'desk' ? 'text-sky-400/80' : 'text-emerald-400/80';
      subTextColor = 'text-white/30';
    }
  } else {
    if (occupied) {
      variantClasses = 'bg-red-200 border-red-500';
      textColor = 'text-red-900';
      subTextColor = 'text-red-800';
    } else if (flightReady) {
      variantClasses = type === 'desk'
        ? 'bg-sky-300 border-sky-600 shadow-lg'
        : 'bg-emerald-300 border-emerald-600 shadow-lg';
      textColor = type === 'desk' ? 'text-sky-900' : 'text-emerald-900';
      subTextColor = 'text-gray-800';
    } else {
      variantClasses = type === 'desk'
        ? 'bg-sky-100 border-sky-300'
        : 'bg-emerald-100 border-emerald-300';
      textColor = type === 'desk' ? 'text-sky-800' : 'text-emerald-800';
      subTextColor = 'text-gray-600';
    }
  }

  return (
    <TouchFeedback onTap={onAssign} disabled={!!occupied}>
      <div className={`${baseClasses} ${variantClasses}`} style={{ padding: '12px 4px' }}>
        {flightReady && !occupied && (
          <div className={`absolute inset-0 rounded-xl opacity-40 animate-ping ${type === 'desk' ? 'bg-sky-400' : 'bg-emerald-400'}`} style={{ animationDuration: '1.5s' }} />
        )}
        <div className={`relative text-xl font-black leading-none ${textColor}`}>
          {id}
        </div>
        <div className={`relative text-[10px] mt-1.5 font-mono truncate max-w-full px-1 ${subTextColor}`}>
          {occupied ? occupied.flightNumber : flightReady ? '📱 TAPNI' : '⚫'}
        </div>
        {occupied && (
          <div className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-red-500 ring-2 ring-white dark:ring-slate-900" />
        )}
      </div>
    </TouchFeedback>
  );
};

// ─────────────────────────────────────────────
// Komponenta: FlightRow (povećan za touch)
// ─────────────────────────────────────────────
interface FlightRowProps {
  flight: Flight;
  assigned: boolean;
  selected: boolean;
  onSelect: () => void;
  isDark: boolean;
}

const FlightRow: React.FC<FlightRowProps> = ({
  flight, assigned, selected, onSelect, isDark,
}) => {
  let containerClasses = 'cursor-pointer rounded-xl border transition-all duration-150 select-none relative overflow-hidden min-h-[85px] ';
  let flightNumberColor = '';
  let timeColor = '';
  let destColor = '';
  let airlineColor = '';

  if (isDark) {
    if (selected) {
      containerClasses += 'ring-2 ring-amber-400 bg-amber-500/20 border-amber-400/70 shadow-lg shadow-amber-500/30';
      flightNumberColor = 'text-amber-200';
      timeColor = 'text-amber-400/80';
      destColor = 'text-amber-300/90';
      airlineColor = 'text-amber-400/60';
    } else if (assigned) {
      containerClasses += 'bg-white/5 border-white/15 opacity-60';
      flightNumberColor = 'text-white/70';
      timeColor = 'text-white/40';
      destColor = 'text-white/60';
      airlineColor = 'text-white/30';
    } else {
      containerClasses += 'bg-white/8 border-white/20 hover:bg-white/15 active:scale-98';
      flightNumberColor = 'text-white';
      timeColor = 'text-white/40';
      destColor = 'text-white/70';
      airlineColor = 'text-white/35';
    }
  } else {
    if (selected) {
      containerClasses += 'ring-2 ring-amber-500 bg-amber-100 border-amber-500 shadow-md';
      flightNumberColor = 'text-amber-900';
      timeColor = 'text-amber-700';
      destColor = 'text-amber-800';
      airlineColor = 'text-amber-700/70';
    } else if (assigned) {
      containerClasses += 'bg-gray-100 border-gray-300 opacity-70';
      flightNumberColor = 'text-gray-700';
      timeColor = 'text-gray-500';
      destColor = 'text-gray-600';
      airlineColor = 'text-gray-500';
    } else {
      containerClasses += 'bg-white border-gray-200 hover:bg-gray-100 active:scale-98';
      flightNumberColor = 'text-gray-900';
      timeColor = 'text-gray-500';
      destColor = 'text-gray-700';
      airlineColor = 'text-gray-500';
    }
  }

  return (
    <TouchFeedback onTap={onSelect}>
      <div className={containerClasses} style={{ padding: '12px 16px' }}>
        {selected && <div className="absolute left-0 top-0 bottom-0 w-1.5 bg-amber-400 rounded-l-xl" />}
        <div className="flex items-center justify-between gap-3">
          <span className={`font-mono font-bold text-base tracking-tight ${flightNumberColor}`}>
            {flight.FlightNumber}
          </span>
          <div className={`flex items-center gap-1.5 ${timeColor}`}>
            <Clock size={12} />
            <span className="text-xs font-mono">{flight.ScheduledDepartureTime}</span>
          </div>
        </div>
        <div className={`text-sm truncate mt-1 font-medium ${destColor}`}>
          {flight.DestinationCityName || flight.DestinationAirportCode}
        </div>
        <div className="flex items-center justify-between mt-1.5">
          <span className={`text-[11px] truncate ${airlineColor}`}>
            {flight.AirlineName}
          </span>
          {selected && (
            <span className="text-[11px] font-bold text-amber-900 bg-amber-300 px-2.5 py-1 rounded-full flex-shrink-0 shadow-sm">
              ✓ ODABRAN
            </span>
          )}
          {!selected && assigned && (
            <span className={`text-[10px] font-medium flex-shrink-0 ${isDark ? 'text-white/35' : 'text-gray-500'}`}>
              dodijeljen
            </span>
          )}
        </div>
      </div>
    </TouchFeedback>
  );
};

// ─────────────────────────────────────────────
// Komponenta: AssignmentCard
// ─────────────────────────────────────────────
const AssignmentCard: React.FC<{
  a: Assignment;
  type: 'desk' | 'gate';
  classType: ClassType;
  onRemove: () => void;
  onClassToggle: (next: ClassType) => void;
  isDark: boolean;
}> = ({ a, type, classType, onRemove, onClassToggle, isDark }) => {
  const classes = ['ECONOMY', 'BUSINESS', 'PREMIUM', 'PRIORITY'] as const;

  return (
    <div className={`
      flex flex-col gap-2 rounded-xl border p-3
      ${type === 'desk'
        ? isDark ? 'bg-sky-500/10 border-sky-500/30' : 'bg-sky-100 border-sky-400'
        : isDark ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-emerald-100 border-emerald-400'
      }
    `}>
      {/* Info + trash */}
      <div className="flex justify-between items-start">
        <div className="min-w-0 flex-1">
          <div className={`text-xs font-bold tracking-wider mb-1 ${
            type === 'desk'
              ? (isDark ? 'text-sky-400' : 'text-sky-800')
              : (isDark ? 'text-emerald-400' : 'text-emerald-800')
          }`}>
            {type === 'desk' ? 'ŠALTER' : 'GATE'} {a.resourceId}
          </div>
          <div className={`font-mono font-bold text-base ${isDark ? 'text-white' : 'text-gray-900'}`}>
            {a.flightNumber}
          </div>
          <div className={`text-xs truncate ${isDark ? 'text-white/50' : 'text-gray-600'}`}>
            {a.destinationCity} · {a.scheduledTime}
          </div>
        </div>
        <TouchFeedback onTap={onRemove}>
          <button className="p-2 rounded-lg text-gray-400 hover:text-red-500 transition-colors flex-shrink-0">
            <Trash2 size={16} />
          </button>
        </TouchFeedback>
      </div>

      {/* Class buttons */}
      <div className="grid grid-cols-4 gap-1">
        {classes.map((cls) => {
          const isActive = classType === cls;
          const style = CLASS_BADGE_STYLES[cls];
          return (
            <TouchFeedback key={cls} onTap={() => onClassToggle(isActive ? null : cls)}>
              <button
                className="w-full rounded-lg py-1.5 text-[10px] font-bold tracking-wide border transition-all active:scale-95"
                style={isActive ? {
                  background:  style.bg,
                  color:       style.text,
                  borderColor: style.border,
                  boxShadow:   `0 0 8px ${style.border}55`,
                } : {
                  background:  isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)',
                  color:       isDark ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.30)',
                  borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.12)',
                }}
              >
                <div>{CLASS_EMOJI[cls]}</div>
                <div>{cls}</div>
              </button>
            </TouchFeedback>
          );
        })}
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────
// Komponenta: ConfirmOverlay (touch optimizovan)
// ─────────────────────────────────────────────
const ConfirmOverlay: React.FC<{ pending: PendingOverride; onConfirm: () => void; onCancel: () => void; isDark: boolean }> = ({ pending, onConfirm, onCancel, isDark }) => (
  <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onClick={onCancel}>
    <div className={`rounded-2xl border p-6 max-w-sm w-full shadow-2xl ${isDark ? 'bg-slate-900 border-white/20' : 'bg-white border-gray-200'}`} onClick={(e) => e.stopPropagation()}>
      <div className={`font-bold text-lg mb-3 text-center ${isDark ? 'text-white' : 'text-gray-900'}`}>
        Zamijeniti dodjelu?
      </div>
      <div className={`text-sm mb-6 text-center leading-relaxed ${isDark ? 'text-white/70' : 'text-gray-600'}`}>
        {pending.resourceType === 'desk' ? 'Šalter' : 'Gate'} {pending.resourceId} je već dodijeljen letu{' '}
        <span className={`font-mono font-bold ${isDark ? 'text-red-400' : 'text-red-700'}`}>{pending.existingFlight}</span>.
        <br />
        Zamijeniti sa{' '}
        <span className={`font-mono font-bold ${isDark ? 'text-amber-400' : 'text-amber-700'}`}>{pending.flight.FlightNumber}</span>?
      </div>
      <div className="flex gap-3">
        <button onClick={onCancel} className={`flex-1 py-3 rounded-xl text-sm font-medium border transition-colors ${isDark ? 'bg-white/10 border-white/20 text-white/80 active:bg-white/20' : 'bg-gray-100 border-gray-200 text-gray-600 active:bg-gray-200'}`}>
          Odustani
        </button>
        <button onClick={onConfirm} className="flex-1 py-3 rounded-xl text-sm font-bold bg-red-500 text-white active:bg-red-600 transition-colors shadow-lg">
          Zamijeni
        </button>
      </div>
    </div>
  </div>
);

// ─────────────────────────────────────────────
// GLAVNA KOMPONENTA
// ─────────────────────────────────────────────
export default function AssignPanel() {
  const router = useRouter();

  const [activeTab, setActiveTab] = useState<TabType>('checkin');
  const [flights, setFlights] = useState<Flight[]>([]);
  const [loadingFlights, setLoadingFlights] = useState(true);
  const [lastUpdate, setLastUpdate] = useState('');
  const [checkinAssignments, setCheckinAssignments] = useState<Assignment[]>([]);
  const [gateAssignments, setGateAssignments] = useState<Assignment[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedFlightForTouch, setSelectedFlightForTouch] = useState<Flight | null>(null);
  const [tickSec, setTickSec] = useState(REFRESH_INTERVAL_MS / 1000);
  const [pendingOverride, setPendingOverride] = useState<PendingOverride | null>(null);
  const [isDark, setIsDark] = useState(true);
  const [checkinClasses, setCheckinClasses] = useState<Record<string, ClassType>>({});
const [gateClasses,    setGateClasses]    = useState<Record<string, ClassType>>({});

  // Refs
  const flightsRef = useRef<Flight[]>([]);
  const selectedFlightRef = useRef<Flight | null>(null);
  const checkinAssignmentsRef = useRef<Assignment[]>([]);
  const gateAssignmentsRef = useRef<Assignment[]>([]);
  const touchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync refs
  useEffect(() => { flightsRef.current = flights; }, [flights]);
  useEffect(() => { checkinAssignmentsRef.current = checkinAssignments; }, [checkinAssignments]);
  useEffect(() => { gateAssignmentsRef.current = gateAssignments; }, [gateAssignments]);
 

  const setSelectedFlight = useCallback((flight: Flight | null) => {
    selectedFlightRef.current = flight;
    setSelectedFlightForTouch(flight);
  }, []);

  // Tema
  useEffect(() => {
    const stored = localStorage.getItem('theme');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const shouldBeDark = stored === 'dark' || (stored === null && prefersDark);
    setIsDark(shouldBeDark);
    document.documentElement.classList.toggle('dark', shouldBeDark);
  }, []);

  const toggleTheme = () => {
    const newDark = !isDark;
    setIsDark(newDark);
    document.documentElement.classList.toggle('dark', newDark);
    localStorage.setItem('theme', newDark ? 'dark' : 'light');
  };

  // API pozivi
  const fetchFlightsData = useCallback(async (): Promise<Flight[]> => {
    const res = await fetch('/api/flights?nocache=' + Date.now());
    const data = await res.json();
    return processFlights(data.departures || []);
  }, []);

  const fetchFlights = useCallback(async () => {
    try {
      const sorted = await fetchFlightsData();
      setFlights(sorted);
      setLastUpdate(new Date().toLocaleTimeString('sr-Latn-RS'));
    } catch (err) {
      console.error('Error fetching flights:', err);
    } finally {
      setLoadingFlights(false);
    }
  }, [fetchFlightsData]);

  const fetchCheckinAssignments = useCallback(async (currentFlights: Flight[]) => {
    try {
      const res = await fetch(`${API_PREFIX}/desk-status-override`);
      if (!res.ok) return;
      const data = await res.json();
      const list: Assignment[] = [];
      for (const [deskNumber, value] of Object.entries(data)) {
        const parsed = typeof value === 'string' ? JSON.parse(value) : value as Record<string, unknown>;
        if (parsed.flightNumber && parsed.status === 'open') {
          const flight = currentFlights.find(f => f.FlightNumber === parsed.flightNumber);
          list.push({
            resourceId: deskNumber,
            flightNumber: parsed.flightNumber as string,
            airlineName: flight?.AirlineName || '',
            destinationCity: flight?.DestinationCityName || '',
            scheduledTime: flight?.ScheduledDepartureTime || '',
            assignedAt: parsed.setAt ? new Date(parsed.setAt as string).toLocaleTimeString() : 'unknown',
          });
        }
      }
      setCheckinAssignments(list);
    } catch (err) { console.error(err); }
  }, []);

  const fetchGateAssignments = useCallback(async (currentFlights: Flight[]) => {
    try {
      const res = await fetch(`${API_PREFIX}/gate-status-override`);
      if (!res.ok) return;
      const data = await res.json();
      const list: Assignment[] = [];
      for (const [gateNumber, value] of Object.entries(data)) {
        const parsed = typeof value === 'string' ? JSON.parse(value) : value as Record<string, unknown>;
        if (parsed.flightNumber && parsed.status === 'open') {
          const flight = currentFlights.find(f => f.FlightNumber === parsed.flightNumber);
          list.push({
            resourceId: gateNumber,
            flightNumber: parsed.flightNumber as string,
            airlineName: flight?.AirlineName || '',
            destinationCity: flight?.DestinationCityName || '',
            scheduledTime: flight?.ScheduledDepartureTime || '',
            assignedAt: parsed.setAt ? new Date(parsed.setAt as string).toLocaleTimeString() : 'unknown',
          });
        }
      }
      setGateAssignments(list);
    } catch (err) { console.error(err); }
  }, []);

  const refreshAll = useCallback(async (currentFlights: Flight[]) => {
    await Promise.all([
      fetchCheckinAssignments(currentFlights),
      fetchGateAssignments(currentFlights),
    ]);
  }, [fetchCheckinAssignments, fetchGateAssignments]);

  useEffect(() => {
    fetchFlights().then(() => refreshAll(flightsRef.current));
  }, [fetchFlights, refreshAll]);

  // Auto-refresh timer
// Auto-refresh timer
useEffect(() => {
  const ticker = setInterval(() => setTickSec(prev => prev <= 1 ? REFRESH_INTERVAL_MS / 1000 : prev - 1), 1000);
  const interval = setInterval(async () => {
    setTickSec(REFRESH_INTERVAL_MS / 1000);
    try {
      const sorted = await fetchFlightsData();
      setFlights(sorted);
      setLastUpdate(new Date().toLocaleTimeString('sr-Latn-RS'));
      await refreshAll(sorted);

      // ── Auto-clear šaltera ──────────────────────────────
      for (const a of checkinAssignmentsRef.current) {
        const stillExists = sorted.find(f => f.FlightNumber === a.flightNumber);
        if (!stillExists) {
          try {
            const checkRes = await fetch(`${API_PREFIX}/desk-status-override?deskNumber=${a.resourceId}`);
            if (checkRes.ok) {
              const current = await checkRes.json();
              if (current.flightNumber === a.flightNumber && current.status === 'open') {
                await fetch(`${API_PREFIX}/desk-status-override`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ deskNumber: a.resourceId, action: 'clear' }),
                }).catch(err => console.error('Auto-clear desk error:', err));
              }
            }
          } catch (err) { console.error('Auto-clear desk check error:', err); }
        }
      }

      // ── Auto-clear gate-ova ─────────────────────────────
      for (const a of gateAssignmentsRef.current) {
        const stillExists = sorted.find(f => f.FlightNumber === a.flightNumber);
        if (!stillExists) {
          try {
            const checkRes = await fetch(`${API_PREFIX}/gate-status-override?gateNumber=${a.resourceId}`);
            if (checkRes.ok) {
              const current = await checkRes.json();
              if (current.flightNumber === a.flightNumber && current.status === 'open') {
                await fetch(`${API_PREFIX}/gate-status-override`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ gateNumber: a.resourceId, action: 'clear' }),
                }).catch(err => console.error('Auto-clear gate error:', err));
              }
            }
          } catch (err) { console.error('Auto-clear gate check error:', err); }
        }
      }

    } catch (err) { console.error('Silent refresh error:', err); }
  }, REFRESH_INTERVAL_MS);
  return () => { clearInterval(ticker); clearInterval(interval); };
}, [fetchFlightsData, refreshAll]);

  
const handleRefresh = useCallback(async () => {
  setRefreshing(true);
  setTickSec(REFRESH_INTERVAL_MS / 1000);
  try {
    const sorted = await fetchFlightsData();
    setFlights(sorted);
    setLastUpdate(new Date().toLocaleTimeString('sr-Latn-RS'));
    await refreshAll(sorted);
  } catch (err) { console.error(err); }
  finally { setRefreshing(false); }
}, [fetchFlightsData, refreshAll]);

  // Centralna logika dodjele
  const assignFlightToResource = useCallback(async (flight: Flight, resourceId: string, resourceType: 'desk' | 'gate'): Promise<boolean> => {
    const endpoint = `${API_PREFIX}/${resourceType === 'desk' ? 'desk-status-override' : 'gate-status-override'}`;
    const payload = resourceType === 'desk'
      ? { deskNumber: resourceId, action: 'open', flightNumber: flight.FlightNumber }
      : { gateNumber: resourceId, action: 'open', flightNumber: flight.FlightNumber };

try {
      const res = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      if (!res.ok) throw new Error('HTTP ' + res.status);

      // BA automatska klasa — samo za check-in šaltere
// BA automatska klasa — prva dva BA šaltera = BUSINESS, ostali = ECONOMY
if (resourceType === 'desk' && isBAFlight(flight.FlightNumber)) {
  // Koliko BA šaltera je već dodijeljeno PRIJE ovog novog
  const existingBADesks = checkinAssignmentsRef.current.filter(
    a => isBAFlight(a.flightNumber) && a.resourceId !== resourceId
  );
  const autoClass = existingBADesks.length < 2 ? 'BUSINESS' : 'ECONOMY';

  try {
    await fetch(`/api/test/desk-class/${resourceId}`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ classType: autoClass }),
    });
    // Odmah ažuriraj lokalni state
    setCheckinClasses(prev => ({ ...prev, [resourceId]: autoClass }));
  } catch (err) {
    console.error('Auto BA class error:', err);
  }
}

      await refreshAll(flightsRef.current);
      return true;
    } catch (err) {
      console.error('Greška pri dodjeli:', err);
      return false;
    }
  }, [refreshAll]);

  // Touch assign
  const handleResourceTouchAssign = useCallback(async (resourceId: string, resourceType: 'desk' | 'gate') => {
    const flight = selectedFlightRef.current;
    if (!flight) return;

    const assignments = resourceType === 'desk' ? checkinAssignmentsRef.current : gateAssignmentsRef.current;
    const existing = assignments.find(a => a.resourceId === resourceId);

    if (existing) {
      setPendingOverride({ flight, resourceId, resourceType, existingFlight: existing.flightNumber });
      return;
    }

    await assignFlightToResource(flight, resourceId, resourceType);
    setSelectedFlight(null);
    if (touchTimeoutRef.current) clearTimeout(touchTimeoutRef.current);
  }, [assignFlightToResource, setSelectedFlight]);

  const handleConfirmOverride = useCallback(async () => {
    const p = pendingOverride;
    setPendingOverride(null);
    if (!p) return;
    await assignFlightToResource(p.flight, p.resourceId, p.resourceType);
    setSelectedFlight(null);
    if (touchTimeoutRef.current) clearTimeout(touchTimeoutRef.current);
  }, [pendingOverride, assignFlightToResource, setSelectedFlight]);

  const handleFlightTouchSelect = useCallback((flight: Flight) => {
    setSelectedFlight(flight);
    if (touchTimeoutRef.current) clearTimeout(touchTimeoutRef.current);
    touchTimeoutRef.current = setTimeout(() => setSelectedFlight(null), TOUCH_TIMEOUT_MS);
  }, [setSelectedFlight]);

  const handleRemoveCheckin = useCallback(async (deskNumber: string) => {
    try {
      await fetch(`${API_PREFIX}/desk-status-override`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deskNumber, action: 'clear' }),
      });
      await fetchCheckinAssignments(flightsRef.current);
    } catch { console.error('Greška pri brisanju šaltera', deskNumber); }
  }, [fetchCheckinAssignments]);

  const handleRemoveGate = useCallback(async (gateNumber: string) => {
    try {
      await fetch(`${API_PREFIX}/gate-status-override`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gateNumber, action: 'clear' }),
      });
      await fetchGateAssignments(flightsRef.current);
    } catch { console.error('Greška pri brisanju gate-a', gateNumber); }
  }, [fetchGateAssignments]);

  const fetchAllClasses = useCallback(async (
  assignments: Assignment[],
  type: 'desk' | 'gate',
): Promise<Record<string, ClassType>> => {
  const entries = await Promise.all(
    assignments.map(async (a) => {
      try {
        const endpoint = type === 'desk'
          ? `/api/test/desk-class/${a.resourceId}`
          : `/api/test/gate-class/${a.resourceId}`;
        const res = await fetch(endpoint);
        if (!res.ok) return [a.resourceId, null] as const;
        const data = await res.json();
        return [a.resourceId, (data.classType ?? null)] as const;
      } catch {
        return [a.resourceId, null] as const;
      }
    })
  );
  return Object.fromEntries(entries) as Record<string, ClassType>;
}, []);

useEffect(() => {
  if (checkinAssignments.length === 0) { setCheckinClasses({}); return; }
  // Mali delay da Redis stigne da upiše klasu prije nego je čitamo
  const id = setTimeout(() => {
    fetchAllClasses(checkinAssignments, 'desk').then(setCheckinClasses);
  }, 800);
  return () => clearTimeout(id);
}, [checkinAssignments, fetchAllClasses]);

useEffect(() => {
  if (gateAssignments.length === 0) { setGateClasses({}); return; }
  const id = setTimeout(() => {
    fetchAllClasses(gateAssignments, 'gate').then(setGateClasses);
  }, 800);
  return () => clearTimeout(id);
}, [gateAssignments, fetchAllClasses]);


const handleClassToggle = useCallback(async (
  resourceId: string,
  resourceType: 'desk' | 'gate',
  next: ClassType,                          // ← dodaj parametar
) => {
  const currentClasses = resourceType === 'desk' ? checkinClasses : gateClasses;
  const setClasses     = resourceType === 'desk' ? setCheckinClasses : setGateClasses;
  const current        = currentClasses[resourceId] ?? null;

  setClasses(prev => ({ ...prev, [resourceId]: next }));

  try {
    const endpoint = resourceType === 'desk'
      ? `/api/test/desk-class/${resourceId}`
      : `/api/test/gate-class/${resourceId}`;
    await fetch(endpoint, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ classType: next }),
    });
  } catch (err) {
    console.error('Class toggle error:', err);
    setClasses(prev => ({ ...prev, [resourceId]: current }));
  }
}, [checkinClasses, gateClasses]);

  const handleLogout = async () => {
    await fetch('/api/admin/logout', { method: 'POST' }).catch(() => {});
    router.push('/admin/login');
  };

  const isFlightAssigned = (flightNumber: string, tab: TabType) =>
    tab === 'checkin'
      ? checkinAssignments.some(a => a.flightNumber === flightNumber)
      : gateAssignments.some(a => a.flightNumber === flightNumber);

  if (loadingFlights) {
    return (
      <div className={`min-h-screen flex items-center justify-center ${isDark ? 'bg-slate-950' : 'bg-white'}`}>
        <div className="text-center space-y-4">
          <div className="w-12 h-12 border-3 border-sky-500 border-t-transparent rounded-full animate-spin mx-auto" />
          <div className={`text-sm tracking-widest uppercase ${isDark ? 'text-white/50' : 'text-gray-500'}`}>Učitavanje</div>
        </div>
      </div>
    );
  }

  const flightList = (tab: TabType) => (
    <div className="space-y-2 max-h-[65vh] overflow-y-auto pr-1 scrollbar-thin">
      {flights.length === 0 && (
        <div className={`text-center py-12 text-sm ${isDark ? 'text-white/30' : 'text-gray-400'}`}>
          <Plane size={36} className="mx-auto mb-3 opacity-30" />
          Nema aktivnih letova
        </div>
      )}
      {flights.map(flight => (
        <FlightRow
          key={flight.FlightNumber + flight.ScheduledDepartureTime}
          flight={flight}
          assigned={isFlightAssigned(flight.FlightNumber, tab)}
          selected={selectedFlightForTouch?.FlightNumber === flight.FlightNumber}
          onSelect={() => handleFlightTouchSelect(flight)}
          isDark={isDark}
        />
      ))}
    </div>
  );

const resourceGrid = (type: 'desk' | 'gate', items: string[], occupied: Assignment[]) => (
  <div className="grid grid-cols-4 sm:grid-cols-6 lg:grid-cols-8 gap-3">
      {items.map(id => (
        <ResourceCell
          key={id}
          id={id}
          type={type}
          occupied={occupied.find(a => a.resourceId === id)}
          flightReady={!!selectedFlightForTouch && !occupied.find(a => a.resourceId === id)}
          onAssign={() => handleResourceTouchAssign(id, type)}
          isDark={isDark}
        />
      ))}
    </div>
  );

  return (
    <div className={`min-h-screen p-4 overflow-y-auto ${isDark ? 'bg-slate-950 text-white' : 'bg-white text-gray-900'}`}>
      {pendingOverride && (
        <ConfirmOverlay pending={pendingOverride} onConfirm={handleConfirmOverride} onCancel={() => setPendingOverride(null)} isDark={isDark} />
      )}

      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-6">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Fingerprint size={24} className="text-sky-500" />
              <h1 className="text-xl font-bold tracking-tight">TIV · Check-in &amp; Gate</h1>
            </div>
            <div className="flex flex-wrap items-center gap-3 text-xs">
              <span className={isDark ? 'text-white/30' : 'text-gray-500'}>✈️ Letovi: {flights.length}</span>
              <span className={isDark ? 'text-white/15' : 'text-gray-300'}>|</span>
              <span className={isDark ? 'text-white/30' : 'text-gray-500'}>🕐 Ažurirano: {lastUpdate || '—'}</span>
              <span className={isDark ? 'text-white/15' : 'text-gray-300'}>|</span>
              <span className={`tabular-nums ${isDark ? 'text-white/25' : 'text-gray-500'}`}>🔄 Refresh za {tickSec}s</span>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button onClick={handleRefresh} disabled={refreshing} className={`p-2.5 rounded-xl border transition-all active:scale-95 ${isDark ? 'bg-white/5 hover:bg-white/10 border-white/10' : 'bg-gray-100 hover:bg-gray-200 border-gray-300'}`}>
              <RefreshCw size={16} className={`${isDark ? 'text-white/60' : 'text-gray-600'} ${refreshing ? 'animate-spin' : ''}`} />
            </button>
            <button onClick={() => router.push('/admin')} className={`p-2.5 rounded-xl border transition-all active:scale-95 ${isDark ? 'bg-white/5 hover:bg-white/10 border-white/10' : 'bg-gray-100 hover:bg-gray-200 border-gray-300'}`}>
              <Home size={16} className={isDark ? 'text-white/60' : 'text-gray-600'} />
            </button>
            <button onClick={toggleTheme} className={`p-2.5 rounded-xl border transition-all active:scale-95 ${isDark ? 'bg-white/5 hover:bg-white/10 border-white/10' : 'bg-gray-100 hover:bg-gray-200 border-gray-300'}`}>
              {isDark ? <Sun size={16} className="text-yellow-400" /> : <Moon size={16} className="text-slate-700" />}
            </button>
            <button onClick={handleLogout} className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-red-500/15 hover:bg-red-500/25 border border-red-500/25 text-red-400 text-xs font-medium transition-all active:scale-95">
              <LogOut size={14} /> Odjava
            </button>
          </div>
        </div>

        {/* Tabovi - veći za touch */}
        <div className="flex gap-3 mb-6">
          {[
            { id: 'checkin' as TabType, label: '🏷️ Check-in', icon: CheckSquare, count: checkinAssignments.length },
            { id: 'gate' as TabType, label: '🚪 Gate-ovi', icon: GitBranch, count: gateAssignments.length },
          ].map(tab => {
            const isActive = activeTab === tab.id;
            return (
              <button key={tab.id} onClick={() => setActiveTab(tab.id)} className={`flex items-center gap-2 px-5 py-3 rounded-xl border text-sm font-semibold transition-all active:scale-95 ${isActive ? (isDark ? 'bg-sky-500/20 border-sky-500/50 text-sky-300 shadow-lg' : 'bg-sky-200 border-sky-500 text-sky-900 shadow-md') : (isDark ? 'bg-white/5 border-white/10 text-white/50 hover:bg-white/10' : 'bg-gray-100 border-gray-300 text-gray-600 hover:bg-gray-200')}`}>
                {tab.icon && <tab.icon size={16} />}
                <span>{tab.label}</span>
                <span className={`text-[11px] px-2 py-0.5 rounded-full font-bold ${isActive ? (isDark ? 'bg-white/20 text-white' : 'bg-white/80 text-gray-800') : (isDark ? 'bg-white/10 text-white/40' : 'bg-gray-300 text-gray-600')}`}>
                  {tab.count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Selected Flight Banner */}
        {selectedFlightForTouch && (
          <div className="mb-5 p-4 rounded-xl bg-amber-500/15 border-2 border-amber-400/50 shadow-lg shadow-amber-500/20">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div className="flex items-center gap-3">
                <div className="w-3 h-3 rounded-full bg-amber-400 animate-pulse" />
                <span className={`font-mono font-bold text-lg ${isDark ? 'text-amber-200' : 'text-amber-900'}`}>
                  {selectedFlightForTouch.FlightNumber}
                </span>
                <span className={`text-base ${isDark ? 'text-amber-400/80' : 'text-amber-800'}`}>
                  → {selectedFlightForTouch.DestinationCityName || selectedFlightForTouch.DestinationAirportCode}
                </span>
              </div>
              <button onClick={() => setSelectedFlight(null)} className="flex items-center gap-1.5 text-sm text-amber-400/70 hover:text-amber-300 px-3 py-1.5 rounded-lg hover:bg-amber-500/10 transition-colors">
                <X size={14} /> Odustani
              </button>
            </div>
          </div>
        )}

        {/* CHECK-IN TAB */}
        {activeTab === 'checkin' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            <div className={`rounded-xl border p-4 ${isDark ? 'bg-white/5 border-white/10' : 'bg-gray-50 border-gray-200'}`}>
              <div className={`text-xs font-bold tracking-wider uppercase mb-4 ${isDark ? 'text-white/40' : 'text-gray-500'}`}>✈️ Letovi ({flights.length})</div>
              {flightList('checkin')}
            </div>
            <div className="lg:col-span-2 space-y-5">
              <div className={`rounded-xl border p-4 ${isDark ? 'bg-white/5 border-white/10' : 'bg-gray-50 border-gray-200'}`}>
                <div className={`text-xs font-bold tracking-wider uppercase mb-4 ${isDark ? 'text-white/40' : 'text-gray-500'}`}>📋 Šalteri</div>
                <div className="mb-5">
                  <div className="text-center text-sm font-medium mb-3 text-sky-400">Terminal 1</div>
                  {resourceGrid('desk', DESKS.filter(d => parseInt(d) <= 12), checkinAssignments)}
                </div>
                <div>
                  <div className="text-center text-sm font-medium mb-3 text-emerald-400">Terminal 2</div>
                  {resourceGrid('desk', DESKS.filter(d => parseInt(d) >= 21), checkinAssignments)}
                </div>
              </div>
              <div className={`rounded-xl border p-4 ${isDark ? 'bg-white/5 border-white/10' : 'bg-gray-50 border-gray-200'}`}>
                <div className={`text-xs font-bold tracking-wider uppercase mb-3 ${isDark ? 'text-white/40' : 'text-gray-500'}`}>✅ Aktivne dodjele ({checkinAssignments.length})</div>
                {checkinAssignments.length === 0 ? <div className={`text-center py-8 text-sm ${isDark ? 'text-white/30' : 'text-gray-400'}`}>Nema dodjela</div> : <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">{checkinAssignments.map(a => (
  <AssignmentCard
    key={a.resourceId}
    a={a}
    type="desk"
    classType={checkinClasses[a.resourceId] ?? null}
    onRemove={() => handleRemoveCheckin(a.resourceId)}
   onClassToggle={(next) => handleClassToggle(a.resourceId, 'desk', next)}
    isDark={isDark}
  />
))}</div>}
              </div>
            </div>
          </div>
        )}

        {/* GATE TAB */}
        {activeTab === 'gate' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            <div className={`rounded-xl border p-4 ${isDark ? 'bg-white/5 border-white/10' : 'bg-gray-50 border-gray-200'}`}>
              <div className={`text-xs font-bold tracking-wider uppercase mb-4 ${isDark ? 'text-white/40' : 'text-gray-500'}`}>✈️ Letovi ({flights.length})</div>
              {flightList('gate')}
            </div>
            <div className="lg:col-span-2 space-y-5">
              <div className={`rounded-xl border p-4 ${isDark ? 'bg-white/5 border-white/10' : 'bg-gray-50 border-gray-200'}`}>
                <div className={`text-xs font-bold tracking-wider uppercase mb-4 ${isDark ? 'text-white/40' : 'text-gray-500'}`}>🚪 Gate-ovi</div>
                <div className="mb-5">
                  <div className="text-center text-sm font-medium mb-3 text-sky-400">Terminal 1</div>
                  {resourceGrid('gate', GATES.filter(g => parseInt(g) >= 2 && parseInt(g) <= 6), gateAssignments)}
                </div>
                <div>
                  <div className="text-center text-sm font-medium mb-3 text-emerald-400">Terminal 2</div>
                  {resourceGrid('gate', GATES.filter(g => parseInt(g) >= 21 && parseInt(g) <= 28), gateAssignments)}
                </div>
              </div>
              <div className={`rounded-xl border p-4 ${isDark ? 'bg-white/5 border-white/10' : 'bg-gray-50 border-gray-200'}`}>
                <div className={`text-xs font-bold tracking-wider uppercase mb-3 ${isDark ? 'text-white/40' : 'text-gray-500'}`}>✅ Aktivne dodjele ({gateAssignments.length})</div>
                {gateAssignments.length === 0 ? <div className={`text-center py-8 text-sm ${isDark ? 'text-white/30' : 'text-gray-400'}`}>Nema dodjela</div> : <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">{gateAssignments.map(a => (
  <AssignmentCard
    key={a.resourceId}
    a={a}
    type="gate"
    classType={gateClasses[a.resourceId] ?? null}
    onRemove={() => handleRemoveGate(a.resourceId)}
onClassToggle={(next) => handleClassToggle(a.resourceId, 'gate', next)}
    isDark={isDark}
  />
))}</div>}
              </div>
            </div>
          </div>
        )}
      </div>

      <style jsx global>{`
        html, body, #__next { overflow: auto !important; height: auto !important; min-height: 100vh; }
        * { -webkit-tap-highlight-color: transparent; }
        .touch-manipulation { touch-action: manipulation; }
        .scrollbar-thin::-webkit-scrollbar { width: 4px; }
        .scrollbar-thin::-webkit-scrollbar-track { background: transparent; }
        .scrollbar-thin::-webkit-scrollbar-thumb { background: ${isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.2)'}; border-radius: 4px; }
        @keyframes pulse-subtle { 0%, 100% { opacity: 0.8; } 50% { opacity: 1; } }
        .animate-pulse-subtle { animation: pulse-subtle 1.2s ease-in-out infinite; }
        .active\\:scale-95:active { transform: scale(0.95); }
      `}</style>
    </div>
  );
}