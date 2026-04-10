'use client';

import { useEffect, useState, useRef, useCallback, memo, Component, type ErrorInfo, type ReactNode, useMemo } from 'react';
import { useParams } from 'next/navigation';
import Image from 'next/image';
import type { Flight } from '@/types/flight';
import { fetchFlightData } from '@/lib/flight-service';
import {
  getEnhancedCheckInStatus,
  checkFlightStatus,
  type CheckInStatus,
} from '@/lib/check-in-service';
import { Clock, MapPin, Users, AlertCircle, DoorOpen } from 'lucide-react';

// ============================================================
// KONSTANTE
// ============================================================
const REFRESH_INTERVAL_MS = 60_000;
const HARD_RESET_INTERVAL_MS = 6 * 60 * 60 * 1000;

// ============================================================
// ERROR BOUNDARY
// ============================================================
interface ErrorBoundaryState { hasError: boolean; message: string }
class GateErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }
  static getDerivedStateFromError(error: Error) { return { hasError: true, message: error.message }; }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('🚨 Gate ErrorBoundary:', error, info);
    setTimeout(() => this.setState({ hasError: false, message: '' }), 10_000);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="w-screen h-screen bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900 text-white flex flex-col items-center justify-center gap-6">
          <DoorOpen className="w-24 h-24 text-yellow-400 opacity-30 animate-pulse" />
          <div className="text-4xl font-bold opacity-70">Reconnecting...</div>
          <div className="text-xl opacity-40">{this.state.message}</div>
        </div>
      );
    }
    return this.props.children;
  }
}

// ============================================================
// MEMO: Logo komponenta
// ============================================================
const AirlineLogo = memo(function AirlineLogo({ icao, flightNumber, name }: { icao: string; flightNumber: string; name: string }) {
  const code = icao || flightNumber?.substring(0, 2).toUpperCase() || '';

  const src = useMemo(() => {
    if (!code) return '';
    if (typeof window !== 'undefined') {
      try {
        const xhr = new XMLHttpRequest();
        xhr.open('HEAD', `/airlines/${code}.jpg`, false);
        xhr.send();
        if (xhr.status === 200) return `/airlines/${code}.jpg`;
        xhr.open('HEAD', `/airlines/${code}.png`, false);
        xhr.send();
        if (xhr.status === 200) return `/airlines/${code}.png`;
      } catch { }
    }
    return `https://www.flightaware.com/images/airline_logos/180px/${code}.png`;
  }, [code]);

  const handleError = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
    const container = e.currentTarget.parentElement;
    if (container) {
      container.innerHTML = `<span class="text-slate-500 text-sm font-semibold px-4 text-center w-full h-full flex items-center justify-center">${name || code}</span>`;
    }
  }, [code, name]);

  if (!code) {
    return (
      <div className="w-[350px] h-[100px] bg-slate-700/50 rounded-xl flex items-center justify-center border border-white/10">
        <span className="text-white/40 text-sm">{name || 'N/A'}</span>
      </div>
    );
  }

  return (
    <div className="w-[350px] h-[100px] bg-white rounded-xl p-2 shadow-xl flex items-center justify-center overflow-hidden">
      <img
        src={src}
        alt={name}
        className="object-contain w-full h-full"
        onError={handleError}
      />
    </div>
  );
});

// ============================================================
// HELPERS
// ============================================================
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
    if (now.getTime() - d.getTime() > 6 * 60 * 60 * 1000) {
      d.setDate(d.getDate() + 1);
    }
    return d;
  } catch { return null; }
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

const flightChanged = (a: Flight | null, b: Flight | null): boolean =>
  a?.FlightNumber !== b?.FlightNumber ||
  a?.ScheduledDepartureTime !== b?.ScheduledDepartureTime ||
  a?.StatusEN !== b?.StatusEN;

// ============================================================
// TIPOVI
// ============================================================
interface FlightDisplayState {
  flight: Flight | null;
  checkInStatus: CheckInStatus | null;
  nextFlight: Flight | null;
  gateChangedAt: number | undefined;
  manualGateStatus: string | null;
}

const EMPTY_STATE: FlightDisplayState = {
  flight: null, checkInStatus: null, nextFlight: null,
  gateChangedAt: undefined,
  manualGateStatus: null
};

// ============================================================
// MAIN KOMPONENTA
// ============================================================
export default function GatePage() {
  return (
    <GateErrorBoundary>
      <GateDisplay />
    </GateErrorBoundary>
  );
}

function GateDisplay() {
  const params = useParams();
  const gateNumber = params.gateNumber as string;

  const [display, setDisplay] = useState<FlightDisplayState>(EMPTY_STATE);
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState('');
  const [nextUpdate, setNextUpdate] = useState('');
  const [timeUntilDeparture, setTimeUntilDeparture] = useState<number | null>(null);

  const isMountedRef = useRef(true);
  const currentFlightRef = useRef<Flight | null>(null);
  const currentStatusRef = useRef<CheckInStatus | null>(null);
  const prevGateRef = useRef<string | undefined>(undefined);
  const manualGateStatusRef = useRef<string | null>(null);
  // Ref za STD auto-switch timer — čuva timeout ID da se može očistiti
  const stdSwitchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Funkcija za dohvaćanje statusa iz Redisa
  const fetchGateStatusOverride = useCallback(async (gate: string): Promise<string | null> => {
    try {
      const res = await fetch(`/api/gate-status/${gate}`);
      const data = await res.json();
      return data.status;
    } catch { return null; }
  }, []);

  // ============================================================
  // shouldDisplayFlight:
  // - Cancelled / Diverted → uvijek false
  // - Departed → false (ali ovo je backup; primarno radi minutesSinceDep logika)
  // - Sve ostalo → true
  // ============================================================
  const shouldDisplayFlight = useCallback((flight: Flight): boolean => {
    if (manualGateStatusRef.current === 'open') return true;

    const s = (flight.StatusEN || '').toLowerCase().trim();

    // Cancelled / Diverted — nikad ne prikazuj
    if (
      s.includes('cancelled') || s.includes('canceled') || s.includes('otkazan') ||
      s.includes('diverted') || s.includes('preusmjeren')
    ) return false;

    // Departed — preskoči (primarno se hvata kroz minutesSinceDep >= 0)
    if (s.includes('departed') || s.includes('poletio')) return false;

    return true;
  }, []);

  // Hard reset svakih 6h
  useEffect(() => {
    const id = setTimeout(() => {
      console.log('🔄 Gate kiosk scheduled hard reset (6h)...');
      window.location.reload();
    }, HARD_RESET_INTERVAL_MS);
    return () => clearTimeout(id);
  }, []);

  // Spriječi kontekstni meni / selekciju / drag
  useEffect(() => {
    const prevent = (e: Event) => e.preventDefault();
    document.addEventListener('contextmenu', prevent);
    document.addEventListener('selectstart', prevent);
    document.addEventListener('dragstart', prevent);
    return () => {
      document.removeEventListener('contextmenu', prevent);
      document.removeEventListener('selectstart', prevent);
      document.removeEventListener('dragstart', prevent);
    };
  }, []);

  const updateCountdown = useCallback((f: Flight | null) => {
    if (!f) { setTimeUntilDeparture(null); return; }
    const dep = parseDepartureTime(f.ScheduledDepartureTime || '');
    if (dep) setTimeUntilDeparture(Math.floor((dep.getTime() - Date.now()) / 60_000));
  }, []);

  const getFlightCheckInStatus = useCallback(async (f: Flight): Promise<CheckInStatus | null> => {
    try {
      return await getEnhancedCheckInStatus(f.FlightNumber, f.ScheduledDepartureTime || '', f.StatusEN || '');
    } catch { return null; }
  }, []);

  const loadFlights = useCallback(async () => {
    if (!isMountedRef.current) return;
    try {
      const data = await fetchFlightData();
      const now = new Date();

      // Svi letovi za ovaj gate, sortirani po vremenu
      const allForGate = data.departures.filter((f: Flight) => {
        if (!f.GateNumber) return false;
        const gates = f.GateNumber.split(',').map((g: string) => g.trim());
        return (
          gates.includes(gateNumber) ||
          gates.includes(gateNumber.replace(/^0+/, '')) ||
          gates.includes(gateNumber.padStart(2, '0'))
        );
      });

      const withStatus = await Promise.all(
        allForGate.map(async (f) => ({
          ...f,
          checkInStatus: await getFlightCheckInStatus(f),
        }))
      );

      const withTime = withStatus
        .map((f) => ({ ...f, departureTime: parseDepartureTime(f.ScheduledDepartureTime || '') }))
        .filter((f) => f.departureTime !== null) as (Flight & { departureTime: Date; checkInStatus: CheckInStatus | null })[];

      const sorted = withTime.sort((a, b) => a.departureTime.getTime() - b.departureTime.getTime());

      // ──────────────────────────────────────────────────────
      // RUČNI OVERRIDE: CLOSED
      // ──────────────────────────────────────────────────────
      if (manualGateStatusRef.current === 'closed') {
        if (!isMountedRef.current) return;
        currentFlightRef.current = null;
        currentStatusRef.current = null;
        setDisplay({ flight: null, checkInStatus: null, nextFlight: null, gateChangedAt: undefined, manualGateStatus: 'closed' });
        setLastUpdate(new Date().toLocaleTimeString('en-GB'));
        setNextUpdate(new Date(Date.now() + REFRESH_INTERVAL_MS).toLocaleTimeString('en-GB'));
        setLoading(false);
        return;
      }

      // ──────────────────────────────────────────────────────
      // ODABIR TRENUTNOG LETA
      //
      // Prioritet:
      //   1. FORCE OPEN  → prvi let u listi
      //   2. Normalna logika:
      //      a. Preskoči letove čiji je STD već prošao (minutesSinceDep >= 0)
      //         — ovo je T+0 auto-switch
      //      b. Preskoči cancelled / diverted / departed
      //      c. Uzmi prvi preostali let (budući)
      //   3. Fallback: ako nema budućeg leta, prikaži najbliži aktivni
      //      (npr. let kasni, STD je prošao ali status nije "departed")
      // ──────────────────────────────────────────────────────
      let current: (typeof sorted)[number] | null = null;

      if (manualGateStatusRef.current === 'open') {
        // FORCE OPEN: prikaži prvi let bez obzira na status/STD
        current = sorted[0] || null;
      } else {
        // Prolaz 1: traži prvi let čiji STD još NIJE prošao
        for (const f of sorted) {
          if (!shouldDisplayFlight(f)) continue;

          const minutesSinceDep = Math.floor((now.getTime() - f.departureTime.getTime()) / 60_000);

          // STD je prošlo → ovaj let se "ugasio" → preskoči, uzmi sljedeći
          if (minutesSinceDep >= 0) continue;

          current = f;
          break;
        }

        // Fallback: nema budućeg leta → uzmi prvi koji je aktivan ali kasni
        // (departed / cancelled su već filtrirani u shouldDisplayFlight)
        if (!current) {
          current = sorted.find((f) => shouldDisplayFlight(f)) ?? null;
        }
      }

      const idx = sorted.findIndex((f) => f.FlightNumber === current?.FlightNumber);
      const nextFlight = idx >= 0 && idx < sorted.length - 1 ? sorted[idx + 1] : null;

      let gateChangedAt: number | undefined;
      if (current?.GateNumber && currentFlightRef.current?.GateNumber !== current.GateNumber) {
        const prevGate = currentFlightRef.current?.GateNumber;
        if (prevGate && prevGate !== '-') {
          gateChangedAt = Date.now();
        }
      }

      if (!isMountedRef.current) return;

      if (flightChanged(current, currentFlightRef.current) || gateChangedAt) {
        currentFlightRef.current = current;
        currentStatusRef.current = current?.checkInStatus ?? null;
        prevGateRef.current = current?.GateNumber;
        setDisplay({
          flight: current,
          checkInStatus: current?.checkInStatus ?? null,
          nextFlight,
          gateChangedAt,
          manualGateStatus: null,
        });
        updateCountdown(current);
      }

      setLastUpdate(new Date().toLocaleTimeString('en-GB'));
      setNextUpdate(new Date(Date.now() + REFRESH_INTERVAL_MS).toLocaleTimeString('en-GB'));
      setLoading(false);
    } catch (err) {
      console.error('Gate load error:', err);
      if (isMountedRef.current) setLoading(false);
    }
  }, [gateNumber, getFlightCheckInStatus, updateCountdown, shouldDisplayFlight]);

  // ──────────────────────────────────────────────────────────
  // REFRESH LOOP: svakih 60s
  // ──────────────────────────────────────────────────────────
  useEffect(() => {
    isMountedRef.current = true;
    let timeoutId: ReturnType<typeof setTimeout>;
    const schedule = () => {
      timeoutId = setTimeout(async () => {
        if (isMountedRef.current) { await loadFlights(); schedule(); }
      }, REFRESH_INTERVAL_MS);
    };
    loadFlights().then(schedule);
    return () => { isMountedRef.current = false; clearTimeout(timeoutId); };
  }, [loadFlights]);

  // ──────────────────────────────────────────────────────────
  // STD AUTO-SWITCH TIMER
  // Okida loadFlights() tačno kada STD trenutnog leta prođe.
  // Ne čeka 60s refresh — switch se dešava odmah u T+0.
  // ──────────────────────────────────────────────────────────
  useEffect(() => {
    // Očisti prethodni timer ako postoji
    if (stdSwitchTimerRef.current) {
      clearTimeout(stdSwitchTimerRef.current);
      stdSwitchTimerRef.current = null;
    }

    if (!display.flight?.ScheduledDepartureTime) return;

    const depTime = parseDepartureTime(display.flight.ScheduledDepartureTime);
    if (!depTime) return;

    const msUntilDep = depTime.getTime() - Date.now();

    // Postavi timer samo ako je STD u budućnosti
    if (msUntilDep > 0) {
      console.log(
        `⏰ STD auto-switch timer postavljen za ${display.flight.FlightNumber} ` +
        `za ${Math.round(msUntilDep / 1000)}s (STD: ${display.flight.ScheduledDepartureTime})`
      );

      stdSwitchTimerRef.current = setTimeout(async () => {
        console.log(
          `🔄 STD prošlo za ${display.flight?.FlightNumber} — ` +
          `switching to next flight on gate ${gateNumber}`
        );
        // +1s buffer da API stigne da ažurira status
        await new Promise((r) => setTimeout(r, 1000));
        if (isMountedRef.current) loadFlights();
      }, msUntilDep);
    }

    return () => {
      if (stdSwitchTimerRef.current) {
        clearTimeout(stdSwitchTimerRef.current);
        stdSwitchTimerRef.current = null;
      }
    };
  }, [display.flight?.ScheduledDepartureTime, display.flight?.FlightNumber, gateNumber, loadFlights]);

  // ──────────────────────────────────────────────────────────
  // MANUAL GATE STATUS POLLING (svakih 30s)
  // ──────────────────────────────────────────────────────────
  useEffect(() => {
    const refreshStatus = async () => {
      try {
        const newStatus = await fetchGateStatusOverride(gateNumber);
        if (manualGateStatusRef.current !== newStatus) {
          manualGateStatusRef.current = newStatus;
          loadFlights();
        }
      } catch (err) {
        console.error('Gate status poll error:', err);
      }
    };
    refreshStatus();
    const id = setInterval(refreshStatus, 30_000);
    return () => clearInterval(id);
  }, [gateNumber, fetchGateStatusOverride, loadFlights]);

  // Countdown update svakih 60s
  useEffect(() => {
    const id = setInterval(() => updateCountdown(currentFlightRef.current), REFRESH_INTERVAL_MS);
    return () => clearInterval(id);
  }, [updateCountdown]);

  // ──────────────────────────────────────────────────────────
  // HELPERS ZA RENDER
  // ──────────────────────────────────────────────────────────
  const getStatusColor = (status: string): string => {
    const s = (status || '').toLowerCase().trim();
    if (
      s.includes('cancelled') || s.includes('canceled') || s.includes('otkazan') ||
      s.includes('diverted') || s.includes('preusmjeren')
    ) return 'text-red-600 line-through';
    if (s.includes('departed') || s.includes('poletio')) return 'text-gray-500 line-through';
    if (s.includes('boarding') || s.includes('gate open')) return 'text-green-400';
    if (s.includes('final call')) return 'text-red-400 animate-pulse';
    if (s.includes('delay') || s.includes('kasni')) return 'text-red-400';
    return 'text-yellow-400';
  };

  const { isCancelled, isDiverted } = checkFlightStatus(display.flight?.StatusEN || '');
  const isGateChanged = display.gateChangedAt && (Date.now() - display.gateChangedAt < 15_000);
  const timeUntilClose = timeUntilDeparture !== null && timeUntilDeparture <= 30 && timeUntilDeparture > 0
    ? Math.max(0, timeUntilDeparture)
    : null;

  // ──────────────────────────────────────────────────────────
  // RENDER: Loading
  // ──────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="w-screen h-screen bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900 text-white flex items-center justify-center">
        <div className="text-center">
          <div className="w-20 h-20 border-4 border-yellow-400 border-t-transparent rounded-full animate-spin mx-auto mb-6" />
          <div className="text-3xl text-slate-300">Loading gate information...</div>
        </div>
      </div>
    );
  }

  // ──────────────────────────────────────────────────────────
  // RENDER: Nema leta
  // ──────────────────────────────────────────────────────────
  if (!display.flight) {
    const isManuallyClosed = display.manualGateStatus === 'closed';
    return (
      <div className="w-screen h-screen bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900 text-white flex items-center justify-center">
        <div className="text-center">
          <DoorOpen className={`w-32 h-32 mx-auto mb-8 ${isManuallyClosed ? 'text-red-500 opacity-80' : 'text-slate-400 opacity-50'}`} />
          <div className="text-8xl font-bold text-slate-400 mb-2">Gate</div>
          <div className="text-[32rem] font-black text-orange-500 leading-none mb-6">{gateNumber}</div>
          {isManuallyClosed ? (
            <div className="text-6xl font-black text-red-500 mb-4">GATE CLOSED</div>
          ) : (
            <div className="text-4xl text-slate-500 mb-4">No flights scheduled</div>
          )}
          <div className="text-lg text-slate-700">Last updated: {lastUpdate} | Next: {nextUpdate}</div>
        </div>
      </div>
    );
  }

  // ──────────────────────────────────────────────────────────
  // RENDER: Glavni prikaz
  // ──────────────────────────────────────────────────────────
  return (
    <div className="w-[95vw] h-[95vh] mx-auto rounded-3xl border-2 border-white/10 shadow-2xl overflow-hidden bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900">
      <div className="h-full grid grid-cols-12 gap-8 p-12">

        {/* LIJEVA KOLONA */}
        <div className="col-span-6 flex flex-col justify-between">
          <div className="mb-8">
            <div className="flex items-center gap-6 mb-6">
              <div className="p-5 bg-slate-800/80 rounded-2xl border border-white/10">
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

          <div className="space-y-8 flex-1">
            <div className="flex items-center gap-8">
              <AirlineLogo
                icao={display.flight.AirlineICAO}
                flightNumber={display.flight.FlightNumber}
                name={display.flight.AirlineName}
              />
              <div className="text-[11rem] font-black text-white mb-4 leading-tight">
                {display.flight.FlightNumber}
              </div>
            </div>

            {display.flight.CodeShareFlights && display.flight.CodeShareFlights.length > 0 && (
              <div className="flex items-center gap-4 bg-blue-500/20 px-6 py-3 rounded-2xl border border-blue-500/30">
                <Users className="w-8 h-8 text-blue-400" />
                <div className="text-2xl text-blue-300">
                  Also: {display.flight.CodeShareFlights.join(', ')}
                </div>
              </div>
            )}

            <div className="flex items-center gap-6">
              <MapPin className="w-12 h-12 text-cyan-400" />
              <div>
                <div className="text-[10rem] font-bold bg-gradient-to-r from-yellow-400 to-orange-400 bg-clip-text text-transparent leading-tight mb-2">
                  {display.flight.DestinationCityName}
                </div>
                <div className="text-5xl font-semibold text-cyan-400">{display.flight.DestinationAirportCode}</div>
              </div>
            </div>
          </div>

          <div className="mt-8">
            <div className="text-sm text-slate-400">Last Updated</div>
            <div className="text-xl font-mono text-slate-300">{lastUpdate}</div>
            <div className="text-sm text-slate-600">Next: {nextUpdate}</div>
          </div>
        </div>

        {/* DESNA KOLONA */}
        <div className="col-span-6 flex flex-col justify-between pl-12">
          <div className="space-y-12">
            <div className="text-right">
              <div className="flex items-center justify-end gap-4 mb-4">
                <Clock className="w-10 h-10 text-slate-400" />
                <div className="text-3xl text-slate-400">Scheduled Departure</div>
              </div>
              <div className="text-9xl font-mono font-bold text-white leading-tight">
                {display.flight.ScheduledDepartureTime}
              </div>
            </div>

            {display.flight.EstimatedDepartureTime &&
              display.flight.EstimatedDepartureTime !== display.flight.ScheduledDepartureTime && (
                <div className="text-right">
                  <div className="flex items-center justify-end gap-4 mb-4">
                    <AlertCircle className="w-10 h-10 text-yellow-400" />
                    <div className="text-3xl text-yellow-400">Expected Departure</div>
                  </div>
                  <div className="text-8xl font-mono font-bold text-yellow-400 animate-pulse leading-tight">
                    {display.flight.EstimatedDepartureTime}
                  </div>
                </div>
              )}
          </div>

          <div className="text-right space-y-8">
            <div>
              {isCancelled ? (
                <div className="text-7xl font-bold text-red-500 leading-tight">CANCELLED</div>
              ) : isDiverted ? (
                <div className="text-7xl font-bold text-orange-500 leading-tight">DIVERTED</div>
              ) : (
                <>
                  <div className={`text-7xl font-bold ${getStatusColor(display.flight.StatusEN)} leading-tight`}>
                    {display.flight.StatusEN}
                  </div>
                  {display.flight.StatusEN?.toLowerCase().includes('boarding') && (
                    <div className="text-4xl text-green-400 mt-4 animate-pulse">Please proceed to gate</div>
                  )}
                  {display.flight.StatusEN?.toLowerCase().includes('final call') && (
                    <div className="text-4xl text-red-400 mt-4 animate-pulse">Final boarding call</div>
                  )}
                  {display.flight.StatusEN?.toLowerCase().includes('delay') && (
                    <div className="text-3xl text-red-400 mt-4">Flight delayed — Please wait for updates</div>
                  )}
                </>
              )}
            </div>

            <div className="grid grid-cols-2 gap-8">
              {display.flight.Terminal && (
                <div className="text-center bg-slate-800/50 rounded-2xl p-6 border border-white/10">
                  <div className="text-2xl text-slate-400 mb-3">Terminal</div>
                  <div className="text-5xl font-bold text-white">
                    {display.flight.Terminal.replace('T0', 'T').replace('T', 'T ')}
                  </div>
                </div>
              )}
              <div className="text-center bg-slate-800/50 rounded-2xl p-6 border border-white/10">
                <div className="text-2xl text-slate-400 mb-3">Gate</div>
                <div className={`text-5xl font-bold py-2 px-4 rounded-2xl border-2 shadow-xl
                  ${isGateChanged
                    ? 'text-red-500 bg-red-500/20 border-red-400 animate-pill-blink-fast'
                    : 'text-white bg-slate-800/50 border-white/10'
                  }`}>
                  {display.flight.GateNumber}
                </div>
              </div>
            </div>

            {display.checkInStatus?.checkInCloseTime && timeUntilClose !== null && (
              <div className="mt-4 bg-red-500/20 border border-red-400/40 rounded-xl px-6 py-4">
                <div className="text-2xl text-red-300 animate-pulse">
                  ⚠️ Check-in closes {formatTimeRemaining(timeUntilClose)}
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
        @keyframes pill-blink-fast {
          0%, 40%  { opacity: 1; }
          41%, 100% { opacity: 0.55; }
        }
        .animate-pulse { animation: pulse 2s infinite; }
        .animate-pill-blink-fast { animation: .4s ease-in-out infinite pill-blink-fast; will-change: opacity; }
        html, body, #__next { margin: 0; padding: 0; width: 100vw; height: 100vh; overflow: hidden; background: #0f172a; }
        body { display: flex; align-items: center; justify-content: center; background: linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #0f172a 100%); }
      `}</style>
    </div>
  );
}