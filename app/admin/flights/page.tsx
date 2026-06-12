'use client';

import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Plane, CheckSquare, ArrowUpRight, ArrowDownRight, Clock, MapPin,
  CheckCircle, XCircle, AlertCircle, RefreshCw, Calendar, Search,
  ChevronDown, LogOut, Home, Save, Trash2, AlertTriangle, Shield, Lock
} from 'lucide-react';
import type { Flight } from '@/types/flight';
import { invalidateBusinessClassCache } from '@/lib/business-class-service';



// ============================================================
// KONSTANTE
// ============================================================
const AUTO_REFRESH_INTERVAL = 30_000; // 30 sekundi
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
// OVERRIDE CONTROL (pojednostavljen)
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
// STATUS CONTROL (pojednostavljen)
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
// FORCE OPEN (XY234) → early-open: prikaži OVAJ let odmah
// FORCE CLOSE        → zatvori šalter
// Reset to Auto      → vrati na automatiku
// ============================================================
const DeskManualControl = ({ deskNumbers, flightNumber }: { deskNumbers?: string; flightNumber?: string }) => {
  const [deskStates, setDeskStates] = useState<Record<string, { status: string; flightNumber: string | null }>>({});
  const [loadingDesk, setLoadingDesk] = useState<Record<string, boolean>>({});
  const desks = deskNumbers?.split(',').map(d => d.trim()).filter(Boolean) || [];

  // Učitaj trenutni status pri mountu
  useEffect(() => {
    if (!desks.length) return;
    desks.forEach(async (desk) => {
      try {
        const res = await fetch(`/api/desk-status/${desk}`);
        if (!res.ok) return;
        const data = await res.json();
        if (data.status) {
          setDeskStates(prev => ({
            ...prev,
            [desk]: { status: data.status, flightNumber: data.flightNumber ?? null },
          }));
        }
      } catch {}
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deskNumbers]);

const handleSetStatus = async (
  desk: string,
  status: 'open' | 'closed' | null,
  targetFlight: string | null = null
) => {
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

    // ⭐ NOVO: Pošalji signal svim FIDS tabovima
    try {
      const bc = new BroadcastChannel('desk-status-updates');
      bc.postMessage({ desk, status, flightNumber: targetFlight, ts: Date.now() });
      bc.close();
    } catch {} // BroadcastChannel nije dostupan u svim browserima

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
        const state     = deskStates[desk];
        const isOpen    = state?.status === 'open';
        const isClosed  = state?.status === 'closed';
        const isEarly   = isOpen && !!state?.flightNumber;
        const isBusy    = !!loadingDesk[desk];

        return (
          <div key={desk} className="rounded-lg bg-white/5 border border-white/10 overflow-hidden">

            {/* Status red */}
            <div className="flex items-center gap-2 px-3 py-2">
              <span className="text-xs font-bold text-white/70 w-8 flex-shrink-0">Š{desk}</span>

              {!state ? (
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/10 text-white/40">AUTO</span>
              ) : isEarly ? (
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-purple-500/30 text-purple-200 border border-purple-500/40 font-bold">
                  ⚡ OPEN · {state.flightNumber}
                </span>
              ) : isOpen ? (
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-green-500/20 text-green-300 border border-green-500/30 font-bold">
                  ✓ OPEN
                </span>
              ) : (
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-red-500/20 text-red-300 border border-red-500/30 font-bold">
                  ✕ CLOSED
                </span>
              )}

              {state && (
                <button
                  onClick={() => handleSetStatus(desk, null)}
                  disabled={isBusy}
                  className="ml-auto text-[10px] text-white/40 hover:text-white px-2 py-0.5 rounded bg-white/5 hover:bg-white/10 transition disabled:opacity-40"
                >
                  Reset Auto
                </button>
              )}
            </div>

            {/* Dugmad */}
            <div className="flex flex-wrap gap-1.5 px-3 pb-3">

              {/* FORCE OPEN — uvijek šalje flightNumber ovog leta (early-open) */}
              <button
                onClick={() => handleSetStatus(desk, 'open', flightNumber ?? null)}
                disabled={isBusy || (isEarly && state?.flightNumber === flightNumber)}
                title={flightNumber
                  ? `Otvori šalter za let ${flightNumber} odmah (early-open)`
                  : 'Otvori šalter'}
                className="px-2.5 py-1.5 text-[10px] font-bold rounded-lg transition disabled:opacity-40
                  bg-green-600/20 hover:bg-green-600/40 text-green-300 border border-green-600/30"
              >
                ✓ FORCE OPEN{flightNumber ? ` (${flightNumber})` : ''}
              </button>

              {/* FORCE CLOSE */}
              <button
                onClick={() => handleSetStatus(desk, 'closed', null)}
                disabled={isBusy || isClosed}
                title="Zatvori šalter"
                className="px-2.5 py-1.5 text-[10px] font-bold rounded-lg transition disabled:opacity-40
                  bg-red-600/20 hover:bg-red-600/40 text-red-300 border border-red-600/30"
              >
                ✕ FORCE CLOSE
              </button>

            </div>

            {/* Info kad je early-open aktivan */}
            {isEarly && (
              <div className="mx-3 mb-3 px-2 py-1.5 rounded-lg bg-purple-500/10 border border-purple-500/20 text-[10px] text-purple-200">
                ⚡ Let <strong>{state.flightNumber}</strong> prikazan odmah na ovom šalteru.
                Klikni <strong>Reset Auto</strong> za povratak na automatiku.
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
      {cfg.icon}
      {cfg.label}
    </span>
  );
};

// ============================================================
// FLIGHT CARD (pojednostavljen)
// ============================================================
// ============================================================
// FLIGHT CARD (sa badge-evima za override)
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
                    <AlertTriangle className="w-2.5 h-2.5" />
                    Override Active
                  </span>
                  {/* ⭐ OVDJE KORISTIMO OverrideBadge ZA SVAKI OVERRIDE */}
                  {Object.keys(overrideFields).map(field => (
                    <OverrideBadge key={field} fieldName={field} />
                  ))}
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
                    <Trash2 className="w-4 h-4 inline mr-2" /> Ukloni sve override-ove
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
  const showToast = (message: string, type: 'success' | 'error' | 'warning') => setToast({ message, type });
  const confirmAction = (title: string, message: string, action: () => void) => {
    if (safetyMode) setConfirmDialog({ open: true, title, message, action });
    else action();
  };
  const withDebounce = (cb: () => void) => {
    if (Date.now() - lastClickRef.current > CONFIRM_THRESHOLD_MS) { lastClickRef.current = Date.now(); cb(); }
    else showToast('Prebrzi klikovi! Sačekajte.', 'warning');
  };

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

  // Helpers for display
  const allFlights = useMemo(() => activeTab === 'all' ? [...flights.departures, ...flights.arrivals] : activeTab === 'departures' ? flights.departures : flights.arrivals, [flights, activeTab]);
  const filteredFlights = useMemo(() => {
    let result = allFlights;
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      result = result.filter(f => f.FlightNumber?.toLowerCase().includes(term) || f.AirlineName?.toLowerCase().includes(term) || f.DestinationCityName?.toLowerCase().includes(term));
    }
    if (airlineFilter !== 'all') result = result.filter(f => f.AirlineName === airlineFilter);
    return result.sort((a, b) => (a.ScheduledDepartureTime || '').localeCompare(b.ScheduledDepartureTime || ''));
  }, [allFlights, searchTerm, airlineFilter]);

  const uniqueAirlines = useMemo(() => [...new Set(allFlights.map(f => f.AirlineName).filter(Boolean))].sort(), [allFlights]);
  const overrideCount = useMemo(() => allFlights.filter(f => (f as any)._hasOverride).length, [allFlights]);
  const getTimeSinceUpdate = () => {
    if (!lastUpdated) return 'Nepoznato';
    const mins = Math.floor((Date.now() - new Date(lastUpdated).getTime()) / 60000);
    if (mins < 1) return 'upravo sada';
    if (mins < 60) return `pre ${mins} min`;
    return `pre ${Math.floor(mins / 60)}h`;
  };

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

        <div className="max-w-7xl mx-auto">
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
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={() => loadFlights(true)} disabled={refreshing} className="p-2 rounded-lg bg-white/5 hover:bg-white/10 transition disabled:opacity-50"><RefreshCw className={`w-5 h-5 text-white/60 ${refreshing ? 'animate-spin' : ''}`} /></button>
              <Link href="/admin/assign-checkin" className="flex items-center gap-1 px-3 py-2 bg-purple-600/20 hover:bg-purple-600/30 text-purple-300 rounded-lg text-sm transition"><CheckSquare className="w-4 h-4" />Assign</Link>
              {overrideCount > 0 && <button onClick={handleClearAllFlightsOverrides} className="flex items-center gap-1 px-3 py-2 bg-red-600/20 hover:bg-red-600/30 text-red-300 rounded-lg text-sm transition"><Trash2 className="w-4 h-4" />Clear all</button>}
              <button onClick={async () => { await fetch('/api/admin/logout', { method: 'POST' }); router.push('/admin/login'); }} className="px-3 py-2 bg-red-600/20 hover:bg-red-600/30 text-red-300 rounded-lg text-sm transition">Odjava</button>
            </div>
          </div>

          {error && <div className="mb-4 p-3 bg-red-500/20 border border-red-500/30 rounded-lg text-red-400 text-sm">⚠️ {error}</div>}

          {/* Filteri */}
          <div className="bg-white/5 rounded-xl p-4 mb-6">
            <div className="flex flex-wrap gap-4">
              <div className="flex gap-1">
                {(['all', 'departures', 'arrivals'] as const).map(tab => (
                  <button key={tab} onClick={() => setActiveTab(tab)} className={`px-4 py-2 rounded-lg text-sm font-medium transition ${activeTab === tab ? 'bg-blue-600 text-white' : 'text-white/70 hover:bg-white/10'}`}>
                    {tab === 'all' ? 'Svi' : tab === 'departures' ? 'Polasci' : 'Dolasci'}
                  </button>
                ))}
              </div>
              <div className="flex-1 relative">
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

          {/* Lista letova */}
          <div className="space-y-3">
            {loading && !flights.departures.length ? (
              <div className="text-center py-12"><div className="w-10 h-10 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" /><div className="text-white/50">Učitavanje...</div></div>
            ) : filteredFlights.length === 0 ? (
              <div className="text-center py-12 bg-white/5 rounded-xl"><Plane className="w-12 h-12 text-white/20 mx-auto mb-3" /><div className="text-white/50">Nema letova</div></div>
            ) : (
              filteredFlights.map((flight, idx) => <FlightCard key={`${flight.FlightNumber}-${flight.ScheduledDepartureTime}-${idx}`} flight={flight} onOverride={handleOverride} onClearAll={handleClearAllOverrides} />)
            )}
          </div>

          {/* Footer */}
          <div className="mt-6 pt-4 border-t border-white/10 text-center text-xs text-white/30 pb-8">
            Prikazano {filteredFlights.length} od {allFlights.length} letova • Sistem ažuriran: {lastUpdated ? new Date(lastUpdated).toLocaleTimeString() : 'N/A'}
          </div>
        </div>
      </div>
    </>
  );
}