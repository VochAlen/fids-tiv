'use client';

import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Plane, CheckSquare, ArrowUpRight, ArrowDownRight, Clock, MapPin,
  CheckCircle, XCircle, AlertCircle, RefreshCw, Calendar, Search,
  ChevronDown, LogOut, Home, Save, Trash2, AlertTriangle, Shield, Lock,
  ChevronRight, BarChart2, TrendingUp, TrendingDown, Users, Layers,
  FileDown, Activity, Percent
} from 'lucide-react';
import type { Flight } from '@/types/flight';
import { invalidateBusinessClassCache } from '@/lib/business-class-service';

// ============================================================
// KONSTANTE
// ============================================================
const AUTO_REFRESH_INTERVAL = 30_000;
const CONFIRM_THRESHOLD_MS = 500;
const DEVELOPMENT = process.env.NODE_ENV === 'development';

// ============================================================
// HELPER FUNKCIJE
// ============================================================
const formatTime = (timeString: string): string => {
  if (!timeString || !timeString.includes(':')) return '--:--';
  const [hours, minutes] = timeString.split(':').map(Number);
  if (isNaN(hours) || isNaN(minutes)) return '--:--';
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
};

const getStatusColor = (status: string): string => {
  if (!status) return 'text-gray-400';
  const s = status.toLowerCase();
  if (s.includes('cancelled') || s.includes('otkazan')) return 'text-red-500';
  if (s.includes('delay') || s.includes('kasni')) return 'text-yellow-500';
  if (s.includes('board') || s.includes('ukrcaj')) return 'text-blue-500';
  if (s.includes('departed') || s.includes('poletio')) return 'text-purple-500';
  if (s.includes('diverted') || s.includes('preusmjeren')) return 'text-orange-500';
  return 'text-gray-400';
};

const getStatusIcon = (status: string) => {
  if (!status) return <Clock className="w-4 h-4 text-gray-400" />;
  const s = status.toLowerCase();
  if (s.includes('cancelled') || s.includes('otkazan')) return <XCircle className="w-4 h-4 text-red-500" />;
  if (s.includes('delay') || s.includes('kasni')) return <AlertCircle className="w-4 h-4 text-yellow-500" />;
  if (s.includes('board') || s.includes('ukrcaj')) return <Plane className="w-4 h-4 text-blue-500" />;
  return <Clock className="w-4 h-4 text-gray-400" />;
};

// ============================================================
// STATS HELPER FUNKCIJE
// ============================================================
const parseMinutes = (timeStr: string): number => {
  if (!timeStr || !timeStr.includes(':')) return -1;
  const [h, m] = timeStr.split(':').map(Number);
  if (isNaN(h) || isNaN(m)) return -1;
  return h * 60 + m;
};

const getDelayMinutes = (scheduled: string, actual: string): number | null => {
  const s = parseMinutes(scheduled);
  const a = parseMinutes(actual);
  if (s < 0 || a < 0) return null;
  return a - s;
};

// ============================================================
// TOAST KOMPONENTA
// ============================================================
const Toast = ({ message, type, onClose }: { message: string; type: 'success' | 'error' | 'warning'; onClose: () => void }) => {
  useEffect(() => {
    const timer = setTimeout(onClose, 3000);
    return () => clearTimeout(timer);
  }, [onClose]);
  const colors = { success: 'bg-green-500', error: 'bg-red-500', warning: 'bg-yellow-500' };
  return (
    <div className={`fixed bottom-4 right-4 z-50 ${colors[type]} text-white px-4 py-2 rounded-lg shadow-lg animate-pulse`}>
      {message}
    </div>
  );
};

// ============================================================
// CONFIRM DIALOG
// ============================================================
const ConfirmDialog = ({ open, title, message, onConfirm, onCancel }: { open: boolean; title: string; message: string; onConfirm: () => void; onCancel: () => void }) => {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={onCancel}>
      <div className="bg-slate-900 rounded-xl p-6 max-w-md w-full border border-white/20" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-3 mb-4">
          <AlertTriangle className="w-6 h-6 text-yellow-500" />
          <h3 className="text-lg font-bold text-white">{title}</h3>
        </div>
        <p className="text-sm text-white/70 mb-6">{message}</p>
        <div className="flex gap-3">
          <button onClick={onCancel} className="flex-1 py-2 rounded-lg text-sm font-medium bg-white/10 hover:bg-white/20 text-white transition">Odustani</button>
          <button onClick={onConfirm} className="flex-1 py-2 rounded-lg text-sm font-bold bg-red-500 hover:bg-red-600 text-white transition">Potvrdi</button>
        </div>
      </div>
    </div>
  );
};

// ============================================================
// OVERRIDE CONTROL
// ============================================================
const OverrideControl = ({ label, currentValue, fieldName, flightNumber, onOverride }: any) => {
  const [value, setValue] = useState(currentValue || '');
  const [loading, setLoading] = useState(false);
  const hasOverride = !!currentValue;

  const handleAction = async (action: 'assign' | 'clear') => {
    setLoading(true);
    try {
      await onOverride(flightNumber, fieldName, action, action === 'assign' ? value : undefined);
      if (action === 'clear') setValue('');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={`p-2 rounded-lg ${fieldName === 'CheckInDesk' && hasOverride ? 'bg-purple-500/10 border border-purple-500/30' : ''}`}>
      <div className="flex justify-between items-center mb-1">
        <span className="text-xs text-white/50">{label} {hasOverride && <span className="text-orange-300">(Override)</span>}</span>
        {hasOverride && <button onClick={() => handleAction('clear')} className="text-[10px] text-red-400 hover:text-red-300">✕ Ukloni</button>}
      </div>
      <div className="text-xs text-white/50 mb-1">Trenutno: {currentValue || <span className="text-white/30">Nije postavljeno</span>}</div>
      <div className="flex gap-2">
        <input type="text" value={value} onChange={e => setValue(e.target.value)} placeholder="npr. 1,2,3" className="flex-1 px-2 py-1.5 text-sm bg-white/10 border border-white/20 rounded text-white" disabled={loading} />
        <button onClick={() => handleAction('assign')} disabled={loading} className="px-3 py-1.5 text-sm bg-blue-600/30 hover:bg-blue-600/50 text-blue-300 rounded transition"><Save className="w-3.5 h-3.5" /></button>
        <button onClick={() => handleAction('clear')} disabled={loading || !currentValue} className="px-3 py-1.5 text-sm bg-red-600/30 hover:bg-red-600/50 text-red-300 rounded transition"><Trash2 className="w-3.5 h-3.5" /></button>
      </div>
    </div>
  );
};

// ============================================================
// STATUS CONTROL
// ============================================================
const StatusControl = ({ currentStatus, flightNumber, onOverride }: any) => {
  const [loading, setLoading] = useState(false);
  const statuses = [
    { value: 'On Time', label: 'Na vrijeme', color: 'green' },
    { value: 'Delayed', label: 'Kasni', color: 'yellow' },
    { value: 'Boarding', label: 'Ukrcaj', color: 'blue' },
    { value: 'Departed', label: 'Poletio', color: 'purple' },
    { value: 'Cancelled', label: 'Otkazan', color: 'red' },
    { value: 'Diverted', label: 'Preusmjeren', color: 'orange' },
  ];
  const isActive = (val: string) => currentStatus?.toLowerCase() === val.toLowerCase();
  return (
    <div>
      <div className="text-xs text-white/50 mb-1">Status leta</div>
      <div className="text-sm text-white mb-2">Trenutno: {currentStatus || <span className="text-white/30">N/A</span>}</div>
      <div className="flex flex-wrap gap-2">
        {statuses.map(s => (
          <button key={s.value} onClick={async () => {
            setLoading(true);
            try { await onOverride(flightNumber, 'StatusEN', 'assign', s.value); } finally { setLoading(false); }
          }} disabled={loading || isActive(s.value)} className={`px-3 py-1 text-xs font-medium rounded-lg border transition ${isActive(s.value) ? `bg-${s.color}-600/40 border-${s.color}-500 text-${s.color}-300` : 'bg-white/5 border-white/10 text-white/70 hover:bg-white/10'}`}>
            {s.label}
          </button>
        ))}
      </div>
    </div>
  );
};

// ============================================================
// DESK MANUAL CONTROL
// ============================================================
const DeskManualControl = ({ deskNumbers, flightNumber }: { deskNumbers?: string; flightNumber?: string }) => {
  const [deskStates, setDeskStates] = useState<Record<string, { status: string; flightNumber: string | null }>>({});
  const [loadingDesk, setLoadingDesk] = useState<Record<string, boolean>>({});
  const desks = deskNumbers?.split(',').map(d => d.trim()).filter(Boolean) || [];

  useEffect(() => {
    if (!deskNumbers) return;
    const desks = deskNumbers.split(',').map(d => d.trim()).filter(Boolean);
    if (!desks.length) return;
    desks.forEach(async (desk) => {
      try {
        const res = await fetch(`/api/desk-status/${desk}`);
        if (!res.ok) return;
        const data = await res.json();
        if (data.status) {
          setDeskStates(prev => ({ ...prev, [desk]: { status: data.status, flightNumber: data.flightNumber ?? null } }));
        }
      } catch {}
    });
  }, [deskNumbers]);

  const handleSetStatus = async (desk: string, status: 'open' | 'closed' | null, targetFlight: string | null = null) => {
    setLoadingDesk(prev => ({ ...prev, [desk]: true }));
    try {
      const res = await fetch(`/api/desk-status/${desk}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, flightNumber: targetFlight }),
      });
      if (!res.ok) { alert('Greška pri postavljanju statusa'); return; }
      if (status === null) {
        setDeskStates(prev => { const n = { ...prev }; delete n[desk]; return n; });
      } else {
        setDeskStates(prev => ({ ...prev, [desk]: { status, flightNumber: targetFlight } }));
      }
    } catch {
      alert('Greška pri postavljanju statusa');
    } finally {
      setLoadingDesk(prev => ({ ...prev, [desk]: false }));
    }
  };

  if (!desks.length) return null;

  return (
    <div className="mt-2 space-y-2">
      <div className="text-xs text-white/50 mb-1">🖥️ Manual Desk Control</div>
      {desks.map((desk) => {
        const state = deskStates[desk];
        const isOpen = state?.status === 'open';
        const isClosed = state?.status === 'closed';
        const isEarly = isOpen && !!state?.flightNumber;
        const isBusy = !!loadingDesk[desk];
        return (
          <div key={desk} className="rounded-lg bg-white/5 border border-white/10 overflow-hidden">
            <div className="flex items-center gap-2 px-3 py-2">
              <span className="text-xs font-bold text-white/70 w-8 flex-shrink-0">Š{desk}</span>
              {!state ? (
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/10 text-white/40">AUTO</span>
              ) : isEarly ? (
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-purple-500/30 text-purple-200 border border-purple-500/40 font-bold">⚡ OPEN · {state.flightNumber}</span>
              ) : isOpen ? (
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-green-500/20 text-green-300 border border-green-500/30 font-bold">✓ OPEN</span>
              ) : (
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-red-500/20 text-red-300 border border-red-500/30 font-bold">✕ CLOSED</span>
              )}
              {state && (
                <button onClick={() => handleSetStatus(desk, null)} disabled={isBusy} className="ml-auto text-[10px] text-white/40 hover:text-white px-2 py-0.5 rounded bg-white/5 hover:bg-white/10 transition disabled:opacity-40">Reset Auto</button>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5 px-3 pb-3">
              <button onClick={() => handleSetStatus(desk, 'open', flightNumber ?? null)} disabled={isBusy || (isEarly && state?.flightNumber === flightNumber)} title={flightNumber ? `Otvori šalter za let ${flightNumber} odmah (early-open)` : 'Otvori šalter'} className="px-2.5 py-1.5 text-[10px] font-bold rounded-lg transition disabled:opacity-40 bg-green-600/20 hover:bg-green-600/40 text-green-300 border border-green-600/30">
                ✓ FORCE OPEN{flightNumber ? ` (${flightNumber})` : ''}
              </button>
              <button onClick={() => handleSetStatus(desk, 'closed', null)} disabled={isBusy || isClosed} title="Zatvori šalter" className="px-2.5 py-1.5 text-[10px] font-bold rounded-lg transition disabled:opacity-40 bg-red-600/20 hover:bg-red-600/40 text-red-300 border border-red-600/30">
                ✕ FORCE CLOSE
              </button>
            </div>
            {isEarly && (
              <div className="mx-3 mb-3 px-2 py-1.5 rounded-lg bg-purple-500/10 border border-purple-500/20 text-[10px] text-purple-200">
                ⚡ Let <strong>{state.flightNumber}</strong> prikazan odmah na ovom šalteru. Klikni <strong>Reset Auto</strong> za povratak na automatiku.
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

// ============================================================
// OVERRIDE BADGE KOMPONENTA
// ============================================================
const OverrideBadge = ({ fieldName }: { fieldName: string }) => {
  const config: Record<string, { label: string; color: string; icon: JSX.Element }> = {
    CheckInDesk: { label: 'Check-in', color: 'bg-purple-500/20 text-purple-300 border-purple-500/30', icon: <CheckSquare className="w-2.5 h-2.5" /> },
    GateNumber: { label: 'Gate', color: 'bg-blue-500/20 text-blue-300 border-blue-500/30', icon: <MapPin className="w-2.5 h-2.5" /> },
    StatusEN: { label: 'Status', color: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30', icon: <AlertCircle className="w-2.5 h-2.5" /> },
    Terminal: { label: 'Terminal', color: 'bg-green-500/20 text-green-300 border-green-500/30', icon: <Home className="w-2.5 h-2.5" /> },
    BaggageReclaim: { label: 'Baggage', color: 'bg-orange-500/20 text-orange-300 border-orange-500/30', icon: <MapPin className="w-2.5 h-2.5" /> },
  };
  const cfg = config[fieldName];
  if (!cfg) return null;
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-medium border ${cfg.color}`}>
      {cfg.icon}{cfg.label}
    </span>
  );
};

// ============================================================
// FLIGHT CARD
// ============================================================
const FlightCard = ({ flight, onOverride, onClearAll }: any) => {
  const [expanded, setExpanded] = useState(false);
  const isDeparture = flight.FlightType === 'departure';
  const hasOverride = flight._hasOverride;
  const overrideFields = flight._overrideFields || {};

  return (
    <div className={`bg-white/5 border rounded-xl p-4 cursor-pointer transition ${expanded ? 'bg-white/10' : ''} ${hasOverride ? 'border-orange-500/50 ring-1 ring-orange-500/30' : 'border-white/10'}`} onClick={() => setExpanded(!expanded)}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className={`p-2 rounded-lg ${isDeparture ? 'bg-blue-500/20' : 'bg-green-500/20'}`}>
            {isDeparture ? <ArrowUpRight className="w-5 h-5 text-blue-400" /> : <ArrowDownRight className="w-5 h-5 text-green-400" />}
          </div>
          <div>
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-xl font-bold text-white">{flight.FlightNumber}</span>
              {hasOverride && (
                <div className="flex flex-wrap gap-1">
                  <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-orange-500/20 text-orange-300 border border-orange-500/30 flex items-center gap-1">
                    <AlertTriangle className="w-2.5 h-2.5" />Override Active
                  </span>
                  {Object.keys(overrideFields).map(field => <OverrideBadge key={field} fieldName={field} />)}
                </div>
              )}
              <span className="text-sm text-white/60">{flight.AirlineName}</span>
            </div>
            <div className="text-sm text-white/80">{isDeparture ? flight.DestinationCityName : 'Tivat (TIV)'}</div>
          </div>
        </div>
        <div className="flex items-center gap-6">
          <div className="text-right">
            <div className="text-lg font-semibold text-white">{formatTime(flight.ScheduledDepartureTime)}</div>
            {flight.EstimatedDepartureTime && <div className="text-sm text-yellow-400">Est: {formatTime(flight.EstimatedDepartureTime)}</div>}
          </div>
          <div className="flex items-center gap-2">{getStatusIcon(flight.StatusEN)}<span className={`text-sm font-medium ${getStatusColor(flight.StatusEN)}`}>{flight.StatusEN || 'Unknown'}</span></div>
          <ChevronDown className={`w-5 h-5 text-white/40 transition-transform ${expanded ? 'rotate-180' : ''}`} />
        </div>
      </div>
      {expanded && (
        <div className="mt-4 pt-4 border-t border-white/10" onClick={e => e.stopPropagation()}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-3">
              <div className="text-sm"><span className="text-white/50">Terminal:</span> {flight.Terminal || '--'}</div>
              <div className="text-sm"><span className="text-white/50">Gate:</span> {flight.GateNumber || '--'}</div>
              {flight.CodeShareFlights?.length > 0 && <div className="text-sm"><span className="text-white/50">Code-share:</span> {flight.CodeShareFlights.join(', ')}</div>}
            </div>
            {isDeparture && (
              <div className="space-y-4 bg-white/5 rounded-xl p-4">
                <StatusControl currentStatus={flight.StatusEN} flightNumber={flight.FlightNumber} onOverride={onOverride} />
                <OverrideControl label="Check-In Desk" currentValue={flight.CheckInDesk} fieldName="CheckInDesk" flightNumber={flight.FlightNumber} onOverride={onOverride} />
                <OverrideControl label="Gate" currentValue={flight.GateNumber} fieldName="GateNumber" flightNumber={flight.FlightNumber} onOverride={onOverride} />
                <DeskManualControl deskNumbers={flight.CheckInDesk} flightNumber={flight.FlightNumber} />
                {hasOverride && (
                  <button onClick={() => onClearAll(flight.FlightNumber)} className="w-full mt-2 px-3 py-2 text-sm bg-red-600/30 hover:bg-red-600/50 text-red-300 rounded-lg transition">
                    <Trash2 className="w-4 h-4 inline mr-2" />Ukloni sve override-ove
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

// ============================================================
// DEPARTED FLIGHTS SECTION
// ============================================================
const DepartedSection = ({ flights, onOverride, onClearAll }: { flights: any[]; onOverride: any; onClearAll: any }) => {
  const [open, setOpen] = useState(false);
  if (!flights.length) return null;
  return (
    <div className="mb-4">
      <button onClick={() => setOpen(o => !o)} className="w-full flex items-center justify-between px-4 py-3 rounded-xl bg-purple-500/10 border border-purple-500/20 hover:bg-purple-500/15 transition group">
        <div className="flex items-center gap-3">
          <Plane className="w-4 h-4 text-purple-400" />
          <span className="text-sm font-semibold text-purple-300">Odletjeli letovi</span>
          <span className="px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-300 text-xs font-bold border border-purple-500/30">{flights.length}</span>
        </div>
        <ChevronDown className={`w-4 h-4 text-purple-400 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="mt-2 space-y-2">
          {flights.map(flight => (
            <div key={`dep-${flight.FlightNumber}-${flight.ScheduledDepartureTime}`} className="opacity-70">
              <FlightCard flight={flight} onOverride={onOverride} onClearAll={onClearAll} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// ============================================================
// STATS UI HELPERS
// ============================================================
const MiniBar = ({ value, max, color }: { value: number; max: number; color: string }) => {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className="h-1.5 rounded-full bg-white/10 overflow-hidden flex-1">
      <div className={`h-full rounded-full ${color} transition-all duration-500`} style={{ width: `${pct}%` }} />
    </div>
  );
};

const StatRow = ({ label, value, total, color, icon }: { label: string; value: number; total: number; color: string; icon: React.ReactNode }) => {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <div className="flex items-center gap-2 py-1">
      <div className="w-4 flex-shrink-0">{icon}</div>
      <span className="text-xs text-white/60 w-28 flex-shrink-0 leading-tight">{label}</span>
      <MiniBar value={value} max={total} color={color} />
      <span className="text-xs font-bold text-white w-8 text-right flex-shrink-0">{pct}%</span>
      <span className="text-[10px] text-white/40 w-5 text-right flex-shrink-0">({value})</span>
    </div>
  );
};

const CounterRow = ({ label, count, total, color }: { label: string; count: number; total: number; color: string }) => {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  return (
    <div className="flex items-center gap-2 py-0.5">
      <span className="text-xs text-white/70 font-mono w-16 flex-shrink-0 truncate">{label}</span>
      <MiniBar value={count} max={total} color={color} />
      <span className="text-xs font-bold text-white w-8 text-right flex-shrink-0">{pct}%</span>
      <span className="text-[10px] text-white/40 w-5 text-right flex-shrink-0">({count})</span>
    </div>
  );
};

// ============================================================
// COMPUTE STATS HOOK
// ============================================================
const useFlightStats = (departures: any[], arrivals: any[]) => {
  return useMemo(() => {
    const calcOnTime = (list: any[]) => {
      let onTime = 0, early = 0, d15 = 0, d30 = 0, d60p = 0, total = 0;
      let delaySum = 0, delayCount = 0;
      list.forEach(f => {
        const sched = f.ScheduledDepartureTime || f.ScheduledArrivalTime;
        const actual = f.ActualDepartureTime || f.ActualArrivalTime || f.EstimatedDepartureTime || f.EstimatedArrivalTime;
        if (!sched) return;
        total++;
        if (!actual) { onTime++; return; }
        const delay = getDelayMinutes(sched, actual);
        if (delay === null) { onTime++; return; }
        if (delay > 0) { delaySum += delay; delayCount++; }
        if (delay < -5) early++;
        else if (delay <= 15) onTime++;
        else if (delay <= 30) d15++;
        else if (delay <= 60) d30++;
        else d60p++;
      });
      const avgDelay = delayCount > 0 ? Math.round(delaySum / delayCount) : 0;
      return { onTime, early, d15, d30, d60p, total, avgDelay };
    };

    // Check-in counter stats
    const deskMap: Record<string, number> = {};
    let totalDeskAssigned = 0;
    departures.forEach(f => {
      if (!f.CheckInDesk) return;
      f.CheckInDesk.split(',').map((d: string) => d.trim()).filter(Boolean).forEach((d: string) => {
        deskMap[d] = (deskMap[d] || 0) + 1;
        totalDeskAssigned++;
      });
    });
    const topDesks = Object.entries(deskMap).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([desk, count]) => ({ desk, count }));

    // Gate stats
    const gateMap: Record<string, number> = {};
    let totalGateAssigned = 0;
    departures.forEach(f => {
      if (!f.GateNumber) return;
      const g = String(f.GateNumber).trim();
      if (!g) return;
      gateMap[g] = (gateMap[g] || 0) + 1;
      totalGateAssigned++;
    });
    const topGates = Object.entries(gateMap).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([gate, count]) => ({ gate, count }));

    // Airline breakdown (departures)
    const airlineDepMap: Record<string, number> = {};
    departures.forEach(f => { if (f.AirlineName) airlineDepMap[f.AirlineName] = (airlineDepMap[f.AirlineName] || 0) + 1; });
    const topAirlinesDep = Object.entries(airlineDepMap).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([name, count]) => ({ name, count }));

    // Airline breakdown (arrivals)
    const airlineArrMap: Record<string, number> = {};
    arrivals.forEach(f => { if (f.AirlineName) airlineArrMap[f.AirlineName] = (airlineArrMap[f.AirlineName] || 0) + 1; });
    const topAirlinesArr = Object.entries(airlineArrMap).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([name, count]) => ({ name, count }));

    // Cancelled / Diverted
    const cancelledDep = departures.filter(f => (f.StatusEN || '').toLowerCase().includes('cancel')).length;
    const cancelledArr = arrivals.filter(f => (f.StatusEN || '').toLowerCase().includes('cancel')).length;
    const divertedArr = arrivals.filter(f => (f.StatusEN || '').toLowerCase().includes('divert')).length;

    // Peak hours (departures)
    const hourMap: Record<number, number> = {};
    departures.forEach(f => {
      const t = f.ScheduledDepartureTime;
      if (!t || !t.includes(':')) return;
      const h = parseInt(t.split(':')[0]);
      if (!isNaN(h)) hourMap[h] = (hourMap[h] || 0) + 1;
    });
    const maxHourCount = Math.max(...Object.values(hourMap), 1);
    const hours = Array.from({ length: 16 }, (_, i) => i + 6).map(h => ({ h, count: hourMap[h] || 0 }));

    // Peak hours (arrivals)
    const hourMapArr: Record<number, number> = {};
    arrivals.forEach(f => {
      const t = f.ScheduledDepartureTime || f.ScheduledArrivalTime;
      if (!t || !t.includes(':')) return;
      const h = parseInt(t.split(':')[0]);
      if (!isNaN(h)) hourMapArr[h] = (hourMapArr[h] || 0) + 1;
    });
    const maxHourCountArr = Math.max(...Object.values(hourMapArr), 1);
    const hoursArr = Array.from({ length: 16 }, (_, i) => i + 6).map(h => ({ h, count: hourMapArr[h] || 0 }));

    // Destination breakdown (departures)
    const destMap: Record<string, number> = {};
    departures.forEach(f => { if (f.DestinationCityName) destMap[f.DestinationCityName] = (destMap[f.DestinationCityName] || 0) + 1; });
    const topDestinations = Object.entries(destMap).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([city, count]) => ({ city, count }));

    const depOnTime = calcOnTime(departures);
    const arrOnTime = calcOnTime(arrivals);

    return {
      depOnTime, arrOnTime,
      topDesks, totalDeskAssigned,
      topGates, totalGateAssigned,
      topAirlinesDep, topAirlinesArr,
      cancelledDep, cancelledArr, divertedArr,
      hours, maxHourCount,
      hoursArr, maxHourCountArr,
      topDestinations,
      totalDep: departures.length,
      totalArr: arrivals.length,
    };
  }, [departures, arrivals]);
};

// ============================================================
// PDF EXPORT FUNCTION (pure client-side, no SSR issues)
// ============================================================
// ============================================================
// PDF EXPORT FUNCTION (pure client-side, no SSR issues)
// ============================================================
const exportStatsPDF = async (stats: ReturnType<typeof useFlightStats>, date: string) => {
  // Ova sintaksa radi sa jspdf 4.2.1
  const jspdfModule = await import('jspdf');
  const { jsPDF } = jspdfModule;
  
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  const W = 210;
  const MARGIN = 14;
  const COL = W - MARGIN * 2;
  let y = 0;

  // Helpers
  const hex = (h: string) => {
    const r = parseInt(h.slice(1, 3), 16);
    const g = parseInt(h.slice(3, 5), 16);
    const b = parseInt(h.slice(5, 7), 16);
    return [r, g, b] as [number, number, number];
  };
  const setColor = (h: string) => doc.setTextColor(...hex(h));
  const setFill = (h: string) => doc.setFillColor(...hex(h));
  const setDraw = (h: string) => doc.setDrawColor(...hex(h));
  
  // Helper za crni tekst (koristićemo ga za sav tekst osim headera)
  const setBlackText = () => doc.setTextColor(0, 0, 0);

  // ── HEADER BLOCK ── (ostaje originalno - svetle boje na tamnoj pozadini)
  setFill('#0f172a');
  doc.rect(0, 0, W, 38, 'F');

  // Airport name top-left
  setColor('#94a3b8');
  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.text('TIVAT AIRPORT — TIV', MARGIN, 10);

  // Main title
  setColor('#ffffff');
  doc.setFontSize(17);
  doc.setFont('helvetica', 'bold');
  doc.text('Terminal Building Statistics', MARGIN, 20);

  // Subtitle / date
  setColor('#cbd5e1');
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.text(`Date: ${date}`, MARGIN, 27.5);
  doc.text(`Generated: ${new Date().toLocaleTimeString('bs-BA', { hour: '2-digit', minute: '2-digit' })}`, MARGIN, 33);

  // Plane icon area (right side of header)
  setColor('#3b82f6');
  doc.setFontSize(22);
  doc.text('✈', W - MARGIN - 8, 22);

  y = 45;

  // ── SUMMARY KPI ROW ──
  const kpis = [
    { label: 'Departures', value: String(stats.totalDep), color: '#3b82f6' },
    { label: 'Arrivals', value: String(stats.totalArr), color: '#22c55e' },
    { label: 'Cancelled', value: String(stats.cancelledDep + stats.cancelledArr), color: '#ef4444' },
    { label: 'Diverted', value: String(stats.divertedArr), color: '#f97316' },
  ];
  const kpiW = COL / 4;
  kpis.forEach((k, i) => {
    const x = MARGIN + i * kpiW;
    setFill('#1e293b');
    doc.roundedRect(x, y, kpiW - 2, 18, 2, 2, 'F');
    setColor(k.color);
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text(k.value, x + kpiW / 2 - 1, y + 9, { align: 'center' });
    // Label ispod broja - OSTAVLJAMO svetlo sivu (dobro je)
    setColor('#94a3b8');
    doc.setFontSize(7);
    doc.setFont('helvetica', 'normal');
    doc.text(k.label, x + kpiW / 2 - 1, y + 14.5, { align: 'center' });
  });
  y += 24;

  // ── SECTION helper ──
  const sectionTitle = (title: string) => {
    setFill('#1e293b');
    doc.rect(MARGIN, y, COL, 7, 'F');
    // Tekst sekcije - PLAVA (ostaje)
    setColor('#60a5fa');
    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    doc.text(title.toUpperCase(), MARGIN + 3, y + 4.8);
    y += 10;
  };

  // Bar row helper (label | bar | pct | count) - SVE BOJE TEKSTA SU CRNE
  const barRow = (label: string, value: number, maxVal: number, total: number, barColor: string) => {
    const pct = total > 0 ? Math.round((value / total) * 100) : 0;
    const barMaxW = 65;
    const barW = maxVal > 0 ? (value / maxVal) * barMaxW : 0;

    setBlackText(); // CRNI TEKST
    doc.setFontSize(7.5);
    doc.setFont('helvetica', 'normal');
    doc.text(label, MARGIN + 2, y + 3.2);

    // Bar background
    setFill('#334155');
    doc.roundedRect(MARGIN + 46, y, barMaxW, 4, 1, 1, 'F');

    // Bar fill
    if (barW > 0.5) {
      setFill(barColor);
      doc.roundedRect(MARGIN + 46, y, barW, 4, 1, 1, 'F');
    }

    // pct - CRNI TEKST
    setBlackText();
    doc.setFontSize(7.5);
    doc.setFont('helvetica', 'bold');
    doc.text(`${pct}%`, MARGIN + 115, y + 3.2);

    // count - CRNI TEKST
    setBlackText();
    doc.setFont('helvetica', 'normal');
    doc.text(`(${value})`, MARGIN + 126, y + 3.2);

    y += 6.5;
  };

  // ── ON-TIME PERFORMANCE (Departures) ──
  sectionTitle('On-Time Performance — Departures');
  const d = stats.depOnTime;
  barRow('On time (±15 min)', d.onTime, d.total, d.total, '#22c55e');
  barRow('Early (>5 min)', d.early, d.total, d.total, '#14b8a6');
  barRow('Delayed 15–30 min', d.d15, d.total, d.total, '#eab308');
  barRow('Delayed 30–60 min', d.d30, d.total, d.total, '#f97316');
  barRow('Delayed >60 min', d.d60p, d.total, d.total, '#ef4444');
  if (d.avgDelay > 0) {
    setBlackText(); // CRNI TEKST
    doc.setFontSize(7);
    doc.text(`Average delay (delayed flights only): ${d.avgDelay} min`, MARGIN + 2, y);
    y += 5;
  }
  y += 2;

  // ── ON-TIME PERFORMANCE (Arrivals) ──
  sectionTitle('On-Time Performance — Arrivals');
  const a = stats.arrOnTime;
  barRow('On time (±15 min)', a.onTime, a.total, a.total, '#22c55e');
  barRow('Early (>5 min)', a.early, a.total, a.total, '#14b8a6');
  barRow('Delayed 15–30 min', a.d15, a.total, a.total, '#eab308');
  barRow('Delayed 30–60 min', a.d30, a.total, a.total, '#f97316');
  barRow('Delayed >60 min', a.d60p, a.total, a.total, '#ef4444');
  if (a.avgDelay > 0) {
    setBlackText(); // CRNI TEKST
    doc.setFontSize(7);
    doc.text(`Average delay (delayed flights only): ${a.avgDelay} min`, MARGIN + 2, y);
    y += 5;
  }
  y += 2;

  // ── CHECK PAGE BREAK ──
  const checkPage = () => { if (y > 250) { doc.addPage(); y = 14; } };

  checkPage();

  // ── CHECK-IN COUNTERS ──
  if (stats.topDesks.length > 0) {
    sectionTitle('Check-In Counter Load');
    const maxDeskCount = stats.topDesks[0]?.count || 1;
    stats.topDesks.forEach(({ desk, count }) => barRow(`Counter ${desk}`, count, maxDeskCount, maxDeskCount, '#a855f7'));
    y += 2;
  }

  checkPage();

  // ── GATE UTILIZATION ──
  if (stats.topGates.length > 0) {
    sectionTitle('Gate Utilization');
    const maxGateCount = stats.topGates[0]?.count || 1;
    stats.topGates.forEach(({ gate, count }) => barRow(`Gate ${gate}`, count, maxGateCount, maxGateCount, '#3b82f6'));
    y += 2;
  }

  checkPage();

  // ── PEAK HOURS (side by side) ──
  sectionTitle('Peak Traffic Hours');

  // Heatmap grid for departures
  setBlackText(); // CRNI TEKST
  doc.setFontSize(7);
  doc.setFont('helvetica', 'bold');
  doc.text('DEPARTURES', MARGIN, y + 3);
  y += 5;

  const cellW = COL / 16;
  stats.hours.forEach(({ h, count }) => {
    const x = MARGIN + (h - 6) * cellW;
    const pct = stats.maxHourCount > 0 ? count / stats.maxHourCount : 0;
    const fillHex = pct === 0 ? '#1e293b' : pct < 0.35 ? '#1d4ed8' : pct < 0.65 ? '#2563eb' : pct < 0.85 ? '#f97316' : '#dc2626';
    setFill(fillHex);
    doc.roundedRect(x, y, cellW - 0.5, 7, 0.8, 0.8, 'F');
    // Tekst u heatmap - ostaje kako jeste (beli na tamnoj pozadini)
    setColor(pct === 0 ? '#475569' : '#ffffff');
    doc.setFontSize(5.5);
    doc.setFont('helvetica', count > 0 ? 'bold' : 'normal');
    doc.text(`${h}`, x + cellW / 2 - 0.25, y + 3, { align: 'center' });
    if (count > 0) doc.text(`${count}`, x + cellW / 2 - 0.25, y + 6, { align: 'center' });
  });
  y += 10;

  setBlackText(); // CRNI TEKST
  doc.setFontSize(7);
  doc.setFont('helvetica', 'bold');
  doc.text('ARRIVALS', MARGIN, y + 3);
  y += 5;

  stats.hoursArr.forEach(({ h, count }) => {
    const x = MARGIN + (h - 6) * cellW;
    const pct = stats.maxHourCountArr > 0 ? count / stats.maxHourCountArr : 0;
    const fillHex = pct === 0 ? '#1e293b' : pct < 0.35 ? '#14532d' : pct < 0.65 ? '#16a34a' : pct < 0.85 ? '#f97316' : '#dc2626';
    setFill(fillHex);
    doc.roundedRect(x, y, cellW - 0.5, 7, 0.8, 0.8, 'F');
    setColor(pct === 0 ? '#475569' : '#ffffff');
    doc.setFontSize(5.5);
    doc.setFont('helvetica', count > 0 ? 'bold' : 'normal');
    doc.text(`${h}`, x + cellW / 2 - 0.25, y + 3, { align: 'center' });
    if (count > 0) doc.text(`${count}`, x + cellW / 2 - 0.25, y + 6, { align: 'center' });
  });
  y += 12;

  checkPage();

  // ── TWO-COLUMN: AIRLINES + DESTINATIONS ──
  const colLeft = MARGIN;
  const colRight = MARGIN + COL / 2 + 2;
  const yBeforeCols = y;

  // Airlines departures
  setFill('#1e293b');
  doc.rect(colLeft, y, COL / 2 - 2, 7, 'F');
  setColor('#60a5fa');
  doc.setFontSize(8);
  doc.setFont('helvetica', 'bold');
  doc.text('AIRLINES (DEP)', colLeft + 3, y + 4.8);
  y += 10;

  const maxAirline = stats.topAirlinesDep[0]?.count || 1;
  stats.topAirlinesDep.forEach(({ name, count }) => {
    const shortName = name.length > 18 ? name.slice(0, 16) + '..' : name;
    const pct = Math.round((count / stats.totalDep) * 100);
    const bw = (count / maxAirline) * 42;
    setBlackText(); // CRNI TEKST
    doc.setFontSize(7);
    doc.setFont('helvetica', 'normal');
    doc.text(shortName, colLeft + 2, y + 3);
    setFill('#334155');
    doc.roundedRect(colLeft + 38, y, 42, 3.5, 0.7, 0.7, 'F');
    if (bw > 0.3) { setFill('#3b82f6'); doc.roundedRect(colLeft + 38, y, bw, 3.5, 0.7, 0.7, 'F'); }
    setBlackText(); // CRNI TEKST
    doc.setFontSize(6.5);
    doc.setFont('helvetica', 'bold');
    doc.text(`${pct}%`, colLeft + 82, y + 2.8);
    y += 5.5;
  });

  // Destinations (right column)
  let yR = yBeforeCols;
  setFill('#1e293b');
  doc.rect(colRight, yR, COL / 2 - 2, 7, 'F');
  setColor('#34d399');
  doc.setFontSize(8);
  doc.setFont('helvetica', 'bold');
  doc.text('TOP DESTINATIONS', colRight + 3, yR + 4.8);
  yR += 10;

  const maxDest = stats.topDestinations[0]?.count || 1;
  stats.topDestinations.forEach(({ city, count }) => {
    const shortCity = city.length > 17 ? city.slice(0, 15) + '..' : city;
    const pct = Math.round((count / stats.totalDep) * 100);
    const bw = (count / maxDest) * 42;
    setBlackText(); // CRNI TEKST
    doc.setFontSize(7);
    doc.setFont('helvetica', 'normal');
    doc.text(shortCity, colRight + 2, yR + 3);
    setFill('#334155');
    doc.roundedRect(colRight + 38, yR, 42, 3.5, 0.7, 0.7, 'F');
    if (bw > 0.3) { setFill('#22c55e'); doc.roundedRect(colRight + 38, yR, bw, 3.5, 0.7, 0.7, 'F'); }
    setBlackText(); // CRNI TEKST
    doc.setFontSize(6.5);
    doc.setFont('helvetica', 'bold');
    doc.text(`${pct}%`, colRight + 82, yR + 2.8);
    yR += 5.5;
  });

  y = Math.max(y, yR) + 4;

  // ── FOOTER ── (ostaje originalno)
   // ── FOOTER ──
  const pageCount = doc.getNumberOfPages();
  for (let p = 1; p <= pageCount; p++) {
    doc.setPage(p);
    setFill('#0f172a');
    doc.rect(0, 287, W, 10, 'F');
    
    // Leva strana: povjerljivo
    setColor('#475569');
    doc.setFontSize(6.5);
    doc.setFont('helvetica', 'normal');
    doc.text('Tivat Airport (TIV) — Terminal Building Statistics', MARGIN, 292.5);
    
    // Centralni dio: "Developed with ❤️ for Tivat Airport by Alen, 2026 :: alen.vocanec@apm.co.me"
    // Koristimo srcu emoji ❤️
    const footerCenterText = 'Developed by Alen, 2026 :: alen.vocanec@apm.co.me';
    doc.text(footerCenterText, W / 2, 292.5, { align: 'center' });
    
    // Desna strana: broj stranice u formatu "Page 1 of 3"
    doc.text(`Page ${p} of ${pageCount}`, W - MARGIN, 292.5, { align: 'right' });
  }

  doc.save(`TIV-Statistics-${date.replace(/\./g, '-')}.pdf`);

  doc.save(`TIV-Statistics-${date.replace(/\./g, '-')}.pdf`);
};

// ============================================================
// FLIGHT STATS PANEL
// ============================================================
const FlightStatsPanel = ({ departures, arrivals }: { departures: any[]; arrivals: any[] }) => {
  const [statsTab, setStatsTab] = useState<'dep' | 'arr'>('dep');
  const [exporting, setExporting] = useState(false);
  const stats = useFlightStats(departures, arrivals);

  const handleExport = async () => {
    setExporting(true);
    try {
      const today = new Date().toLocaleDateString('bs-BA', { day: '2-digit', month: '2-digit', year: 'numeric' });
      await exportStatsPDF(stats, today);
    } catch (e) {
      console.error('PDF export error:', e);
      alert('Greška pri generisanju PDF-a. Provjerite konzolu.');
    } finally {
      setExporting(false);
    }
  };

  const ot = statsTab === 'dep' ? stats.depOnTime : stats.arrOnTime;
  const label = statsTab === 'dep' ? 'Polaski' : 'Dolasci';

  return (
    <div className="bg-white/5 border border-white/10 rounded-2xl p-4 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <BarChart2 className="w-4 h-4 text-blue-400" />
          <span className="text-sm font-bold text-white">Statistika</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex gap-1 text-xs bg-white/5 rounded-lg p-0.5">
            <button onClick={() => setStatsTab('dep')} className={`px-2.5 py-1 rounded-md transition font-medium ${statsTab === 'dep' ? 'bg-blue-600 text-white' : 'text-white/50 hover:text-white'}`}>Polaski</button>
            <button onClick={() => setStatsTab('arr')} className={`px-2.5 py-1 rounded-md transition font-medium ${statsTab === 'arr' ? 'bg-green-600 text-white' : 'text-white/50 hover:text-white'}`}>Dolasci</button>
          </div>
          <button
            onClick={handleExport}
            disabled={exporting}
            title="Izvezi statistiku kao PDF"
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-blue-600/20 hover:bg-blue-600/40 text-blue-300 border border-blue-600/30 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {exporting
              ? <RefreshCw className="w-3 h-3 animate-spin" />
              : <FileDown className="w-3 h-3" />
            }
            {exporting ? 'Generišem...' : 'PDF'}
          </button>
        </div>
      </div>

      {/* KPI mini cards */}
      <div className="grid grid-cols-2 gap-2">
        {[
          { label: 'Polaski', val: stats.totalDep, color: 'text-blue-400', bg: 'bg-blue-500/10' },
          { label: 'Dolasci', val: stats.totalArr, color: 'text-green-400', bg: 'bg-green-500/10' },
          { label: 'Otkazani', val: stats.cancelledDep + stats.cancelledArr, color: 'text-red-400', bg: 'bg-red-500/10' },
          { label: 'Preusmjereni', val: stats.divertedArr, color: 'text-orange-400', bg: 'bg-orange-500/10' },
        ].map(k => (
          <div key={k.label} className={`${k.bg} rounded-xl p-2.5 text-center`}>
            <div className={`text-xl font-bold ${k.color}`}>{k.val}</div>
            <div className="text-[10px] text-white/40 mt-0.5">{k.label}</div>
          </div>
        ))}
      </div>

      {/* On-Time Performance */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <TrendingUp className="w-3.5 h-3.5 text-green-400" />
          <span className="text-xs font-semibold text-white/80">Tačnost {label}</span>
          <span className="ml-auto text-[10px] text-white/40">{ot.total} letova</span>
        </div>
        <div className="space-y-0.5">
          <StatRow label="Na vrijeme (±15 min)" value={ot.onTime} total={ot.total} color="bg-green-500" icon={<CheckCircle className="w-3 h-3 text-green-400" />} />
          <StatRow label="Ranije (>5 min)" value={ot.early} total={ot.total} color="bg-teal-500" icon={<TrendingDown className="w-3 h-3 text-teal-400" />} />
          <StatRow label="Kasni 15–30 min" value={ot.d15} total={ot.total} color="bg-yellow-500" icon={<AlertCircle className="w-3 h-3 text-yellow-400" />} />
          <StatRow label="Kasni 30–60 min" value={ot.d30} total={ot.total} color="bg-orange-500" icon={<AlertCircle className="w-3 h-3 text-orange-400" />} />
          <StatRow label="Kasni >60 min" value={ot.d60p} total={ot.total} color="bg-red-500" icon={<XCircle className="w-3 h-3 text-red-400" />} />
        </div>
        {ot.avgDelay > 0 && (
          <div className="mt-2 flex items-center gap-2 px-2 py-1.5 rounded-lg bg-white/5">
            <Activity className="w-3 h-3 text-yellow-400" />
            <span className="text-[11px] text-white/50">Prosj. kašnjenje:</span>
            <span className="text-[11px] font-bold text-yellow-300">{ot.avgDelay} min</span>
          </div>
        )}
      </div>

      <div className="border-t border-white/10" />

      {/* Peak Hours heatmap */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Clock className="w-3.5 h-3.5 text-blue-400" />
          <span className="text-xs font-semibold text-white/80">Vršna opterećenja (sati)</span>
        </div>
        {(() => {
          const hourData = statsTab === 'dep' ? stats.hours : stats.hoursArr;
          const maxC = statsTab === 'dep' ? stats.maxHourCount : stats.maxHourCountArr;
          return (
            <div className="grid grid-cols-8 gap-1">
              {hourData.map(({ h, count }) => {
                const pct = maxC > 0 ? count / maxC : 0;
                const bg = pct === 0 ? 'bg-white/5 text-white/20' : pct < 0.35 ? 'bg-blue-900/60 text-blue-300' : pct < 0.65 ? 'bg-blue-600/60 text-blue-200' : pct < 0.85 ? 'bg-orange-500/60 text-orange-200' : 'bg-red-500/70 text-red-100';
                return (
                  <div key={h} className={`rounded-md px-1 py-1.5 text-center ${bg} transition-all`} title={`${h}:00–${h + 1}:00 · ${count} letova`}>
                    <div className="text-[9px] font-mono leading-none mb-0.5">{h}</div>
                    <div className="text-[10px] font-bold leading-none">{count > 0 ? count : ''}</div>
                  </div>
                );
              })}
            </div>
          );
        })()}
        <div className="flex items-center gap-3 mt-2 text-[9px] text-white/30">
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-blue-900/60 inline-block" />Malo</span>
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-blue-600/60 inline-block" />Srednje</span>
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-orange-500/60 inline-block" />Visoko</span>
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-red-500/70 inline-block" />Vršno</span>
        </div>
      </div>

      {/* Check-in counters (dep tab only) */}
      {statsTab === 'dep' && stats.topDesks.length > 0 && (
        <>
          <div className="border-t border-white/10" />
          <div>
            <div className="flex items-center gap-2 mb-2">
              <CheckSquare className="w-3.5 h-3.5 text-purple-400" />
              <span className="text-xs font-semibold text-white/80">Najopterećeniji šalteri</span>
            </div>
            <div className="space-y-1">
              {stats.topDesks.map(({ desk, count }) => (
                <CounterRow key={desk} label={`Šalter ${desk}`} count={count} total={stats.topDesks[0].count} color="bg-purple-500" />
              ))}
            </div>
          </div>
        </>
      )}
      {statsTab === 'dep' && stats.topDesks.length === 0 && (
        <>
          <div className="border-t border-white/10" />
          <p className="text-xs text-white/30 italic">Check-in šalteri nisu dodijeljeni</p>
        </>
      )}

      {/* Gates */}
      {stats.topGates.length > 0 && (
        <>
          <div className="border-t border-white/10" />
          <div>
            <div className="flex items-center gap-2 mb-2">
              <MapPin className="w-3.5 h-3.5 text-blue-400" />
              <span className="text-xs font-semibold text-white/80">Najopterećeniji gejteri</span>
            </div>
            <div className="space-y-1">
              {stats.topGates.map(({ gate, count }) => (
                <CounterRow key={gate} label={`Gate ${gate}`} count={count} total={stats.topGates[0].count} color="bg-blue-500" />
              ))}
            </div>
          </div>
        </>
      )}

      {/* Airlines breakdown */}
      <div className="border-t border-white/10" />
      <div>
        <div className="flex items-center gap-2 mb-2">
          <Layers className="w-3.5 h-3.5 text-sky-400" />
          <span className="text-xs font-semibold text-white/80">Avio-kompanije {label.toLowerCase()}</span>
        </div>
        {(statsTab === 'dep' ? stats.topAirlinesDep : stats.topAirlinesArr).length > 0 ? (
          <div className="space-y-1">
            {(statsTab === 'dep' ? stats.topAirlinesDep : stats.topAirlinesArr).map(({ name, count }) => (
              <CounterRow key={name} label={name} count={count} total={statsTab === 'dep' ? stats.totalDep : stats.totalArr} color="bg-sky-500" />
            ))}
          </div>
        ) : (
          <p className="text-xs text-white/30 italic">Nema podataka</p>
        )}
      </div>

      {/* Top Destinations (dep only) */}
      {statsTab === 'dep' && stats.topDestinations.length > 0 && (
        <>
          <div className="border-t border-white/10" />
          <div>
            <div className="flex items-center gap-2 mb-2">
              <MapPin className="w-3.5 h-3.5 text-emerald-400" />
              <span className="text-xs font-semibold text-white/80">Top destinacije</span>
            </div>
            <div className="space-y-1">
              {stats.topDestinations.map(({ city, count }) => (
                <CounterRow key={city} label={city} count={count} total={stats.totalDep} color="bg-emerald-500" />
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
};

// ============================================================
// GLAVNA ADMIN KOMPONENTA
// ============================================================
export default function AdminFlightsPage() {
  const router = useRouter();

  // State
  const [flights, setFlights] = useState<{ departures: Flight[]; arrivals: Flight[] }>({ departures: [], arrivals: [] });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState('');
  const [activeTab, setActiveTab] = useState<'all' | 'departures' | 'arrivals'>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [airlineFilter, setAirlineFilter] = useState('all');
  const [error, setError] = useState<string | null>(null);

  // Sigurnost
  const [safetyMode, setSafetyMode] = useState(true);
  const [confirmDialog, setConfirmDialog] = useState<{ open: boolean; title: string; message: string; action: () => void }>({ open: false, title: '', message: '', action: () => {} });
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'warning' } | null>(null);
  const [countdown, setCountdown] = useState(AUTO_REFRESH_INTERVAL / 1000);
  const lastClickRef = useRef(0);

  // Utility
  const showToast = useCallback((message: string, type: 'success' | 'error' | 'warning') => {
    setToast({ message, type });
  }, []);

  const confirmAction = useCallback((title: string, message: string, action: () => void) => {
    if (safetyMode) setConfirmDialog({ open: true, title, message, action });
    else action();
  }, [safetyMode]);

  const withDebounce = useCallback((cb: () => void) => {
    if (Date.now() - lastClickRef.current > CONFIRM_THRESHOLD_MS) {
      lastClickRef.current = Date.now();
      cb();
    } else {
      showToast('Prebrzi klikovi! Sačekajte.', 'warning');
    }
  }, [showToast]);

  // Load overrides
  const loadOverrides = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/flight-override?action=getAllOverrides');
      return await res.json();
    } catch { return {}; }
  }, []);

  // Load flights
  const loadFlights = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setRefreshing(true);
    setError(null);
    try {
      const [flightsRes, overrides] = await Promise.all([
        fetch(`/api/flights?nocache=${Date.now()}`, { cache: 'no-store' }),
        loadOverrides()
      ]);
      if (!flightsRes.ok) throw new Error('Failed to fetch');
      const data = await flightsRes.json();
      const mapOverrides = (list: Flight[]) => list.map(f => ({
        ...f,
        _hasOverride: !!overrides[f.FlightNumber] && Object.keys(overrides[f.FlightNumber] || {}).length > 0,
        _overrideFields: overrides[f.FlightNumber] || {}
      }));
      setFlights({ departures: mapOverrides(data.departures || []), arrivals: mapOverrides(data.arrivals || []) });
      setLastUpdated(data.lastUpdated || new Date().toISOString());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Greška');
      showToast('Greška pri učitavanju podataka!', 'error');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [loadOverrides]);

  // Override handler
  const handleOverride = useCallback(async (flightNumber: string, field: string, action: string, value?: string) => {
    withDebounce(async () => {
      try {
        const res = await fetch('/api/admin/flight-override', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ flightNumber, field, action, value })
        });
        if (!res.ok) throw new Error((await res.json()).message);
        invalidateBusinessClassCache();
        await loadFlights(true);
        showToast(`Uspješno: ${field} → ${value || 'uklonjeno'}`, 'success');
      } catch (err) {
        showToast(err instanceof Error ? err.message : 'Greška', 'error');
      }
    });
  }, [loadFlights]);

  // Clear all overrides for a flight
  const handleClearAllOverrides = useCallback(async (flightNumber: string) => {
    confirmAction('Uklanjanje override-a', `Ukloniti sve override-ove za let ${flightNumber}?`, async () => {
      try {
        const res = await fetch('/api/admin/flight-override?action=getAllOverrides');
        const overrides = await res.json();
        const fields = Object.keys(overrides[flightNumber] || {});
        await Promise.all(fields.map(field =>
          fetch('/api/admin/flight-override', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ flightNumber, field, action: 'clear' }) })
        ));
        await loadFlights(true);
        showToast(`Svi override-ovi za let ${flightNumber} su uklonjeni`, 'success');
      } catch { showToast('Greška pri uklanjanju', 'error'); }
    });
  }, [loadFlights, safetyMode]);

  // Clear all flights overrides
  const handleClearAllFlightsOverrides = useCallback(async () => {
    confirmAction('Brisanje SVIH override-a', 'Ovo će ukloniti sve override-ove za sve letove! Ova akcija se ne može poništiti.', async () => {
      try {
        const res = await fetch('/api/admin/flight-override?action=getAllOverrides');
        const overrides = await res.json();
        const promises = Object.entries(overrides).flatMap(([fn, fields]) =>
          Object.keys(fields as object).map(field =>
            fetch('/api/admin/flight-override', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ flightNumber: fn, field, action: 'clear' }) })
          )
        );
        await Promise.all(promises);
        await loadFlights(true);
        showToast('Svi override-ovi su obrisani!', 'success');
      } catch { showToast('Greška pri brisanju', 'error'); }
    });
  }, [loadFlights, safetyMode]);

  // Auto-refresh timers
  useEffect(() => {
    const interval = setInterval(() => { if (!refreshing) loadFlights(true); }, AUTO_REFRESH_INTERVAL);
    return () => clearInterval(interval);
  }, [loadFlights, refreshing]);

  useEffect(() => {
    const interval = setInterval(() => setCountdown(prev => prev <= 1 ? AUTO_REFRESH_INTERVAL / 1000 : prev - 1), 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => { loadFlights(); }, [loadFlights]);

  // Display helpers
  const allFlights = useMemo(() =>
    activeTab === 'all' ? [...flights.departures, ...flights.arrivals]
    : activeTab === 'departures' ? flights.departures
    : flights.arrivals,
  [flights, activeTab]);

  const { departedFlights, activeFlights } = useMemo(() => {
    const isDeparted = (f: any) => {
      const s = (f.StatusEN || '').toLowerCase();
      return s.includes('departed') || s.includes('poletio');
    };
    return { departedFlights: allFlights.filter(isDeparted), activeFlights: allFlights.filter(f => !isDeparted(f)) };
  }, [allFlights]);

  const filteredFlights = useMemo(() => {
    let result = activeFlights;
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      result = result.filter(f => f.FlightNumber?.toLowerCase().includes(term) || f.AirlineName?.toLowerCase().includes(term) || f.DestinationCityName?.toLowerCase().includes(term));
    }
    if (airlineFilter !== 'all') result = result.filter(f => f.AirlineName === airlineFilter);
    return result.sort((a, b) => (a.ScheduledDepartureTime || '').localeCompare(b.ScheduledDepartureTime || ''));
  }, [activeFlights, searchTerm, airlineFilter]);

  const uniqueAirlines = useMemo(() => [...new Set(allFlights.map(f => f.AirlineName).filter(Boolean))].sort(), [allFlights]);
  const overrideCount = useMemo(() => allFlights.filter(f => (f as any)._hasOverride).length, [allFlights]);

  const getTimeSinceUpdate = useCallback(() => {
    if (!lastUpdated) return 'Nepoznato';
    const mins = Math.floor((Date.now() - new Date(lastUpdated).getTime()) / 60000);
    if (mins < 1) return 'upravo sada';
    if (mins < 60) return `prije ${mins} min`;
    return `prije ${Math.floor(mins / 60)}h`;
  }, [lastUpdated]);

  return (
    <>
      <style jsx global>{`
        html, body, #__next {
          overflow-y: auto !important;
          height: auto !important;
          min-height: 100vh !important;
        }
      `}</style>

      <div className="w-full min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 p-4 md:p-8">
        {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
        <ConfirmDialog open={confirmDialog.open} title={confirmDialog.title} message={confirmDialog.message} onConfirm={() => { confirmDialog.action(); setConfirmDialog({ ...confirmDialog, open: false }); }} onCancel={() => setConfirmDialog({ ...confirmDialog, open: false })} />

        <div className="max-w-[1600px] mx-auto">
          {/* Header */}
          <div className="flex flex-wrap justify-between items-start gap-4 mb-6">
            <div>
              <div className="flex items-center gap-3 mb-2 flex-wrap">
                <Link href="/admin" className="p-2 hover:bg-white/10 rounded-lg transition"><Home className="w-5 h-5 text-slate-400" /></Link>
                <h1 className="text-2xl font-bold text-white">Red letenja</h1>
                <div className={`px-2 py-1 rounded-full text-xs ${overrideCount > 0 ? 'bg-orange-500/20 text-orange-400' : 'bg-green-500/20 text-green-400'}`}>
                  {overrideCount > 0 ? `${overrideCount} override-a` : 'Sinhronizovano'}
                </div>
                <button onClick={() => setSafetyMode(!safetyMode)} className={`flex items-center gap-1 px-2 py-1 rounded-lg text-xs transition ${safetyMode ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>
                  {safetyMode ? <Shield className="w-3 h-3" /> : <Lock className="w-3 h-3" />}
                  {safetyMode ? 'Safety ON' : 'Safety OFF'}
                </button>
              </div>
              <div className="flex flex-wrap gap-4 text-xs text-slate-400">
                <span>📅 {new Date().toLocaleDateString('sr-Latn-RS')}</span>
                <span>🕐 Zadnji update: {getTimeSinceUpdate()}</span>
                <span>🔄 Auto-refresh za {countdown}s</span>
                <span>✈️ {flights.departures.length} polazaka • {flights.arrivals.length} dolazaka</span>
                {departedFlights.length > 0 && <span className="text-purple-400">🛫 {departedFlights.length} odletjelih</span>}
              </div>
            </div>
            <div className="flex gap-2 flex-wrap">
              <button onClick={() => loadFlights(true)} disabled={refreshing} className="p-2 rounded-lg bg-white/5 hover:bg-white/10 transition disabled:opacity-50"><RefreshCw className={`w-5 h-5 text-white/60 ${refreshing ? 'animate-spin' : ''}`} /></button>
              <Link href="/admin/assign-checkin" className="flex items-center gap-1 px-3 py-2 bg-purple-600/20 hover:bg-purple-600/30 text-purple-300 rounded-lg text-sm transition"><CheckSquare className="w-4 h-4" />Assign</Link>
              {overrideCount > 0 && <button onClick={handleClearAllFlightsOverrides} className="flex items-center gap-1 px-3 py-2 bg-red-600/20 hover:bg-red-600/30 text-red-300 rounded-lg text-sm transition"><Trash2 className="w-4 h-4" />Clear all</button>}
              <button onClick={async () => { await fetch('/api/admin/logout', { method: 'POST' }); router.push('/admin/login'); }} className="px-3 py-2 bg-red-600/20 hover:bg-red-600/30 text-red-300 rounded-lg text-sm transition">Odjava</button>
            </div>
          </div>

          {error && <div className="mb-4 p-3 bg-red-500/20 border border-red-500/30 rounded-lg text-red-400 text-sm">⚠️ {error}</div>}

          {/* Filteri */}
          <div className="bg-white/5 rounded-xl p-4 mb-4">
            <div className="flex flex-wrap gap-4">
              <div className="flex gap-1">
                {(['all', 'departures', 'arrivals'] as const).map(tab => (
                  <button key={tab} onClick={() => setActiveTab(tab)} className={`px-4 py-2 rounded-lg text-sm font-medium transition ${activeTab === tab ? 'bg-blue-600 text-white' : 'text-white/70 hover:bg-white/10'}`}>
                    {tab === 'all' ? 'Svi' : tab === 'departures' ? 'Polasci' : 'Dolasci'}
                  </button>
                ))}
              </div>
              <div className="flex-1 relative min-w-[160px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
                <input type="text" placeholder="Pretraži letove..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} className="w-full pl-9 pr-4 py-2 bg-white/10 border border-white/20 rounded-lg text-white text-sm placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              {uniqueAirlines.length > 0 && (
                <select value={airlineFilter} onChange={e => setAirlineFilter(e.target.value)} className="px-4 py-2 bg-white/10 border border-white/20 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  <option value="all">Sve kompanije</option>
                  {uniqueAirlines.map(a => <option key={a} value={a}>{a}</option>)}
                </select>
              )}
            </div>
          </div>

          {/* Odletjeli letovi — collapsible na vrhu */}
          <DepartedSection flights={departedFlights} onOverride={handleOverride} onClearAll={handleClearAllOverrides} />

          {/* Glavni layout: lista + stats */}
          <div className="flex flex-col xl:flex-row gap-4 items-start">

            {/* Lista letova */}
            <div className="flex-1 min-w-0 space-y-3">
              {loading && !flights.departures.length ? (
                <div className="text-center py-12"><div className="w-10 h-10 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" /><div className="text-white/50">Učitavanje...</div></div>
              ) : filteredFlights.length === 0 ? (
                <div className="text-center py-12 bg-white/5 rounded-xl"><Plane className="w-12 h-12 text-white/20 mx-auto mb-3" /><div className="text-white/50">Nema letova</div></div>
              ) : (
                filteredFlights.map(flight => (
                  <FlightCard key={`${flight.FlightNumber}-${flight.ScheduledDepartureTime}`} flight={flight} onOverride={handleOverride} onClearAll={handleClearAllOverrides} />
                ))
              )}
            </div>

            {/* Stats panel — desno na xl, ispod na mobile */}
            <div className="w-full xl:w-80 xl:flex-shrink-0 xl:sticky xl:top-4">
              <FlightStatsPanel departures={flights.departures} arrivals={flights.arrivals} />
            </div>

          </div>

          {/* Footer */}
          <div className="mt-6 pt-4 border-t border-white/10 text-center text-xs text-white/30 pb-8">
            Prikazano {filteredFlights.length} aktivnih od {allFlights.length} letova • Sinhronizovano: {lastUpdated ? new Date(lastUpdated).toLocaleTimeString() : 'N/A'}
          </div>
        </div>
      </div>
    </>
  );
}