'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import {
  RefreshCw, Trash2, LogOut, Home, CheckSquare, GitBranch,
  X, Plane, Clock, Sun, Moon, Fingerprint, BarChart2,
} from 'lucide-react';
import type { Flight } from '@/types/flight';

// ─────────────────────────────────────────────
// Konstante
// ─────────────────────────────────────────────

const API_PREFIX = '/api/test';

let cachedFlights: Flight[] | null = null;
let cachedFlightsExpiry = 0;
const FLIGHTS_CACHE_MS = 60_000;

let isDirty = false;
let lastHash = '';
let isCheckingChanges = false;

const DESKS = [
  ...Array.from({ length: 12 }, (_, i) => String(i + 1)),
  '21', '22', '23', '24', '25', '26',
];
const GATES = ['2','3','4','5','6','21','22','23','24','25','26','27','28','29','30','31'];

const REFRESH_INTERVAL_MS = 80_000;
const TOUCH_TIMEOUT_MS    = 8_000;
const TAP_MOVE_THRESHOLD  = 10;

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

const isBAFlight = (fn: string) => fn.toUpperCase().startsWith('BA');

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
  classType: ClassType;
}

interface StatSession {
  flight: string;
  destination: string;
  from: string;
  to: string;
  minutes: number;
}

interface DailyStats {
  desks: Record<string, StatSession[]>;
  gates: Record<string, StatSession[]>;
}

type TabType = 'checkin' | 'gate';

interface PendingOverride {
  flight: Flight;
  resourceId: string;
  resourceType: 'desk' | 'gate';
  existingFlight: string;
}

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

const isDeparted = (f: Flight) => {
  const s = (f.StatusEN || '').toLowerCase();
  return s.includes('departed') || s.includes('poletio');
};

const sortBySTD = (a: Flight, b: Flight) =>
  (a.ScheduledDepartureTime || '').localeCompare(b.ScheduledDepartureTime || '');

const processFlights = (deps: Flight[]) =>
  deps.filter(f => !isDeparted(f)).sort(sortBySTD);

const todayKey = () => new Date().toISOString().split('T')[0];

// ─────────────────────────────────────────────
// Stats API helpers — sve ide kroz /api/test/stats
// ─────────────────────────────────────────────

const statsPost = (body: object) =>
  fetch('/api/test/stats', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).catch(err => console.error('Stats API error:', err));

const trackStart = (type: 'desk' | 'gate', resourceId: string, flight: Flight) =>
  statsPost({ action: 'start', type, resourceId, flight });

const trackEnd = (type: 'desk' | 'gate', resourceId: string) =>
  statsPost({ action: 'end', type, resourceId });

const fetchDailyStats = async (date?: string): Promise<DailyStats> => {
  try {
    const res = await fetch(`/api/test/stats${date ? `?date=${date}` : ''}`);
    if (!res.ok) return { desks: {}, gates: {} };
    return res.json();
  } catch {
    return { desks: {}, gates: {} };
  }
};

// ─────────────────────────────────────────────
// Komponenta: TouchFeedback
// ─────────────────────────────────────────────

const TouchFeedback = ({
  children, onTap, disabled,
}: {
  children: React.ReactNode;
  onTap: () => void;
  disabled?: boolean;
}) => {
  const [ripple, setRipple] = useState(false);
  const touchStart = useRef<{ x: number; y: number } | null>(null);

  const handleTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0];
    touchStart.current = { x: t.clientX, y: t.clientY };
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (disabled || !touchStart.current) return;
    const t  = e.changedTouches[0];
    const dx = Math.abs(t.clientX - touchStart.current.x);
    const dy = Math.abs(t.clientY - touchStart.current.y);
    touchStart.current = null;
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
        <div className="absolute inset-0 bg-white/20 rounded-xl animate-ping"
          style={{ animationDuration: '300ms' }} />
      )}
      {children}
    </div>
  );
};

// ─────────────────────────────────────────────
// Komponenta: ResourceCell
// ─────────────────────────────────────────────

const ResourceCell: React.FC<{
  id: string;
  occupied?: Assignment;
  type: 'desk' | 'gate';
  flightReady: boolean;
  onAssign: () => void;
  isDark: boolean;
}> = ({ id, occupied, type, flightReady, onAssign, isDark }) => {
  let variantClasses = '';
  let textColor      = '';
  let subTextColor   = '';

  const base = 'relative rounded-xl border text-center cursor-pointer transition-all duration-200 touch-manipulation select-none min-h-[70px] flex flex-col items-center justify-center';

  if (isDark) {
    if (occupied) {
      variantClasses = 'bg-red-500/20 border-red-500/50';
      textColor = 'text-red-300'; subTextColor = 'text-red-400/80';
    } else if (flightReady) {
      variantClasses = type === 'desk'
        ? 'bg-sky-500/30 border-sky-400/70 shadow-lg shadow-sky-500/30 animate-pulse-subtle'
        : 'bg-emerald-500/30 border-emerald-400/70 shadow-lg shadow-emerald-500/30 animate-pulse-subtle';
      textColor = type === 'desk' ? 'text-sky-200' : 'text-emerald-200';
      subTextColor = 'text-white/70';
    } else {
      variantClasses = type === 'desk'
        ? 'bg-sky-500/10 border-sky-500/30' : 'bg-emerald-500/10 border-emerald-500/30';
      textColor = type === 'desk' ? 'text-sky-400/80' : 'text-emerald-400/80';
      subTextColor = 'text-white/30';
    }
  } else {
    if (occupied) {
      variantClasses = 'bg-red-200 border-red-500';
      textColor = 'text-red-900'; subTextColor = 'text-red-800';
    } else if (flightReady) {
      variantClasses = type === 'desk'
        ? 'bg-sky-300 border-sky-600 shadow-lg' : 'bg-emerald-300 border-emerald-600 shadow-lg';
      textColor = type === 'desk' ? 'text-sky-900' : 'text-emerald-900';
      subTextColor = 'text-gray-800';
    } else {
      variantClasses = type === 'desk'
        ? 'bg-sky-100 border-sky-300' : 'bg-emerald-100 border-emerald-300';
      textColor = type === 'desk' ? 'text-sky-800' : 'text-emerald-800';
      subTextColor = 'text-gray-600';
    }
  }

  return (
    <TouchFeedback onTap={onAssign} disabled={!!occupied}>
      <div className={`${base} ${variantClasses}`} style={{ padding: '12px 4px' }}>
        {flightReady && !occupied && (
          <div className={`absolute inset-0 rounded-xl opacity-40 animate-ping ${
            type === 'desk' ? 'bg-sky-400' : 'bg-emerald-400'
          }`} style={{ animationDuration: '1.5s' }} />
        )}
        <div className={`relative text-xl font-black leading-none ${textColor}`}>{id}</div>
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
// Komponenta: FlightRow
// ─────────────────────────────────────────────

const FlightRow: React.FC<{
  flight: Flight;
  assigned: boolean;
  selected: boolean;
  onSelect: () => void;
  isDark: boolean;
}> = ({ flight, assigned, selected, onSelect, isDark }) => {
  let cc = 'cursor-pointer rounded-xl border transition-all duration-150 select-none relative overflow-hidden min-h-[85px] ';
  let fc = '', tc = '', dc = '', ac = '';

  if (isDark) {
    if (selected) {
      cc += 'ring-2 ring-amber-400 bg-amber-500/20 border-amber-400/70 shadow-lg shadow-amber-500/30';
      fc = 'text-amber-200'; tc = 'text-amber-400/80'; dc = 'text-amber-300/90'; ac = 'text-amber-400/60';
    } else if (assigned) {
      cc += 'bg-white/5 border-white/15 opacity-60';
      fc = 'text-white/70'; tc = 'text-white/40'; dc = 'text-white/60'; ac = 'text-white/30';
    } else {
      cc += 'bg-white/8 border-white/20 hover:bg-white/15';
      fc = 'text-white'; tc = 'text-white/40'; dc = 'text-white/70'; ac = 'text-white/35';
    }
  } else {
    if (selected) {
      cc += 'ring-2 ring-amber-500 bg-amber-100 border-amber-500 shadow-md';
      fc = 'text-amber-900'; tc = 'text-amber-700'; dc = 'text-amber-800'; ac = 'text-amber-700/70';
    } else if (assigned) {
      cc += 'bg-gray-100 border-gray-300 opacity-70';
      fc = 'text-gray-700'; tc = 'text-gray-500'; dc = 'text-gray-600'; ac = 'text-gray-500';
    } else {
      cc += 'bg-white border-gray-200 hover:bg-gray-100';
      fc = 'text-gray-900'; tc = 'text-gray-500'; dc = 'text-gray-700'; ac = 'text-gray-500';
    }
  }

  return (
    <TouchFeedback onTap={onSelect}>
      <div className={cc} style={{ padding: '12px 16px' }}>
        {selected && <div className="absolute left-0 top-0 bottom-0 w-1.5 bg-amber-400 rounded-l-xl" />}
        <div className="flex items-center justify-between gap-3">
          <span className={`font-mono font-bold text-base tracking-tight ${fc}`}>{flight.FlightNumber}</span>
          <div className={`flex items-center gap-1.5 ${tc}`}>
            <Clock size={12} />
            <span className="text-xs font-mono">{flight.ScheduledDepartureTime}</span>
          </div>
        </div>
        <div className={`text-sm truncate mt-1 font-medium ${dc}`}>
          {flight.DestinationCityName || flight.DestinationAirportCode}
        </div>
        <div className="flex items-center justify-between mt-1.5">
          <span className={`text-[11px] truncate ${ac}`}>{flight.AirlineName}</span>
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
    disabled?: boolean; //dodato
}> = ({ a, type, classType, onRemove, onClassToggle, isDark }) => {
  const classes = ['ECONOMY', 'BUSINESS', 'PREMIUM', 'PRIORITY'] as const;
  return (
    <div className={`flex flex-col gap-2 rounded-xl border p-3 ${
      type === 'desk'
        ? isDark ? 'bg-sky-500/10 border-sky-500/30'     : 'bg-sky-100 border-sky-400'
        : isDark ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-emerald-100 border-emerald-400'
    }`}>
      <div className="flex justify-between items-start">
        <div className="min-w-0 flex-1">
          <div className={`text-xs font-bold tracking-wider mb-1 ${
            type === 'desk'
              ? isDark ? 'text-sky-400'     : 'text-sky-800'
              : isDark ? 'text-emerald-400' : 'text-emerald-800'
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
      <div className="grid grid-cols-4 gap-1">
        {classes.map(cls => {
          const isActive = classType === cls;
          const style    = CLASS_BADGE_STYLES[cls];
          return (
            <TouchFeedback key={cls} onTap={() => onClassToggle(isActive ? null : cls)}>
              <button
                className="w-full rounded-lg py-1.5 text-[10px] font-bold tracking-wide border transition-all active:scale-95"
                style={isActive ? {
                  background: style.bg, color: style.text, borderColor: style.border,
                  boxShadow: `0 0 8px ${style.border}55`,
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
// Komponenta: ConfirmOverlay
// ─────────────────────────────────────────────

const ConfirmOverlay: React.FC<{
  pending: PendingOverride;
  onConfirm: () => void;
  onCancel: () => void;
  isDark: boolean;
}> = ({ pending, onConfirm, onCancel, isDark }) => (
  <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onClick={onCancel}>
    <div className={`rounded-2xl border p-6 max-w-sm w-full shadow-2xl ${
      isDark ? 'bg-slate-900 border-white/20' : 'bg-white border-gray-200'
    }`} onClick={e => e.stopPropagation()}>
      <div className={`font-bold text-lg mb-3 text-center ${isDark ? 'text-white' : 'text-gray-900'}`}>
        Zamijeniti dodjelu?
      </div>
      <div className={`text-sm mb-6 text-center leading-relaxed ${isDark ? 'text-white/70' : 'text-gray-600'}`}>
        {pending.resourceType === 'desk' ? 'Šalter' : 'Gate'} {pending.resourceId} je već dodijeljen letu{' '}
        <span className={`font-mono font-bold ${isDark ? 'text-red-400' : 'text-red-700'}`}>{pending.existingFlight}</span>.
        <br />Zamijeniti sa{' '}
        <span className={`font-mono font-bold ${isDark ? 'text-amber-400' : 'text-amber-700'}`}>{pending.flight.FlightNumber}</span>?
      </div>
      <div className="flex gap-3">
        <button onClick={onCancel} className={`flex-1 py-3 rounded-xl text-sm font-medium border transition-colors ${
          isDark ? 'bg-white/10 border-white/20 text-white/80' : 'bg-gray-100 border-gray-200 text-gray-600'
        }`}>Odustani</button>
        <button onClick={onConfirm} className="flex-1 py-3 rounded-xl text-sm font-bold bg-red-500 text-white active:bg-red-600 transition-colors shadow-lg">
          Zamijeni
        </button>
      </div>
    </div>
  </div>
);

// ─────────────────────────────────────────────
// Komponenta: StatsModal
// ─────────────────────────────────────────────

const StatsModal: React.FC<{
  stats: DailyStats;
  loading: boolean;
  onClose: () => void;
  isDark: boolean;
  currentCheckin: Assignment[];
  currentGates: Assignment[];
}> = ({ stats, loading, onClose, isDark, currentCheckin, currentGates }) => {
  const [tab, setTab] = useState<'desks' | 'gates'>('desks');

  const totalMin = (sessions: StatSession[]) =>
    sessions.reduce((s, x) => s + x.minutes, 0);

  const currentActive = tab === 'desks' ? currentCheckin : currentGates;
  const data          = tab === 'desks' ? stats.desks    : stats.gates;

  const activeOnlyIds = currentActive
    .filter(a => !data[a.resourceId])
    .map(a => a.resourceId);

  const entries = [
    ...Object.entries(data).sort(([, a], [, b]) => totalMin(b) - totalMin(a)),
    ...activeOnlyIds.map(id => [id, [] as StatSession[]] as [string, StatSession[]]),
  ];

  const grandSessions = entries.reduce((s, [, x]) => s + x.length, 0);
  const grandMinutes  = entries.reduce((s, [, x]) => s + totalMin(x), 0);
  const grandH = Math.floor(grandMinutes / 60);
  const grandM = grandMinutes % 60;

  const today = new Date().toLocaleDateString('sr-Latn-RS', {
    day: '2-digit', month: '2-digit', year: 'numeric',
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-6 bg-black/70 backdrop-blur-sm overflow-y-auto"
      onClick={onClose}
    >
      <div
        className={`rounded-2xl border w-full max-w-2xl shadow-2xl mb-6 ${
          isDark ? 'bg-slate-900 border-white/20' : 'bg-white border-gray-200'
        }`}
        onClick={e => e.stopPropagation()}
      >
        <div className={`flex items-center justify-between p-5 border-b ${isDark ? 'border-white/10' : 'border-gray-100'}`}>
          <div>
            <div className={`font-bold text-lg flex items-center gap-2 ${isDark ? 'text-white' : 'text-gray-900'}`}>
              <BarChart2 size={20} className="text-sky-400" />
              Statistika · {today}
            </div>
            <div className={`text-xs mt-0.5 ${isDark ? 'text-white/40' : 'text-gray-500'}`}>
              Dnevni pregled zauzetosti šaltera i gate-ova
            </div>
          </div>
          <button onClick={onClose} className={`p-2 rounded-lg transition-colors ${
            isDark ? 'text-white/40 hover:text-white hover:bg-white/10' : 'text-gray-400 hover:text-gray-700 hover:bg-gray-100'
          }`}><X size={18} /></button>
        </div>

        {loading ? (
          <div className="py-16 text-center">
            <div className="w-8 h-8 border-2 border-sky-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
            <div className={`text-sm ${isDark ? 'text-white/40' : 'text-gray-500'}`}>Učitavanje...</div>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-3 p-5 pb-3">
              {[
                { label: 'završenih letova', value: String(grandSessions) },
                { label: 'ukupno minuta',    value: `${grandMinutes} min` },
                { label: 'ukupno sati',      value: `${grandH}h ${grandM}m` },
              ].map(({ label, value }) => (
                <div key={label} className={`rounded-xl p-3 text-center ${isDark ? 'bg-white/5' : 'bg-gray-50'}`}>
                  <div className={`text-xl font-black ${isDark ? 'text-white' : 'text-gray-900'}`}>{value}</div>
                  <div className={`text-[11px] mt-0.5 ${isDark ? 'text-white/40' : 'text-gray-500'}`}>{label}</div>
                </div>
              ))}
            </div>

            <div className="flex gap-2 px-5 pb-3">
              {(['desks', 'gates'] as const).map(t => (
                <button key={t} onClick={() => setTab(t)}
                  className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
                    tab === t
                      ? isDark ? 'bg-sky-500/20 text-sky-300 border border-sky-500/40'
                               : 'bg-sky-100 text-sky-800 border border-sky-300'
                      : isDark ? 'text-white/40 hover:text-white/60 border border-transparent'
                               : 'text-gray-500 hover:text-gray-700 border border-transparent'
                  }`}>
                  {t === 'desks' ? '🏷️ Šalteri' : '🚪 Gate-ovi'}
                  {(t === 'desks' ? currentCheckin : currentGates).length > 0 && (
                    <span className="ml-2 inline-flex items-center gap-1 text-[10px] bg-emerald-500/20 text-emerald-400 px-1.5 py-0.5 rounded-full">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse inline-block" />
                      {(t === 'desks' ? currentCheckin : currentGates).length}
                    </span>
                  )}
                </button>
              ))}
            </div>

            <div className="px-5 pb-5 space-y-2 max-h-[55vh] overflow-y-auto">
              {entries.length === 0 ? (
                <div className={`text-center py-12 text-sm ${isDark ? 'text-white/30' : 'text-gray-400'}`}>
                  <BarChart2 size={32} className="mx-auto mb-3 opacity-30" />
                  Nema podataka za danas
                </div>
              ) : entries.map(([id, sessions]) => {
                const tot     = totalMin(sessions);
                const h       = Math.floor(tot / 60);
                const m       = tot % 60;
                const active  = currentActive.find(a => a.resourceId === id);

                return (
                  <div key={id} className={`rounded-xl border p-3 ${
                    isDark ? 'bg-white/5 border-white/10' : 'bg-gray-50 border-gray-200'
                  }`}>
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className={`font-bold text-sm ${isDark ? 'text-white' : 'text-gray-900'}`}>
                          {tab === 'desks' ? 'Šalter' : 'Gate'} {id}
                        </span>
                        {active && (
                          <span className="flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse inline-block" />
                            AKTIVAN
                          </span>
                        )}
                      </div>
                      {sessions.length > 0 && (
                        <div className="flex items-center gap-2">
                          <span className={`text-[11px] px-2 py-0.5 rounded-full ${
                            isDark ? 'bg-white/10 text-white/60' : 'bg-gray-200 text-gray-600'
                          }`}>
                            {sessions.length} {sessions.length === 1 ? 'let' : sessions.length < 5 ? 'leta' : 'letova'}
                          </span>
                          <span className={`text-xs font-mono font-bold ${isDark ? 'text-sky-400' : 'text-sky-700'}`}>
                            {h > 0 ? `${h}h ` : ''}{m}m
                          </span>
                        </div>
                      )}
                    </div>

                    {active && (
                      <div className={`flex items-center gap-2 text-[11px] rounded-lg px-2 py-1.5 mb-2 ${
                        isDark ? 'bg-emerald-500/10 border border-emerald-500/20' : 'bg-emerald-50 border border-emerald-200'
                      }`}>
                        <span className={`font-mono font-bold w-14 flex-shrink-0 ${isDark ? 'text-emerald-300' : 'text-emerald-700'}`}>
                          {active.flightNumber}
                        </span>
                        <span className={`truncate flex-1 ${isDark ? 'text-white/60' : 'text-gray-600'}`}>
                          {active.destinationCity}
                        </span>
                        <span className={`flex-shrink-0 ${isDark ? 'text-white/40' : 'text-gray-400'}`}>
                          od {active.assignedAt}
                        </span>
                      </div>
                    )}

                    {sessions.length > 0 && (
                      <>
                        <div className={`h-1 rounded-full mb-2 overflow-hidden ${isDark ? 'bg-white/10' : 'bg-gray-200'}`}>
                          <div
                            className={`h-full rounded-full ${tab === 'desks' ? 'bg-sky-500' : 'bg-emerald-500'}`}
                            style={{ width: `${Math.min(100, grandMinutes > 0 ? Math.round((tot / grandMinutes) * 100 * entries.length) : 0)}%` }}
                          />
                        </div>
                        <div className="space-y-0.5">
                          {sessions.map((s, i) => (
                            <div key={i} className={`flex items-center gap-2 text-[11px] ${isDark ? 'text-white/50' : 'text-gray-600'}`}>
                              <span className="font-mono font-semibold w-14 flex-shrink-0">{s.flight}</span>
                              <span className="truncate flex-1">{s.destination}</span>
                              <span className="font-mono flex-shrink-0">{s.from}–{s.to}</span>
                              <span className={`w-9 text-right flex-shrink-0 ${isDark ? 'text-white/30' : 'text-gray-400'}`}>
                                {s.minutes}m
                              </span>
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────
// GLAVNA KOMPONENTA
// ─────────────────────────────────────────────

export default function AssignPanel() {
  const router = useRouter();

  const [activeTab,              setActiveTab]              = useState<TabType>('checkin');
  const [flights,                setFlights]                = useState<Flight[]>([]);
  const [loadingFlights,         setLoadingFlights]         = useState(true);
  const [lastUpdate,             setLastUpdate]             = useState('');
  const [checkinAssignments,     setCheckinAssignments]     = useState<Assignment[]>([]);
  const [gateAssignments,        setGateAssignments]        = useState<Assignment[]>([]);
  const [refreshing,             setRefreshing]             = useState(false);
  const [selectedFlightForTouch, setSelectedFlightForTouch] = useState<Flight | null>(null);
  const [tickSec,                setTickSec]                = useState(REFRESH_INTERVAL_MS / 1000);
  const [pendingOverride,        setPendingOverride]        = useState<PendingOverride | null>(null);
  const [isDark,                 setIsDark]                 = useState(true);
  const [showStats,              setShowStats]              = useState(false);
  const [dailyStats,             setDailyStats]             = useState<DailyStats>({ desks: {}, gates: {} });
  const [loadingStats,           setLoadingStats]           = useState(false);

  // Dodaj state za praćenje "u toku brisanja" — sprečava duplirane klikove
const [removingResources, setRemovingResources] = useState<Set<string>>(new Set());

  const flightsRef            = useRef<Flight[]>([]);
  const selectedFlightRef     = useRef<Flight | null>(null);
  const checkinAssignmentsRef = useRef<Assignment[]>([]);
  const gateAssignmentsRef    = useRef<Assignment[]>([]);
  const touchTimeoutRef       = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { flightsRef.current = flights; }, [flights]);
  useEffect(() => { checkinAssignmentsRef.current = checkinAssignments; }, [checkinAssignments]);
  useEffect(() => { gateAssignmentsRef.current = gateAssignments; }, [gateAssignments]);

  const setSelectedFlight = useCallback((flight: Flight | null) => {
    selectedFlightRef.current = flight;
    setSelectedFlightForTouch(flight);
  }, []);

  // Tema
  useEffect(() => {
    const stored      = localStorage.getItem('theme');
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

  // Učitavanje statistike
  const openStats = useCallback(async () => {
    setShowStats(true);
    setLoadingStats(true);
    const data = await fetchDailyStats();
    setDailyStats(data);
    setLoadingStats(false);
  }, []);

  // API
// Dodaj opcioni parametar za prisilno osvježavanje
const fetchFlightsData = useCallback(async (force = false): Promise<Flight[]> => {
  const now = Date.now();
  if (!force && cachedFlights && now < cachedFlightsExpiry) {
    return cachedFlights;
  }
  
  const res = await fetch('/api/flights');
  const data = await res.json();
  const sorted = processFlights(data.departures || []);
  
  
  cachedFlights = sorted;
  cachedFlightsExpiry = now + FLIGHTS_CACHE_MS;
  return sorted;
}, []);

  const fetchFlights = useCallback(async () => {
    try {
      const sorted = await fetchFlightsData();
      setFlights(sorted);
      setLastUpdate(new Date().toLocaleTimeString('sr-Latn-RS'));
    } catch (err) { console.error('Error fetching flights:', err); }
    finally { setLoadingFlights(false); }
  }, [fetchFlightsData]);

  const fetchCheckinAssignments = useCallback(async (currentFlights: Flight[]) => {
    try {
      const res = await fetch(`${API_PREFIX}/desk-status-override`);
      if (!res.ok) return {};
      const data = await res.json();
      const list: Assignment[] = [];
      for (const [deskNumber, value] of Object.entries(data)) {
        const parsed = typeof value === 'string' ? JSON.parse(value) : value as Record<string, unknown>;
        if (parsed.flightNumber && parsed.status === 'open') {
          const flight = currentFlights.find(f => f.FlightNumber === parsed.flightNumber);
          list.push({
            resourceId:      deskNumber,
            flightNumber:    parsed.flightNumber as string,
            airlineName:     flight?.AirlineName || '',
            destinationCity: flight?.DestinationCityName || '',
            scheduledTime:   flight?.ScheduledDepartureTime || '',
            assignedAt:      parsed.setAt ? new Date(parsed.setAt as string).toLocaleTimeString() : 'unknown',
            classType:       (parsed.classType as ClassType) ?? null,
          });
        }
      }
      setCheckinAssignments(list);
      return data;
    } catch (err) { console.error(err); return {}; }
  }, []);

  const fetchGateAssignments = useCallback(async (currentFlights: Flight[]) => {
    try {
      const res = await fetch(`${API_PREFIX}/gate-status-override`);
      if (!res.ok) return {};
      const data = await res.json();
      const list: Assignment[] = [];
      for (const [gateNumber, value] of Object.entries(data)) {
        const parsed = typeof value === 'string' ? JSON.parse(value) : value as Record<string, unknown>;
        if (parsed.flightNumber && parsed.status === 'open') {
          const flight = currentFlights.find(f => f.FlightNumber === parsed.flightNumber);
          list.push({
            resourceId:      gateNumber,
            flightNumber:    parsed.flightNumber as string,
            airlineName:     flight?.AirlineName || '',
            destinationCity: flight?.DestinationCityName || '',
            scheduledTime:   flight?.ScheduledDepartureTime || '',
            assignedAt:      parsed.setAt ? new Date(parsed.setAt as string).toLocaleTimeString() : 'unknown',
            classType:       (parsed.classType as ClassType) ?? null,
          });
        }
      }
      setGateAssignments(list);
      return data;
    } catch (err) { console.error(err); return {}; }
  }, []);

  const refreshAll = useCallback(async (currentFlights: Flight[]) => {
    const [deskData, gateData] = await Promise.all([
      fetchCheckinAssignments(currentFlights),
      fetchGateAssignments(currentFlights),
    ]);
    return { deskData, gateData };
  }, [fetchCheckinAssignments, fetchGateAssignments]);

  // checkForChanges funkcija - proverava da li ima promena pre refresha
  const checkForChanges = useCallback(async () => {
  if (isCheckingChanges) return;
  isCheckingChanges = true;
  
  try {
    const res = await fetch('/api/flights/status');
    const meta = await res.json();
    
    if (meta.hash !== lastHash) {
      lastHash = meta.hash;
      isDirty = true;
    }
    
    if (isDirty) {
      const sorted = await fetchFlightsData(true); // ← force=true, zaobiđi lokalni keš
      setFlights(sorted);
      await refreshAll(sorted);
      setLastUpdate(new Date().toLocaleTimeString('sr-Latn-RS'));
      isDirty = false;
    }
  } catch (err) {
    console.error('Check for changes error:', err);
  } finally {
    isCheckingChanges = false;
  }
}, [fetchFlightsData, refreshAll]);
  // Inicijalno učitavanje - JEDAN poziv
  useEffect(() => {
    const loadAllData = async () => {
      try {
        const sorted = await fetchFlightsData();
        setFlights(sorted);
        await refreshAll(sorted);
        setLastUpdate(new Date().toLocaleTimeString('sr-Latn-RS'));
        setLoadingFlights(false);
      } catch (err) {
        console.error('Error loading data:', err);
        setLoadingFlights(false);
      }
    };
    
    loadAllData();
  }, [fetchFlightsData, refreshAll]);

  // Auto-refresh timer sa dirty flag-om
  useEffect(() => {
    const ticker = setInterval(
      () => setTickSec(prev => (prev <= 1 ? REFRESH_INTERVAL_MS / 1000 : prev - 1)),
      1000,
    );

    const interval = setInterval(async () => {
      setTickSec(REFRESH_INTERVAL_MS / 1000);
      await checkForChanges();
    }, REFRESH_INTERVAL_MS);

    return () => { 
      clearInterval(ticker); 
      clearInterval(interval); 
    };
  }, [checkForChanges]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    setTickSec(REFRESH_INTERVAL_MS / 1000);
    try {
      const sorted = await fetchFlightsData();
      setFlights(sorted);
      setLastUpdate(new Date().toLocaleTimeString('sr-Latn-RS'));
      await refreshAll(sorted);
      
      // Resetuj dirty flag i hash
      isDirty = false;
      const statusRes = await fetch('/api/flights/status');
      const meta = await statusRes.json();
      lastHash = meta.hash || '';
    } catch (err) { console.error(err); }
    finally { setRefreshing(false); }
  }, [fetchFlightsData, refreshAll]);

const assignFlightToResource = useCallback(async (
  flight: Flight, resourceId: string, resourceType: 'desk' | 'gate',
): Promise<boolean> => {
  const endpoint = `${API_PREFIX}/${resourceType === 'desk' ? 'desk-status-override' : 'gate-status-override'}`;
  const payload  = resourceType === 'desk'
    ? { deskNumber: resourceId, action: 'open', flightNumber: flight.FlightNumber }
    : { gateNumber: resourceId, action: 'open', flightNumber: flight.FlightNumber };

  // ── Odredi auto-klasu ODMAH (lokalno, bez čekanja servera) ──
  let autoClass: ClassType = null;
  if (resourceType === 'desk' && isBAFlight(flight.FlightNumber)) {
    const existingBADesks = checkinAssignmentsRef.current.filter(
      a => isBAFlight(a.flightNumber) && a.resourceId !== resourceId,
    );
    autoClass = existingBADesks.length < 2 ? 'BUSINESS' : 'ECONOMY';
  }

  // ── OPTIMISTIČKO DODAVANJE — UI se mijenja ODMAH ──
  const optimisticAssignment: Assignment = {
    resourceId,
    flightNumber: flight.FlightNumber,
    airlineName: flight.AirlineName || '',
    destinationCity: flight.DestinationCityName || '',
    scheduledTime: flight.ScheduledDepartureTime || '',
    assignedAt: new Date().toLocaleTimeString(),
    classType: autoClass,
  };

  const setAssignments = resourceType === 'desk' ? setCheckinAssignments : setGateAssignments;
  setAssignments(list => [...list.filter(a => a.resourceId !== resourceId), optimisticAssignment]);

  try {
    // Glavni assign i trackStart idu paralelno — nezavisni su
    const assignPromise = fetch(endpoint, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const trackPromise = trackStart(resourceType, resourceId, flight);

    const [res] = await Promise.all([assignPromise, trackPromise]);
    if (!res.ok) throw new Error('HTTP ' + res.status);

    // setClass MORA ići poslije assign-a (server treba postojeći zapis) —
    // ali radimo je u pozadini, ne čekamo je za UI (već je optimistički prikazano)
    if (autoClass) {
      fetch(`${API_PREFIX}/desk-status-override`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deskNumber: resourceId, action: 'setClass', classType: autoClass }),
      }).catch(err => console.error('Auto BA class error:', err));
    }

    isDirty = true; // signal za sinhronizaciju sa drugim uređajima na sljedećem checkForChanges ciklusu
    return true;
  } catch (err) {
    console.error('Greška pri dodjeli:', err);
    // Rollback — ukloni optimistički dodatu stavku
    setAssignments(list => list.filter(a => a.resourceId !== resourceId));
    return false;
  }
}, []);

  const handleResourceTouchAssign = useCallback(async (
    resourceId: string, resourceType: 'desk' | 'gate',
  ) => {
    const flight = selectedFlightRef.current;
    if (!flight) return;
    const assignments = resourceType === 'desk' ? checkinAssignmentsRef.current : gateAssignmentsRef.current;
    const existing    = assignments.find(a => a.resourceId === resourceId);
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

  // trackEnd i assignFlightToResource mogu ići paralelno —
  // trackEnd zatvara staru sesiju u statistici, ne blokira novu dodjelu
  const trackEndPromise = trackEnd(p.resourceType, p.resourceId);
  const assignPromise = assignFlightToResource(p.flight, p.resourceId, p.resourceType);

  await Promise.all([trackEndPromise, assignPromise]);

  setSelectedFlight(null);
  if (touchTimeoutRef.current) clearTimeout(touchTimeoutRef.current);
}, [pendingOverride, assignFlightToResource, setSelectedFlight]);

  const handleFlightTouchSelect = useCallback((flight: Flight) => {
    setSelectedFlight(flight);
    if (touchTimeoutRef.current) clearTimeout(touchTimeoutRef.current);
    touchTimeoutRef.current = setTimeout(() => setSelectedFlight(null), TOUCH_TIMEOUT_MS);
  }, [setSelectedFlight]);

const handleRemoveCheckin = useCallback(async (deskNumber: string) => {
  // Blokiraj duplirani klik dok je operacija u toku
  if (removingResources.has(`desk:${deskNumber}`)) return;
  setRemovingResources(prev => new Set(prev).add(`desk:${deskNumber}`));

  // ── OPTIMISTIČKO UKLANJANJE — UI se mijenja ODMAH ──
  const removed = checkinAssignmentsRef.current.find(a => a.resourceId === deskNumber);
  setCheckinAssignments(list => list.filter(a => a.resourceId !== deskNumber));

  try {
    // trackEnd i clear idu paralelno, ne sekvencijalno
    await Promise.all([
      trackEnd('desk', deskNumber),
      fetch(`${API_PREFIX}/desk-status-override`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deskNumber, action: 'clear' }),
      }),
    ]);
    isDirty = true;
    // Nema potrebe za dodatnim fetchCheckinAssignments — već smo lokalno uklonili
  } catch (err) {
    console.error('Greška pri brisanju šaltera', deskNumber, err);
    // Rollback — vrati stavku nazad ako je poziv pao
    if (removed) {
      setCheckinAssignments(list =>
        list.some(a => a.resourceId === deskNumber) ? list : [...list, removed]
      );
    }
  } finally {
    setRemovingResources(prev => {
      const next = new Set(prev);
      next.delete(`desk:${deskNumber}`);
      return next;
    });
  }
}, [removingResources]);

const handleRemoveGate = useCallback(async (gateNumber: string) => {
  if (removingResources.has(`gate:${gateNumber}`)) return;
  setRemovingResources(prev => new Set(prev).add(`gate:${gateNumber}`));

  const removed = gateAssignmentsRef.current.find(a => a.resourceId === gateNumber);
  setGateAssignments(list => list.filter(a => a.resourceId !== gateNumber));

  try {
    await Promise.all([
      trackEnd('gate', gateNumber),
      fetch(`${API_PREFIX}/gate-status-override`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gateNumber, action: 'clear' }),
      }),
    ]);
    isDirty = true;
  } catch (err) {
    console.error('Greška pri brisanju gate-a', gateNumber, err);
    if (removed) {
      setGateAssignments(list =>
        list.some(a => a.resourceId === gateNumber) ? list : [...list, removed]
      );
    }
  } finally {
    setRemovingResources(prev => {
      const next = new Set(prev);
      next.delete(`gate:${gateNumber}`);
      return next;
    });
  }
}, [removingResources]);

  const handleClassToggle = useCallback(async (
    resourceId: string, resourceType: 'desk' | 'gate', next: ClassType,
  ) => {
    const setAssignments = resourceType === 'desk' ? setCheckinAssignments : setGateAssignments;
    const prevAssignments = resourceType === 'desk' ? checkinAssignmentsRef.current : gateAssignmentsRef.current;
    const prev = prevAssignments.find(a => a.resourceId === resourceId)?.classType ?? null;

    setAssignments(list => list.map(a =>
      a.resourceId === resourceId ? { ...a, classType: next } : a
    ));

    try {
      const endpoint = resourceType === 'desk'
        ? `${API_PREFIX}/desk-status-override` : `${API_PREFIX}/gate-status-override`;
      const body = resourceType === 'desk'
        ? { deskNumber: resourceId, action: 'setClass', classType: next }
        : { gateNumber: resourceId, action: 'setClass', classType: next };

      const res = await fetch(endpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error('setClass failed');
      
      isDirty = true;
    } catch (err) {
      console.error('Class toggle error:', err);
      setAssignments(list => list.map(a =>
        a.resourceId === resourceId ? { ...a, classType: prev } : a
      ));
    }
  }, []);

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
          key={id} id={id} type={type}
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
        <ConfirmOverlay pending={pendingOverride} onConfirm={handleConfirmOverride}
          onCancel={() => setPendingOverride(null)} isDark={isDark} />
      )}
      {showStats && (
        <StatsModal
          stats={dailyStats}
          loading={loadingStats}
          onClose={() => setShowStats(false)}
          isDark={isDark}
          currentCheckin={checkinAssignments}
          currentGates={gateAssignments}
        />
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
            <button onClick={handleRefresh} disabled={refreshing}
              className={`p-2.5 rounded-xl border transition-all active:scale-95 ${isDark ? 'bg-white/5 hover:bg-white/10 border-white/10' : 'bg-gray-100 hover:bg-gray-200 border-gray-300'}`}>
              <RefreshCw size={16} className={`${isDark ? 'text-white/60' : 'text-gray-600'} ${refreshing ? 'animate-spin' : ''}`} />
            </button>

            <button onClick={openStats} title="Dnevna statistika"
              className={`p-2.5 rounded-xl border transition-all active:scale-95 ${isDark ? 'bg-white/5 hover:bg-white/10 border-white/10' : 'bg-gray-100 hover:bg-gray-200 border-gray-300'}`}>
              <BarChart2 size={16} className={isDark ? 'text-sky-400' : 'text-sky-600'} />
            </button>

            <button onClick={() => router.push('/admin')}
              className={`p-2.5 rounded-xl border transition-all active:scale-95 ${isDark ? 'bg-white/5 hover:bg-white/10 border-white/10' : 'bg-gray-100 hover:bg-gray-200 border-gray-300'}`}>
              <Home size={16} className={isDark ? 'text-white/60' : 'text-gray-600'} />
            </button>

            <button onClick={toggleTheme}
              className={`p-2.5 rounded-xl border transition-all active:scale-95 ${isDark ? 'bg-white/5 hover:bg-white/10 border-white/10' : 'bg-gray-100 hover:bg-gray-200 border-gray-300'}`}>
              {isDark ? <Sun size={16} className="text-yellow-400" /> : <Moon size={16} className="text-slate-700" />}
            </button>

            <button onClick={handleLogout}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-red-500/15 hover:bg-red-500/25 border border-red-500/25 text-red-400 text-xs font-medium transition-all active:scale-95">
              <LogOut size={14} /> Odjava
            </button>
          </div>
        </div>

        {/* Tabovi */}
        <div className="flex gap-3 mb-6">
          {([
            { id: 'checkin' as TabType, label: '🏷️ Check-in', icon: CheckSquare, count: checkinAssignments.length },
            { id: 'gate'    as TabType, label: '🚪 Gate-ovi', icon: GitBranch,   count: gateAssignments.length    },
          ] as const).map(tab => {
            const isActive = activeTab === tab.id;
            return (
              <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-5 py-3 rounded-xl border text-sm font-semibold transition-all active:scale-95 ${
                  isActive
                    ? isDark ? 'bg-sky-500/20 border-sky-500/50 text-sky-300 shadow-lg'
                             : 'bg-sky-200 border-sky-500 text-sky-900 shadow-md'
                    : isDark ? 'bg-white/5 border-white/10 text-white/50 hover:bg-white/10'
                             : 'bg-gray-100 border-gray-300 text-gray-600 hover:bg-gray-200'
                }`}>
                <tab.icon size={16} />
                <span>{tab.label}</span>
                <span className={`text-[11px] px-2 py-0.5 rounded-full font-bold ${
                  isActive
                    ? isDark ? 'bg-white/20 text-white' : 'bg-white/80 text-gray-800'
                    : isDark ? 'bg-white/10 text-white/40' : 'bg-gray-300 text-gray-600'
                }`}>{tab.count}</span>
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
              <button onClick={() => setSelectedFlight(null)}
                className="flex items-center gap-1.5 text-sm text-amber-400/70 hover:text-amber-300 px-3 py-1.5 rounded-lg hover:bg-amber-500/10 transition-colors">
                <X size={14} /> Odustani
              </button>
            </div>
          </div>
        )}

        {/* CHECK-IN TAB */}
        {activeTab === 'checkin' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            <div className={`rounded-xl border p-4 ${isDark ? 'bg-white/5 border-white/10' : 'bg-gray-50 border-gray-200'}`}>
              <div className={`text-xs font-bold tracking-wider uppercase mb-4 ${isDark ? 'text-white/40' : 'text-gray-500'}`}>
                ✈️ Letovi ({flights.length})
              </div>
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
                <div className={`text-xs font-bold tracking-wider uppercase mb-3 ${isDark ? 'text-white/40' : 'text-gray-500'}`}>
                  ✅ Aktivne dodjele ({checkinAssignments.length})
                </div>
                {checkinAssignments.length === 0
                  ? <div className={`text-center py-8 text-sm ${isDark ? 'text-white/30' : 'text-gray-400'}`}>Nema dodjela</div>
                  : <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
       {checkinAssignments.map(a => (
  <AssignmentCard key={a.resourceId} a={a} type="desk"
    classType={a.classType}
    onRemove={() => handleRemoveCheckin(a.resourceId)}
    onClassToggle={next => handleClassToggle(a.resourceId, 'desk', next)}
    isDark={isDark}
    disabled={removingResources.has(`desk:${a.resourceId}`)}  // ← novo
  />
))}
                    </div>
                }
              </div>
            </div>
          </div>
        )}

        {/* GATE TAB */}
        {activeTab === 'gate' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            <div className={`rounded-xl border p-4 ${isDark ? 'bg-white/5 border-white/10' : 'bg-gray-50 border-gray-200'}`}>
              <div className={`text-xs font-bold tracking-wider uppercase mb-4 ${isDark ? 'text-white/40' : 'text-gray-500'}`}>
                ✈️ Letovi ({flights.length})
              </div>
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
                <div className={`text-xs font-bold tracking-wider uppercase mb-3 ${isDark ? 'text-white/40' : 'text-gray-500'}`}>
                  ✅ Aktivne dodjele ({gateAssignments.length})
                </div>
                {gateAssignments.length === 0
                  ? <div className={`text-center py-8 text-sm ${isDark ? 'text-white/30' : 'text-gray-400'}`}>Nema dodjela</div>
                  : <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {gateAssignments.map(a => (
                        <AssignmentCard key={a.resourceId} a={a} type="gate"
                          classType={a.classType}
                          onRemove={() => handleRemoveGate(a.resourceId)}
                          onClassToggle={next => handleClassToggle(a.resourceId, 'gate', next)}
                          isDark={isDark} />
                      ))}
                    </div>
                }
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
        .scrollbar-thin::-webkit-scrollbar-thumb {
          background: ${isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.2)'};
          border-radius: 4px;
        }
        @keyframes pulse-subtle { 0%, 100% { opacity: 0.8; } 50% { opacity: 1; } }
        .animate-pulse-subtle { animation: pulse-subtle 1.2s ease-in-out infinite; }
        .active\\:scale-95:active { transform: scale(0.95); }
        .active\\:scale-98:active { transform: scale(0.98); }
      `}</style>
    </div>
  );
}