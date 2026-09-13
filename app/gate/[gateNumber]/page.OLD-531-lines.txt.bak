'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useParams } from 'next/navigation';
import type { Flight } from '@/types/flight';
import { fetchFlightData } from '@/lib/flight-service';
import {
  getEnhancedCheckInStatus,
  checkFlightStatus,
  type CheckInStatus,
} from '@/lib/check-in-service';
import { Clock, MapPin, Users, AlertCircle, DoorOpen } from 'lucide-react';

// ─── Konstante ───────────────────────────────────────────────
const REFRESH_INTERVAL_MS = 60_000;

// ─── Helpers ─────────────────────────────────────────────────

const getFlightawareLogoURL = (icaoCode: string): string => {
  if (!icaoCode) return 'https://via.placeholder.com/180x120?text=No+Logo';
  return `https://www.flightaware.com/images/airline_logos/180px/${icaoCode}.png`;
};

const parseDepartureTime = (timeString: string): Date | null => {
  if (!timeString) return null;
  try {
    if (timeString.includes('T')) {
      const date = new Date(timeString);
      if (!isNaN(date.getTime())) return date;
    }
    const [hours, minutes] = timeString.split(':').map(Number);
    if (isNaN(hours) || isNaN(minutes)) return null;
    const now = new Date();
    const d = new Date(now);
    d.setHours(hours, minutes, 0, 0);

    const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
    if (now.getTime() - d.getTime() > SIX_HOURS_MS) {
      d.setDate(d.getDate() + 1);
    }

    return d;
  } catch {
    return null;
  }
};

const formatTimeRemaining = (minutes: number): string => {
  if (minutes <= 0) return 'Now';
  if (minutes >= 60) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return m === 0 ? `in ${h} ${h === 1 ? 'hour' : 'hours'}` : `in ${h}h ${m}m`;
  }
  return `in ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`;
};

const isFlightTerminated = (statusEN: string): boolean => {
  const s = (statusEN || '').toLowerCase().trim();
  return (
    s.includes('departed') ||
    s.includes('cancelled') ||
    s.includes('canceled') ||
    s.includes('diverted') ||
    s.includes('arrived') ||
    s.includes('completed')
  );
};

const shouldDisplayFlight = (flight: Flight, status?: CheckInStatus): boolean => {
  // Nikad ne prikazuj departed, cancelled, diverted letove
  if (isFlightTerminated(flight.StatusEN || '')) return false;
  if (status) return status.shouldBeOpen || status.status === 'scheduled';
  const dep = parseDepartureTime(flight.ScheduledDepartureTime || '');
  if (!dep) return false;
  const minutesBefore = Math.floor((dep.getTime() - Date.now()) / 60_000);
  return minutesBefore > -30;
};

// Poredi samo ključna polja — izbjegava JSON.stringify (sporo + nepouzdano za Date)
const flightChanged = (a: Flight | null, b: Flight | null): boolean =>
  a?.FlightNumber !== b?.FlightNumber ||
  a?.ScheduledDepartureTime !== b?.ScheduledDepartureTime ||
  a?.StatusEN !== b?.StatusEN;

// ─── Komponenta ───────────────────────────────────────────────

export default function GatePage() {
  const params = useParams();
  const gateNumber = params.gateNumber as string;

  const [flight, setFlight] = useState<Flight | null>(null);
  const [checkInStatus, setCheckInStatus] = useState<CheckInStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState('');
  const [nextUpdate, setNextUpdate] = useState('');
  const [timeUntilDeparture, setTimeUntilDeparture] = useState<number | null>(null);
  const [timeUntilOpen, setTimeUntilOpen] = useState<number | null>(null);

  // FIX 1: ref prati trenutni flight — izbjegava stale closure u intervalima
  const isMountedRef = useRef(true);
  const currentFlightRef = useRef<Flight | null>(null);
  const currentStatusRef = useRef<CheckInStatus | null>(null);

  // ─── Countdown update ──────────────────────────────────────

  const updateCountdowns = useCallback((f: Flight | null, s: CheckInStatus | null) => {
    if (!f) {
      setTimeUntilDeparture(null);
      setTimeUntilOpen(null);
      return;
    }
    const dep = parseDepartureTime(f.ScheduledDepartureTime || '');
    if (dep) {
      setTimeUntilDeparture(Math.floor((dep.getTime() - Date.now()) / 60_000));
    }
    if (s?.checkInOpenTime) {
      setTimeUntilOpen(Math.max(0, Math.floor((s.checkInOpenTime.getTime() - Date.now()) / 60_000)));
    } else {
      setTimeUntilOpen(null);
    }
  }, []);

  // ─── Check-in status fetch ─────────────────────────────────

  const getFlightCheckInStatus = useCallback(async (f: Flight): Promise<CheckInStatus | null> => {
    try {
      return await getEnhancedCheckInStatus(
        f.FlightNumber,
        f.ScheduledDepartureTime || '',
        f.StatusEN || ''
      );
    } catch {
      return null;
    }
  }, []);

  // ─── Glavni data load ──────────────────────────────────────

  const loadFlights = useCallback(async () => {
    if (!isMountedRef.current) return;

    try {
      const data = await fetchFlightData();

      // Filtriraj letove za ovaj gate (podržava padding s nulama i višestruke gate-ove)
      const allFlightsForGate = data.departures.filter((f: Flight) => {
        if (!f.GateNumber) return false;
        const gates = f.GateNumber.split(',').map((g: string) => g.trim());
        return (
          gates.includes(gateNumber) ||
          gates.includes(gateNumber.replace(/^0+/, '')) ||
          gates.includes(gateNumber.padStart(2, '0'))
        );
      });

      const now = new Date();

      // FIX 2: Promise.all ispravno čeka sve check-in statuse paralelno
      // (u originalnom kodu .map(async ...) bez Promise.all ne garantuje
      // konzistentan redoslijed završetka)
      const flightsWithTime = await Promise.all(
        allFlightsForGate.map(async (f: Flight) => {
          const departureTime = parseDepartureTime(f.ScheduledDepartureTime || '');
          const status = await getFlightCheckInStatus(f);
          return { ...f, departureTime, checkInStatus: status };
        })
      );

      if (!isMountedRef.current) return;

      const validFlights = flightsWithTime.filter(
        (f) => f.departureTime !== null
      ) as (Flight & { departureTime: Date; checkInStatus: CheckInStatus | null })[];

      const sortedFlights = validFlights.sort(
        (a, b) => a.departureTime.getTime() - b.departureTime.getTime()
      );

      // Pronađi prvi prikazivi let (nije terminated, ima validno vrijeme)
      let currentFlight: (Flight & { checkInStatus: CheckInStatus | null }) | null = null;

      for (const f of sortedFlights) {
        if (shouldDisplayFlight(f, f.checkInStatus || undefined)) {
          currentFlight = f;
          break;
        }
      }

      // Fallback: prvi budući let koji nije terminated
      // (za slučaj da check-in još nije otvoren ali let postoji)
      if (!currentFlight) {
        currentFlight =
          sortedFlights.find(
            (f) => f.departureTime > now && !isFlightTerminated(f.StatusEN || '')
          ) ?? null;
      }

      // FIX 3: Poredi samo ključna polja umjesto JSON.stringify cijelog objekta
      // JSON.stringify je: a) O(n) na cijelom objektu, b) nesiguran za Date,
      // c) redoslijed ključeva nije garantovan u svim JS engineima
      if (flightChanged(currentFlight, currentFlightRef.current)) {
        currentFlightRef.current = currentFlight;
        currentStatusRef.current = currentFlight?.checkInStatus ?? null;
        setFlight(currentFlight);
        setCheckInStatus(currentFlight?.checkInStatus ?? null);
        updateCountdowns(currentFlight, currentFlight?.checkInStatus ?? null);
      }

      // Čak i ako se flight nije promijenio, ažuriraj timestamp
      if (isMountedRef.current) {
        const updateTime = new Date().toLocaleTimeString('en-GB');
        setLastUpdate(updateTime);
        setNextUpdate(new Date(Date.now() + REFRESH_INTERVAL_MS).toLocaleTimeString('en-GB'));
        // FIX 4: loading se gasi ovdje, bez hasInitialDataRef koji se nikad ne resetuje
        // (hasInitialDataRef bio problem pri navigaciji na drugi gate bez unmount)
        setLoading(false);
      }
    } catch (error) {
      console.error('Failed to load gate information:', error);
      if (isMountedRef.current) {
        setLoading(false);
      }
    }
  }, [gateNumber, getFlightCheckInStatus, updateCountdowns]);

  // ─── Inicijalni load + rekurzivni refresh ──────────────────

  useEffect(() => {
    isMountedRef.current = true;

    // FIX 5: Rekurzivni setTimeout umjesto setInterval
    // setInterval može "preklopiti" pozive ako fetch traje duže od intervala.
    // setTimeout čeka da prethodni fetch završi pa tek onda zakazuje sljedeći.
    let timeoutId: ReturnType<typeof setTimeout>;

    const scheduleNext = () => {
      timeoutId = setTimeout(async () => {
        if (isMountedRef.current) {
          await loadFlights();
          scheduleNext();
        }
      }, REFRESH_INTERVAL_MS);
    };

    loadFlights().then(scheduleNext);

    return () => {
      isMountedRef.current = false;
      clearTimeout(timeoutId);
    };
  }, [loadFlights]);

  // ─── Countdown interval ────────────────────────────────────

  useEffect(() => {
    // FIX 6: Interval ne ovisi o flight/checkInStatus state-u —
    // čita vrijednosti kroz ref-ove da izbjegne re-kreiranje pri svakom
    // flight update-u (stari kod resetovao interval svaki put)
    const interval = setInterval(() => {
      updateCountdowns(currentFlightRef.current, currentStatusRef.current);
    }, REFRESH_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [updateCountdowns]);
  // Namjerno bez flight/checkInStatus u deps — koristimo ref-ove gore

  // ─── Render helpers ───────────────────────────────────────

  const getStatusColor = (status: string): string => {
    const s = status.toLowerCase().trim();
    if (s.includes('boarding') || s.includes('gate open')) return 'text-green-400';
    if (s.includes('final call')) return 'text-red-400';
    if (s.includes('delay')) return 'text-red-400';
    if (s.includes('cancelled') || s.includes('canceled')) return 'text-red-600 line-through';
    if (s.includes('departed') || s.includes('diverted')) return 'text-gray-500 line-through';
    return 'text-yellow-400';
  };

  const handleImageError = (e: React.SyntheticEvent<HTMLImageElement>) => {
    e.currentTarget.src = 'https://via.placeholder.com/180x120?text=No+Logo';
  };

  const { isCancelled, isDiverted } = checkFlightStatus(flight?.StatusEN || '');

  // ─── Loading screen ───────────────────────────────────────

  if (loading) {
    return (
      <div className="w-screen h-screen bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900 text-white flex items-center justify-center">
        <div className="text-center">
          <div className="w-20 h-20 border-4 border-yellow-400 border-t-transparent rounded-full animate-spin mx-auto mb-6" />
          <div className="text-3xl text-slate-300">Loading gate information...</div>
          <div className="text-lg text-slate-500 mt-4">Checking for active flights</div>
        </div>
      </div>
    );
  }

  // ─── No flights screen ────────────────────────────────────

  if (!flight) {
    return (
      <div className="w-screen h-screen bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900 text-white flex items-center justify-center">
        <div className="text-center">
          <DoorOpen className="w-32 h-32 text-slate-400 mx-auto mb-8 opacity-50" />
          <div className="text-8xl font-bold text-slate-400 mb-2">Gate</div>
          <div className="text-[32rem] font-black text-orange-500 leading-none mb-6">
            {gateNumber}
          </div>
          <div className="text-4xl text-slate-500 mb-4">No flights scheduled</div>
          <div className="text-2xl text-slate-500 mb-8">
            No flights are currently assigned to this gate.
          </div>
          <div className="text-lg text-slate-700">
            Last updated: {lastUpdate} | Next update: {nextUpdate}
          </div>
        </div>
      </div>
    );
  }

  // ─── Active flight screen ─────────────────────────────────

  return (
    <div className="w-[95vw] h-[95vh] mx-auto bg-white/5 backdrop-blur-xl rounded-3xl border-2 border-white/10 shadow-2xl overflow-hidden">
      <div className="h-full grid grid-cols-12 gap-8 p-12 bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900">

        {/* ── Lijeva kolona ── */}
        <div className="col-span-6 flex flex-col justify-between">

          {/* Header */}
          <div className="mb-8">
            <div className="flex items-center gap-6 mb-6">
              <div className="p-5 bg-white/10 rounded-2xl backdrop-blur-sm border border-white/20">
                <DoorOpen className="w-12 h-12 text-yellow-400" />
              </div>
              <div>
                <h1 className="text-8xl font-black bg-gradient-to-r from-yellow-400 to-orange-400 bg-clip-text text-transparent leading-tight">
                  GATE {gateNumber}
                </h1>
                {isCancelled && (
                  <div className="text-3xl text-red-500 mt-4 font-bold">✈️ FLIGHT CANCELLED</div>
                )}
                {isDiverted && !isCancelled && (
                  <div className="text-3xl text-orange-500 mt-4 font-bold">✈️ FLIGHT DIVERTED</div>
                )}
                {!isCancelled && !isDiverted && timeUntilDeparture !== null && timeUntilDeparture > 0 && (
                  <div className="text-2xl text-slate-400 mt-4">
                    Departure {formatTimeRemaining(timeUntilDeparture)}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Flight info */}
          <div className="space-y-8 flex-1">

            {/* Logo + broj leta */}
            <div className="flex items-center gap-8">
              <div className="w-64 h-48 bg-white rounded-3xl p-6 shadow-2xl flex items-center justify-center">
                <img
                  src={getFlightawareLogoURL(flight.AirlineICAO)}
                  alt={flight.AirlineName}
                  className="w-full h-full object-contain"
                  onError={handleImageError}
                />
              </div>
              <div className="text-[11rem] font-black text-white mb-4 leading-tight">
                {flight.FlightNumber}
              </div>
            </div>

            {/* Codeshare */}
            {flight.CodeShareFlights && flight.CodeShareFlights.length > 0 && (
              <div className="flex items-center gap-4 bg-blue-500/20 px-6 py-3 rounded-2xl border border-blue-500/30">
                <Users className="w-8 h-8 text-blue-400" />
                <div className="text-2xl text-blue-300">
                  Also: {flight.CodeShareFlights.join(', ')}
                </div>
              </div>
            )}

            {/* Destinacija */}
            <div className="flex items-center gap-6">
              <MapPin className="w-12 h-12 text-cyan-400" />
              <div>
                <div className="text-[10rem] font-bold bg-gradient-to-r from-yellow-400 to-orange-400 bg-clip-text text-transparent leading-tight mb-2">
                  {flight.DestinationCityName}
                </div>
                <div className="text-5xl font-semibold text-cyan-400">
                  {flight.DestinationAirportCode}
                </div>
              </div>
            </div>

            {/* Check-in opens info */}
            {/* {checkInStatus?.status === 'scheduled' &&
              timeUntilOpen !== null &&
              timeUntilOpen > 0 && (
                <div className="mt-4 bg-blue-500/20 border border-blue-400/40 rounded-xl px-6 py-4">
                  <div className="text-2xl text-blue-300">
                    Check-in opens {formatTimeRemaining(timeUntilOpen)}
                  </div>
                </div>
              )} */}
          </div>

          {/* Footer */}
          <div className="mt-8">
            <div className="text-sm text-slate-400">Last Updated</div>
            <div className="text-xl font-mono text-slate-300">{lastUpdate}</div>
            <div className="text-sm text-slate-600">Next update: {nextUpdate}</div>
          </div>
        </div>

        {/* ── Desna kolona ── */}
        <div className="col-span-6 flex flex-col justify-between pl-12">

          {/* Vremena */}
          <div className="space-y-12">
            <div className="text-right">
              <div className="flex items-center justify-end gap-4 mb-4">
                <Clock className="w-10 h-10 text-slate-400" />
                <div className="text-3xl text-slate-400">Scheduled Departure</div>
              </div>
              <div className="text-9xl font-mono font-bold text-white leading-tight">
                {flight.ScheduledDepartureTime}
              </div>
            </div>

            {flight.EstimatedDepartureTime &&
              flight.EstimatedDepartureTime !== flight.ScheduledDepartureTime && (
                <div className="text-right">
                  <div className="flex items-center justify-end gap-4 mb-4">
                    <AlertCircle className="w-10 h-10 text-yellow-400" />
                    <div className="text-3xl text-yellow-400">Expected Departure</div>
                  </div>
                  <div className="text-8xl font-mono font-bold text-yellow-400 animate-pulse leading-tight">
                    {flight.EstimatedDepartureTime}
                  </div>
                </div>
              )}
          </div>

          {/* Status */}
          <div className="text-right space-y-8">
            <div>
              {isCancelled ? (
                <div className="text-7xl font-bold text-red-500 leading-tight">CANCELLED</div>
              ) : isDiverted ? (
                <div className="text-7xl font-bold text-orange-500 leading-tight">DIVERTED</div>
              ) : (
                <>
                  <div className={`text-7xl font-bold ${getStatusColor(flight.StatusEN)} leading-tight`}>
                    {flight.StatusEN}
                  </div>
                  {flight.StatusEN.toLowerCase().includes('boarding') && (
                    <div className="text-4xl text-green-400 mt-4 animate-pulse">
                      Please proceed to gate
                    </div>
                  )}
                  {flight.StatusEN.toLowerCase().includes('final call') && (
                    <div className="text-4xl text-red-400 mt-4 animate-pulse">
                      Final boarding call
                    </div>
                  )}
                  {flight.StatusEN.toLowerCase().includes('delay') && (
                    <div className="text-3xl text-red-400 mt-4">
                      Flight delayed — Please wait for updates
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Terminal / Gate kartice */}
            <div className="grid grid-cols-2 gap-8">
              {flight.Terminal && (
                <div className="text-center bg-slate-800/50 rounded-2xl p-6 border border-white/10">
                  <div className="text-2xl text-slate-400 mb-3">Terminal</div>
                  <div className="text-5xl font-bold text-white">
                    {flight.Terminal.replace('T0', 'T').replace('T', 'T ')}
                  </div>
                </div>
              )}
              {flight.GateNumber && (
                <div className="text-center bg-slate-800/50 rounded-2xl p-6 border border-white/10">
                  <div className="text-2xl text-slate-400 mb-3">Gate</div>
                  <div className="text-5xl font-bold text-white">{flight.GateNumber}</div>
                </div>
              )}
            </div>

            {/* Check-in closes upozorenje */}
            {checkInStatus?.checkInCloseTime &&
              timeUntilDeparture !== null &&
              timeUntilDeparture <= 30 &&
              timeUntilDeparture > 0 && (
                <div className="mt-4 bg-red-500/20 border border-red-400/40 rounded-xl px-6 py-4">
                  <div className="text-2xl text-red-300 animate-pulse">
                    ⚠️ Check-in closes {formatTimeRemaining(timeUntilDeparture)}
                  </div>
                </div>
              )}
          </div>
        </div>
      </div>

      <style jsx global>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.7; }
        }
        .animate-pulse { animation: pulse 2s infinite; }
        html, body, #__next {
          margin: 0; padding: 0;
          width: 100vw; height: 100vh;
          overflow: hidden;
          background: #0f172a;
        }
        body {
          display: flex;
          align-items: center;
          justify-content: center;
          background: linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #0f172a 100%);
        }
      `}</style>
    </div>
  );
}