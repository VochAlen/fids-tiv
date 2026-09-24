/* eslint-disable react-hooks/set-state-in-effect */
'use client';

import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import {
  RefreshCw, Trash2, LogOut, Home, CheckSquare, GitBranch,
  X, Plane, Clock, Sun, Moon, Fingerprint, BarChart2,
  AlertTriangle, Search,
} from 'lucide-react';
import type { Flight } from '@/types/flight';

import { useRealtimeFlightData } from '@/hooks/useRealtimeFlightData'; // ← NOVO (Faza 1)
import { useRealtimeAssignments, type AssignmentEntry } from '@/hooks/useRealtimeAssignments';
import { logoutAndRedirect } from '@/lib/admin-logout';
import { getPodgoricaMinutesOfDay } from '@/lib/night-hours';
// ─────────────────────────────────────────────
// Konstante
// ─────────────────────────────────────────────

const API_PREFIX = '/api/test';

const DESKS = [
  ...Array.from({ length: 12 }, (_, i) => String(i + 1)),
  '21', '22', '23', '24', '25', '26',
];
const GATES = ['2','3','4','5','6','21','22','23','24','25','26','27','28','29','30','31'];


// FIX (KRITIČNO — pravi uzrok prijavljenog "neke letove otvara, neke
// ne"): 8 sekundi je prekratko za normalan tempo rada (skrolovanje do
// ciljanog gate-a, kratko razmišljanje) — selekcija leta se TIHO
// poništavala prije nego što bi osoblje stiglo da dodirne cilj, bez
// ikakve poruke da se to desilo, pa je djelovalo kao da tap na gate
// "ne radi" za taj konkretan let. Produženo na 25s — i dalje razumna
// sigurnosna mjera (spriječava da stara, zaboravljena selekcija
// slučajno "upadne" u pogrešan gate mnogo kasnije), ali dovoljno
// velikodušno da ne smeta normalnoj upotrebi. Vidi i vizuelnu poruku
// dodatu u handleFlightTouchSelect ispod — sad se JASNO vidi kad
// selekcija istekne, umjesto tihog, zbunjujućeg "ništa se ne desi".
const TOUCH_TIMEOUT_MS    = 25_000;
const TAP_MOVE_THRESHOLD  = 10;
type ClassType = 'ECONOMY' | 'BUSINESS' | 'PREMIUM' | 'PRIORITY' | 'EASYJET_PLUS' | null;

const CLASS_BADGE_STYLES: Record<string, { bg: string; text: string; border: string }> = {
  ECONOMY:      { bg: 'rgba(37,99,235,0.15)',  text: '#93c5fd', border: '#3b82f6' },
  BUSINESS:     { bg: 'rgba(194,65,12,0.20)',  text: '#fdba74', border: '#f97316' },
  PREMIUM:      { bg: 'rgba(109,40,217,0.20)', text: '#d8b4fe', border: '#a855f7' },
  PRIORITY:     { bg: 'rgba(22,101,52,0.20)',  text: '#86efac', border: '#22c55e' },
  EASYJET_PLUS: { bg: 'rgba(234,88,12,0.20)',  text: '#fdba74', border: '#f97316' },
};

const CLASS_EMOJI: Record<string, string> = {
  ECONOMY: '💺', BUSINESS: '💼', PREMIUM: '👑', PRIORITY: '⭐', EASYJET_PLUS: '🟠',
};

const CLASS_LABELS: Record<string, string> = {
  EASYJET_PLUS: 'PLUS',
};

const isBAFlight = (fn: string) => fn.toUpperCase().startsWith('BA');
const EASYJET_PREFIXES = ['U2', 'EZY'];

const isEasyJetFlight = (flightNumber: string, airlineName?: string): boolean => {
  const name = (airlineName || '').toLowerCase().replace(/\s+/g, '');
  if (name.includes('easyjet')) return true;
  const fn = flightNumber.toUpperCase();
  return EASYJET_PREFIXES.some(prefix => fn.startsWith(prefix));
};

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

// NOVO (po zahtjevu — značka "hitno"): let je "hitan" ako do
// planiranog polaska ostaje manje od 60 min I JOŠ NEMA dodjelu —
// vizuelni prioritet, osoblje ne mora računati u glavi. Koristi
// getPodgoricaMinutesOfDay (isti, već dokazano ispravan obrazac kao
// dinamički noćni režim ranije ove sesije) — čisto brojevno poređenje
// po lokalnom vremenu, imuno na UTC-vs-lokalno razliku servera.
const URGENT_THRESHOLD_MIN = 60;

function isUrgentFlight(flight: Flight, assigned: boolean): boolean {
  if (assigned) return false;
  const timeStr = flight.ScheduledDepartureTime;
  if (!timeStr) return false;
  const [h, m] = timeStr.split(':').map(Number);
  if (isNaN(h) || isNaN(m)) return false;
  const flightMin = h * 60 + m;
  const nowMin = getPodgoricaMinutesOfDay();
  let diff = flightMin - nowMin;
  if (diff < -720) diff += 1440; // let je "sjutra" po satu, npr. 00:15 dok je sad 23:50
  return diff >= 0 && diff < URGENT_THRESHOLD_MIN;
}

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

const parseAssignedAt = (setAt: unknown): string => {
  if (!setAt) return 'unknown';
  const n = Number(setAt);
  const d = new Date(!isNaN(n) && n > 0 ? n : (setAt as string));
  return isNaN(d.getTime()) ? 'unknown' : d.toLocaleTimeString();
};

function buildAssignmentList(
  entries: Record<string, AssignmentEntry>,
  currentFlights: Flight[]
): Assignment[] {
  const list: Assignment[] = [];
  for (const [resourceId, entry] of Object.entries(entries)) {
    if (entry?.flightNumber && entry.status === 'open') {
      const flight = currentFlights.find(f => f.FlightNumber === entry.flightNumber);
      list.push({
        resourceId,
        flightNumber: entry.flightNumber,
        airlineName: flight?.AirlineName || '',
        destinationCity: flight?.DestinationCityName || '',
        scheduledTime: flight?.ScheduledDepartureTime || '',
        assignedAt: parseAssignedAt(entry.setAt),
        classType: (entry.classType as ClassType) ?? null,
      });
    }
  }
  return list;
}
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
  // FIX (KRITIČNO — pravi uzrok prijavljenog "dodijeli se i na 26 i na
  // 27" / "21,22 i 26,27"): onTouchEnd ISPOD već zove preventDefault()
  // i onTap() za svaki pravi dodir. ALI je poseban onClick={onTap} bio
  // DODATNO vezan na isti element — na touch kiosk ekranima browser
  // često generiše ODLOŽEN, SINTETIČKI "click" nakon touchend-a. Ako
  // se između njih desi re-render (npr. ćelija gate-a mijenja izgled
  // jer postaje "zauzeta"), taj odloženi klik zna pogoditi POMJERENU
  // ili SUSJEDNU ćeliju u mreži (umjesto originalno dodirnute) — dva
  // poziva onTap() za DVA RAZLIČITA gate-a od jednog fizičkog dodira,
  // upravo obrazac koji je prijavljen (26→27, 21→22, uvijek susjedni
  // brojevi u GATES nizu/mreži). Ref ispod pamti KADA je pravi dodir
  // završen; onClick provjerava da nije prošlo manje od 500ms otkad
  // — ako jeste, to je gotovo sigurno duh-klik, ignoriše se. Mišu
  // (desktop admin bez ekrana na dodir) ovo ne smeta — tamo touchend
  // nikad ne okine, pa onClick uvijek prolazi normalno.
  const lastTouchEndAtRef = useRef(0);

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
    lastTouchEndAtRef.current = Date.now();
    setRipple(true);
    onTap();
    setTimeout(() => setRipple(false), 150);
  };

  const handleClick = () => {
    if (disabled) return;
    // Duh-klik zaštita — vidi komentar uz lastTouchEndAtRef iznad.
    if (Date.now() - lastTouchEndAtRef.current < 500) return;
    onTap();
  };

  return (
    <div
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onClick={handleClick}
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
  dimmed?: boolean;
}> = ({ id, occupied, type, flightReady, onAssign, isDark, dimmed }) => {
  let variantClasses = '';
  let textColor      = '';
  let subTextColor   = '';

  const base = 'relative rounded-2xl border text-center cursor-pointer transition-all duration-200 touch-manipulation select-none min-h-[72px] flex flex-col items-center justify-center';

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
      variantClasses = 'bg-red-50 border-red-300 shadow-sm';
      textColor = 'text-red-700'; subTextColor = 'text-red-500';
    } else if (flightReady) {
      variantClasses = type === 'desk'
        ? 'bg-sky-500 border-sky-500 shadow-lg shadow-sky-500/30' : 'bg-emerald-500 border-emerald-500 shadow-lg shadow-emerald-500/30';
      textColor = 'text-white';
      subTextColor = 'text-white/80';
    } else {
      variantClasses = type === 'desk'
        ? 'bg-sky-50 border-sky-200 shadow-sm' : 'bg-emerald-50 border-emerald-200 shadow-sm';
      textColor = type === 'desk' ? 'text-sky-700' : 'text-emerald-700';
      subTextColor = 'text-gray-400';
    }
  }

  return (
    <TouchFeedback onTap={onAssign} disabled={!!occupied}>
      <div
        className={`${base} ${variantClasses} ${dimmed ? 'opacity-20 saturate-50' : ''}`}
        style={{ padding: '12px 4px', transition: 'opacity 150ms ease, filter 150ms ease' }}
      >
        {flightReady && !occupied && (
          <div className={`absolute inset-0 rounded-2xl opacity-40 animate-ping ${
            type === 'desk' ? 'bg-sky-400' : 'bg-emerald-400'
          }`} style={{ animationDuration: '1.5s' }} />
        )}
        <div className={`relative text-xl font-black leading-none ${textColor}`}>{id}</div>
        <div className={`relative text-xs mt-1.5 font-mono truncate max-w-full px-1 ${subTextColor}`}>
          {occupied ? occupied.flightNumber : flightReady ? '📱 TAPNI' : '⚫'}
        </div>
        {occupied && (
          <div className={`absolute -top-1 -right-1 w-3 h-3 rounded-full bg-red-500 ring-2 ${isDark ? 'ring-slate-900' : 'ring-white'}`} />
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
  urgent: boolean;
}> = ({ flight, assigned, selected, onSelect, isDark, urgent }) => {
  let cc = 'cursor-pointer rounded-2xl border transition-all duration-150 select-none relative overflow-hidden min-h-[85px] ';
  let fc = '', tc = '', dc = '', ac = '';

  if (isDark) {
    if (selected) {
      cc += 'ring-2 ring-amber-400 bg-amber-500/20 border-amber-400/70 shadow-lg shadow-amber-500/30';
      fc = 'text-amber-200'; tc = 'text-amber-400/80'; dc = 'text-amber-300/90'; ac = 'text-amber-400/60';
    } else if (urgent) {
      // NOVO (po zahtjevu — značka "hitno"): distinktna crvena obrada,
      // vizuelno RAZLIČITA od "odabran" (amber) da se dva stanja nikad
      // ne pomiješaju na brz pogled.
      cc += 'ring-2 ring-red-500/60 bg-red-500/10 border-red-500/40';
      fc = 'text-white'; tc = 'text-red-300'; dc = 'text-white/70'; ac = 'text-white/35';
    } else if (assigned) {
      cc += 'bg-white/5 border-white/15 opacity-60';
      fc = 'text-white/70'; tc = 'text-white/40'; dc = 'text-white/60'; ac = 'text-white/30';
    } else {
      cc += 'bg-white/8 border-white/20 hover:bg-white/15';
      fc = 'text-white'; tc = 'text-white/40'; dc = 'text-white/70'; ac = 'text-white/35';
    }
  } else {
    if (selected) {
      cc += 'ring-2 ring-amber-500 bg-amber-50 border-amber-400 shadow-md';
      fc = 'text-amber-900'; tc = 'text-amber-700'; dc = 'text-amber-800'; ac = 'text-amber-700/70';
    } else if (urgent) {
      cc += 'ring-2 ring-red-400 bg-red-50 border-red-300 shadow-sm';
      fc = 'text-red-900'; tc = 'text-red-700'; dc = 'text-red-800'; ac = 'text-red-700/70';
    } else if (assigned) {
      cc += 'bg-gray-50 border-gray-200 opacity-70';
      fc = 'text-gray-700'; tc = 'text-gray-500'; dc = 'text-gray-600'; ac = 'text-gray-500';
    } else {
      cc += 'bg-white border-gray-200 shadow-sm hover:shadow-md hover:border-gray-300';
      fc = 'text-gray-900'; tc = 'text-gray-500'; dc = 'text-gray-700'; ac = 'text-gray-500';
    }
  }

  return (
    <TouchFeedback onTap={onSelect}>
      <div className={cc} style={{ padding: '12px 16px' }}>
        {selected && <div className="absolute left-0 top-0 bottom-0 w-1.5 bg-amber-400 rounded-l-2xl" />}
        {!selected && urgent && <div className="absolute left-0 top-0 bottom-0 w-1.5 bg-red-500 rounded-l-2xl" />}
        <div className="flex items-center justify-between gap-3">
          <span className={`font-mono font-bold text-base tracking-tight ${fc}`}>{flight.FlightNumber}</span>
          <div className={`flex items-center gap-1.5 ${tc}`}>
            <Clock size={13} />
            <span className="text-xs font-mono font-semibold">{flight.ScheduledDepartureTime}</span>
          </div>
        </div>
        <div className={`text-sm truncate mt-1 font-medium ${dc}`}>
          {flight.DestinationCityName || flight.DestinationAirportCode}
        </div>
        <div className="flex items-center justify-between mt-1.5 gap-2">
          <span className={`text-xs truncate ${ac}`}>{flight.AirlineName}</span>
          {selected ? (
            <span className="text-xs font-bold text-amber-900 bg-amber-300 px-2.5 py-1 rounded-full flex-shrink-0 shadow-sm">
              ✓ ODABRAN
            </span>
          ) : urgent ? (
            <span className="text-xs font-bold text-white bg-red-500 px-2.5 py-1 rounded-full flex-shrink-0 shadow-sm flex items-center gap-1">
              🔴 HITNO
            </span>
          ) : assigned && (
            <span className={`text-xs font-medium flex-shrink-0 ${isDark ? 'text-white/35' : 'text-gray-500'}`}>
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
const classes = isEasyJetFlight(a.flightNumber, a.airlineName)
   ? (['ECONOMY', 'EASYJET_PLUS', 'PREMIUM', 'PRIORITY'] as const)
   : (['ECONOMY', 'BUSINESS', 'PREMIUM', 'PRIORITY'] as const);
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
                className="w-full rounded-lg py-1.5 text-xs font-bold tracking-wide border transition-all active:scale-95"
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
       <div>{CLASS_LABELS[cls] ?? cls}</div>
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
                  <div className={`text-xs mt-0.5 ${isDark ? 'text-white/40' : 'text-gray-500'}`}>{label}</div>
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
                    <span className="ml-2 inline-flex items-center gap-1 text-xs bg-emerald-500/20 text-emerald-400 px-1.5 py-0.5 rounded-full">
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
                          <span className="flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse inline-block" />
                            AKTIVAN
                          </span>
                        )}
                      </div>
                      {sessions.length > 0 && (
                        <div className="flex items-center gap-2">
                          <span className={`text-xs px-2 py-0.5 rounded-full ${
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
                      <div className={`flex items-center gap-2 text-xs rounded-lg px-2 py-1.5 mb-2 ${
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
                            <div key={i} className={`flex items-center gap-2 text-xs ${isDark ? 'text-white/50' : 'text-gray-600'}`}>
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
  // flights UKLONJEN odavde — sad je useMemo niže
  const [loadingFlights,         setLoadingFlights]         = useState(true);
  const [lastUpdate,             setLastUpdate]             = useState('');
  const [checkinAssignments,     setCheckinAssignments]     = useState<Assignment[]>([]);
  const [gateAssignments,        setGateAssignments]        = useState<Assignment[]>([]);
  const [refreshing,             setRefreshing]             = useState(false);
  const [selectedFlightForTouch, setSelectedFlightForTouch] = useState<Flight | null>(null);
  // FIX (po zahtjevu — vidljiva poruka kad selekcija leta istekne,
  // vidi opširan komentar uz TOUCH_TIMEOUT_MS): bez ovoga, istek
  // selekcije je bio potpuno nevidljiv — tap na gate/šalter tad ne bi
  // radio ništa, bez objašnjenja zašto.
  const [selectionExpiredNotice, setSelectionExpiredNotice] = useState(false);
  // NOVO (po zahtjevu — vidljivo obavještenje kad server-side uklanjanje
  // šaltera/gate-a NE uspije, npr. lock conflict, vidi opširan
  // komentar uz handleRemoveCheckin/handleRemoveGate): bez ovoga bi
  // osoblje vidjelo tiho vraćanje stavke nazad (rollback) i
  // pomislilo da je UI "glitch", ne znajući da treba da pokuša ponovo.
  const [removalErrorNotice, setRemovalErrorNotice] = useState<string | null>(null);
  const [pendingOverride,        setPendingOverride]        = useState<PendingOverride | null>(null);
  const [isDark,                 setIsDark]                 = useState(false);
  const [showStats,              setShowStats]              = useState(false);
  const [dailyStats,             setDailyStats]             = useState<DailyStats>({ desks: {}, gates: {} });
  const [loadingStats,           setLoadingStats]           = useState(false);
  const [removingResources, setRemovingResources] = useState<Set<string>>(new Set());
  // FIX (po zahtjevu — UX poboljšanje): pretraga/filter za brzo
  // pronalaženje šaltera/gate-a među 18+16 resursa — po broju resursa,
  // broju leta, avio kompaniji, ili destinaciji. Ovo je ADMIN stranica
  // (ne kiosk ekran), koristi je 1-3 osobe istovremeno — nema uticaja
  // na "50 kiosk displeja" trošak/performans budžet.
  const [resourceFilter, setResourceFilter] = useState('');

  const flightsRef            = useRef<Flight[]>([]);
  const selectedFlightRef     = useRef<Flight | null>(null);
  const checkinAssignmentsRef = useRef<Assignment[]>([]);
  const gateAssignmentsRef    = useRef<Assignment[]>([]);
  const touchTimeoutRef       = useRef<ReturnType<typeof setTimeout> | null>(null);


  const setSelectedFlight = useCallback((flight: Flight | null) => {
    selectedFlightRef.current = flight;
    setSelectedFlightForTouch(flight);
  }, []);

  // Tema — FIX (po zahtjevu): podrazumijevana tema je sad UVIJEK Light
  // dok korisnik eksplicitno ne izabere Dark (preko toggleTheme ispod,
  // što se onda pamti u localStorage). Ranije se, kad ništa nije bilo
  // sačuvano, padalo nazad na OS podešavanje uređaja
  // (prefers-color-scheme) — na telefonu sa uključenim sistemskim
  // "dark mode" (uobičajeno na Android/iOS), to je tihо davalo tamnu
  // temu iako je Light bila namjeravana podrazumijevana vrijednost.
  useEffect(() => {
    const stored      = localStorage.getItem('theme');
    const shouldBeDark = stored === 'dark';
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



 // ── NOVO: realtime hookovi ──────────────────────────────
  const { data: flightDataRaw, connectionState: flightsConnState, refetch: refetchFlights } = useRealtimeFlightData('board');
  const { deskEntries, gateEntries, connectionState: assignConnState } = useRealtimeAssignments('board');

  // ── Izvedeni letovi — JEDINO mjesto gdje se 'flights' definiše ──
  // eslint-disable-next-line react-hooks/preserve-manual-memoization
const flights = useMemo(
    () => flightDataRaw ? processFlights(flightDataRaw.departures || []) : [],
    [flightDataRaw]
  );

  // NOVO (po zahtjevu — brojač "X od Y dodijeljeno"): koliko od
  // trenutno prikazanih (nedoletjelih) letova ima BAR JEDNU dodjelu na
  // aktivnom tabu (šalter ili gate, zavisno koji je tab otvoren).
  // Računa se po JEDINSTVENOM broju leta (jedan let može imati više
  // dodijeljenih šaltera/gate-ova — svejedno se broji samo jednom).
  const assignedProgress = useMemo(() => {
    const relevantAssignments = activeTab === 'checkin' ? checkinAssignments : gateAssignments;
    const assignedFlightNumbers = new Set(relevantAssignments.map(a => a.flightNumber));
    const assignedCount = flights.filter(f => assignedFlightNumbers.has(f.FlightNumber)).length;
    return { assigned: assignedCount, total: flights.length };
  }, [flights, checkinAssignments, gateAssignments, activeTab]);

  useEffect(() => { flightsRef.current = flights; }, [flights]);
  useEffect(() => { checkinAssignmentsRef.current = checkinAssignments; }, [checkinAssignments]);
  useEffect(() => { gateAssignmentsRef.current = gateAssignments; }, [gateAssignments]);

  // FIX (po zahtjevu — UX poboljšanje, podloga za upozorenje o
  // zastarjelom podatku ispod): lastUpdate je već čuvan kao FORMATIRAN
  // tekst (za prikaz), ne kao broj — dodat je poseban REF (ne state,
  // da ne izaziva dodatni re-render) koji čuva SIRO vrijeme, samo za
  // izračun "koliko je prošlo". Ne mijenja postojeći prikaz.
  const lastUpdateTimestampRef = useRef<number | null>(null);
  const [isDataStale, setIsDataStale] = useState(false);

  const markDataFresh = useCallback(() => {
    lastUpdateTimestampRef.current = Date.now();
    setLastUpdate(new Date().toLocaleTimeString('sr-Latn-RS'));
    setIsDataStale(false);
  }, []);

  // Provjerava svakih 30s da li je prošlo predugo od poslednjeg
  // stvarnog osvježenja podatka (3 min — dvostruko duže od najsporijeg
  // REFRESH_INTERVAL_MS ciklusa bilo koje kiosk stranice u sistemu).
  // Direktno motivisano nedavno otkrivenim i popravljenim bug-om
  // (lažno okinut noćni režim usred dana) — ovo je vidljivost, ne
  // popravka mehanizma. lastUpdateTimestampRef.current je null dok
  // prvi podatak još nije stigao — tada se ništa ne prijavljuje kao
  // zastarjelo (drugačiji, već pokriven "Povezivanje..." slučaj).
  useEffect(() => {
    const STALE_THRESHOLD_MS = 3 * 60_000;
    const id = setInterval(() => {
      const ts = lastUpdateTimestampRef.current;
      setIsDataStale(ts !== null && Date.now() - ts > STALE_THRESHOLD_MS);
    }, 30_000);
    return () => clearInterval(id);
  }, []);

  // ── DODAJ OVO — bez njega loadingFlights ostaje zauvijek true ──
  useEffect(() => {
    if (flightDataRaw) {
      markDataFresh();
      setLoadingFlights(false);
    }
  }, [flightDataRaw, markDataFresh]);

  // FIX (KRITIČNO — otkriveno kroz sveobuhvatnu analizu, razmišljajući
  // o STVARNOM radu na aerodromu): ako bi VEZA (Ably token, mreža,
  // Redis) bila potpuno nedostupna VEĆ OD PRVOG otvaranja stranice
  // (npr. osoblje otvori assign-checkin baš u trenutku kad počne
  // mrežni ispad), flightDataRaw bi ostao null ZAUVIJEK — useEffect
  // iznad se NIKAD ne bi izvršio, i loadingFlights bi ostao true
  // ZAUVIJEK, ostavljajući osoblje zaglavljeno na skeleton ekranu bez
  // ikakve naznake šta se dešava ili da sistem uopšte pokušava da se
  // oporavi (fallback polling iz useRealtimeFlightData BI se nastavio
  // u pozadini, ali korisnik to ne bi vidio). Sigurnosna mreža: nakon
  // 15s, prisilno izađi iz loading stanja bez obzira na ishod — stranica
  // tad prelazi na normalan prikaz sa praznom listom letova (postojeće
  // "Nema aktivnih letova" stanje), umjesto beskonačnog čekanja.
  // Fallback polling i Ably veza nastavljaju da rade u pozadini i dalje
  // — čim podatak stvarno stigne, prikaz se ažurira normalno.
  useEffect(() => {
    const id = setTimeout(() => setLoadingFlights(false), 15_000);
    return () => clearTimeout(id);
  }, []);

  // ── Izvedene liste dodjela — rebuilduju se kad god stigne nova Ably poruka ──
  useEffect(() => {
    setCheckinAssignments(buildAssignmentList(deskEntries, flights));
  }, [deskEntries, flights]);

  useEffect(() => {
    setGateAssignments(buildAssignmentList(gateEntries, flights));
  }, [gateEntries, flights]);


const handleLogout = useCallback(() => {
    // FIX (po zahtjevu — "ne mogu da se odjavim, traje predugo"):
    // portovano u dijeljen, timeout-zaštićen helper — vidi
    // lib/admin-logout.ts za pun kontekst.
    logoutAndRedirect();
  }, []);

  // Napomena: idle-logout tajmer (3 min neaktivnosti) sad živi u
  // app/admin/layout.tsx i pokriva sve /admin/* rute centralno — nema
  // potrebe da ova stranica ima svoju kopiju istog koda.

  // ─── RUČNI REFRESH ──────────────────────────────────────
// ZAMIJENI staru handleRefresh (koja je pozivala fetchFlightsData/refreshAll) sa:
const handleRefresh = useCallback(async () => {
  setRefreshing(true);
  try {
    // FIX (po zahtjevu — "letovi se moraju osvježavati svakih 3-4
    // minuta", garantovano): refetchFlights (izloženo iz
    // useRealtimeFlightData) STVARNO primjenjuje svježe podatke na
    // prikaz — ranije je ovo dugme samo provjeravalo da su izvori
    // dostupni, bez da stvarno ažurira ono što se vidi na ekranu, ako
    // bi Ably veza ikad tiho "zaglavila" (izgledala povezano, ali
    // prestala da isporučuje poruke). refetch('/api/test/assignments')
    // ostaje isti provjera-dostupnosti obrazac kao ranije, jer
    // dodjele već imaju sopstveni, pouzdan realtime kanal.
    const [assignRes] = await Promise.all([
      fetch('/api/test/assignments'),
    ]);
    refetchFlights();
    if (assignRes.ok) {
      markDataFresh();
    }
  } catch (err) {
    console.error('Manual refresh check failed:', err);
  } finally {
    setRefreshing(false);
  }
}, [markDataFresh, refetchFlights]);

// FIX (po zahtjevu — "letovi se MORAJU osvježavati svakih 3-4 minuta"):
// garantovan, periodičan poziv refetchFlights() na 3.5 min — NEZAVISNO
// od Ably stanja konekcije. Ably PUSH ostaje primaran, skoro-trenutan
// put (cron objavljuje promjenu čim je detektuje, obično mnogo brže
// od 3.5 min) — ovo je isključivo sigurnosna mreža za rijedak slučaj
// da konekcija izgleda "connected" ali tiho prestane da isporučuje
// poruke, ili je poruka nekako izgubljena. refetchFlights() ima
// ugrađenu zaštitu od prepisivanja novijeg podatka starijim (vidi
// hooks/useRealtimeFlightData.ts), pa je bezbjedno pozivati i kad Ably
// već uredno radi — u tom slučaju samo potvrdi isto stanje, bez efekta.
useEffect(() => {
  const REFRESH_GUARANTEE_MS = 3.5 * 60_000;
  const id = setInterval(() => { refetchFlights(); }, REFRESH_GUARANTEE_MS);
  return () => clearInterval(id);
}, [refetchFlights]);

const assignFlightToResource = useCallback(async (
  flight: Flight, resourceId: string, resourceType: 'desk' | 'gate',
): Promise<boolean> => {
  const endpoint = `${API_PREFIX}/${resourceType === 'desk' ? 'desk-status-override' : 'gate-status-override'}`;
  const payload  = resourceType === 'desk'
    ? { deskNumber: resourceId, action: 'open', flightNumber: flight.FlightNumber }
    : { gateNumber: resourceId, action: 'open', flightNumber: flight.FlightNumber };

  // ── Odredi auto-klasu ODMAH (lokalno, bez čekanja servera) ──
  let autoClass: ClassType = null;
  let gateToDowngrade: string | null = null; // ← NOVO: gate koji gubi PLUS jer novi gate ima prioritet

  if (resourceType === 'desk' && isBAFlight(flight.FlightNumber)) {
    const existingBADesks = checkinAssignmentsRef.current.filter(
      a => isBAFlight(a.flightNumber) && a.resourceId !== resourceId,
    );
    autoClass = existingBADesks.length < 2 ? 'BUSINESS' : 'ECONOMY';
  }

  // ── NOVO: easyJet Plus — dodjeljuje se automatski PRVOM gate-u
  // (po redoslijedu u GATES nizu) dodijeljenom ovom letu ──
  if (resourceType === 'gate' && isEasyJetFlight(flight.FlightNumber, flight.AirlineName)) {
    const siblingGateIds = gateAssignmentsRef.current
      .filter(a => a.flightNumber === flight.FlightNumber && a.resourceId !== resourceId)
      .map(a => a.resourceId);

    const allGateIdsForFlight = [...siblingGateIds, resourceId];
    const sortedByOrder = [...allGateIdsForFlight].sort(
      (a, b) => GATES.indexOf(a) - GATES.indexOf(b)
    );
    const firstGate = sortedByOrder[0];

    if (resourceId === firstGate) {
      autoClass = 'EASYJET_PLUS';
      // Ako je neki od SIBLING gate-ova (već dodijeljenih ranije) trenutno imao PLUS,
      // a sad novi gate preuzima prvo mjesto po redoslijedu — skini mu PLUS.
      const previousFirstWithPlus = siblingGateIds.find(id => {
        const existing = gateAssignmentsRef.current.find(a => a.resourceId === id);
        return existing?.classType === 'EASYJET_PLUS';
      });
      if (previousFirstWithPlus && previousFirstWithPlus !== firstGate) {
        gateToDowngrade = previousFirstWithPlus;
      }
    } else {
      autoClass = null; // ne prvi gate — bez posebne klase
    }
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

  // ── NOVO: optimistički skini PLUS sa prethodnog "prvog" gate-a, ako treba ──
  if (gateToDowngrade) {
    setGateAssignments(list => list.map(a =>
      a.resourceId === gateToDowngrade ? { ...a, classType: null } : a
    ));
  }

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
      const classEndpoint = resourceType === 'desk'
        ? `${API_PREFIX}/desk-status-override`
        : `${API_PREFIX}/gate-status-override`;
      const classBody = resourceType === 'desk'
        ? { deskNumber: resourceId, action: 'setClass', classType: autoClass }
        : { gateNumber: resourceId, action: 'setClass', classType: autoClass };

      fetch(classEndpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(classBody),
      }).catch(err => console.error('Auto class error:', err));
    }

    // ── NOVO: pošalji i uklanjanje klase za "downgraded" gate na server ──
    if (gateToDowngrade) {
      fetch(`${API_PREFIX}/gate-status-override`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gateNumber: gateToDowngrade, action: 'setClass', classType: null }),
      }).catch(err => console.error('Gate downgrade error:', err));
    }

    return true;
  } catch (err) {
    console.error('Greška pri dodjeli:', err);
    // Rollback — ukloni optimistički dodatu stavku
    setAssignments(list => list.filter(a => a.resourceId !== resourceId));
    // Rollback downgrade-a (vrati PLUS nazad na prethodni gate ako je poziv pao)
    if (gateToDowngrade) {
      setGateAssignments(list => list.map(a =>
        a.resourceId === gateToDowngrade ? { ...a, classType: 'EASYJET_PLUS' } : a
      ));
    }
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
    setSelectionExpiredNotice(false);
    if (touchTimeoutRef.current) clearTimeout(touchTimeoutRef.current);
    touchTimeoutRef.current = setTimeout(() => {
      setSelectedFlight(null);
      setSelectionExpiredNotice(true);
      setTimeout(() => setSelectionExpiredNotice(false), 4_000);
    }, TOUCH_TIMEOUT_MS);
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
    // FIX (KRITIČNO — drugi, odvojen uzrok prijavljenog "kiosk se ne
    // može zatvoriti"): fetch() Promise ODBIJA (throw) ISKLJUČIVO na
    // mrežnim greškama (DNS, prekinuta konekcija) — NIKAD na HTTP
    // error statusima (4xx/5xx). Ako server vrati 503 (npr. lock
    // conflict — realan, čest scenario ako dva zahtjeva pogode isti
    // resurs istovremeno, ili se poklope sa auto-cleanup-om), fetch()
    // i dalje USPJEŠNO rezolvira — Promise.all iznad NIKAD ne baci
    // grešku, catch blok se NIKAD ne izvrši, rollback (vraćanje
    // optimistički uklonjene stavke) se NIKAD ne desi. Admin panel je
    // pogrešno prikazivao "uspješno uklonjeno" iako server nikad nije
    // stvarno promijenio stanje — kiosk je ispravno nastavljao da
    // prikazuje STARO stanje (jer se ništa stvarno nije promijenilo),
    // što je osoblju izgledalo kao "kiosk se ne može zatvoriti".
    // Eksplicitna .ok provjera + throw sad garantuje da svaki neuspjeh
    // (uključujući 503) ispravno pokrene rollback ispod.
    const [, deskRes] = await Promise.all([
      trackEnd('desk', deskNumber),
      fetch(`${API_PREFIX}/desk-status-override`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deskNumber, action: 'clear' }),
      }),
    ]);
    if (!deskRes.ok) throw new Error(`HTTP ${deskRes.status}`);
   // isDirty = true;
    // Nema potrebe za dodatnim fetchCheckinAssignments — već smo lokalno uklonili
  } catch (err) {
    console.error('Greška pri brisanju šaltera', deskNumber, err);
    setRemovalErrorNotice(`Šalter ${deskNumber} nije uklonjen — pokušaj ponovo`);
    setTimeout(() => setRemovalErrorNotice(null), 5_000);
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
    // FIX (po zahtjevu — isti razlog kao handleRemoveCheckin, vidi
    // opširan komentar tamo).
    const [, gateRes] = await Promise.all([
      trackEnd('gate', gateNumber),
      fetch(`${API_PREFIX}/gate-status-override`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gateNumber, action: 'clear' }),
      }),
    ]);
    if (!gateRes.ok) throw new Error(`HTTP ${gateRes.status}`);
 //   isDirty = true;
  } catch (err) {
    console.error('Greška pri brisanju gate-a', gateNumber, err);
    setRemovalErrorNotice(`Gate ${gateNumber} nije uklonjen — pokušaj ponovo`);
    setTimeout(() => setRemovalErrorNotice(null), 5_000);
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

// FIX (po zahtjevu — hitno, za brzo čišćenje zaostalih/zaglavljenih
// dodjela iz ranijeg testiranja, npr. duh-klik bug pronađen i
// popravljen ranije ove sesije): "Očisti sve" — jednim dugmetom
// prođe kroz SVE trenutno zauzete šaltere i gate-ove i pozove VEĆ
// POSTOJEĆE, dokazano ispravne handleRemoveCheckin/handleRemoveGate
// funkcije za svaki (ista logika kao pojedinačno "Ukloni" dugme —
// optimističko uklanjanje + clear na serveru + trackEnd) — NE dodaje
// nikakvu novu server-stranu logiku, samo automatizuje ono što bi
// osoblje inače moralo ručno, jedan po jedan. Zaštićeno potvrdom
// (window.confirm) jer je destruktivno. Namjerno definisano OVDJE
// (poslije handleRemoveCheckin/handleRemoveGate), ne ranije u fajlu —
// zavisnosti moraju biti već inicijalizovane u trenutku kad se ovaj
// useCallback poziva.
const [clearingAll, setClearingAll] = useState(false);
const handleClearAll = useCallback(async () => {
  const deskIds = checkinAssignmentsRef.current.map(a => a.resourceId);
  const gateIds = gateAssignmentsRef.current.map(a => a.resourceId);
  if (deskIds.length === 0 && gateIds.length === 0) return;

  const confirmed = window.confirm(
    `Ukloniti SVE trenutne dodjele? (${deskIds.length} šalter${deskIds.length === 1 ? '' : 'a'}, ${gateIds.length} gate${gateIds.length === 1 ? '' : '-a'})\n\nOva radnja se ne može poništiti.`
  );
  if (!confirmed) return;

  setClearingAll(true);
  try {
    await Promise.all([
      ...deskIds.map(id => handleRemoveCheckin(id)),
      ...gateIds.map(id => handleRemoveGate(id)),
    ]);
  } finally {
    setClearingAll(false);
  }
}, [handleRemoveCheckin, handleRemoveGate]);

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
      
   //   isDirty = true;
    } catch (err) {
      console.error('Class toggle error:', err);
      setAssignments(list => list.map(a =>
        a.resourceId === resourceId ? { ...a, classType: prev } : a
      ));
    }
  }, []);

  const isFlightAssigned = (flightNumber: string, tab: TabType) =>
    tab === 'checkin'
      ? checkinAssignments.some(a => a.flightNumber === flightNumber)
      : gateAssignments.some(a => a.flightNumber === flightNumber);

  // FIX (React Compiler — "useCallback called conditionally"): OVAJ
  // hook je ranije bio smješten POSLIJE `if (loadingFlights) return`
  // ispod, što krši Rules of Hooks (hook definisan nakon uslovnog
  // early-return-a). Premješten ovdje, prije bilo kog early-return-a u
  // ovoj komponenti — isto mjesto gdje žive svi ostali hook-ovi.
  //
  // Da li dati resurs (šalter/gate) odgovara trenutnoj pretrazi — po
  // svom ID-ju, ili (ako je dodijeljen) broju leta/kompaniji/destinaciji.
  // Prazna pretraga = sve odgovara (ništa nije zatamnjeno).
  const resourceMatchesFilter = useCallback((id: string, occupied?: Assignment): boolean => {
    const q = resourceFilter.trim().toLowerCase();
    if (!q) return true;
    if (id.toLowerCase().includes(q)) return true;
    if (!occupied) return false;
    return (
      occupied.flightNumber.toLowerCase().includes(q) ||
      occupied.airlineName.toLowerCase().includes(q) ||
      occupied.destinationCity.toLowerCase().includes(q)
    );
  }, [resourceFilter]);

  // FIX (po zahtjevu — moderniji, brži utisak od golog spinnera):
  // skeleton koji prati STVARAN raspored stranice (zaglavlje, tabovi,
  // 1/3+2/3 mreža) — sivi "duh" oblika sadržaja umjesto praznog
  // ekrana sa rotirajućim krugom. Čist CSS (animate-pulse, Tailwind
  // ugrađen), bez ikakve nove zavisnosti — jeftino i za Moto G34/
  // Redmi klasu uređaja.
  if (loadingFlights) {
    const pulse = isDark ? 'bg-white/10' : 'bg-gray-200';
    return (
      <div className={`min-h-screen p-3 sm:p-4 ${isDark ? 'bg-slate-950' : 'bg-slate-50'}`}>
        <div className="max-w-7xl mx-auto animate-pulse">
          {/* Zaglavlje */}
          <div className="flex items-center gap-2 mb-2">
            <div className={`w-8 h-8 rounded-xl ${pulse}`} />
            <div className={`h-5 w-48 rounded-lg ${pulse}`} />
          </div>
          <div className={`h-3 w-24 rounded ${pulse} mb-5`} />
          {/* Tabovi */}
          <div className="flex gap-2 sm:gap-3 mb-5 sm:mb-6">
            <div className={`h-11 flex-1 sm:w-40 sm:flex-initial rounded-2xl ${pulse}`} />
            <div className={`h-11 flex-1 sm:w-40 sm:flex-initial rounded-2xl ${pulse}`} />
          </div>
          {/* Sadržaj: 1/3 lista letova + 2/3 mreža resursa */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            <div className="space-y-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className={`h-[85px] rounded-2xl ${pulse}`} />
              ))}
            </div>
            <div className="lg:col-span-2">
              <div className="grid grid-cols-4 sm:grid-cols-6 lg:grid-cols-8 gap-3">
                {Array.from({ length: 16 }).map((_, i) => (
                  <div key={i} className={`h-[72px] rounded-2xl ${pulse}`} />
                ))}
              </div>
            </div>
          </div>
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
      {flights.map(flight => {
        const assigned = isFlightAssigned(flight.FlightNumber, tab);
        return (
          <FlightRow
            key={flight.FlightNumber + flight.ScheduledDepartureTime}
            flight={flight}
            assigned={assigned}
            selected={selectedFlightForTouch?.FlightNumber === flight.FlightNumber}
            onSelect={() => handleFlightTouchSelect(flight)}
            isDark={isDark}
            urgent={isUrgentFlight(flight, assigned)}
          />
        );
      })}
    </div>
  );

  const resourceGrid = (type: 'desk' | 'gate', items: string[], occupied: Assignment[]) => (
    <div className="grid grid-cols-4 sm:grid-cols-6 lg:grid-cols-8 gap-3">
      {items.map(id => {
        const match = occupied.find(a => a.resourceId === id);
        return (
          <ResourceCell
            key={id} id={id} type={type}
            occupied={match}
            flightReady={!!selectedFlightForTouch && !match}
            onAssign={() => handleResourceTouchAssign(id, type)}
            isDark={isDark}
            dimmed={!resourceMatchesFilter(id, match)}
          />
        );
      })}
    </div>
  );

  return (
    <div className={`min-h-screen p-3 sm:p-4 overflow-y-auto ${isDark ? 'bg-slate-950 text-white' : 'bg-slate-50 text-gray-900'}`}>
      {/* FIX (po zahtjevu — vidljiva poruka kad selekcija leta istekne,
          vidi opširan komentar uz TOUCH_TIMEOUT_MS i
          selectionExpiredNotice): lagan, ne-blokirajući banner —
          osoblje odmah vidi ZAŠTO tap na gate/šalter "nije radio",
          umjesto da izgleda kao kvar. Nestaje sam nakon 4s. */}
      {selectionExpiredNotice && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[60] px-5 py-3 rounded-xl shadow-2xl bg-amber-500 text-white font-semibold text-sm flex items-center gap-2 animate-in fade-in">
          ⏱️ Selekcija leta je istekla — izaberi let ponovo
        </div>
      )}
      {/* NOVO — vidi opširan komentar uz removalErrorNotice state.
          Isti obrazac kao selectionExpiredNotice, crveno umjesto
          žuto (stvarna greška, ne samo istek selekcije). */}
      {removalErrorNotice && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[60] px-5 py-3 rounded-xl shadow-2xl bg-red-500 text-white font-semibold text-sm flex items-center gap-2 animate-in fade-in">
          ⚠️ {removalErrorNotice}
        </div>
      )}
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
        {/* NOVO (po zahtjevu — sticky zaglavlje pri skrolovanju): naslov,
            toolbar i tabovi ostaju vidljivi dok se skroluje kroz dužu
            listu resursa/letova ispod. Sopstvena, puna pozadina (ista
            kao stranica) da sadržaj koji se skroluje ispod ne "probija"
            kroz njega; tanka donja linija za vizuelno odvajanje. */}
        <div className={`sticky top-0 z-30 -mx-3 sm:-mx-4 px-3 sm:px-4 pt-3 sm:pt-4 pb-3 sm:pb-4 border-b ${
          isDark ? 'bg-slate-950 border-white/10' : 'bg-slate-50 border-gray-200'
        }`}>
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 sm:gap-4 mb-5 sm:mb-6">
          <div>
            <div className="flex items-baseline flex-wrap gap-x-2.5 gap-y-0.5 mb-2">
              <div className="flex items-center gap-2">
                <div className={`p-1.5 rounded-xl ${isDark ? 'bg-sky-500/15' : 'bg-sky-100'}`}>
                  <Fingerprint size={20} className="text-sky-500" />
                </div>
                <h1 className="text-lg sm:text-xl font-bold tracking-tight">TIV · Check-in &amp; Gate</h1>
              </div>
              {/* FIX (po zahtjevu — "Developed by Alen" mora biti u
                  ISTOM redu sa naslovom, ne ispod njega): items-baseline
                  na roditelju poravnava tekst uz osnovnu liniju naslova;
                  flex-wrap je i dalje tu kao sigurnosna mreža SAMO za
                  ekstremno uske ekrane gdje bi inače tekst iscurio van
                  ekrana, ne kao namjerno ponašanje. */}
              <span className={`text-xs font-medium ${isDark ? 'text-white/25' : 'text-gray-400'}`}>
                Developed by Alen
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2.5 text-xs">
              <span className={isDark ? 'text-white/30' : 'text-gray-500'}>✈️ Letovi: {flights.length}</span>
              <span className={isDark ? 'text-white/15' : 'text-gray-300'}>|</span>
              <span className={isDark ? 'text-white/30' : 'text-gray-500'}>🕐 Ažurirano: {lastUpdate || '—'}</span>
              <span className={isDark ? 'text-white/15' : 'text-gray-300'}>|</span>
<span className={`flex items-center gap-1.5 ${isDark ? 'text-white/30' : 'text-gray-500'}`}>
  <span className={`w-2 h-2 rounded-full ${
    flightsConnState === 'connected' && assignConnState === 'connected'
      ? 'bg-emerald-400 animate-pulse'
      : flightsConnState === 'night-sleep' || assignConnState === 'night-sleep'
        ? 'bg-slate-500'
        : 'bg-yellow-500'
  }`} />
  {flightsConnState === 'connected' && assignConnState === 'connected'
    ? 'Live'
    : flightsConnState === 'night-sleep' || assignConnState === 'night-sleep'
      ? 'Noćni režim'
      : 'Povezivanje...'}
</span>
{/* FIX (po zahtjevu — UX poboljšanje, direktno vezano za nedavno
    otkriven bug: pogrešno okinuti noćni režim usred dana): ako
    veza tvrdi da je "Live" ILI "Noćni režim" ali podatak nije
    osvježen duže od 3 min (dvostruko duže od najsporijeg
    REFRESH_INTERVAL_MS ciklusa bilo koje kiosk stranice u
    sistemu), nešto je vjerovatno zaglavljeno — pokaži jasno
    upozorenje umjesto tihog "Live" statusa koji zavarava osoblje.
    Ne mijenja NIŠTA u samom mehanizmu, samo dodaje vidljivost. */}
{isDataStale && (
  <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-400 font-semibold">
    <AlertTriangle size={12} />
    Podatak zastario — pokušaj osvježi
  </span>
)}
            </div>
          </div>

          <div className="flex items-center gap-2 flex-shrink-0 flex-wrap w-full sm:w-auto">
            {/* FIX (po zahtjevu — UX poboljšanje): pretraga/filter za
                brzo pronalaženje šaltera/gate-a po broju resursa, broju
                leta, kompaniji ili destinaciji. Ne-poklapajuće ćelije se
                ZATAMNJUJU (ne uklanjaju) — raspored ostaje na istom
                mjestu, osoblje se oslanja na prostornu memoriju
                ("gate 23 je uvijek tu"). */}
            <div className="relative flex items-center flex-1 sm:flex-initial min-w-0">
              <Search size={15} className={`absolute left-3.5 pointer-events-none ${isDark ? 'text-white/30' : 'text-gray-400'}`} />
              <input
                type="text"
                value={resourceFilter}
                onChange={(e) => setResourceFilter(e.target.value)}
                placeholder="Traži šalter, gate, let..."
                className={`pl-9 pr-9 py-2.5 rounded-2xl border text-sm w-full sm:w-48 transition-all ${
                  isDark ? 'bg-white/5 hover:bg-white/10 border-white/10 text-white placeholder:text-white/30 focus:border-sky-400/50'
                         : 'bg-white hover:bg-gray-50 border-gray-200 text-gray-900 placeholder:text-gray-400 focus:border-sky-400 shadow-sm'
                } focus:outline-none focus:ring-2 focus:ring-sky-400/20`}
              />
              {resourceFilter && (
                <button
                  onClick={() => setResourceFilter('')}
                  className={`absolute right-3 ${isDark ? 'text-white/40 hover:text-white' : 'text-gray-400 hover:text-gray-700'}`}
                  title="Obriši pretragu"
                  type="button"
                >
                  <X size={14} />
                </button>
              )}
            </div>

            <button onClick={handleRefresh} disabled={refreshing}
              className={`p-3 rounded-2xl border transition-all active:scale-95 ${isDark ? 'bg-white/5 hover:bg-white/10 border-white/10' : 'bg-white hover:bg-gray-50 border-gray-200 shadow-sm'}`}>
              <RefreshCw size={16} className={`${isDark ? 'text-white/60' : 'text-gray-600'} ${refreshing ? 'animate-spin' : ''}`} />
            </button>

            <button onClick={openStats} title="Dnevna statistika"
              className={`p-3 rounded-2xl border transition-all active:scale-95 ${isDark ? 'bg-white/5 hover:bg-white/10 border-white/10' : 'bg-white hover:bg-gray-50 border-gray-200 shadow-sm'}`}>
              <BarChart2 size={16} className={isDark ? 'text-sky-400' : 'text-sky-600'} />
            </button>

            {/* FIX (po zahtjevu — hitno čišćenje zaostalih dodjela iz
                testiranja): "Očisti sve" — crveno/upozoravajuće
                stilizovano jer je destruktivno, sa window.confirm
                zaštitom u handleClearAll. Onemogućeno dok nema
                nijedne aktivne dodjele (ništa za čišćenje) ili dok je
                čišćenje već u toku. */}
            <button
              onClick={handleClearAll}
              disabled={clearingAll || (checkinAssignments.length === 0 && gateAssignments.length === 0)}
              title="Očisti sve trenutne dodjele"
              className={`p-3 rounded-2xl border transition-all active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed ${
                isDark ? 'bg-red-500/10 hover:bg-red-500/20 border-red-500/20' : 'bg-red-50 hover:bg-red-100 border-red-200'
              }`}
            >
              <Trash2 size={16} className={`${isDark ? 'text-red-400' : 'text-red-600'} ${clearingAll ? 'animate-pulse' : ''}`} />
            </button>

            <button onClick={() => router.push('/admin')}
              className={`p-3 rounded-2xl border transition-all active:scale-95 ${isDark ? 'bg-white/5 hover:bg-white/10 border-white/10' : 'bg-white hover:bg-gray-50 border-gray-200 shadow-sm'}`}>
              <Home size={16} className={isDark ? 'text-white/60' : 'text-gray-600'} />
            </button>

            <button onClick={toggleTheme}
              className={`p-3 rounded-2xl border transition-all active:scale-95 ${isDark ? 'bg-white/5 hover:bg-white/10 border-white/10' : 'bg-white hover:bg-gray-50 border-gray-200 shadow-sm'}`}>
              {isDark ? <Sun size={16} className="text-yellow-400" /> : <Moon size={16} className="text-slate-700" />}
            </button>

            <button onClick={handleLogout}
              className="flex items-center gap-2 px-4 py-3 rounded-2xl bg-red-500/15 hover:bg-red-500/25 border border-red-500/25 text-red-400 text-xs font-semibold transition-all active:scale-95">
              <LogOut size={14} /> Odjava
            </button>
          </div>
        </div>

        {/* Tabovi */}
        <div className="flex gap-2 sm:gap-3 mb-5 sm:mb-6">
          {([
            { id: 'checkin' as TabType, label: '🏷️ Check-in', icon: CheckSquare, count: checkinAssignments.length },
            { id: 'gate'    as TabType, label: '🚪 Gate-ovi', icon: GitBranch,   count: gateAssignments.length    },
          ] as const).map(tab => {
            const isActive = activeTab === tab.id;
            return (
              <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                className={`flex-1 sm:flex-initial flex items-center justify-center sm:justify-start gap-2 px-4 sm:px-5 py-3 rounded-2xl border text-sm font-semibold transition-all active:scale-95 ${
                  isActive
                    ? isDark ? 'bg-sky-500/20 border-sky-500/50 text-sky-300 shadow-lg'
                             : 'bg-sky-500 border-sky-500 text-white shadow-md shadow-sky-500/20'
                    : isDark ? 'bg-white/5 border-white/10 text-white/50 hover:bg-white/10'
                             : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50 shadow-sm'
                }`}>
                <tab.icon size={16} />
                <span>{tab.label}</span>
                <span className={`text-xs px-2 py-0.5 rounded-full font-bold ${
                  isActive
                    ? isDark ? 'bg-white/20 text-white' : 'bg-white/25 text-white'
                    : isDark ? 'bg-white/10 text-white/40' : 'bg-gray-100 text-gray-500'
                }`}>{tab.count}</span>
              </button>
            );
          })}
        </div>

        {/* NOVO (po zahtjevu — "X od Y dodijeljeno" traka napretka):
            koliko od trenutno prikazanih letova (na aktivnom tabu) već
            ima dodijeljen šalter/gate. */}
        {assignedProgress.total > 0 && (
          <div className="mt-3">
            <div className="flex items-center justify-between mb-1">
              <span className={`text-xs font-medium ${isDark ? 'text-white/40' : 'text-gray-500'}`}>
                {assignedProgress.assigned} od {assignedProgress.total} letova dodijeljeno
              </span>
              <span className={`text-xs font-semibold ${isDark ? 'text-white/50' : 'text-gray-600'}`}>
                {Math.round((assignedProgress.assigned / assignedProgress.total) * 100)}%
              </span>
            </div>
            <div className={`h-1.5 rounded-full overflow-hidden ${isDark ? 'bg-white/10' : 'bg-gray-200'}`}>
              <div
                className={`h-full rounded-full transition-all duration-500 ${activeTab === 'checkin' ? 'bg-sky-500' : 'bg-emerald-500'}`}
                style={{ width: `${(assignedProgress.assigned / assignedProgress.total) * 100}%` }}
              />
            </div>
          </div>
        )}
        </div>

        {/* Selected Flight Banner */}
        {selectedFlightForTouch && (
          <div className="mb-5 p-4 rounded-2xl bg-amber-500/15 border-2 border-amber-400/50 shadow-lg shadow-amber-500/20">
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