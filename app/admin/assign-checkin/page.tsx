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
} from 'lucide-react';
import type { Flight } from '@/types/flight';

// ─────────────────────────────────────────────
// Konstante
// ─────────────────────────────────────────────

const isDevelopment = process.env.NODE_ENV === 'development';
const API_PREFIX    = isDevelopment ? '/api/test' : '/api/admin';

const DESKS = [
  ...Array.from({ length: 12 }, (_, i) => String(i + 1)),
  '21', '22', '23', '24', '25', '26',
];
const GATES = ['2','3','4','5','6','21','22','23','24','25','26','27','28','29','30','31'];

const REFRESH_INTERVAL_MS = 60_000;

// ─────────────────────────────────────────────
// Tipovi
// ─────────────────────────────────────────────

interface Assignment {
  resourceId:      string;
  flightNumber:    string;
  airlineName:     string;
  destinationCity: string;
  scheduledTime:   string;
  assignedAt:      string;
}

type TabType = 'checkin' | 'gate';

// ─────────────────────────────────────────────
// Helpers
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
// Sub-komponente
// ─────────────────────────────────────────────

const Divider: React.FC<{ label: string; isDark: boolean }> = ({ label, isDark }) => (
  <div className="flex items-center gap-3 mb-3">
    <div className={`h-px flex-1 ${isDark ? 'bg-gradient-to-r from-transparent via-sky-500/30 to-transparent' : 'bg-gradient-to-r from-transparent via-sky-600/60 to-transparent'}`} />
    <span className={`text-[10px] font-bold tracking-widest uppercase ${isDark ? 'text-blue-400' : 'text-blue-700'}`}>
      {label}
    </span>
    <div className={`h-px flex-1 ${isDark ? 'bg-gradient-to-r from-transparent via-sky-500/30 to-transparent' : 'bg-gradient-to-r from-transparent via-sky-600/60 to-transparent'}`} />
  </div>
);

interface ResourceCellProps {
  id:            string;
  occupied?:     Assignment;
  type:          'desk' | 'gate';
  flightReady:   boolean;
  onDragOver:    (e: React.DragEvent) => void;
  onDrop:        (e: React.DragEvent) => void;
  onClick:       () => void;
  isDark:        boolean;
}

const ResourceCell: React.FC<ResourceCellProps> = ({
  id, occupied, type, flightReady, onDragOver, onDrop, onClick, isDark,
}) => {
  let variantClasses = '';
  let textColor = '';
  let subTextColor = '';

  if (isDark) {
    // Tamna tema (originalno)
    if (occupied) {
      variantClasses = 'bg-red-500/10 border-red-500/40 hover:bg-red-500/20';
      textColor = 'text-red-300';
      subTextColor = 'text-red-400/80';
    } else if (flightReady) {
      variantClasses = type === 'desk'
        ? 'bg-sky-500/20 border-sky-400/60 hover:bg-sky-500/30 shadow-md shadow-sky-500/15 animate-pulse-subtle'
        : 'bg-emerald-500/20 border-emerald-400/60 hover:bg-emerald-500/30 shadow-md shadow-emerald-500/15 animate-pulse-subtle';
      textColor = type === 'desk' ? 'text-sky-200' : 'text-emerald-200';
      subTextColor = 'text-white/50';
    } else {
      variantClasses = type === 'desk'
        ? 'bg-sky-500/5 border-sky-500/15 hover:bg-sky-500/12'
        : 'bg-emerald-500/5 border-emerald-500/15 hover:bg-emerald-500/12';
      textColor = type === 'desk' ? 'text-sky-400/70' : 'text-emerald-400/70';
      subTextColor = 'text-white/15';
    }
  } else {
    // SVJETLA TEMA – pojačan kontrast
    if (occupied) {
      variantClasses = 'bg-red-100 border-red-400 hover:bg-red-200';
      textColor = 'text-red-800';
      subTextColor = 'text-red-700';
    } else if (flightReady) {
      variantClasses = type === 'desk'
        ? 'bg-sky-200 border-sky-500 hover:bg-sky-300 shadow-md shadow-sky-300/50 animate-pulse-subtle'
        : 'bg-emerald-200 border-emerald-500 hover:bg-emerald-300 shadow-md shadow-emerald-300/50 animate-pulse-subtle';
      textColor = type === 'desk' ? 'text-sky-900' : 'text-emerald-900';
      subTextColor = 'text-gray-700';
    } else {
      variantClasses = type === 'desk'
        ? 'bg-sky-50 border-sky-200 hover:bg-sky-100'
        : 'bg-emerald-50 border-emerald-200 hover:bg-emerald-100';
      textColor = type === 'desk' ? 'text-sky-700' : 'text-emerald-700';
      subTextColor = 'text-gray-500';
    }
  }

  return (
    <div
      onDragOver={onDragOver}
      onDrop={onDrop}
      onClick={onClick}
      className={`relative rounded-xl border text-center cursor-pointer transition-all duration-200 touch-manipulation select-none ${variantClasses}`}
      style={{ padding: '12px 6px' }}
    >
      {flightReady && !occupied && (
        <div className={`absolute inset-0 rounded-xl opacity-30 animate-ping ${type === 'desk' ? 'bg-sky-400' : 'bg-emerald-400'}`} style={{ animationDuration: '2s' }} />
      )}
      <div className={`relative text-lg font-black leading-none ${textColor}`}>
        {id}
      </div>
      <div className={`relative text-[9px] mt-1 font-mono truncate leading-tight ${subTextColor}`}>
        {occupied ? occupied.flightNumber : flightReady ? 'tapni' : '·'}
      </div>
      {occupied && (
        <div className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-red-500 ring-1 ring-gray-200 dark:ring-slate-950" />
      )}
    </div>
  );
};

interface FlightRowProps {
  flight:     Flight;
  assigned:   boolean;
  selected:   boolean;
  onDragStart:(e: React.DragEvent) => void;
  onClick:    () => void;
  isDark:     boolean;
}

const FlightRow: React.FC<FlightRowProps> = ({
  flight, assigned, selected, onDragStart, onClick, isDark,
}) => {
  let containerClasses = 'cursor-pointer rounded-xl border transition-all duration-150 select-none relative overflow-hidden ';
  let flightNumberColor = '';
  let timeColor = '';
  let destColor = '';
  let airlineColor = '';

  if (isDark) {
    if (selected) {
      containerClasses += 'ring-2 ring-amber-400 bg-amber-500/15 border-amber-400/60 shadow-lg shadow-amber-500/20';
      flightNumberColor = 'text-amber-200';
      timeColor = 'text-amber-400/70';
      destColor = 'text-amber-300/80';
      airlineColor = 'text-amber-400/50';
    } else if (assigned) {
      containerClasses += 'bg-white/3 border-white/8 opacity-50';
      flightNumberColor = 'text-white';
      timeColor = 'text-white/35';
      destColor = 'text-white/65';
      airlineColor = 'text-white/25';
    } else {
      containerClasses += 'bg-white/5 border-white/10 hover:bg-white/10 hover:border-white/25 active:scale-98';
      flightNumberColor = 'text-white';
      timeColor = 'text-white/35';
      destColor = 'text-white/65';
      airlineColor = 'text-white/25';
    }
  } else {
    // SVJETLA TEMA – visok kontrast
    if (selected) {
      containerClasses += 'ring-2 ring-amber-500 bg-amber-50 border-amber-400 shadow-md';
      flightNumberColor = 'text-amber-900';
      timeColor = 'text-amber-700';
      destColor = 'text-amber-800';
      airlineColor = 'text-amber-700/70';
    } else if (assigned) {
      containerClasses += 'bg-gray-100 border-gray-300 opacity-80';
      flightNumberColor = 'text-gray-700';
      timeColor = 'text-gray-500';
      destColor = 'text-gray-600';
      airlineColor = 'text-gray-500';
    } else {
      containerClasses += 'bg-white border-gray-200 hover:bg-gray-100 hover:border-gray-300 active:scale-98';
      flightNumberColor = 'text-gray-900';
      timeColor = 'text-gray-500';
      destColor = 'text-gray-700';
      airlineColor = 'text-gray-500';
    }
  }

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onClick={onClick}
      className={containerClasses}
      style={{ padding: '11px 13px' }}
    >
      {selected && <div className="absolute left-0 top-0 bottom-0 w-1 bg-amber-400 rounded-l-xl" />}
      <div className="flex items-center justify-between gap-2">
        <span className={`font-mono font-bold text-sm tracking-tight ${flightNumberColor}`}>
          {flight.FlightNumber}
        </span>
        <div className={`flex items-center gap-1 ${timeColor}`}>
          <Clock size={10} />
          <span className="text-[11px] font-mono">{flight.ScheduledDepartureTime}</span>
        </div>
      </div>
      <div className={`text-[12px] truncate mt-0.5 ${destColor}`}>
        {flight.DestinationCityName || flight.DestinationAirportCode}
      </div>
      <div className="flex items-center justify-between mt-1.5">
        <span className={`text-[10px] truncate ${airlineColor}`}>
          {flight.AirlineName}
        </span>
        {selected && (
          <span className="text-[10px] font-bold text-amber-800 bg-amber-200 px-2 py-0.5 rounded-full flex-shrink-0">
            ✓ ODABRAN — tapni šalter/GATE
          </span>
        )}
        {!selected && assigned && (
          <span className={`text-[9px] font-medium flex-shrink-0 ${isDark ? 'text-white/25' : 'text-gray-500'}`}>
            dodijeljen
          </span>
        )}
      </div>
    </div>
  );
};

interface AssignmentCardProps {
  a:        Assignment;
  type:     'desk' | 'gate';
  onRemove: () => void;
  isDark:   boolean;
}

const AssignmentCard: React.FC<AssignmentCardProps> = ({ a, type, onRemove, isDark }) => (
  <div className={`
    flex justify-between items-center rounded-lg border p-3
    ${type === 'desk'
      ? isDark ? 'bg-sky-500/5 border-sky-500/15' : 'bg-sky-100 border-sky-300'
      : isDark ? 'bg-emerald-500/5 border-emerald-500/15' : 'bg-emerald-100 border-emerald-300'
    }
  `}>
    <div className="min-w-0">
      <div className={`text-xs font-bold tracking-wider mb-0.5 ${
        type === 'desk' 
          ? (isDark ? 'text-sky-400' : 'text-sky-800')
          : (isDark ? 'text-emerald-400' : 'text-emerald-800')
      }`}>
        {type === 'desk' ? 'ŠALTER' : 'GATE'} {a.resourceId}
      </div>
      <div className={`font-mono font-bold text-sm ${isDark ? 'text-white' : 'text-gray-900'}`}>
        {a.flightNumber}
      </div>
      <div className={`text-[11px] truncate ${isDark ? 'text-white/40' : 'text-gray-600'}`}>
        {a.destinationCity} · {a.scheduledTime}
      </div>
    </div>
    <button
      onClick={onRemove}
      className="ml-3 p-1.5 rounded-md text-gray-400 hover:text-red-500 hover:bg-red-100 dark:hover:bg-red-500/10 transition-colors flex-shrink-0"
    >
      <Trash2 size={14} />
    </button>
  </div>
);

// ─────────────────────────────────────────────
// GLAVNA KOMPONENTA
// ─────────────────────────────────────────────

export default function AssignPanel() {
  const router = useRouter();

  const [activeTab,             setActiveTab]             = useState<TabType>('checkin');
  const [flights,               setFlights]               = useState<Flight[]>([]);
  const [loadingFlights,        setLoadingFlights]        = useState(true);
  const [lastUpdate,            setLastUpdate]            = useState('');
  const [checkinAssignments,    setCheckinAssignments]    = useState<Assignment[]>([]);
  const [gateAssignments,       setGateAssignments]       = useState<Assignment[]>([]);
  const [refreshing,            setRefreshing]            = useState(false);
  const [draggedFlight,         setDraggedFlight]         = useState<string | null>(null);
  const [selectedFlightForTouch,setSelectedFlightForTouch]= useState<Flight | null>(null);
  const [tickSec,               setTickSec]               = useState(REFRESH_INTERVAL_MS / 1000);
  
  const [isDark, setIsDark] = useState(true);

  useEffect(() => {
    const stored = localStorage.getItem('theme');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const shouldBeDark = stored === 'dark' || (stored === null && prefersDark);
    setIsDark(shouldBeDark);
    if (shouldBeDark) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, []);

  const toggleTheme = () => {
    const newDark = !isDark;
    setIsDark(newDark);
    if (newDark) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('theme', 'light');
    }
  };

  const flightsRef = useRef<Flight[]>([]);
  useEffect(() => { flightsRef.current = flights; }, [flights]);

  // ── API pozivi (isti kao ranije) ───────────────────────────────────────────
  const fetchFlightsData = useCallback(async (): Promise<Flight[]> => {
    const res  = await fetch('/api/flights?nocache=' + Date.now());
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
            resourceId:      deskNumber,
            flightNumber:    parsed.flightNumber as string,
            airlineName:     flight?.AirlineName || '',
            destinationCity: flight?.DestinationCityName || '',
            scheduledTime:   flight?.ScheduledDepartureTime || '',
            assignedAt:      parsed.setAt ? new Date(parsed.setAt as string).toLocaleTimeString() : 'unknown',
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
            resourceId:      gateNumber,
            flightNumber:    parsed.flightNumber as string,
            airlineName:     flight?.AirlineName || '',
            destinationCity: flight?.DestinationCityName || '',
            scheduledTime:   flight?.ScheduledDepartureTime || '',
            assignedAt:      parsed.setAt ? new Date(parsed.setAt as string).toLocaleTimeString() : 'unknown',
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

  useEffect(() => {
    const ticker = setInterval(() => {
      setTickSec(prev => (prev <= 1 ? REFRESH_INTERVAL_MS / 1000 : prev - 1));
    }, 1000);
    const interval = setInterval(async () => {
      setTickSec(REFRESH_INTERVAL_MS / 1000);
      try {
        const sorted = await fetchFlightsData();
        setFlights(sorted);
        setLastUpdate(new Date().toLocaleTimeString('sr-Latn-RS'));
        await refreshAll(sorted);
      } catch (err) { console.error('Silent refresh error:', err); }
    }, REFRESH_INTERVAL_MS);
    return () => {
      clearInterval(ticker);
      clearInterval(interval);
    };
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

  const onDragStart = (flightNumber: string) => (e: React.DragEvent) => {
    setDraggedFlight(flightNumber);
    e.dataTransfer.setData('text/plain', flightNumber);
    e.dataTransfer.effectAllowed = 'copy';
  };

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  };

  const assignFlightToResource = useCallback(async (
    flight: Flight,
    resourceId: string,
    resourceType: 'desk' | 'gate'
  ): Promise<boolean> => {
    const existing = resourceType === 'desk'
      ? checkinAssignments.find(a => a.resourceId === resourceId)
      : gateAssignments.find(a => a.resourceId === resourceId);

    if (existing && !confirm(`${resourceType === 'desk' ? 'Šalter' : 'Gate'} ${resourceId} je već dodijeljen letu ${existing.flightNumber}. Zamijeniti?`)) 
      return false;

    const endpoint = resourceType === 'desk' ? `${API_PREFIX}/desk-status-override` : `${API_PREFIX}/gate-status-override`;
    const payload = resourceType === 'desk'
      ? { deskNumber: resourceId, action: 'open', flightNumber: flight.FlightNumber }
      : { gateNumber: resourceId, action: 'open', flightNumber: flight.FlightNumber };

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error();
      await refreshAll(flightsRef.current);
      return true;
    } catch {
      alert('Greška pri dodjeli');
      return false;
    }
  }, [checkinAssignments, gateAssignments, refreshAll]);

  const onDropCheckin = (deskNumber: string) => async (e: React.DragEvent) => {
    e.preventDefault();
    const fn = draggedFlight || e.dataTransfer.getData('text/plain');
    setDraggedFlight(null);
    const flight = flightsRef.current.find(f => f.FlightNumber === fn);
    if (flight) await assignFlightToResource(flight, deskNumber, 'desk');
  };

  const onDropGate = (gateNumber: string) => async (e: React.DragEvent) => {
    e.preventDefault();
    const fn = draggedFlight || e.dataTransfer.getData('text/plain');
    setDraggedFlight(null);
    const flight = flightsRef.current.find(f => f.FlightNumber === fn);
    if (flight) await assignFlightToResource(flight, gateNumber, 'gate');
  };

  const touchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleFlightTouchSelect = (flight: Flight) => {
    setSelectedFlightForTouch(flight);
    if (touchTimeoutRef.current) clearTimeout(touchTimeoutRef.current);
    touchTimeoutRef.current = setTimeout(() => setSelectedFlightForTouch(null), 8000);
  };

  const handleResourceTouchAssign = async (resourceId: string, resourceType: 'desk' | 'gate') => {
    if (!selectedFlightForTouch) {
      alert('Prvo tapnite let koji želite dodijeliti.');
      return;
    }
    await assignFlightToResource(selectedFlightForTouch, resourceId, resourceType);
    setSelectedFlightForTouch(null);
    if (touchTimeoutRef.current) clearTimeout(touchTimeoutRef.current);
  };

  const handleRemoveCheckin = async (deskNumber: string, flightNumber: string) => {
    if (!confirm(`Ukloniti ${flightNumber} sa šaltera ${deskNumber}?`)) return;
    try {
      await fetch(`${API_PREFIX}/desk-status-override`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deskNumber, action: 'clear' }),
      });
      await fetchCheckinAssignments(flightsRef.current);
    } catch { alert('Greška pri brisanju'); }
  };

  const handleRemoveGate = async (gateNumber: string, flightNumber: string) => {
    if (!confirm(`Ukloniti ${flightNumber} sa gate-a ${gateNumber}?`)) return;
    try {
      await fetch(`${API_PREFIX}/gate-status-override`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gateNumber, action: 'clear' }),
      });
      await fetchGateAssignments(flightsRef.current);
    } catch { alert('Greška pri brisanju'); }
  };

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
          <div className="w-10 h-10 border-2 border-sky-500 border-t-transparent rounded-full animate-spin mx-auto" />
          <div className={`text-sm tracking-widest uppercase ${isDark ? 'text-white/50' : 'text-gray-500'}`}>Učitavanje</div>
        </div>
      </div>
    );
  }

  const flightList = (tab: TabType) => (
    <div className="space-y-1.5 max-h-[62vh] overflow-y-auto pr-0.5 scrollbar-thin">
      {flights.length === 0 && (
        <div className={`text-center py-8 text-sm ${isDark ? 'text-white/20' : 'text-gray-400'}`}>
          <Plane size={28} className="mx-auto mb-2 opacity-30" />
          Nema aktivnih letova
        </div>
      )}
      {flights.map(flight => (
        <FlightRow
          key={flight.FlightNumber + flight.ScheduledDepartureTime}
          flight={flight}
          assigned={isFlightAssigned(flight.FlightNumber, tab)}
          selected={selectedFlightForTouch?.FlightNumber === flight.FlightNumber}
          onDragStart={onDragStart(flight.FlightNumber)}
          onClick={() => handleFlightTouchSelect(flight)}
          isDark={isDark}
        />
      ))}
    </div>
  );

  const touchBanner = () => (
    <div className="mb-4">
      <div className={`rounded-xl border p-4 transition-all duration-300 ${selectedFlightForTouch
        ? isDark ? 'bg-amber-500/10 border-amber-400/50 shadow-lg shadow-amber-500/10' : 'bg-amber-50 border-amber-400 shadow-md'
        : isDark ? 'bg-slate-900 border-white/10' : 'bg-gray-100 border-gray-300'
      }`}>
        <div className="flex items-stretch gap-3">
          {/* Korak 1 */}
          <div className={`flex-1 rounded-lg p-3 border-2 transition-all duration-200 text-center ${!selectedFlightForTouch
            ? isDark ? 'border-sky-400 bg-sky-500/15 shadow-md shadow-sky-500/20' : 'border-sky-500 bg-sky-50 shadow-md'
            : isDark ? 'border-white/10 bg-white/3 opacity-40' : 'border-gray-300 bg-gray-200 opacity-60'
          }`}>
            <div className={`w-7 h-7 rounded-full flex items-center justify-center text-sm font-black mx-auto mb-2 ${!selectedFlightForTouch
              ? isDark ? 'bg-sky-400 text-slate-900' : 'bg-sky-600 text-white'
              : isDark ? 'bg-white/10 text-white/30' : 'bg-gray-300 text-gray-500'
            }`}>1</div>
            <div className={`text-xs font-bold mb-1 ${!selectedFlightForTouch ? (isDark ? 'text-sky-300' : 'text-sky-800') : (isDark ? 'text-white/30' : 'text-gray-500')}`}>
              Odaberi let
            </div>
            <div className={`text-[10px] leading-tight ${!selectedFlightForTouch ? (isDark ? 'text-sky-400/80' : 'text-sky-700') : (isDark ? 'text-white/20' : 'text-gray-400')}`}>
              Tapni let iz liste lijevo
            </div>
          </div>
          {/* Strelica */}
          <div className="flex items-center flex-shrink-0 self-center">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path d="M4 10h12M12 6l4 4-4 4" stroke={selectedFlightForTouch ? '#f59e0b' : (isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.3)')} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          {/* Korak 2 */}
          <div className={`flex-1 rounded-lg p-3 border-2 transition-all duration-200 text-center ${selectedFlightForTouch
            ? isDark ? 'border-amber-400 bg-amber-500/15 shadow-md shadow-amber-500/20' : 'border-amber-500 bg-amber-50 shadow-md'
            : isDark ? 'border-white/10 bg-white/3 opacity-40' : 'border-gray-300 bg-gray-200 opacity-60'
          }`}>
            <div className={`w-7 h-7 rounded-full flex items-center justify-center text-sm font-black mx-auto mb-2 ${selectedFlightForTouch
              ? isDark ? 'bg-amber-400 text-slate-900' : 'bg-amber-600 text-white'
              : isDark ? 'bg-white/10 text-white/30' : 'bg-gray-300 text-gray-500'
            }`}>2</div>
            <div className={`text-xs font-bold mb-1 ${selectedFlightForTouch ? (isDark ? 'text-amber-300' : 'text-amber-800') : (isDark ? 'text-white/30' : 'text-gray-500')}`}>
              Tapni šalter / gate
            </div>
            <div className={`text-[10px] leading-tight ${selectedFlightForTouch ? (isDark ? 'text-amber-400/80' : 'text-amber-700') : (isDark ? 'text-white/20' : 'text-gray-400')}`}>
              {selectedFlightForTouch ? `"${selectedFlightForTouch.FlightNumber}" spreman` : 'Čeka se odabir leta'}
            </div>
          </div>
        </div>
        {selectedFlightForTouch && (
          <div className="mt-3 flex items-center justify-between bg-amber-500/20 border border-amber-400/40 rounded-lg px-3 py-2">
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-2 h-2 rounded-full bg-amber-400 animate-pulse flex-shrink-0" />
              <span className={`font-mono font-bold text-sm flex-shrink-0 ${isDark ? 'text-amber-200' : 'text-amber-800'}`}>
                {selectedFlightForTouch.FlightNumber}
              </span>
              <span className={`text-xs truncate ${isDark ? 'text-amber-400/70' : 'text-amber-700'}`}>
                {selectedFlightForTouch.DestinationCityName || selectedFlightForTouch.DestinationAirportCode}
                {selectedFlightForTouch.ScheduledDepartureTime && ` · ${selectedFlightForTouch.ScheduledDepartureTime}`}
              </span>
            </div>
            <button onClick={() => { setSelectedFlightForTouch(null); if (touchTimeoutRef.current) clearTimeout(touchTimeoutRef.current); }}
              className="flex items-center gap-1 text-[10px] text-amber-400/60 hover:text-amber-300 transition-colors px-2 py-1 rounded hover:bg-amber-500/10 flex-shrink-0 ml-2">
              <X size={11} /> Odustani
            </button>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div className={`min-h-screen p-4 overflow-y-auto ${isDark ? 'bg-slate-950 text-white' : 'bg-white text-gray-900'}`}>
      <div className="max-w-7xl mx-auto">

        {/* Header */}
        <div className="flex items-start justify-between gap-4 mb-6">
          <div>
            <h1 className="text-xl font-bold tracking-tight">TIV · Check-in & Gate</h1>
            <div className="flex items-center gap-3 mt-1">
              <span className={`text-xs ${isDark ? 'text-white/30' : 'text-gray-500'}`}>Letovi: {flights.length}</span>
              <span className={`text-xs ${isDark ? 'text-white/15' : 'text-gray-300'}`}>·</span>
              <span className={`text-xs ${isDark ? 'text-white/30' : 'text-gray-500'}`}>Ažurirano: {lastUpdate || '—'}</span>
              <span className={`text-xs ${isDark ? 'text-white/15' : 'text-gray-300'}`}>·</span>
              <span className={`text-xs tabular-nums ${isDark ? 'text-white/25' : 'text-gray-500'}`}>Refresh za {tickSec}s</span>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button onClick={handleRefresh} disabled={refreshing}
              className={`p-2 rounded-lg border transition-colors disabled:opacity-40 ${isDark ? 'bg-white/5 hover:bg-white/10 border-white/8' : 'bg-gray-100 hover:bg-gray-200 border-gray-300'}`}>
              <RefreshCw size={15} className={`${isDark ? 'text-white/60' : 'text-gray-600'} ${refreshing ? 'animate-spin' : ''}`} />
            </button>
            <button onClick={() => router.push('/admin')}
              className={`p-2 rounded-lg border transition-colors ${isDark ? 'bg-white/5 hover:bg-white/10 border-white/8' : 'bg-gray-100 hover:bg-gray-200 border-gray-300'}`}>
              <Home size={15} className={isDark ? 'text-white/60' : 'text-gray-600'} />
            </button>
            <button onClick={toggleTheme}
              className={`p-2 rounded-lg border transition-colors ${isDark ? 'bg-white/5 hover:bg-white/10 border-white/8' : 'bg-gray-100 hover:bg-gray-200 border-gray-300'}`}>
              {isDark ? <Sun size={15} className="text-yellow-400" /> : <Moon size={15} className="text-slate-700" />}
            </button>
            <button onClick={handleLogout}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-red-400 text-xs transition-colors">
              <LogOut size={13} /> Odjava
            </button>
          </div>
        </div>

        {/* Tabovi */}
        <div className="flex gap-2 mb-5">
          {[
            { id: 'checkin' as TabType, label: 'Check-in', icon: CheckSquare, count: checkinAssignments.length, activeClass: isDark ? 'bg-sky-500/15 border-sky-500/40 text-sky-300' : 'bg-sky-100 border-sky-400 text-sky-800 shadow-sm' },
            { id: 'gate' as TabType, label: 'Gate-ovi', icon: GitBranch, count: gateAssignments.length, activeClass: isDark ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300' : 'bg-emerald-100 border-emerald-400 text-emerald-800 shadow-sm' },
          ].map(tab => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg border text-sm font-medium transition-all duration-150 ${isActive
                  ? tab.activeClass
                  : isDark ? 'bg-white/3 border-white/8 text-white/40 hover:bg-white/8 hover:text-white/60' : 'bg-gray-100 border-gray-300 text-gray-500 hover:bg-gray-200 hover:text-gray-700'
                }`}>
                <Icon size={14} /> {tab.label}
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${isActive ? (isDark ? 'bg-white/20' : 'bg-white/80 text-gray-800') : (isDark ? 'bg-white/8 text-white/30' : 'bg-gray-200 text-gray-500')}`}>
                  {tab.count}
                </span>
              </button>
            );
          })}
        </div>

        {activeTab === 'checkin' && (
          <>
            {touchBanner()}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <div className={`rounded-xl border p-3 ${isDark ? 'bg-white/3 border-white/8' : 'bg-gray-50 border-gray-300 shadow-sm'}`}>
                <div className={`text-[10px] font-bold tracking-widest uppercase mb-3 px-1 ${isDark ? 'text-white/30' : 'text-gray-500'}`}>
                  Letovi ({flights.length})
                </div>
                {flightList('checkin')}
              </div>
              <div className="lg:col-span-2 space-y-4">
                <div className={`rounded-xl border p-4 ${isDark ? 'bg-white/3 border-white/8' : 'bg-gray-50 border-gray-300 shadow-sm'}`}>
                  <div className={`text-[10px] font-bold tracking-widest uppercase mb-4 ${isDark ? 'text-white/30' : 'text-gray-500'}`}>Šalteri</div>
                  <div className="mb-5">
                    <Divider label="Terminal 1" isDark={isDark} />
                    <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-6 xl:grid-cols-8 gap-2">
                      {DESKS.filter(d => parseInt(d) <= 12).map(desk => (
                        <ResourceCell key={desk} id={desk} type="desk"
                          occupied={checkinAssignments.find(a => a.resourceId === desk)}
                          flightReady={!!selectedFlightForTouch && !checkinAssignments.find(a => a.resourceId === desk)}
                          onDragOver={onDragOver} onDrop={onDropCheckin(desk)}
                          onClick={() => handleResourceTouchAssign(desk, 'desk')} isDark={isDark} />
                      ))}
                    </div>
                  </div>
                  <div>
                    <Divider label="Terminal 2" isDark={isDark} />
                    <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
                      {DESKS.filter(d => parseInt(d) >= 21).map(desk => (
                        <ResourceCell key={desk} id={desk} type="desk"
                          occupied={checkinAssignments.find(a => a.resourceId === desk)}
                          flightReady={!!selectedFlightForTouch && !checkinAssignments.find(a => a.resourceId === desk)}
                          onDragOver={onDragOver} onDrop={onDropCheckin(desk)}
                          onClick={() => handleResourceTouchAssign(desk, 'desk')} isDark={isDark} />
                      ))}
                    </div>
                  </div>
                </div>
                <div className={`rounded-xl border p-4 ${isDark ? 'bg-white/3 border-white/8' : 'bg-gray-50 border-gray-300 shadow-sm'}`}>
                  <div className={`text-[10px] font-bold tracking-widest uppercase mb-3 ${isDark ? 'text-white/30' : 'text-gray-500'}`}>
                    Aktivne dodjele ({checkinAssignments.length})
                  </div>
                  {checkinAssignments.length === 0
                    ? <div className={`text-sm text-center py-4 ${isDark ? 'text-white/20' : 'text-gray-400'}`}>Nema dodjela</div>
                    : <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {checkinAssignments.map(a => <AssignmentCard key={a.resourceId} a={a} type="desk" onRemove={() => handleRemoveCheckin(a.resourceId, a.flightNumber)} isDark={isDark} />)}
                      </div>
                  }
                </div>
              </div>
            </div>
          </>
        )}

        {activeTab === 'gate' && (
          <>
            {touchBanner()}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <div className={`rounded-xl border p-3 ${isDark ? 'bg-white/3 border-white/8' : 'bg-gray-50 border-gray-300 shadow-sm'}`}>
                <div className={`text-[10px] font-bold tracking-widest uppercase mb-3 px-1 ${isDark ? 'text-white/30' : 'text-gray-500'}`}>
                  Letovi ({flights.length})
                </div>
                {flightList('gate')}
              </div>
              <div className="lg:col-span-2 space-y-4">
                <div className={`rounded-xl border p-4 ${isDark ? 'bg-white/3 border-white/8' : 'bg-gray-50 border-gray-300 shadow-sm'}`}>
                  <div className={`text-[10px] font-bold tracking-widest uppercase mb-4 ${isDark ? 'text-white/30' : 'text-gray-500'}`}>Gate-ovi</div>
                  <div className="mb-5">
                    <Divider label="Terminal 1" isDark={isDark} />
                    <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
                      {GATES.filter(g => parseInt(g) >= 2 && parseInt(g) <= 6).map(gate => (
                        <ResourceCell key={gate} id={gate} type="gate"
                          occupied={gateAssignments.find(a => a.resourceId === gate)}
                          flightReady={!!selectedFlightForTouch && !gateAssignments.find(a => a.resourceId === gate)}
                          onDragOver={onDragOver} onDrop={onDropGate(gate)}
                          onClick={() => handleResourceTouchAssign(gate, 'gate')} isDark={isDark} />
                      ))}
                    </div>
                  </div>
                  <div>
                    <Divider label="Terminal 2" isDark={isDark} />
                    <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
                      {GATES.filter(g => parseInt(g) >= 21 && parseInt(g) <= 28).map(gate => (
                        <ResourceCell key={gate} id={gate} type="gate"
                          occupied={gateAssignments.find(a => a.resourceId === gate)}
                          flightReady={!!selectedFlightForTouch && !gateAssignments.find(a => a.resourceId === gate)}
                          onDragOver={onDragOver} onDrop={onDropGate(gate)}
                          onClick={() => handleResourceTouchAssign(gate, 'gate')} isDark={isDark} />
                      ))}
                    </div>
                  </div>
                </div>
                <div className={`rounded-xl border p-4 ${isDark ? 'bg-white/3 border-white/8' : 'bg-gray-50 border-gray-300 shadow-sm'}`}>
                  <div className={`text-[10px] font-bold tracking-widest uppercase mb-3 ${isDark ? 'text-white/30' : 'text-gray-500'}`}>
                    Aktivne dodjele ({gateAssignments.length})
                  </div>
                  {gateAssignments.length === 0
                    ? <div className={`text-sm text-center py-4 ${isDark ? 'text-white/20' : 'text-gray-400'}`}>Nema dodjela</div>
                    : <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {gateAssignments.map(a => <AssignmentCard key={a.resourceId} a={a} type="gate" onRemove={() => handleRemoveGate(a.resourceId, a.flightNumber)} isDark={isDark} />)}
                      </div>
                  }
                </div>
              </div>
            </div>
          </>
        )}
      </div>
      <style jsx global>{`
        html, body, #__next { overflow: auto !important; height: auto !important; min-height: 100vh; }
        .touch-manipulation { touch-action: manipulation; }
        .scrollbar-thin::-webkit-scrollbar { width: 3px; }
        .scrollbar-thin::-webkit-scrollbar-track { background: transparent; }
        .scrollbar-thin::-webkit-scrollbar-thumb { background: ${isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.2)'}; border-radius: 2px; }
        @keyframes pulse-subtle { 0%, 100% { opacity: 1; } 50% { opacity: 0.75; } }
        .animate-pulse-subtle { animation: pulse-subtle 1.8s ease-in-out infinite; }
        .active\\:scale-98:active { transform: scale(0.98); }
      `}</style>
    </div>
  );
}