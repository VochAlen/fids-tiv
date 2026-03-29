'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { 
  Plane, 
  Settings, 
  LogOut, 
  Building,
  MapPin,
  Calendar,
  BarChart3,
  Clock,
  Users,
  Activity,
  RefreshCw
} from 'lucide-react';

// Helper funkcije za obradu datuma
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

// Tipovi za letove
interface Flight {
  FlightNumber: string;
  Airline: string;
  Destination?: string;
  Origin?: string;
  FlightType: 'departure' | 'arrival';
  ScheduleTime: string;
  Status?: string;
  Gate?: string;
  Terminal?: string;
}

interface FlightStats {
  totalFlights: number;
  departures: number;
  arrivals: number;
  todayFlights: number;
  activeAirlines: number;
  delayedFlights: number;
}

export default function AdminDashboard() {
  const router = useRouter();
  const [stats, setStats] = useState<FlightStats>({
    totalFlights: 0,
    departures: 0,
    arrivals: 0,
    todayFlights: 0,
    activeAirlines: 0,
    delayedFlights: 0
  });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<string>('');
  const [systemStatus, setSystemStatus] = useState<'online' | 'offline'>('online');
  const [recentFlights, setRecentFlights] = useState<Flight[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Učitaj statistiku odmah - middleware će se pobrinuti za autentifikaciju
    loadFlightStats();
  }, []);

  const loadFlightStats = useCallback(async (showLoading: boolean = true) => {
    try {
      if (showLoading) {
        setLoading(true);
      }
      setRefreshing(true);
      setError(null);
      
      const response = await fetch('/api/flights', {
        cache: 'no-store'
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: Greška pri učitavanju podataka`);
      }
      
      const data = await response.json();
      
      const totalFlights = data.totalFlights || 0;
      const departures = data.departures || [];
      const arrivals = data.arrivals || [];
      const allFlights = [...departures, ...arrivals];
      
      // Računajmo jedinstvene avio kompanije
      const seenAirlines: Record<string, boolean> = {};
      const uniqueAirlines = allFlights
        .map(flight => flight.Airline)
        .filter(Boolean)
        .filter((airline): airline is string => {
          if (typeof airline !== 'string') return false;
          if (seenAirlines[airline]) return false;
          seenAirlines[airline] = true;
          return true;
        });
      
      // Računajmo odložene letove
      const delayedFlights = allFlights.filter(flight => 
        flight.Status && (
          flight.Status.toLowerCase().includes('delay') || 
          flight.Status.toLowerCase().includes('late') ||
          flight.Status.toLowerCase().includes('odložen')
        )
      ).length;
      
      // Skupljamo najnovije letove za prikaz
      const sortedFlights = allFlights
        .filter(flight => flight.ScheduleTime)
        .sort((a, b) => {
          const timeA = a.ScheduleTime || '';
          const timeB = b.ScheduleTime || '';
          return timeB.localeCompare(timeA);
        })
        .slice(0, 5);
      
      setStats({
        totalFlights,
        departures: departures.length,
        arrivals: arrivals.length,
        todayFlights: totalFlights,
        activeAirlines: uniqueAirlines.length,
        delayedFlights
      });
      
      setLastUpdated(data.lastUpdated || new Date().toISOString());
      setSystemStatus(data.isOfflineMode ? 'offline' : 'online');
      setRecentFlights(sortedFlights);
      
    } catch (error) {
      console.error('Error loading flight stats:', error);
      
      if (error instanceof Error) {
        setError(error.message || 'Greška pri učitavanju podataka');
      } else {
        setError('Greška pri učitavanju podataka');
      }
      
      // Fallback na default vrednosti
      setStats({
        totalFlights: 32,
        departures: 18,
        arrivals: 14,
        todayFlights: 32,
        activeAirlines: 12,
        delayedFlights: 3
      });
      setSystemStatus('offline');
      setLastUpdated(new Date().toISOString());
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const handleRefresh = useCallback(() => {
    loadFlightStats(false);
  }, [loadFlightStats]);

const handleLogout = useCallback(async () => {
    try {
      const response = await fetch('/api/admin/logout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });
      
      if (!response.ok) {
        console.error('Logout failed:', response.status);
      }
      
      // Izbriši sve lokalne podatke
      if (typeof window !== 'undefined') {
        // Očisti bilo kakve cached podatke
        sessionStorage.clear();
        localStorage.clear();
      }
      
    } catch (error) {
      console.error('Logout API error:', error);
    } finally {
      // Forsuj redirect na login
      window.location.href = '/admin/login';
    }
  }, []);
  
  // Računanje vremena od ažuriranja
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
      return `pre ${diffHours} sati`;
    } catch {
      return 'Nepoznato';
    }
  }, [lastUpdated]);

  // Formatiraj trenutni datum za prikaz
  const currentDate = new Date().toLocaleDateString('sr-Latn-RS', { 
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  });

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 p-4 md:p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <header className="mb-8">
          <div className="flex justify-between items-center">
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-3xl font-bold text-white">Administracija</h1>
                <div className={`flex items-center gap-2 px-3 py-1 rounded-full text-sm ${systemStatus === 'online' ? 'bg-green-900/30 text-green-400' : 'bg-yellow-900/30 text-yellow-400'}`}>
                  <div className={`w-2 h-2 rounded-full ${systemStatus === 'online' ? 'bg-green-500' : 'bg-yellow-500'}`} />
                  {systemStatus === 'online' ? 'ONLINE' : 'BACKUP MODE'}
                </div>
              </div>
              <p className="text-white/80 mt-2">Tivat Airport Check-in System</p>
              
              {/* Status bar */}
              <div className="mt-3 flex items-center gap-4 text-sm">
                <div className="flex items-center gap-2 text-slate-400">
                  <Clock size={14} />
                  <span>Poslednje ažuriranje: {getTimeSinceUpdate()}</span>
                </div>
                <div className="flex items-center gap-2 text-slate-400">
                  <Activity size={14} />
                  <span>Total letova: {stats.totalFlights}</span>
                </div>
                {error && (
                  <div className="flex items-center gap-2 text-red-400">
                    <span>⚠️ {error}</span>
                  </div>
                )}
              </div>
            </div>
            
            <div className="flex items-center gap-4">
              <div className="hidden md:block text-right">
                <div className="text-sm text-slate-400">Trenutni dan</div>
                <div className="text-white font-medium">
                  {currentDate}
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleRefresh}
                  disabled={refreshing}
                  className="p-2 text-slate-400 hover:text-white hover:bg-white/10 rounded-lg transition-colors disabled:opacity-50"
                  title="Osveži podatke"
                  type="button"
                >
                  <RefreshCw size={18} className={refreshing ? 'animate-spin' : ''} />
                </button>
                <button
                  onClick={handleLogout}
                  className="flex items-center gap-2 px-4 py-2 bg-red-600/20 hover:bg-red-600/30 text-red-300 rounded-lg border border-red-500/30 transition-colors"
                  type="button"
                >
                  <LogOut size={18} />
                  Odjavi se
                </button>
              </div>
            </div>
          </div>
        </header>

        {/* Quick Stats */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <div className="bg-white/5 backdrop-blur-sm rounded-xl p-6 border border-white/10 hover:bg-white/10 transition-all duration-200">
            <div className="flex items-center justify-between mb-4">
              <div className="p-3 bg-blue-600/20 rounded-lg">
                <Plane className="w-6 h-6 text-blue-400" />
              </div>
              {loading ? (
                <div className="h-8 w-20 bg-slate-700/50 rounded animate-pulse" />
              ) : (
                <div className="text-blue-400 font-bold text-3xl">{stats.todayFlights}</div>
              )}
            </div>
            <div className="text-white/70 text-sm">Današnjih letova</div>
            <div className="text-white/50 text-xs mt-1">
              {stats.departures} polazaka, {stats.arrivals} dolazaka
            </div>
          </div>
          
          <div className="bg-white/5 backdrop-blur-sm rounded-xl p-6 border border-white/10 hover:bg-white/10 transition-all duration-200">
            <div className="flex items-center justify-between mb-4">
              <div className="p-3 bg-green-600/20 rounded-lg">
                <Building className="w-6 h-6 text-green-400" />
              </div>
              {loading ? (
                <div className="h-8 w-20 bg-slate-700/50 rounded animate-pulse" />
              ) : (
                <div className="text-green-400 font-bold text-3xl">{stats.activeAirlines}</div>
              )}
            </div>
            <div className="text-white/70 text-sm">Aktivnih kompanija</div>
            <div className="text-white/50 text-xs mt-1">
              {stats.delayedFlights > 0 ? `${stats.delayedFlights} odgođenih` : 'Svi letovi na vreme'}
            </div>
          </div>
          
          <div className="bg-white/5 backdrop-blur-sm rounded-xl p-6 border border-white/10 hover:bg-white/10 transition-all duration-200">
            <div className="flex items-center justify-between mb-4">
              <div className="p-3 bg-purple-600/20 rounded-lg">
                <Users className="w-6 h-6 text-purple-400" />
              </div>
              <div className="text-purple-400 font-bold text-3xl">24/7</div>
            </div>
            <div className="text-white/70 text-sm">Sistem aktivan</div>
            <div className="text-white/50 text-xs mt-1">
              {systemStatus === 'online' ? 'Live podaci' : 'Backup sistem'}
            </div>
          </div>
          
          <div className="bg-white/5 backdrop-blur-sm rounded-xl p-6 border border-white/10 hover:bg-white/10 transition-all duration-200">
            <div className="flex items-center justify-between mb-4">
              <div className="p-3 bg-yellow-600/20 rounded-lg">
                <Activity className="w-6 h-6 text-yellow-400" />
              </div>
              {loading ? (
                <div className="h-8 w-20 bg-slate-700/50 rounded animate-pulse" />
              ) : (
                <div className="text-yellow-400 font-bold text-3xl">{stats.totalFlights}</div>
              )}
            </div>
            <div className="text-white/70 text-sm">Ukupno letova</div>
            <div className="text-white/50 text-xs mt-1">
              U sistemu • Real-time ažurirano
            </div>
          </div>
        </div>

        {/* Main Navigation */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
          <Link
            href="/admin/business-class"
            className="bg-white/5 backdrop-blur-sm rounded-xl p-6 border border-white/10 hover:bg-white/10 hover:border-white/20 transition-all duration-200 group"
          >
            <div className="flex items-start gap-4">
              <div className="p-3 bg-blue-600/20 rounded-lg text-blue-400 group-hover:bg-blue-600/30 transition-colors">
                <Plane className="w-6 h-6" />
              </div>
              <div>
                <h3 className="font-bold text-lg text-white mb-1">Business Class</h3>
                <p className="text-white/70 text-sm">
                  Konfigurišite business class letove, avio kompanije i destinacije
                </p>
              </div>
            </div>
          </Link>

          <Link
            href="/admin/flights"
            className="bg-white/5 backdrop-blur-sm rounded-xl p-6 border border-white/10 hover:bg-white/10 hover:border-white/20 transition-all duration-200 group"
          >
            <div className="flex items-start gap-4">
              <div className="p-3 bg-green-600/20 rounded-lg text-green-400 group-hover:bg-green-600/30 transition-colors">
                <Calendar className="w-6 h-6" />
              </div>
              <div>
                <h3 className="font-bold text-lg text-white mb-1">Letovi</h3>
                <p className="text-white/70 text-sm">
                  Upravljajte svim letovima i rasporedima
                </p>
              </div>
            </div>
          </Link>

          <Link
            href="/admin/airlines"
            className="bg-white/5 backdrop-blur-sm rounded-xl p-6 border border-white/10 hover:bg-white/10 hover:border-white/20 transition-all duration-200 group"
          >
            <div className="flex items-start gap-4">
              <div className="p-3 bg-purple-600/20 rounded-lg text-purple-400 group-hover:bg-purple-600/30 transition-colors">
                <Building className="w-6 h-6" />
              </div>
              <div>
                <h3 className="font-bold text-lg text-white mb-1">Avio kompanije</h3>
                <p className="text-white/70 text-sm">
                  Upravljajte avio kompanijama i njihovim podacima
                </p>
              </div>
            </div>
          </Link>

          <Link
            href="/admin/destinations"
            className="bg-white/5 backdrop-blur-sm rounded-xl p-6 border border-white/10 hover:bg-white/10 hover:border-white/20 transition-all duration-200 group"
          >
            <div className="flex items-start gap-4">
              <div className="p-3 bg-yellow-600/20 rounded-lg text-yellow-400 group-hover:bg-yellow-600/30 transition-colors">
                <MapPin className="w-6 h-6" />
              </div>
              <div>
                <h3 className="font-bold text-lg text-white mb-1">Destinacije</h3>
                <p className="text-white/70 text-sm">
                  Upravljajte svim destinacijama i rutama
                </p>
              </div>
            </div>
          </Link>

          <Link
            href="/admin/analytics"
            className="bg-white/5 backdrop-blur-sm rounded-xl p-6 border border-white/10 hover:bg-white/10 hover:border-white/20 transition-all duration-200 group"
          >
            <div className="flex items-start gap-4">
              <div className="p-3 bg-red-600/20 rounded-lg text-red-400 group-hover:bg-red-600/30 transition-colors">
                <BarChart3 className="w-6 h-6" />
              </div>
              <div>
                <h3 className="font-bold text-lg text-white mb-1">Analitika</h3>
                <p className="text-white/70 text-sm">
                  Pregled statistike i izvještaja
                </p>
              </div>
            </div>
          </Link>

          <Link
            href="/admin/settings"
            className="bg-white/5 backdrop-blur-sm rounded-xl p-6 border border-white/10 hover:bg-white/10 hover:border-white/20 transition-all duration-200 group"
          >
            <div className="flex items-start gap-4">
              <div className="p-3 bg-gray-600/20 rounded-lg text-gray-400 group-hover:bg-gray-600/30 transition-colors">
                <Settings className="w-6 h-6" />
              </div>
              <div>
                <h3 className="font-bold text-lg text-white mb-1">Postavke</h3>
                <p className="text-white/70 text-sm">
                  Sistemske postavke i konfiguracije
                </p>
              </div>
            </div>
          </Link>
        </div>

        {/* Recent Activity & Latest Flights */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Recent Activity */}
          <div className="bg-white/5 backdrop-blur-sm rounded-xl p-6 border border-white/10">
            <h3 className="font-bold text-lg text-white mb-4">Sistemske aktivnosti</h3>
            <div className="space-y-4">
              <div className="flex items-center justify-between p-3 bg-white/5 rounded-lg">
                <div className="flex items-center gap-3">
                  <div className={`w-2 h-2 rounded-full ${systemStatus === 'online' ? 'bg-green-500' : 'bg-yellow-500'}`} />
                  <span className="text-white/90">
                    {systemStatus === 'online' ? 'Live sistem aktivan' : 'Backup sistem aktivan'}
                  </span>
                </div>
                <span className="text-white/60 text-sm">{getTimeSinceUpdate()}</span>
              </div>
              <div className="flex items-center justify-between p-3 bg-white/5 rounded-lg">
                <div className="flex items-center gap-3">
                  <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
                  <span className="text-white/90">Podaci ažurirani</span>
                </div>
                <span className="text-white/60 text-sm">{getTimeSinceUpdate()}</span>
              </div>
              <div className="flex items-center justify-between p-3 bg-white/5 rounded-lg">
                <div className="flex items-center gap-3">
                  <div className="w-2 h-2 bg-purple-500 rounded-full"></div>
                  <span className="text-white/90">Business Class konfiguracija</span>
                </div>
                <span className="text-white/60 text-sm">spremano</span>
              </div>
              <div className="flex items-center justify-between p-3 bg-white/5 rounded-lg">
                <div className="flex items-center gap-3">
                  <div className="w-2 h-2 bg-yellow-500 rounded-full"></div>
                  <span className="text-white/90">Letovi u sistemu</span>
                </div>
                <span className="text-white/60 text-sm">{stats.totalFlights}</span>
              </div>
            </div>
          </div>

          {/* Latest Flights */}
          <div className="bg-white/5 backdrop-blur-sm rounded-xl p-6 border border-white/10">
            <div className="flex justify-between items-center mb-4">
              <h3 className="font-bold text-lg text-white">Nedavni letovi</h3>
              <div className="flex items-center gap-2">
                <span className="text-sm text-slate-400">
                  {refreshing ? 'Ažuriranje...' : loading ? 'Učitavanje...' : ''}
                </span>
                <button 
                  onClick={handleRefresh}
                  disabled={refreshing}
                  className="text-sm text-blue-400 hover:text-blue-300 flex items-center gap-1 disabled:opacity-50 transition-colors"
                  type="button"
                >
                  {refreshing ? (
                    <>
                      <div className="w-3 h-3 border-2 border-blue-400/30 border-t-blue-400 rounded-full animate-spin" />
                      <span>Osvežava se...</span>
                    </>
                  ) : (
                    <>
                      <RefreshCw size={14} />
                      <span>Osveži</span>
                    </>
                  )}
                </button>
              </div>
            </div>
            
            {loading ? (
              <div className="space-y-3">
                {[...Array(5)].map((_, i) => (
                  <div key={i} className="p-3 bg-white/5 rounded-lg animate-pulse">
                    <div className="h-4 bg-slate-700/50 rounded mb-2 w-3/4" />
                    <div className="h-3 bg-slate-700/50 rounded w-1/2" />
                  </div>
                ))}
              </div>
            ) : recentFlights.length > 0 ? (
              <div className="space-y-4">
                {recentFlights.map((flight, index) => (
                  <div key={index} className="flex items-center justify-between p-3 bg-white/5 rounded-lg hover:bg-white/10 transition-colors">
                    <div className="flex items-center gap-3">
                      <div className={`w-2 h-2 rounded-full ${flight.FlightType === 'departure' ? 'bg-blue-500' : 'bg-green-500'}`} />
                      <div>
                        <div className="text-white font-medium">{flight.FlightNumber}</div>
                        <div className="text-white/60 text-sm">
                          {flight.Airline} • {flight.FlightType === 'departure' ? 'za ' + (flight.Destination || 'Nepoznato') : 'iz ' + (flight.Origin || 'Nepoznato')}
                        </div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-white/90">{formatTime(flight.ScheduleTime)}</div>
                      {flight.Gate && (
                        <div className="text-white/60 text-xs">GATE {flight.Gate}</div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8">
                <div className="text-white/50">Nema dostupnih podataka o letovima</div>
                <button 
                  onClick={handleRefresh}
                  className="mt-2 text-sm text-blue-400 hover:text-blue-300 transition-colors"
                  type="button"
                >
                  Pokušaj ponovo
                </button>
              </div>
            )}
            
            <div className="mt-6 pt-4 border-t border-white/10">
              <div className="flex justify-between text-sm">
                <div className="text-white/60">
                  {stats.departures} polazaka • {stats.arrivals} dolazaka
                </div>
                <div className="flex items-center gap-1 text-white/60">
                  <div className="w-2 h-2 rounded-full bg-blue-500" />
                  <span>Polasci</span>
                  <div className="w-2 h-2 rounded-full bg-green-500 ml-2" />
                  <span>Dolasci</span>
                </div>
              </div>
            </div>
          </div>
        </div>
        
        {/* System Status Footer */}
        <div className="mt-8 pt-6 border-t border-white/10">
          <div className="flex flex-col md:flex-row justify-between items-center gap-4">
            <div className="text-sm text-white/50">
              Sistem ažuriran: {lastUpdated ? new Date(lastUpdated).toLocaleString('sr-Latn-RS') : 'Nepoznato'}
            </div>
            <div className="flex items-center gap-4">
              {systemStatus === 'offline' && (
                <div className="px-3 py-1 bg-yellow-900/20 text-yellow-400 rounded-full text-sm">
                  ⚠️ Backup mode aktiviran
                </div>
              )}
              <div className="text-sm text-white/50">
                © 2024 Tivat Airport Check-in System v1.0
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}