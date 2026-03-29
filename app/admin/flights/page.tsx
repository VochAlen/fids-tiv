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
  Building,
  CheckCircle,
  XCircle,
  AlertCircle,
  RefreshCw,
  Calendar,
  Filter,
  Search,
  ChevronDown,
  ChevronUp,
  LogOut,
  Home,
  Power,
  PowerOff
} from 'lucide-react';
import type { Flight } from '@/types/flight';

// Helper funkcije
const formatTime = (timeString: string): string => {
  if (!timeString || timeString.trim() === '') return '--:--';

  try {
    const [hours, minutes] = timeString.split(':').map(Number);

    if (Number.isNaN(hours) || Number.isNaN(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
      return '--:--';
    }

    const date = new Date();
    date.setHours(hours, minutes, 0, 0);

    return date.toLocaleTimeString('sr-Latn-RS', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });
  } catch {
    return '--:--';
  }
};

const getStatusColor = (status: string): string => {
  if (!status) return 'text-gray-400';

  const statusLower = status.toLowerCase();

  if (statusLower.includes('on time') || statusLower.includes('na vreme')) {
    return 'text-green-500';
  }
  if (statusLower.includes('delay') || statusLower.includes('kasni')) {
    return 'text-yellow-500';
  }
  if (statusLower.includes('cancel') || statusLower.includes('otkazan')) {
    return 'text-red-500';
  }
  if (statusLower.includes('board') || statusLower.includes('ukrcaj')) {
    return 'text-blue-500';
  }
  if (statusLower.includes('gate') || statusLower.includes('izlaz')) {
    return 'text-purple-500';
  }
  if (statusLower.includes('arriv') || statusLower.includes('sletio')) {
    return 'text-emerald-500';
  }

  return 'text-gray-400';
};

const getStatusIcon = (status: string) => {
  if (!status) return <Clock className="w-4 h-4 text-gray-400" />;

  const statusLower = status.toLowerCase();

  if (statusLower.includes('on time') || statusLower.includes('na vreme')) {
    return <CheckCircle className="w-4 h-4 text-green-500" />;
  }
  if (statusLower.includes('delay') || statusLower.includes('kasni')) {
    return <AlertCircle className="w-4 h-4 text-yellow-500" />;
  }
  if (statusLower.includes('cancel') || statusLower.includes('otkazan')) {
    return <XCircle className="w-4 h-4 text-red-500" />;
  }
  if (statusLower.includes('board') || statusLower.includes('ukrcaj')) {
    return <Plane className="w-4 h-4 text-blue-500" />;
  }

  return <Clock className="w-4 h-4 text-gray-400" />;
};

interface FlightCardProps {
  flight: Flight;
  flightKey: string;
  onCheckInToggle: (flightNumber: string, deskNumber: string, action: 'open' | 'close') => Promise<void>;
}

const FlightCard: React.FC<FlightCardProps> = ({ flight, flightKey, onCheckInToggle }) => {
  const [expanded, setExpanded] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);

  const isDeparture = flight.FlightType === 'departure';
  const statusColor = getStatusColor(flight.StatusEN);
  const StatusIcon = getStatusIcon(flight.StatusEN);

  // Formatiraj check-in desk i gate-ove
  const formatMultiValues = (value: string | undefined): string => {
    if (!value) return '--';

    const values = value.split(',').map(v => v.trim()).filter(v => v);

    if (values.length === 1) return values[0];
    if (values.length > 1) {
      const numbers = values.map(v => parseInt(v, 10)).filter(n => !Number.isNaN(n));
      if (numbers.length > 1) {
        const min = Math.min(...numbers);
        const max = Math.max(...numbers);
        return min === max ? min.toString() : `${min}-${max}`;
      }
      return values.slice(0, 3).join(', ');
    }

    return value;
  };

  const checkInDeskDisplay = formatMultiValues(flight.CheckInDesk);
  const gateDisplay = formatMultiValues(flight.GateNumber);

  const handleCheckInToggleClick = useCallback(async (action: 'open' | 'close') => {
    if (!flight.CheckInDesk) {
      alert('Nije definisan check-in desk za ovaj let');
      return;
    }

    setIsUpdating(true);
    try {
      await onCheckInToggle(flight.FlightNumber, flight.CheckInDesk, action);
    } catch (error) {
      console.error('Greška pri togglovanju check-in-a:', error);
    } finally {
      setIsUpdating(false);
    }
  }, [flight.FlightNumber, flight.CheckInDesk, onCheckInToggle]);

  return (
    <div
      className={`bg-white/5 border border-white/10 rounded-xl p-4 hover:bg-white/10 transition-all duration-200 cursor-pointer ${
        expanded ? 'bg-white/10' : ''
      }`}
      onClick={() => setExpanded(!expanded)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          setExpanded(!expanded);
        }
      }}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className={`p-2 rounded-lg ${isDeparture ? 'bg-blue-500/20' : 'bg-green-500/20'}`}>
            {isDeparture ? (
              <ArrowUpRight className="w-5 h-5 text-blue-400" />
            ) : (
              <ArrowDownRight className="w-5 h-5 text-green-400" />
            )}
          </div>

          <div>
            <div className="flex items-center gap-2">
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
            <div className="text-lg font-semibold text-white">
              {formatTime(flight.ScheduledDepartureTime || '--:--')}
            </div>
            <div className="text-sm text-white/60">
              {flight.EstimatedDepartureTime ? (
                <>Est: {formatTime(flight.EstimatedDepartureTime)}</>
              ) : (
                'Scheduled'
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            {StatusIcon}
            <span className={`text-sm font-medium ${statusColor}`}>
              {flight.StatusEN || 'Unknown'}
            </span>
          </div>

          <div className={`transition-transform ${expanded ? 'rotate-180' : ''}`}>
            <ChevronDown className="w-5 h-5 text-white/40" />
          </div>
        </div>
      </div>

      {/* Expanded details */}
      {expanded && (
        <div className="mt-4 pt-4 border-t border-white/10">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <div className="text-xs text-white/50 mb-1">Terminal</div>
              <div className="text-sm text-white">{flight.Terminal || '--'}</div>
            </div>

            <div>
              <div className="text-xs text-white/50 mb-1">
                {isDeparture ? 'Gate' : 'Baggage'}
              </div>
              <div className="text-sm text-white">
                {isDeparture ? gateDisplay : (flight.BaggageReclaim || '--')}
              </div>
            </div>

            <div>
              <div className="text-xs text-white/50 mb-1">Check-in</div>
              <div className="text-sm text-white">{checkInDeskDisplay}</div>
            </div>

            <div>
              <div className="text-xs text-white/50 mb-1">Aktuelno vrijeme</div>
              <div className="text-sm text-white">
                {formatTime(flight.ActualDepartureTime || '--:--')}
              </div>
            </div>
          </div>

          {flight.CodeShareFlights && flight.CodeShareFlights.length > 0 && (
            <div className="mt-3">
              <div className="text-xs text-white/50 mb-1">Code-share flights</div>
              <div className="flex flex-wrap gap-2">
                {flight.CodeShareFlights.map((code, codeIndex) => (
                  <span
                    key={`code-${codeIndex}`}
                    className="px-2 py-1 bg-white/10 rounded text-xs text-white/80"
                  >
                    {code}
                  </span>
                ))}
              </div>
            </div>
          )}

          {flight.StatusMN && (
            <div className="mt-3">
              <div className="text-xs text-white/50 mb-1">Status (Crnogorski)</div>
              <div className="text-sm text-white">{flight.StatusMN}</div>
            </div>
          )}

          {/* Dodatne informacije */}
          <div className="mt-3 grid grid-cols-2 gap-4">
            <div>
              <div className="text-xs text-white/50 mb-1">Airline Code</div>
              <div className="text-sm text-white">{flight.AirlineCode || '--'}</div>
            </div>
            <div>
              <div className="text-xs text-white/50 mb-1">ICAO</div>
              <div className="text-sm text-white">{flight.AirlineICAO || '--'}</div>
            </div>
          </div>

          {/* Dugmad za Open/Close check-in */}
          {isDeparture && flight.CheckInDesk && (
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleCheckInToggleClick('open');
                }}
                disabled={isUpdating}
                className="flex-1 py-2 px-4 bg-green-600/20 hover:bg-green-600/30 text-green-400 rounded-lg border border-green-500/30 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                <Power className="w-4 h-4" />
                {isUpdating ? 'Čekajte...' : 'Otvori Check-in'}
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleCheckInToggleClick('close');
                }}
                disabled={isUpdating}
                className="flex-1 py-2 px-4 bg-red-600/20 hover:bg-red-600/30 text-red-400 rounded-lg border border-red-500/30 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                <PowerOff className="w-4 h-4" />
                {isUpdating ? 'Čekajte...' : 'Zatvori Check-in'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// Funkcija za uklanjanje duplikata
const removeDuplicates = (arr: string[]): string[] => {
  const seen: Record<string, boolean> = {};
  return arr.filter((item) => {
    if (seen[item]) {
      return false;
    }
    seen[item] = true;
    return true;
  });
};

// Funkcija za konsolidaciju letova
const consolidateFlights = (flights: Flight[]): Flight[] => {
  const flightMap = new Map<string, Flight>();

  flights.forEach((flight) => {
    const baseKey = `${flight.FlightNumber}-${flight.ScheduledDepartureTime}`;

    if (flightMap.has(baseKey)) {
      const existingFlight = flightMap.get(baseKey)!;

      // Konsoliduj gate-ove
      if (flight.GateNumber && existingFlight.GateNumber) {
        const existingGates = existingFlight.GateNumber.split(',').map(g => g.trim());
        const newGates = flight.GateNumber.split(',').map(g => g.trim());
        const allGates = removeDuplicates([...existingGates, ...newGates]);
        existingFlight.GateNumber = allGates.join(', ');
      } else if (flight.GateNumber && !existingFlight.GateNumber) {
        existingFlight.GateNumber = flight.GateNumber;
      }

      // Konsoliduj check-in desk
      if (flight.CheckInDesk && existingFlight.CheckInDesk) {
        const existingDesks = existingFlight.CheckInDesk.split(',').map(d => d.trim());
        const newDesks = flight.CheckInDesk.split(',').map(d => d.trim());
        const allDesks = removeDuplicates([...existingDesks, ...newDesks]);
        existingFlight.CheckInDesk = allDesks.join(', ');
      } else if (flight.CheckInDesk && !existingFlight.CheckInDesk) {
        existingFlight.CheckInDesk = flight.CheckInDesk;
      }

      // Ažuriraj ostale podatke
      if (!existingFlight.AirlineName && flight.AirlineName) {
        existingFlight.AirlineName = flight.AirlineName;
      }
      if (!existingFlight.AirlineCode && flight.AirlineCode) {
        existingFlight.AirlineCode = flight.AirlineCode;
      }

      // Ažuriraj status
      if (flight.StatusEN && !existingFlight.StatusEN) {
        existingFlight.StatusEN = flight.StatusEN;
      }
      if (flight.StatusMN && !existingFlight.StatusMN) {
        existingFlight.StatusMN = flight.StatusMN;
      }
    } else {
      flightMap.set(baseKey, { ...flight });
    }
  });

  return Array.from(flightMap.values());
};

// Funkcija za generisanje jedinstvenog key-a
const generateFlightKey = (flight: Flight, index: number): string => {
  const baseKey = `${flight.FlightNumber}-${flight.ScheduledDepartureTime || 'no-time'}`;

  const additionalKeys = [
    flight.GateNumber,
    flight.CheckInDesk,
    flight.Terminal,
    flight.AirlineCode,
    index.toString()
  ].filter(Boolean).join('-');

  return `${baseKey}-${additionalKeys}`.replace(/\s+/g, '-');
};

interface FlightsData {
  departures: Flight[];
  arrivals: Flight[];
}

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

  // Prvo definiši loadFlights
  const loadFlights = useCallback(async (silent = false) => {
    try {
      if (!silent) setLoading(true);
      setRefreshing(true);
      setError(null);

      const response = await fetch('/api/flights', {
        cache: 'no-store',
        headers: {
          'Cache-Control': 'no-cache'
        }
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: Greška pri učitavanju letova`);
      }

      const data = await response.json();

      // Ukloni duplikate i konsoliduj letove
      const removeDuplicatesAndConsolidate = (flightArray: Flight[]): Flight[] => {
        const consolidated = consolidateFlights(flightArray);
        const seen: Record<string, boolean> = {};

        return consolidated.filter((flight) => {
          const uniqueId = `${flight.FlightNumber}-${flight.ScheduledDepartureTime}-${flight.GateNumber || 'nogate'}-${flight.CheckInDesk || 'nodesk'}`;

          if (seen[uniqueId]) {
            return false;
          }

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

  // Onda definiši handleCheckInToggle koji koristi loadFlights
  const handleCheckInToggle = useCallback(async (flightNumber: string, deskNumber: string, action: 'open' | 'close') => {
    try {
      const response = await fetch('/api/admin/checkin-toggle', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          flightNumber,
          deskNumber,
          action,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to update check-in status');
      }

      const result = await response.json();
      alert(result.message || `Check-in ${action === 'open' ? 'otvoren' : 'zatvoren'} uspješno!`);
      
      // Osvježi podatke nakon uspješne promjene
      await loadFlights(true);
    } catch (error) {
      console.error('Error toggling check-in:', error);
      alert(error instanceof Error ? error.message : 'Došlo je do greške prilikom ažuriranja statusa check-in-a.');
      throw error;
    }
  }, [loadFlights]);

  // Učitaj letove pri mountovanju
  useEffect(() => {
    loadFlights();
  }, [loadFlights]);

  const handleRefresh = useCallback(() => {
    loadFlights(true);
  }, [loadFlights]);

  const handleLogout = useCallback(async () => {
    try {
      await fetch('/api/admin/logout', { method: 'POST' });
    } catch (error) {
      console.error('Logout error:', error);
    } finally {
      router.push('/admin/login');
    }
  }, [router]);

  // Filtriraj letove
  const getFilteredFlights = useMemo(() => {
    let filtered: Flight[] = [];

    if (activeTab === 'all') {
      filtered = [...flights.departures, ...flights.arrivals];
    } else if (activeTab === 'departures') {
      filtered = flights.departures;
    } else if (activeTab === 'arrivals') {
      filtered = flights.arrivals;
    }

    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      filtered = filtered.filter((flight) =>
        flight.FlightNumber?.toLowerCase().includes(term) ||
        flight.AirlineName?.toLowerCase().includes(term) ||
        flight.DestinationCityName?.toLowerCase().includes(term) ||
        flight.DestinationAirportName?.toLowerCase().includes(term) ||
        flight.DestinationAirportCode?.toLowerCase().includes(term)
      );
    }

    if (airlineFilter !== 'all') {
      filtered = filtered.filter((flight) =>
        flight.AirlineName?.toLowerCase() === airlineFilter.toLowerCase()
      );
    }

    // Sortiraj po vremenu
    return filtered.sort((a, b) => {
      const timeA = a.ScheduledDepartureTime || '00:00';
      const timeB = b.ScheduledDepartureTime || '00:00';
      return timeA.localeCompare(timeB);
    });
  }, [activeTab, flights, searchTerm, airlineFilter]);

  // Get unique airlines for filter
  const uniqueAirlines = useMemo(() => {
    const allFlights = [...flights.departures, ...flights.arrivals];
    const seenAirlines: Record<string, boolean> = {};

    return allFlights
      .map((f) => f.AirlineName)
      .filter((name): name is string => {
        if (!name) return false;
        if (seenAirlines[name]) return false;
        seenAirlines[name] = true;
        return true;
      })
      .sort((a, b) => a.localeCompare(b));
  }, [flights]);

  // Formatiraj datum
  const formatDate = useCallback((dateString: string) => {
    try {
      const date = new Date(dateString);
      if (Number.isNaN(date.getTime())) {
        return 'Nepoznato';
      }
      return date.toLocaleString('sr-Latn-RS', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch {
      return 'Nepoznato';
    }
  }, []);

  // Vrijeme od ažuriranja
  const getTimeSinceUpdate = useCallback(() => {
    if (!lastUpdated) return 'Nepoznato';

    try {
      const lastUpdate = new Date(lastUpdated);
      if (Number.isNaN(lastUpdate.getTime())) {
        return 'Nepoznato';
      }
      const now = new Date();
      const diffMs = now.getTime() - lastUpdate.getTime();
      const diffMins = Math.floor(diffMs / 60000);

      if (diffMins < 1) return 'upravo sada';
      if (diffMins === 1) return 'pre 1 minut';
      if (diffMins < 60) return `pre ${diffMins} minuta`;

      const diffHours = Math.floor(diffMins / 60);
      if (diffHours === 1) return 'pre 1 sat';
      if (diffHours < 24) return `pre ${diffHours} sati`;

      const diffDays = Math.floor(diffHours / 24);
      if (diffDays === 1) return 'pre 1 dan';
      return `pre ${diffDays} dana`;
    } catch {
      return 'Nepoznato';
    }
  }, [lastUpdated]);

  const today = useMemo(() => {
    return new Date().toLocaleDateString('sr-Latn-RS', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    });
  }, []);

  const filteredFlights = getFilteredFlights;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 p-4 md:p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <header className="mb-8">
          <div className="flex justify-between items-start">
            <div>
              <div className="flex items-center gap-4 mb-2">
                <Link
                  href="/admin"
                  className="p-2 text-slate-400 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
                  title="Nazad na dashboard"
                >
                  <Home className="w-5 h-5" />
                </Link>
                <h1 className="text-3xl font-bold text-white">Red letenja</h1>
                <div className={`flex items-center gap-2 px-3 py-1 rounded-full text-sm ${systemStatus === 'online' ? 'bg-green-900/30 text-green-400' : 'bg-yellow-900/30 text-yellow-400'}`}>
                  <div className={`w-2 h-2 rounded-full ${systemStatus === 'online' ? 'bg-green-500' : 'bg-yellow-500'}`} />
                  {systemStatus === 'online' ? 'LIVE' : 'BACKUP'}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-4 text-sm text-slate-300">
                <div className="flex items-center gap-2">
                  <Calendar className="w-4 h-4" />
                  <span>{today}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Clock className="w-4 h-4" />
                  <span>Poslednje ažuriranje: {getTimeSinceUpdate()}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Plane className="w-4 h-4" />
                  <span>
                    {flights.departures.length} polazaka • {flights.arrivals.length} dolazaka
                  </span>
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-3">
              <div className="flex gap-2">
                <button
                  onClick={handleRefresh}
                  disabled={refreshing}
                  className="p-2 text-slate-400 hover:text-white hover:bg-white/10 rounded-lg transition-colors disabled:opacity-50"
                  title="Osveži podatke"
                  type="button"
                >
                  <RefreshCw className={`w-5 h-5 ${refreshing ? 'animate-spin' : ''}`} />
                </button>
                <button
                  onClick={handleLogout}
                  className="flex items-center gap-2 px-4 py-2 bg-red-600/20 hover:bg-red-600/30 text-red-300 rounded-lg border border-red-500/30 transition-colors"
                  type="button"
                >
                  <LogOut className="w-4 h-4" />
                  Odjavi se
                </button>
              </div>

              {error && (
                <div className="text-right">
                  <div className="text-sm text-red-400">⚠️ {error}</div>
                </div>
              )}
            </div>
          </div>
        </header>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
          <div className="bg-white/5 backdrop-blur-sm rounded-xl p-4 border border-white/10">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm text-white/60">Ukupno letova</div>
                <div className="text-2xl font-bold text-white mt-1">
                  {loading ? '...' : flights.departures.length + flights.arrivals.length}
                </div>
              </div>
              <div className="p-2 bg-blue-500/20 rounded-lg">
                <Plane className="w-6 h-6 text-blue-400" />
              </div>
            </div>
          </div>

          <div className="bg-white/5 backdrop-blur-sm rounded-xl p-4 border border-white/10">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm text-white/60">Polasci</div>
                <div className="text-2xl font-bold text-blue-400 mt-1">
                  {loading ? '...' : flights.departures.length}
                </div>
              </div>
              <div className="p-2 bg-blue-500/20 rounded-lg">
                <ArrowUpRight className="w-6 h-6 text-blue-400" />
              </div>
            </div>
          </div>

          <div className="bg-white/5 backdrop-blur-sm rounded-xl p-4 border border-white/10">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm text-white/60">Dolasci</div>
                <div className="text-2xl font-bold text-green-400 mt-1">
                  {loading ? '...' : flights.arrivals.length}
                </div>
              </div>
              <div className="p-2 bg-green-500/20 rounded-lg">
                <ArrowDownRight className="w-6 h-6 text-green-400" />
              </div>
            </div>
          </div>

          <div className="bg-white/5 backdrop-blur-sm rounded-xl p-4 border border-white/10">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm text-white/60">Aktivni letovi</div>
                <div className="text-2xl font-bold text-white mt-1">
                  {loading ? '...' : filteredFlights.length}
                </div>
              </div>
              <div className="p-2 bg-yellow-500/20 rounded-lg">
                <Clock className="w-6 h-6 text-yellow-400" />
              </div>
            </div>
          </div>
        </div>

        {/* Filters */}
        <div className="bg-white/5 backdrop-blur-sm rounded-xl p-4 border border-white/10 mb-8">
          <div className="flex flex-col md:flex-row gap-4">
            {/* Tabs */}
            <div className="flex border-b border-white/10 md:border-none">
              <button
                onClick={() => setActiveTab('all')}
                className={`px-4 py-2 rounded-t-lg md:rounded-lg transition-colors ${
                  activeTab === 'all'
                    ? 'bg-blue-600 text-white'
                    : 'text-white/70 hover:text-white hover:bg-white/10'
                }`}
                type="button"
              >
                Svi letovi ({flights.departures.length + flights.arrivals.length})
              </button>
              <button
                onClick={() => setActiveTab('departures')}
                className={`px-4 py-2 transition-colors ${
                  activeTab === 'departures'
                    ? 'bg-blue-600 text-white'
                    : 'text-white/70 hover:text-white hover:bg-white/10'
                }`}
                type="button"
              >
                Polasci ({flights.departures.length})
              </button>
              <button
                onClick={() => setActiveTab('arrivals')}
                className={`px-4 py-2 rounded-b-lg md:rounded-lg transition-colors ${
                  activeTab === 'arrivals'
                    ? 'bg-blue-600 text-white'
                    : 'text-white/70 hover:text-white hover:bg-white/10'
                }`}
                type="button"
              >
                Dolasci ({flights.arrivals.length})
              </button>
            </div>

            {/* Search */}
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-white/40" />
              <input
                type="text"
                placeholder="Pretraži letove (broj leta, destinacija, kompanija...)"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2 bg-white/10 border border-white/20 rounded-lg text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>

            {/* Airline Filter */}
            <div className="relative">
              <select
                value={airlineFilter}
                onChange={(e) => setAirlineFilter(e.target.value)}
                className="w-full px-4 py-2 bg-white/10 border border-white/20 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent appearance-none pr-10"
              >
                <option value="all">Sve avio kompanije</option>
                {uniqueAirlines.map((airline) => (
                  <option key={airline} value={airline}>
                    {airline}
                  </option>
                ))}
              </select>
              <ChevronDown className="absolute right-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-white/40 pointer-events-none" />
            </div>
          </div>
        </div>

        {/* Flights List */}
        <div className="space-y-4">
          {loading ? (
            // Loading skeleton
            <div className="space-y-4">
              {[...Array(5)].map((_, i) => (
                <div key={`skeleton-${i}`} className="bg-white/5 border border-white/10 rounded-xl p-4 animate-pulse">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 bg-white/10 rounded-lg"></div>
                      <div>
                        <div className="h-6 w-32 bg-white/10 rounded mb-2"></div>
                        <div className="h-4 w-48 bg-white/10 rounded"></div>
                      </div>
                    </div>
                    <div className="flex items-center gap-6">
                      <div className="text-right">
                        <div className="h-6 w-16 bg-white/10 rounded mb-1"></div>
                        <div className="h-4 w-24 bg-white/10 rounded"></div>
                      </div>
                      <div className="h-4 w-24 bg-white/10 rounded"></div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : filteredFlights.length === 0 ? (
            // No flights
            <div className="text-center py-12 bg-white/5 backdrop-blur-sm rounded-xl border border-white/10">
              <Plane className="w-16 h-16 text-white/20 mx-auto mb-4" />
              <div className="text-xl text-white/70 mb-2">Nema letova</div>
              <div className="text-white/50">
                {searchTerm || airlineFilter !== 'all'
                  ? 'Nema letova za odabrane filtere'
                  : 'Nema današnjih letova u sistemu'}
              </div>
            </div>
          ) : (
            // Flights list
            filteredFlights.map((flight, index) => {
              const flightKey = generateFlightKey(flight, index);
              return (
                <FlightCard
                  key={flightKey}
                  flightKey={flightKey}
                  flight={flight}
                  onCheckInToggle={handleCheckInToggle}
                />
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="mt-8 pt-6 border-t border-white/10">
          <div className="flex flex-col md:flex-row justify-between items-center gap-4">
            <div className="text-sm text-white/50">
              {lastUpdated && `Sistem ažuriran: ${formatDate(lastUpdated)}`}
            </div>

            <div className="flex items-center gap-4">
              {systemStatus === 'offline' && (
                <div className="px-3 py-1 bg-yellow-900/20 text-yellow-400 rounded-full text-sm">
                  ⚠️ Backup mode aktiviran
                </div>
              )}

              <div className="text-sm text-white/50">
                Prikazano: {filteredFlights.length} od {flights.departures.length + flights.arrivals.length} letova
              </div>

              <button
                onClick={handleRefresh}
                disabled={refreshing}
                className="flex items-center gap-2 px-4 py-2 bg-white/10 hover:bg-white/20 text-white rounded-lg transition-colors disabled:opacity-50"
                type="button"
              >
                <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
                {refreshing ? 'Osvežava se...' : 'Osveži'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}