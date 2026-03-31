'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Plane,
  ArrowUpRight,
  ArrowDownRight,
  Clock,
  MapPin,
  CheckCircle,
  XCircle,
  AlertCircle,
  RefreshCw,
  Calendar,
  Search,
  ChevronDown,
  LogOut,
  Home,
  Save,
  Trash2
} from 'lucide-react';
import type { Flight } from '@/types/flight';

// Helper funkcije
const formatTime = (timeString: string): string => {
  if (!timeString || timeString.trim() === '') return '--:--';
  try {
    const [hours, minutes] = timeString.split(':').map(Number);
    if (Number.isNaN(hours) || Number.isNaN(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return '--:--';
    const date = new Date();
    date.setHours(hours, minutes, 0, 0);
    return date.toLocaleTimeString('sr-Latn-RS', { hour: '2-digit', minute: '2-digit', hour12: false });
  } catch { return '--:--'; }
};

const getStatusColor = (status: string): string => {
  if (!status) return 'text-gray-400';
  const s = status.toLowerCase();
  if (s.includes('on time') || s.includes('na vreme')) return 'text-green-500';
  if (s.includes('delay') || s.includes('kasni')) return 'text-yellow-500';
  if (s.includes('cancel') || s.includes('otkazan')) return 'text-red-500';
  if (s.includes('board') || s.includes('ukrcaj')) return 'text-blue-500';
  if (s.includes('gate') || s.includes('izlaz')) return 'text-purple-500';
  if (s.includes('arriv') || s.includes('sletio')) return 'text-emerald-500';
  return 'text-gray-400';
};

const getStatusIcon = (status: string) => {
  if (!status) return <Clock className="w-4 h-4 text-gray-400" />;
  const s = status.toLowerCase();
  if (s.includes('on time') || s.includes('na vreme')) return <CheckCircle className="w-4 h-4 text-green-500" />;
  if (s.includes('delay') || s.includes('kasni')) return <AlertCircle className="w-4 h-4 text-yellow-500" />;
  if (s.includes('cancel') || s.includes('otkazan')) return <XCircle className="w-4 h-4 text-red-500" />;
  if (s.includes('board') || s.includes('ukrcaj')) return <Plane className="w-4 h-4 text-blue-500" />;
  return <Clock className="w-4 h-4 text-gray-400" />;
};

// ============================================================
// KOMPONENTA: Override Control (Za Gate i Check-in)
// ============================================================
interface OverrideControlProps {
  label: string;
  currentValue: string | undefined;
  fieldName: 'GateNumber' | 'CheckInDesk';
  flightNumber: string;
  onFlightOverride: (flightNumber: string, field: string, action: string, value?: string) => Promise<void>;
}

const OverrideControl: React.FC<OverrideControlProps> = ({ 
  label, currentValue, fieldName, flightNumber, onFlightOverride 
}) => {
  const [inputValue, setInputValue] = useState(currentValue || '');
  const [isUpdating, setIsUpdating] = useState(false);

  useEffect(() => {
    if (!isUpdating) setInputValue(currentValue || '');
  }, [currentValue, isUpdating]);

  const handleAction = useCallback(async (action: 'assign' | 'clear') => {
    setIsUpdating(true);
    try {
      await onFlightOverride(flightNumber, fieldName, action, action === 'assign' ? inputValue : undefined);
      if (action === 'clear') setInputValue('');
    } catch (error) {
      console.error('Override error:', error);
    } finally {
      setIsUpdating(false);
    }
  }, [flightNumber, fieldName, inputValue, onFlightOverride]);

  return (
    <div className="flex flex-col gap-2">
      <div className="text-xs text-white/50">{label}</div>
      <div className="text-sm text-white mb-1 font-medium break-all">
        Trenutno: {currentValue || <span className="text-white/30">Nije dodijeljeno (API podatak)</span>}
      </div>
      
<div className="flex flex-col sm:flex-row gap-2 w-full" onClick={(e) => e.stopPropagation()}>
  <input
    type="text"
    value={inputValue}
    onChange={(e) => setInputValue(e.target.value)}
    placeholder="npr. 3 ili 4,5"
    className="w-full sm:w-28 min-w-0 flex-1 px-3 py-2 bg-white/10 border border-white/20 rounded-lg text-white text-sm placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-blue-500"
    disabled={isUpdating}
  />

  <button
    onClick={() => handleAction('assign')}
    disabled={isUpdating || !inputValue.trim()}
    className="w-full sm:w-auto flex justify-center items-center gap-1 px-3 py-2 bg-blue-600/20 hover:bg-blue-600/30 text-blue-400 rounded-lg border border-blue-500/30 transition-colors disabled:opacity-50 text-sm"
    type="button"
  >
    <Save className="w-3.5 h-3.5" />
    {isUpdating ? '...' : 'Promijeni'}
  </button>

  <button
    onClick={() => handleAction('clear')}
    disabled={isUpdating || !currentValue}
    className="w-full sm:w-auto flex justify-center items-center gap-1 px-3 py-2 bg-red-600/20 hover:bg-red-600/30 text-red-400 rounded-lg border border-red-500/30 transition-colors disabled:opacity-50 text-sm"
    type="button"
  >
    <Trash2 className="w-3.5 h-3.5" />
    Ukloni
  </button>
</div>
    </div>
  );
};

// ============================================================
// KOMPONENTA: Flight Card
// ============================================================
interface FlightCardProps {
  flight: Flight;
  flightKey: string;
  onFlightOverride: (flightNumber: string, field: string, action: string, value?: string) => Promise<void>;
}

const FlightCard: React.FC<FlightCardProps> = ({ flight, flightKey, onFlightOverride }) => {
  const [expanded, setExpanded] = useState(false);
  const isDeparture = flight.FlightType === 'departure';
  const statusColor = getStatusColor(flight.StatusEN);
  const StatusIcon = getStatusIcon(flight.StatusEN);

  return (
    <div
      className={`bg-white/5 border border-white/10 rounded-xl p-4 hover:bg-white/10 transition-all duration-200 cursor-pointer ${
        expanded ? 'bg-white/10' : ''
      }`}
      onClick={() => setExpanded(!expanded)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpanded(!expanded); } }}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className={`p-2 rounded-lg ${isDeparture ? 'bg-blue-500/20' : 'bg-green-500/20'}`}>
            {isDeparture ? <ArrowUpRight className="w-5 h-5 text-blue-400" /> : <ArrowDownRight className="w-5 h-5 text-green-400" />}
          </div>
          <div>
            <div className="flex flex-col sm:flex-row gap-2">
              <span className="text-xl font-bold text-white">{flight.FlightNumber}</span>
              <span className="text-sm text-white/60">{flight.AirlineName}</span>
            </div>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-sm text-white/80">
                {isDeparture ? flight.DestinationCityName || flight.DestinationAirportName : 'Tivat (TIV)'}
              </span>
              <span className="text-xs text-white/40">•</span>
              <span className="text-sm text-white/60">
                {isDeparture ? flight.DestinationAirportCode : 'TIV'}
              </span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-6">
          <div className="text-right">
            <div className="text-lg font-semibold text-white">{formatTime(flight.ScheduledDepartureTime || '--:--')}</div>
            <div className="text-sm text-white/60">
              {flight.EstimatedDepartureTime ? <>Est: {formatTime(flight.EstimatedDepartureTime)}</> : 'Scheduled'}
            </div>
          </div>
          <div className="flex flex-col sm:flex-row gap-2">{StatusIcon}<span className={`text-sm font-medium ${statusColor}`}>{flight.StatusEN || 'Unknown'}</span></div>
          <div className={`transition-transform ${expanded ? 'rotate-180' : ''}`}><ChevronDown className="w-5 h-5 text-white/40" /></div>
        </div>
      </div>

      {expanded && (
        <div className="mt-4 pt-4 border-t border-white/10" onClick={(e) => e.stopPropagation()}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-3">
              <div className="flex gap-4">
                <div><div className="text-xs text-white/50 mb-1">Terminal</div><div className="text-sm text-white">{flight.Terminal || '--'}</div></div>
                <div><div className="text-xs text-white/50 mb-1">Aktuelno vrijeme</div><div className="text-sm text-white">{formatTime(flight.ActualDepartureTime || '--:--')}</div></div>
              </div>
              {flight.CodeShareFlights && flight.CodeShareFlights.length > 0 && (
                <div><div className="text-xs text-white/50 mb-1">Code-share</div><div className="flex flex-wrap gap-2">{flight.CodeShareFlights.map((c, i) => <span key={i} className="px-2 py-1 bg-white/10 rounded text-xs text-white/80">{c}</span>)}</div></div>
              )}
              {flight.StatusMN && <div><div className="text-xs text-white/50 mb-1">Status (CN)</div><div className="text-sm text-white">{flight.StatusMN}</div></div>}
              <div className="flex gap-4">
                <div><div className="text-xs text-white/50 mb-1">Airline Code</div><div className="text-sm text-white">{flight.AirlineCode || '--'}</div></div>
                <div><div className="text-xs text-white/50 mb-1">ICAO</div><div className="text-sm text-white">{flight.AirlineICAO || '--'}</div></div>
              </div>
              {!isDeparture && flight.BaggageReclaim && (
                 <div><div className="text-xs text-white/50 mb-1">Baggage Belt</div><div className="text-sm text-white">{flight.BaggageReclaim}</div></div>
              )}
            </div>

            {isDeparture ? (
<div className="bg-white/5 rounded-xl p-4 md:p-5 border border-white/10 space-y-4 md:space-y-6 w-full md:-ml-4">
                <h3 className="text-sm font-bold text-white/80 uppercase tracking-wider border-b border-white/10 pb-2">
                  ⚙️ Upravljanje letom (Redis Overrides)
                </h3>
                
                <OverrideControl
                  label="Check-In Desk"
                  currentValue={flight.CheckInDesk}
                  fieldName="CheckInDesk"
                  flightNumber={flight.FlightNumber}
                  onFlightOverride={onFlightOverride}
                />

                <OverrideControl
                  label="Gate (Izlaz)"
                  currentValue={flight.GateNumber}
                  fieldName="GateNumber"
                  flightNumber={flight.FlightNumber}
                  onFlightOverride={onFlightOverride}
                />
              </div>
            ) : (
              <div className="bg-white/5 rounded-xl p-4 border border-white/10 flex items-center justify-center h-full">
                <p className="text-sm text-white/40 italic">Upravljanje je dostupno samo za polaske.</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

// Funkcije za obradu letova
const removeDuplicates = (arr: string[]): string[] => {
  const seen: Record<string, boolean> = {};
  return arr.filter((item) => { if (seen[item]) return false; seen[item] = true; return true; });
};

const consolidateFlights = (flights: Flight[]): Flight[] => {
  const flightMap = new Map<string, Flight>();
  flights.forEach((flight) => {
    const baseKey = `${flight.FlightNumber}-${flight.ScheduledDepartureTime}`;
    if (flightMap.has(baseKey)) {
      const existingFlight = flightMap.get(baseKey)!;
      if (flight.GateNumber && existingFlight.GateNumber) {
        existingFlight.GateNumber = removeDuplicates([...existingFlight.GateNumber.split(',').map(g => g.trim()), ...flight.GateNumber.split(',').map(g => g.trim())]).join(', ');
      } else if (flight.GateNumber) { existingFlight.GateNumber = flight.GateNumber; }
      
      if (flight.CheckInDesk && existingFlight.CheckInDesk) {
        existingFlight.CheckInDesk = removeDuplicates([...existingFlight.CheckInDesk.split(',').map(d => d.trim()), ...flight.CheckInDesk.split(',').map(d => d.trim())]).join(', ');
      } else if (flight.CheckInDesk) { existingFlight.CheckInDesk = flight.CheckInDesk; }
      
      if (!existingFlight.AirlineName && flight.AirlineName) existingFlight.AirlineName = flight.AirlineName;
      if (!existingFlight.AirlineCode && flight.AirlineCode) existingFlight.AirlineCode = flight.AirlineCode;
      if (!existingFlight.StatusEN && flight.StatusEN) existingFlight.StatusEN = flight.StatusEN;
      if (!existingFlight.StatusMN && flight.StatusMN) existingFlight.StatusMN = flight.StatusMN;
    } else {
      flightMap.set(baseKey, { ...flight });
    }
  });
  return Array.from(flightMap.values());
};

const generateFlightKey = (flight: Flight, index: number): string => {
  const baseKey = `${flight.FlightNumber}-${flight.ScheduledDepartureTime || 'no-time'}`;
  const additionalKeys = [flight.GateNumber, flight.CheckInDesk, flight.Terminal, flight.AirlineCode, index.toString()].filter(Boolean).join('-');
  return `${baseKey}-${additionalKeys}`.replace(/\s+/g, '-');
};

interface FlightsData { departures: Flight[]; arrivals: Flight[]; }

export default function AdminFlightsPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [flights, setFlights] = useState<FlightsData>({ departures: [], arrivals: [] });
  const [lastUpdated, setLastUpdated] = useState<string>('');
  const [systemStatus, setSystemStatus] = useState<'online' | 'offline'>('online');
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'all' | 'departures' | 'arrivals'>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [airlineFilter, setAirlineFilter] = useState<string>('all');

  const loadFlights = useCallback(async (silent = false) => {
    try {
      if (!silent) setLoading(true);
      setRefreshing(true);
      setError(null);
     const response = await fetch(`/api/flights?nocache=${Date.now()}`, {
        cache: 'no-store',
        headers: {
          'Cache-Control': 'no-cache'
        }
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}: Greška pri učitavanju letova`);
      const data = await response.json();

      const removeDuplicatesAndConsolidate = (flightArray: Flight[]): Flight[] => {
        const consolidated = consolidateFlights(flightArray);
        const seen: Record<string, boolean> = {};
        return consolidated.filter((flight) => {
          const uniqueId = `${flight.FlightNumber}-${flight.ScheduledDepartureTime}-${flight.GateNumber || 'nogate'}-${flight.CheckInDesk || 'nodesk'}`;
          if (seen[uniqueId]) return false;
          seen[uniqueId] = true;
          return true;
        });
      };

      setFlights({
        departures: removeDuplicatesAndConsolidate(data.departures || []),
        arrivals: removeDuplicatesAndConsolidate(data.arrivals || [])
      });
      setLastUpdated(data.lastUpdated || new Date().toISOString());
      setSystemStatus(data.isOfflineMode ? 'offline' : 'online');
    } catch (error) {
      console.error('Error loading flights:', error);
      setError(error instanceof Error ? error.message : 'Greška pri učitavanju letova');
      setFlights({ departures: [], arrivals: [] });
      setSystemStatus('offline');
      setLastUpdated(new Date().toISOString());
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const handleFlightOverride = useCallback(async (flightNumber: string, field: string, action: string, value?: string) => {
    try {
      const response = await fetch('/api/admin/flight-override', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ flightNumber, field, action, value }),
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Greška pri ažuriranju');
      }
      await loadFlights(true); // Osvježi listu da pokaže novu vrijednost
    } catch (error) {
      console.error('Override error:', error);
      alert(error instanceof Error ? error.message : 'Došlo je do greške.');
      throw error;
    }
  }, [loadFlights]);

  useEffect(() => { loadFlights(); }, [loadFlights]);
  const handleRefresh = useCallback(() => { loadFlights(true); }, [loadFlights]);

  const handleLogout = useCallback(async () => {
    try { await fetch('/api/admin/logout', { method: 'POST' }); } catch (error) { console.error('Logout error:', error); }
    finally { router.push('/admin/login'); }
  }, [router]);

  const getFilteredFlights = useMemo(() => {
    let filtered: Flight[] = activeTab === 'all' ? [...flights.departures, ...flights.arrivals] : activeTab === 'departures' ? flights.departures : flights.arrivals;
    
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      filtered = filtered.filter((f) => f.FlightNumber?.toLowerCase().includes(term) || f.AirlineName?.toLowerCase().includes(term) || f.DestinationCityName?.toLowerCase().includes(term) || f.DestinationAirportCode?.toLowerCase().includes(term));
    }
    if (airlineFilter !== 'all') filtered = filtered.filter((f) => f.AirlineName?.toLowerCase() === airlineFilter.toLowerCase());
    
    return filtered.sort((a, b) => (a.ScheduledDepartureTime || '00:00').localeCompare(b.ScheduledDepartureTime || '00:00'));
  }, [activeTab, flights, searchTerm, airlineFilter]);

  const uniqueAirlines = useMemo(() => {
    const allFlights = [...flights.departures, ...flights.arrivals];
    const seenAirlines: Record<string, boolean> = {};
    return allFlights.map((f) => f.AirlineName).filter((name): name is string => { if (!name || seenAirlines[name]) return false; seenAirlines[name] = true; return true; }).sort((a, b) => a.localeCompare(b));
  }, [flights]);

  const formatDate = useCallback((dateString: string) => {
    try { const date = new Date(dateString); if (Number.isNaN(date.getTime())) return 'Nepoznato'; return date.toLocaleString('sr-Latn-RS', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch { return 'Nepoznato'; }
  }, []);

  const getTimeSinceUpdate = useCallback(() => {
    if (!lastUpdated) return 'Nepoznato';
    try {
      const diffMs = Date.now() - new Date(lastUpdated).getTime();
      const diffMins = Math.floor(diffMs / 60000);
      if (diffMins < 1) return 'upravo sada';
      if (diffMins === 1) return 'pre 1 minut';
      if (diffMins < 60) return `pre ${diffMins} minuta`;
      const diffHours = Math.floor(diffMins / 60);
      if (diffHours === 1) return 'pre 1 sat';
      if (diffHours < 24) return `pre ${diffHours} sati`;
      const diffDays = Math.floor(diffHours / 24);
      return diffDays === 1 ? 'pre 1 dan' : `pre ${diffDays} dana`;
    } catch { return 'Nepoznato'; }
  }, [lastUpdated]);

  const today = useMemo(() => new Date().toLocaleDateString('sr-Latn-RS', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }), []);

  return (
<div className="min-h-screen overflow-x-hidden bg-gradient-to-br from-slate-900 to-slate-800 p-4 md:p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <header className="mb-8">
      <div className="flex flex-col md:flex-row md:justify-between md:items-start gap-4">
            <div>
              <div className="flex items-center gap-4 mb-2">
                <Link href="/admin" className="p-2 text-slate-400 hover:text-white hover:bg-white/10 rounded-lg transition-colors" title="Nazad na dashboard"><Home className="w-5 h-5" /></Link>
             <h1 className="text-3xl font-bold text-white flex items-center gap-3">
  Red letenja
  <span className="bg-red-500 text-white text-sm px-3 py-1 rounded-full">
    by Alen
  </span>
</h1>
                <div className={`flex items-center gap-2 px-3 py-1 rounded-full text-sm ${systemStatus === 'online' ? 'bg-green-900/30 text-green-400' : 'bg-yellow-900/30 text-yellow-400'}`}>
                  <div className={`w-2 h-2 rounded-full ${systemStatus === 'online' ? 'bg-green-500' : 'bg-yellow-500'}`} />
                  {systemStatus === 'online' ? 'LIVE' : 'BACKUP'}
                </div>
              </div>
           <div className="flex flex-col sm:flex-row sm:flex-wrap gap-2 sm:gap-4 text-sm text-slate-300">
                <div className="flex flex-col sm:flex-row gap-2"><Calendar className="w-4 h-4" /><span>{today}</span></div>
                <div className="flex flex-col sm:flex-row gap-2"><Clock className="w-4 h-4" /><span>Poslednje ažuriranje: {getTimeSinceUpdate()}</span></div>
                <div className="flex flex-col sm:flex-row gap-2"><Plane className="w-4 h-4" /><span>{flights.departures.length} polazaka • {flights.arrivals.length} dolazaka</span></div>
              </div>
            </div>
        <div className="flex flex-col gap-3 w-full md:w-auto">
        <div className="flex flex-wrap gap-2 justify-end">
                <button onClick={handleRefresh} disabled={refreshing} className="p-2 text-slate-400 hover:text-white hover:bg-white/10 rounded-lg transition-colors disabled:opacity-50" title="Osvježi podatke" type="button"><RefreshCw className={`w-5 h-5 ${refreshing ? 'animate-spin' : ''}`} /></button>
<button
  onClick={handleLogout}
  className="flex items-center gap-2 px-3 py-2 md:px-4 bg-red-600/20 hover:bg-red-600/30 text-red-300 rounded-lg border border-red-500/30 transition-colors"
  type="button"
>
  <LogOut className="w-4 h-4" />
  <span className="hidden sm:inline">Odjavi se</span>
</button>              </div>
              {error && <div className="text-right"><div className="text-sm text-red-400">⚠️ {error}</div></div>}
            </div>
          </div>
        </header>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
          {[ 
            { label: 'Ukupno letova', count: flights.departures.length + flights.arrivals.length, color: 'blue', icon: Plane },
            { label: 'Polasci', count: flights.departures.length, color: 'blue', icon: ArrowUpRight },
            { label: 'Dolasci', count: flights.arrivals.length, color: 'green', icon: ArrowDownRight },
            { label: 'Aktivni letovi', count: getFilteredFlights.length, color: 'yellow', icon: Clock }
          ].map((card) => (
            <div key={card.label} className="bg-white/5 backdrop-blur-sm rounded-xl p-4 border border-white/10">
              <div className="flex items-center justify-between">
                <div><div className="text-sm text-white/60">{card.label}</div><div className="text-2xl font-bold text-white mt-1">{loading ? '...' : card.count}</div></div>
                <div className={`p-2 bg-${card.color}-500/20 rounded-lg`}><card.icon className={`w-6 h-6 text-${card.color}-400`} /></div>
              </div>
            </div>
          ))}
        </div>

        {/* Filters */}
        <div className="bg-white/5 backdrop-blur-sm rounded-xl p-4 border border-white/10 mb-8">
          <div className="flex flex-col md:flex-row gap-4">
            <div className="flex border-b border-white/10 md:border-none">
              {(['all', 'departures', 'arrivals'] as const).map((tab) => (
                <button key={tab} onClick={() => setActiveTab(tab)} className={`px-4 py-2 ${tab === 'all' ? 'rounded-t-lg md:rounded-l-lg md:rounded-r-none' : tab === 'arrivals' ? 'rounded-b-lg md:rounded-r-lg' : 'rounded-lg'} transition-colors ${activeTab === tab ? 'bg-blue-600 text-white' : 'text-white/70 hover:text-white hover:bg-white/10'}`} type="button">
                  {tab === 'all' ? `Svi (${flights.departures.length + flights.arrivals.length})` : tab === 'departures' ? `Polasci (${flights.departures.length})` : `Dolasci (${flights.arrivals.length})`}
                </button>
              ))}
            </div>
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-white/40" />
              <input type="text" placeholder="Pretraži letove..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="w-full pl-10 pr-4 py-2 bg-white/10 border border-white/20 rounded-lg text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div className="relative">
              <select value={airlineFilter} onChange={(e) => setAirlineFilter(e.target.value)} className="w-full px-4 py-2 bg-white/10 border border-white/20 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500 appearance-none pr-10">
                <option value="all">Sve avio kompanije</option>
                {uniqueAirlines.map((airline) => <option key={airline} value={airline}>{airline}</option>)}
              </select>
              <ChevronDown className="absolute right-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-white/40 pointer-events-none" />
            </div>
          </div>
        </div>

        {/* Flights List */}
        <div className="space-y-4">
          {loading ? (
            <div className="space-y-4">{[...Array(5)].map((_, i) => (<div key={i} className="bg-white/5 border border-white/10 rounded-xl p-4 animate-pulse"><div className="flex items-center justify-between"><div className="flex items-center gap-4"><div className="w-10 h-10 bg-white/10 rounded-lg" /><div><div className="h-6 w-32 bg-white/10 rounded mb-2" /><div className="h-4 w-48 bg-white/10 rounded" /></div></div><div className="flex items-center gap-6"><div className="text-right"><div className="h-6 w-16 bg-white/10 rounded mb-1" /><div className="h-4 w-24 bg-white/10 rounded" /></div><div className="h-4 w-24 bg-white/10 rounded" /></div></div></div>))}</div>
          ) : getFilteredFlights.length === 0 ? (
            <div className="text-center py-12 bg-white/5 backdrop-blur-sm rounded-xl border border-white/10">
              <Plane className="w-16 h-16 text-white/20 mx-auto mb-4" />
              <div className="text-xl text-white/70 mb-2">Nema letova</div>
              <div className="text-white/50">{searchTerm || airlineFilter !== 'all' ? 'Nema letova za odabrane filtere' : 'Nema današnjih letova'}</div>
            </div>
          ) : (
            getFilteredFlights.map((flight, index) => (
              <FlightCard key={generateFlightKey(flight, index)} flight={flight} flightKey={generateFlightKey(flight, index)} onFlightOverride={handleFlightOverride} />
            ))
          )}
        </div>

        {/* Footer */}
        <div className="mt-8 pt-6 border-t border-white/10">
          <div className="flex flex-col md:flex-row justify-between items-center gap-4">
            <div className="text-sm text-white/50">{lastUpdated && `Sistem ažuriran: ${formatDate(lastUpdated)}`}</div>
            <div className="flex items-center gap-4">
              {systemStatus === 'offline' && <div className="px-3 py-1 bg-yellow-900/20 text-yellow-400 rounded-full text-sm">⚠️ Backup mode</div>}
              <div className="text-sm text-white/50">Prikazano: {getFilteredFlights.length} od {flights.departures.length + flights.arrivals.length}</div>
              <button onClick={handleRefresh} disabled={refreshing} className="flex items-center gap-2 px-4 py-2 bg-white/10 hover:bg-white/20 text-white rounded-lg transition-colors disabled:opacity-50" type="button">
                <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />{refreshing ? 'Osvježava se...' : 'Osvježi'}
              </button>
            </div>
          </div>
        </div>
          <style jsx global>{`
        body, html {
          overflow: auto !important;
          height: auto !important;
        }
      `}</style>
      </div>
    </div>
  );
}