'use client';

import {
  useEffect, useState, useRef, useCallback, memo,
  Component, type ErrorInfo, type ReactNode, useMemo,
} from 'react';
import { useParams } from 'next/navigation';
import type { Flight } from '@/types/flight';
import { fetchFlightData } from '@/lib/flight-service';
import {
  getEnhancedCheckInStatus, checkFlightStatus,
  type CheckInStatus,
} from '@/lib/check-in-service';
import { useWeather } from '@/hooks/use-weather';

const REFRESH_INTERVAL_MS    = 20_000;
const HARD_RESET_INTERVAL_MS = 6 * 60 * 60 * 1000;

// ─────────────────────────────────────────────────────────────
// Error Boundary
// ─────────────────────────────────────────────────────────────

interface EBState { hasError: boolean; message: string }
class GateErrorBoundary extends Component<{ children: ReactNode }, EBState> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }
  static getDerivedStateFromError(e: Error) { return { hasError: true, message: e.message }; }
  componentDidCatch(e: Error, i: ErrorInfo) {
    console.error('🚨 Gate ErrorBoundary:', e, i);
    setTimeout(() => this.setState({ hasError: false, message: '' }), 10_000);
  }
  render() {
    if (this.state.hasError) return (
      <div style={styles.splash}>
        <div style={styles.splashIcon}>⚠</div>
        <div style={styles.splashTitle}>Reconnecting…</div>
        <div style={styles.splashSub}>{this.state.message}</div>
      </div>
    );
    return this.props.children;
  }
}

// ─────────────────────────────────────────────────────────────
// AirlineLogo
// ─────────────────────────────────────────────────────────────

const AirlineLogo = memo(function AirlineLogo(
  { icao, flightNumber, name }: { icao: string; flightNumber: string; name: string }
) {
  const code = icao || flightNumber?.substring(0, 2).toUpperCase() || '';
  const [src, setSrc] = useState('');
  const [errored, setErrored] = useState(false);

  useEffect(() => {
    if (!code) return;
    let cancelled = false;
    const checkImg = (url: string): Promise<boolean> =>
      new Promise(resolve => {
        const img = new window.Image();
        img.onload  = () => resolve(true);
        img.onerror = () => resolve(false);
        setTimeout(() => resolve(false), 1500);
        img.src = url;
      });
    (async () => {
      const [hasJpg, hasPng] = await Promise.all([
        checkImg(`/airlines/${code}.jpg`),
        checkImg(`/airlines/${code}.png`),
      ]);
      if (cancelled) return;
      if (hasJpg)      setSrc(`/airlines/${code}.jpg`);
      else if (hasPng) setSrc(`/airlines/${code}.png`);
      else             setSrc(`https://www.flightaware.com/images/airline_logos/180px/${code}.png`);
    })();
    return () => { cancelled = true; };
  }, [code]);

  return (
    <div style={styles.logoCard} className="fids-logo-card">
      {src && !errored
        ? <img src={src} alt={name} style={styles.logoImg} onError={() => setErrored(true)} />
        : <span style={styles.logoFallback}>{name || code || '—'}</span>
      }
    </div>
  );
});

// ─────────────────────────────────────────────────────────────
// parseDepartureTime
//
// KLJUČNA LOGIKA — rješavamo problem jutarnjih letova (00:00–06:00):
//
// Koristimo "aviation day" koji počinje u 03:00.
// Ako je trenutno vrijeme između 00:00 i 03:00 (deep night),
// letovi "danas" su zapravo letovi koji su krenuli "jučer poslije 03:00".
//
// Threshold: 18h (ne 12h).
// Zašto 18h?
//   - Najduži raspored dana je ~20h (npr. 04:00–00:00)
//   - Threshold od 18h znači: let koji je prošao prije > 18h = sutra
//   - Let od 23:50 u 04:00 → razlika = 4h10m < 18h → ostaje "danas" ✓
//   - Let od 17:45 u 04:00 → razlika = 10h15m < 18h → ostaje "danas" ✓
//   - Let od 05:00 prethodnog dana u 04:00 → razlika = 23h > 18h → sutra ✓
//
// NAPOMENA: parseDepartureTime je SAMO za parsiranje stringa u Date.
// Odluka o prikazu (shouldDisplayFlight) se bazira na STATUS-u iz API-ja,
// a BACKUP logika na STD+GRACE_PERIOD — nikad samo na parsiranom vremenu.
// ─────────────────────────────────────────────────────────────
const parseDepartureTime = (t: string): Date | null => {
  if (!t) return null;
  try {
    // ISO format (npr. 2024-03-15T17:45:00Z)
    if (t.includes('T') || (t.includes('-') && t.length > 8)) {
      const d = new Date(t);
      if (!isNaN(d.getTime())) return d;
    }
    // HH:MM format
    const [h, m] = t.split(':').map(Number);
    if (isNaN(h) || isNaN(m)) return null;
    const d = new Date();
    d.setHours(h, m, 0, 0);
    // 18h threshold — letovi stariji od 18h su "sutrašnji" (next day rotation)
    // Ovo pokriva cijeli raspored dana uključujući kasne noćne letove
    const EIGHTEEN_HOURS = 18 * 60 * 60 * 1000;
    if (Date.now() - d.getTime() > EIGHTEEN_HOURS) {
      d.setDate(d.getDate() + 1);
    }
    return d;
  } catch { return null; }
};

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

const formatTimeRemaining = (min: number): string => {
  if (min <= 0) return 'Now';
  if (min >= 60) { const h = Math.floor(min / 60), m = min % 60; return m ? `${h}h ${m}m` : `${h}h`; }
  return `${min}m`;
};

const flightChanged = (a: Flight | null, b: Flight | null): boolean =>
  a?.FlightNumber !== b?.FlightNumber ||
  a?.ScheduledDepartureTime !== b?.ScheduledDepartureTime ||
  a?.StatusEN !== b?.StatusEN;

// ─────────────────────────────────────────────────────────────
// Tipovi
// ─────────────────────────────────────────────────────────────

interface FlightDisplayState {
  flight:           Flight | null;
  checkInStatus:    CheckInStatus | null;
  nextFlight:       Flight | null;
  gateChangedAt:    number | undefined;
  manualGateStatus: string | null;
}
const EMPTY_STATE: FlightDisplayState = {
  flight: null, checkInStatus: null, nextFlight: null,
  gateChangedAt: undefined, manualGateStatus: null,
};

// ─────────────────────────────────────────────────────────────
// Status helpers
// ─────────────────────────────────────────────────────────────

function getStatusConfig(raw: string): { label: string; color: string; pulse: boolean; priority: boolean } {
  const s = (raw || '').toLowerCase().trim();
  if (s.includes('final call'))                                                    return { label: raw, color: '#ef4444', pulse: true,  priority: true  };
  if (s.includes('boarding') || s.includes('gate open'))                          return { label: raw, color: '#22c55e', pulse: false, priority: true  };
  if (s.includes('delay')    || s.includes('kasni'))                              return { label: raw, color: '#f59e0b', pulse: false, priority: false };
  if (s.includes('cancelled') || s.includes('canceled') || s.includes('otkazan')) return { label: raw, color: '#ef4444', pulse: false, priority: false };
  if (s.includes('diverted') || s.includes('preusmjeren'))                        return { label: raw, color: '#f97316', pulse: false, priority: false };
  if (s.includes('departed') || s.includes('poletio'))                            return { label: raw, color: '#6b7280', pulse: false, priority: false };
  return { label: raw, color: '#eab308', pulse: false, priority: false };
}

function getWeatherIcon(code: number): string {
  if (code === 0) return '☀️';
  if (code <= 2)  return '⛅';
  if (code <= 3)  return '☁️';
  if (code <= 49) return '🌫️';
  if (code <= 59) return '🌦️';
  if (code <= 69) return '🌧️';
  if (code <= 79) return '🌨️';
  if (code <= 84) return '🌦️';
  return '⛈️';
}

// ─────────────────────────────────────────────────────────────
// Micro komponente
// ─────────────────────────────────────────────────────────────

function LiveClock() {
  const [time, setTime] = useState('');
  useEffect(() => {
    const tick = () => setTime(
      new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
    );
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);
  return <span style={styles.clock} className="fids-clock">{time}</span>;
}

function Divider() { return <div style={styles.divider} className="fids-divider" />; }

// ─────────────────────────────────────────────────────────────
// Export
// ─────────────────────────────────────────────────────────────

export default function GatePage() {
  return <GateErrorBoundary><GateDisplay /></GateErrorBoundary>;
}

// ─────────────────────────────────────────────────────────────
// shouldDisplayFlight — CENTRALNA LOGIKA PRIKAZA
//
// DIZAJN:
//
// Primarna logika (STATUS iz API-ja):
//   cancelled / diverted   → NIKAD ne prikazuj
//   departed               → sakrij (let je otišao)
//
// Sekundarna logika (VREMENSKI BACKUP za slučaj da API kasni):
//   STD + GRACE_PERIOD_MS  → ako je prošlo, sakrij
//   GRACE_PERIOD = 45 min  → dovoljno za API sinhronizaciju
//                            i završetak boarding procesa
//
// ZAŠTO 45 min a ne 5 min (kao u prethodnoj verziji)?
//   - 5 min PRIJE polaska je previše agresivno:
//     * API možda nije ažuriran
//     * Boarding može trajati duže
//     * Let može kasniti → ETD je kasniji od STD
//   - 45 min POSLIJE polaska je sigurno: ako let nije poletio
//     za 45 min od STD-a, API će svakako biti ažuriran
//
// ZAŠTO koristimo STD (ne ETD) za grace period?
//   - STD je fiksni raspored — gate slot se ne mijenja
//   - ETD se mijenja i ne treba ga koristiti za "gašenje" prikaza
//   - Ako ETD kasni, koristimo ga samo za PRIKAZ vremena i countdown
//
// Manual override:
//   'open'   → prikazuj dok nije departed/cancelled/diverted
//   'closed' → ne prikazuj ništa
// ─────────────────────────────────────────────────────────────

// Grace period: 45 min nakon STD, prikazujemo let čak i bez API statusa
const GATE_CLOSE_BEFORE_MS = 6 * 60 * 1000;  // 3 minute prije STD

// ─────────────────────────────────────────────────────────────
// Glavna komponenta
// ─────────────────────────────────────────────────────────────

function GateDisplay() {
  const params     = useParams();
  const gateNumber = params.gateNumber as string;

  const [display,            setDisplay]            = useState<FlightDisplayState>(EMPTY_STATE);
  const [loading,            setLoading]            = useState(true);
  const [lastUpdate,         setLastUpdate]         = useState('');
  const [nextUpdate,         setNextUpdate]         = useState('');
  const [timeUntilDeparture, setTimeUntilDeparture] = useState<number | null>(null);

  const isMountedRef        = useRef(true);
  const currentFlightRef    = useRef<Flight | null>(null);
  const currentStatusRef    = useRef<CheckInStatus | null>(null);
  const prevGateRef         = useRef<string | undefined>(undefined);
  const manualGateStatusRef = useRef<string | null>(null);
  const stdSwitchTimerRef   = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Gate status override ────────────────────────────────────
  const fetchGateStatusOverride = useCallback(async (gate: string): Promise<string | null> => {
    try {
      const r = await fetch(`/api/gate-status/${gate}`);
      const d = await r.json();
      return d.status ?? null;
    } catch { return null; }
  }, []);

  // ── shouldDisplayFlight ─────────────────────────────────────
  const shouldDisplayFlight = useCallback((f: Flight): boolean => {
    const s = (f.StatusEN || '').toLowerCase().trim();

    // UVIJEK sakrij: cancelled ili diverted — bez izuzetaka
    if (s.includes('cancelled') || s.includes('canceled') || s.includes('otkazan')) return false;
    if (s.includes('diverted')  || s.includes('preusmjeren')) return false;

    // Manual 'open' override — osoblje kontroliše gate
    if (manualGateStatusRef.current === 'open') {
      // Jedino što sakrije let uz manual open je eksplicitni departed
      return !s.includes('departed') && !s.includes('poletio');
    }

    // Automatski mod: departed → sakrij odmah
    if (s.includes('departed') || s.includes('poletio')) return false;

    // ── VREMENSKI BACKUP ─────────────────────────────────────
    // Koristimo SAMO STD za grace period (ne ETD).
    // Razlog: gate slot je vezan za raspored, ne za procijenjeno vrijeme.
    // Prikazujemo let sve dok je: now < STD + 45min
// ── VREMENSKI BACKUP ─────────────────────────────────────
// Sakrij let 3 minute prije planiranog polaska (STD)
//── VREMENSKI BACKUP ─────────────────────────────────────
  // Sakrij let 3 minute prije polaska (ETD ako postoji, inače STD)
  let departureTimeStr = f.ScheduledDepartureTime || '';
  if (f.EstimatedDepartureTime) {
    departureTimeStr = f.EstimatedDepartureTime;  // koristi ETD ako postoji
  }
  const dep = parseDepartureTime(departureTimeStr);
  if (dep) {
    const hideFrom = dep.getTime() - GATE_CLOSE_BEFORE_MS;
    if (Date.now() >= hideFrom) {
      console.log(
        `[shouldDisplayFlight] ${f.FlightNumber} sakriveno — ` +
        `gate se zatvara 3min prije polaska u ${departureTimeStr}`
      );
      return false;
    }
  }

  return true;
}, []);

  // ── Weather ─────────────────────────────────────────────────
  const weather = useWeather({
    cityName:    display.flight?.DestinationCityName,
    airportCode: display.flight?.DestinationAirportCode,
  }, 0);

  // ── Hard reset ───────────────────────────────────────────────
  useEffect(() => {
    const id = setTimeout(() => window.location.reload(), HARD_RESET_INTERVAL_MS);
    return () => clearTimeout(id);
  }, []);

  // ── Kiosk mode ───────────────────────────────────────────────
  useEffect(() => {
    const p = (e: Event) => e.preventDefault();
    document.addEventListener('contextmenu', p);
    document.addEventListener('selectstart', p);
    document.addEventListener('dragstart', p);
    return () => {
      document.removeEventListener('contextmenu', p);
      document.removeEventListener('selectstart', p);
      document.removeEventListener('dragstart', p);
    };
  }, []);

  // ── Countdown — ETD ako postoji, inače STD ──────────────────
  const updateCountdown = useCallback((f: Flight | null) => {
    if (!f) { setTimeUntilDeparture(null); return; }
    const refTime = f.EstimatedDepartureTime || f.ScheduledDepartureTime || '';
    const dep = parseDepartureTime(refTime);
    if (dep) setTimeUntilDeparture(Math.floor((dep.getTime() - Date.now()) / 60_000));
    else     setTimeUntilDeparture(null);
  }, []);

  // ── Check-in status ─────────────────────────────────────────
  const getFlightCheckInStatus = useCallback(async (f: Flight): Promise<CheckInStatus | null> => {
    try {
      return await getEnhancedCheckInStatus(
        f.FlightNumber, f.ScheduledDepartureTime || '', f.StatusEN || ''
      );
    } catch { return null; }
  }, []);

  // ── Normalizacija gate broja ─────────────────────────────────
  const flightMatchesGate = useCallback((f: Flight, gate: string): boolean => {
    if (!f.GateNumber) return false;
    const gates  = f.GateNumber.split(',').map((g: string) => g.trim());
    const gNorm  = gate.replace(/^0+/, '');
    const gPad   = gate.padStart(2, '0');
    return gates.some(g =>
      g === gate || g === gNorm || g === gPad || g.replace(/^0+/, '') === gNorm
    );
  }, []);

  // ── loadFlights ──────────────────────────────────────────────
  const loadFlights = useCallback(async () => {
    if (!isMountedRef.current) return;
    try {
      const data = await fetchFlightData();

      // 1. Filtriraj departures za ovaj gate
      const allForGate = data.departures.filter(
        (f: Flight) => flightMatchesGate(f, gateNumber)
      );

      // 2. Check-in status za svaki let
      const withStatus = await Promise.all(
        allForGate.map(async (f: Flight) => ({
          ...f,
          checkInStatus: await getFlightCheckInStatus(f),
        }))
      );

      // 3. Sortiraj po STD — gate slot se bazira na rasporedu, ne ETD
      //    Letovi bez parsiranog STD se bacaju (ne možemo ih pozicionirati)
      const withTime = withStatus
        .map(f => ({
          ...f,
          _stdDate: parseDepartureTime(f.ScheduledDepartureTime || ''),
        }))
        .filter(f => f._stdDate !== null) as (Flight & {
          _stdDate: Date;
          checkInStatus: CheckInStatus | null;
        })[];

      const sorted = withTime.sort((a, b) => a._stdDate.getTime() - b._stdDate.getTime());

      // 4. Manual 'closed' → prazan ekran
      if (manualGateStatusRef.current === 'closed') {
        if (!isMountedRef.current) return;
        currentFlightRef.current = null;
        currentStatusRef.current = null;
        setDisplay({
          flight: null, checkInStatus: null, nextFlight: null,
          gateChangedAt: undefined, manualGateStatus: 'closed',
        });
        setLastUpdate(new Date().toLocaleTimeString('en-GB'));
        setNextUpdate(new Date(Date.now() + REFRESH_INTERVAL_MS).toLocaleTimeString('en-GB'));
        setLoading(false);
        return;
      }

      // 5. Odaberi TRENUTNI let
      //
      // LOGIKA ODABIRA:
      // - Prođi kroz sortirane letove (po STD asc)
      // - Uzmi PRVI koji prolazi shouldDisplayFlight
      // - shouldDisplayFlight filtrira: departed, cancelled, diverted,
      //   i letove starije od STD + 45min
      //
      // OVO RJEŠAVA JUTARNJI BUG:
      // U 04:00, let od 23:50 je prošao STD + 45min → filtriran
      // Let od 06:30 je sljedeći → prikazuje se ✓
      //
      // Manual 'open': uzmi prvi koji nije cancelled/diverted
      // (departed se ne filtrira — osoblje može otvoriti kasneći let)

      let current: (typeof sorted)[number] | null = null;

      if (manualGateStatusRef.current === 'open') {
        current = sorted.find(f => {
          const s = (f.StatusEN || '').toLowerCase();
          return !s.includes('cancelled') && !s.includes('otkazan') &&
                 !s.includes('diverted')  && !s.includes('preusmjeren');
        }) ?? null;
      } else {
        current = sorted.find(f => shouldDisplayFlight(f)) ?? null;
      }

      // 6. Sljedeći let IZA currenta
      const idx = current
        ? sorted.findIndex(f => f.FlightNumber === current!.FlightNumber && f.ScheduledDepartureTime === current!.ScheduledDepartureTime)
        : -1;

      let nextFlight: (typeof sorted)[number] | null = null;
      for (let i = (idx >= 0 ? idx + 1 : 0); i < sorted.length; i++) {
        const candidate = sorted[i];
        const s = (candidate.StatusEN || '').toLowerCase();
        // Za next flight: preskači cancelled, prikaži ostale
        if (!s.includes('cancelled') && !s.includes('otkazan')) {
          // Preskoči i letove koji su odavno prošli (departed + > 2h od STD)
          const stdMs = candidate._stdDate.getTime();
          const isDeparted = s.includes('departed') || s.includes('poletio');
          if (isDeparted && Date.now() - stdMs > 2 * 60 * 60 * 1000) continue;
          nextFlight = candidate;
          break;
        }
      }

      // 7. Gate changed detekcija
      let gateChangedAt: number | undefined;
      if (
        current?.GateNumber &&
        prevGateRef.current &&
        prevGateRef.current !== '-' &&
        prevGateRef.current !== current.GateNumber
      ) {
        gateChangedAt = Date.now();
      }

      if (!isMountedRef.current) return;

      // 8. Update state samo ako se nešto promijenilo
      if (flightChanged(current, currentFlightRef.current) || gateChangedAt) {
        currentFlightRef.current = current ?? null;
        currentStatusRef.current = current?.checkInStatus ?? null;
        prevGateRef.current      = current?.GateNumber;
        setDisplay({
          flight:           current ?? null,
          checkInStatus:    current?.checkInStatus ?? null,
          nextFlight:       nextFlight ?? null,
          gateChangedAt,
          manualGateStatus: null,
        });
        updateCountdown(current ?? null);
      }

      setLastUpdate(new Date().toLocaleTimeString('en-GB'));
      setNextUpdate(new Date(Date.now() + REFRESH_INTERVAL_MS).toLocaleTimeString('en-GB'));
      setLoading(false);
    } catch (err) {
      console.error('Gate load error:', err);
      if (isMountedRef.current) setLoading(false);
    }
  }, [gateNumber, getFlightCheckInStatus, updateCountdown, shouldDisplayFlight, flightMatchesGate]);

  // ── Polling ──────────────────────────────────────────────────
  useEffect(() => {
    isMountedRef.current = true;
    let tid: ReturnType<typeof setTimeout>;
    const schedule = () => {
      tid = setTimeout(async () => {
        if (isMountedRef.current) { await loadFlights(); schedule(); }
      }, REFRESH_INTERVAL_MS);
    };
    loadFlights().then(schedule);
    return () => { isMountedRef.current = false; clearTimeout(tid); };
  }, [loadFlights]);

  // ── Switch timer na STD + grace period ──────────────────────
  //
  // PRETHODNA VERZIJA: okidao se na STD - 1min
  // PROBLEM: to je PRIJE polaska → let se sakriva prerano
  //
  // NOVA VERZIJA: okida se na STD + 45min (= grace period)
  // Razlog: to je tačno kad shouldDisplayFlight vraća false
  // zbog vremenskog backupa → refresh koji prikazuje sljedeći let
  //
  // Edge case: ako smo učitali stranicu unutar prozora
  // STD..STD+45min, okidamo refresh odmah ili za ostatak perioda.
// ── Switch timer — refresh 3 minute prije STD ──────────────────
useEffect(() => {
  if (stdSwitchTimerRef.current) {
    clearTimeout(stdSwitchTimerRef.current);
    stdSwitchTimerRef.current = null;
  }
  if (!display.flight) return;
  if (manualGateStatusRef.current === 'open') return;

let departureTimeStr = display.flight.ScheduledDepartureTime || '';
if (display.flight.EstimatedDepartureTime) {
  departureTimeStr = display.flight.EstimatedDepartureTime;
}
const dep = parseDepartureTime(departureTimeStr);
if (!dep) return;

// Okidamo refresh tačno kad se gate treba zatvoriti (ETD - 3min ili STD - 3min)
const triggerAt = dep.getTime() - GATE_CLOSE_BEFORE_MS;
  const ms = triggerAt - Date.now();

  if (ms > 0) {
    stdSwitchTimerRef.current = setTimeout(() => {
      if (isMountedRef.current) loadFlights();
    }, ms);
  } else if (ms > -30_000) {
    // Već smo u prozoru zatvaranja → odmah osvježi
    loadFlights();
  }

  return () => {
    if (stdSwitchTimerRef.current) {
      clearTimeout(stdSwitchTimerRef.current);
      stdSwitchTimerRef.current = null;
    }
  };
}, [display.flight, loadFlights]);

  // ── Gate status override polling ─────────────────────────────
  useEffect(() => {
    const poll = async () => {
      try {
        const s = await fetchGateStatusOverride(gateNumber);
        if (manualGateStatusRef.current !== s) {
          manualGateStatusRef.current = s;
          loadFlights();
        }
      } catch (e) { console.error('Gate status poll error:', e); }
    };
    poll();
    const id = setInterval(poll, 30_000);
    return () => clearInterval(id);
  }, [gateNumber, fetchGateStatusOverride, loadFlights]);

  // ── Countdown ticker ─────────────────────────────────────────
  useEffect(() => {
    const id = setInterval(
      () => updateCountdown(currentFlightRef.current),
      30_000
    );
    return () => clearInterval(id);
  }, [updateCountdown]);

  // ─────────────────────────────────────────────────────────────
  // Derived state
  // ─────────────────────────────────────────────────────────────

  const { isCancelled, isDiverted } = checkFlightStatus(display.flight?.StatusEN || '');
  const isGateChanged = !!(display.gateChangedAt && (Date.now() - display.gateChangedAt < 15_000));
  const hasDel = display.flight?.EstimatedDepartureTime &&
    display.flight.EstimatedDepartureTime !== display.flight.ScheduledDepartureTime;

  // Auto-boarding: prikaži "Boarding" 30-5 minuta prije ETD/STD
  // ako API još nije ažuriran
  const effectiveStatus = useMemo(() => {
    const raw = display.flight?.StatusEN || '';
    if (!display.flight || isCancelled || isDiverted) return raw;
    const s = raw.toLowerCase();
    if (s.includes('departed') || s.includes('poletio'))   return raw;
    if (s.includes('final call'))                           return raw;
    if (s.includes('boarding') || s.includes('gate open')) return raw;

    // Koristi ETD ako postoji za auto-boarding
    const refTime = display.flight.EstimatedDepartureTime || display.flight.ScheduledDepartureTime || '';
    const dep = parseDepartureTime(refTime);
    if (!dep) return raw;
    const minUntil = Math.floor((dep.getTime() - Date.now()) / 60_000);
    if (minUntil <= 30 && minUntil > 5) return 'Boarding';
    return raw;
  }, [display.flight, isCancelled, isDiverted]);

  const statusCfg = getStatusConfig(effectiveStatus);

  // ─────────────────────────────────────────────────────────────
  // Render: loading
  // ─────────────────────────────────────────────────────────────

  if (loading) return (
    <div style={styles.splash}>
      <div style={styles.spinner} />
      <div style={styles.splashTitle}>Loading gate information…</div>
    </div>
  );

  // ─────────────────────────────────────────────────────────────
  // Render: nema leta
  // ─────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────
// Render: nema leta (redizajnirano)
// ─────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────
// Render: nema leta (redizajnirano sa više jezika)
// ─────────────────────────────────────────────────────────────

if (!display.flight) {
  const closed = display.manualGateStatus === 'closed';
  
  // Višejezični tekstovi
const translations = {
  closed: {
    me: 'GATE ZATVOREN',
    de: 'GATE GESCHLOSSEN',
    fr: 'PORTE FERMÉE',
    he: 'השער סגור',
    en: 'GATE CLOSED'
  },
  noFlights: {
    me: 'NEMA LETOVA',
    de: 'KEINE FLÜGE',
    fr: 'AUCUN VOL',
    he: 'אין טיסות',
    en: 'NO FLIGHTS SCHEDULED'
  },
  subtext: {
    me: 'Provjerite info ekrane za ažuriranja',
    de: 'Bitte überprüfen Sie die Info-Bildschirme für Updates',
    fr: 'Veuillez consulter les écrans d\'information pour les mises à jour',
    he: 'אנא בדוק את לוחות המידע לעדכונים',
    en: 'Please check departure boards for updates'
  },
  footerClosed: {
    me: 'Ovaj gate je trenutno zatvoren',
    de: 'Dieses Gate ist derzeit geschlossen',
    fr: 'Cette porte est actuellement fermée',
    he: 'שער זה סגור כרגע',
    en: 'This gate is currently closed'
  },
  footerIdle: {
    me: 'Molimo pričekajte sljedeći let',
    de: 'Bitte warten Sie auf den nächsten Flug',
    fr: 'Veuillez attendre le prochain vol',
    he: 'אנא המתן לטיסה הבאה',
    en: 'Please wait for next flight assignment'
  }
};
  
  // Odaberi jezik (možeš dodati detekciju iz browsera ili parama)
  // Za sada koristimo sve jezike u stacku
  const languages = ['me', 'de', 'fr', 'he', 'en'] as const;
  
  return (
    <div style={styles.emptyRoot} className="fids-empty-root">
      {/* Top bar */}
      <div style={styles.topBar} className="fids-topbar">
        <div style={styles.topBarLeft} className="fids-topbar-left">
          <span style={styles.topBarLabel}>GATE</span>
          <span style={styles.topBarGate}>{gateNumber}</span>
        </div>
        <LiveClock />
      </div>
      
      <Divider />
      
      {/* Glavni sadržaj */}
      <div style={styles.emptyMain} className="fids-empty-main">
        {/* Veliki broj gate-a */}
        <div style={styles.emptyGateNumber} className="fids-empty-gate">
          {gateNumber}
        </div>
        
        {/* Status poruka - stack na više jezika */}
        <div style={styles.emptyStatusWrapper}>
          {/* Ikona - sada veća i vidljivija */}
          <div style={styles.emptyStatusIcon}>
            {closed ? '🔒' : '✈️'}
          </div>
          
          {/* Višejezični stack */}
          <div style={styles.emptyLanguageStack}>
            {languages.map((lang, idx) => (
              <div key={lang} style={styles.emptyLanguageRow}>
                <span style={styles.emptyLanguageCode}>
                  {lang.toUpperCase()}
                </span>
                <span style={styles.emptyLanguageText}>
                  {closed ? translations.closed[lang] : translations.noFlights[lang]}
                </span>
              </div>
            ))}
          </div>
          
          {/* Subtext - također višejezični */}
          <div style={styles.emptySubtextStack}>
            {languages.map((lang, idx) => (
              <div key={lang} style={styles.emptySubtextRow}>
                <span style={styles.emptySubtextCode}>{lang.toUpperCase()}</span>
                <span style={styles.emptySubtextText}>
                  {translations.subtext[lang]}
                </span>
              </div>
            ))}
          </div>
        </div>
        
        {/* Meta info */}
        <div style={styles.emptyMeta}>
          <div style={styles.emptyMetaItem}>
            <span style={styles.emptyMetaLabel}>LAST UPDATE</span>
            <span style={styles.emptyMetaValue}>{lastUpdate}</span>
          </div>
          <div style={styles.emptyMetaDivider} />
          <div style={styles.emptyMetaItem}>
            <span style={styles.emptyMetaLabel}>NEXT UPDATE</span>
            <span style={styles.emptyMetaValue}>{nextUpdate}</span>
          </div>
        </div>
      </div>
      
      <Divider />
      
      {/* Footer - višejezični */}
      <div style={styles.emptyFooter} className="fids-empty-footer">
        <div style={styles.emptyFooterStack}>
          {languages.map((lang, idx) => (
            <span key={lang} style={styles.emptyFooterText}>
              {closed ? translations.footerClosed[lang] : translations.footerIdle[lang]}
              {idx < languages.length - 1 && <span style={styles.emptyFooterSeparator}> • </span>}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

  // ─────────────────────────────────────────────────────────────
  // Render: aktivni let
  // ─────────────────────────────────────────────────────────────

  const f = display.flight;

  return (
    <div style={styles.root} className="fids-root">

      {/* TOP BAR */}
      <div style={styles.topBar} className="fids-topbar">
        <div style={styles.topBarLeft} className="fids-topbar-left">
          <span style={styles.topBarLabel}>GATE</span>
          <span style={styles.topBarGate}>{gateNumber}</span>
          {f.Terminal && (
            <>
              <span style={styles.topBarSep}>|</span>
              <span style={styles.topBarLabel}>TERMINAL</span>
              <span style={styles.topBarTerminal}>{f.Terminal.replace('T0', 'T')}</span>
            </>
          )}
        </div>
        <LiveClock />
      </div>

      <Divider />

      {/* MAIN CONTENT */}
      <div style={styles.main} className="fids-main">

        {/* LEFT COLUMN */}
        <div style={styles.leftCol} className="fids-left-col">
          <AirlineLogo icao={f.AirlineICAO} flightNumber={f.FlightNumber} name={f.AirlineName} />

          <div style={styles.flightNumber} className="fids-flight-number">
            {f.FlightNumber}
          </div>

          {f.CodeShareFlights?.length > 0 && (
            <div style={styles.codeshare} className="fids-codeshare">
              Also operating as:&nbsp;
              <span style={styles.codeshareList}>{f.CodeShareFlights.join(' · ')}</span>
            </div>
          )}

          <Divider />

          <div style={styles.destCode} className="fids-dest-code">
            {f.DestinationAirportCode}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
            <div style={styles.destCity} className="fids-dest-city">
              {f.DestinationCityName}
            </div>
            {!weather.loading && !weather.error && weather.temperature !== 0 && (
              <div style={styles.weatherWidget} className="fids-weather">
                <span style={{ fontSize: '1.6rem', lineHeight: '1' }}>
                  {getWeatherIcon(weather.weatherCode)}
                </span>
                <span style={styles.weatherTemp}>{Math.round(weather.temperature)}°C</span>
              </div>
            )}
          </div>

          {/* Power bank upozorenje */}
          <div style={styles.chargerWarning} className="fids-charger-warning">
            <span style={styles.chargerIcon}>⚠</span>
            <span style={styles.chargerText}>
              Power banks: CABIN ONLY, max 2. No recharging or use during flight.
              Protect terminals. (valid from 27.03.2026.)
            </span>
          </div>

          {/* Boarding notice */}
          <div style={styles.boardingNotice} className="fids-boarding-notice">
            <span style={styles.boardingIcon}>✈️</span>
            <span style={styles.boardingText}>
              Families with small children and elderly passengers may board first.
              If two stairs are used: rear section passengers
              (approx. rows B737-800 16+, A320 14+, A321 18+, E195 15+, may vary)
              use rear stairs; others use front. Thank you and have a pleasant flight 😊
            </span>
          </div>
        </div>

        {/* VERTICAL DIVIDER */}
        <div style={styles.vDivider} className="fids-v-divider" />

        {/* RIGHT COLUMN */}
        <div style={styles.rightCol} className="fids-right-col">

          {/* Scheduled & Estimated */}
          <div style={{ display: 'flex', gap: '2rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div style={styles.timeBlock}>
              <div style={styles.timeLabel}>SCHEDULED DEPARTURE</div>
              <div style={styles.timeValue} className="fids-time-value">
                {f.ScheduledDepartureTime}
              </div>
            </div>
            {hasDel && (
              <div style={styles.timeBlock}>
                <div style={{ ...styles.timeLabel, color: '#f59e0b' }}>ESTIMATED DEPARTURE</div>
                <div style={{ ...styles.timeValue, color: '#f59e0b' }} className="fids-time-value">
                  {f.EstimatedDepartureTime}
                </div>
              </div>
            )}
          </div>

          {/* Countdown */}
          {!isCancelled && !isDiverted &&
            timeUntilDeparture !== null && timeUntilDeparture > 0 && (
            <div style={styles.countdown} className="fids-countdown">
              <span style={styles.countdownVal}>{formatTimeRemaining(timeUntilDeparture)}</span>
              <span style={styles.countdownLabel}>until departure</span>
            </div>
          )}

          <Divider />

          {/* Status badge */}
          <div style={styles.statusBlock} className="fids-status-block">
            {isCancelled ? (
              <div style={{ ...styles.statusBadge, background: '#7f1d1d', color: '#fca5a5' }}
                className="fids-status-badge">CANCELLED</div>
            ) : isDiverted ? (
              <div style={{ ...styles.statusBadge, background: '#7c2d12', color: '#fdba74' }}
                className="fids-status-badge">DIVERTED</div>
            ) : (
              <div style={{
                ...styles.statusBadge,
                background:  statusCfg.priority ? `${statusCfg.color}22` : '#1e293b',
                color:       statusCfg.color,
                border:      `1.5px solid ${statusCfg.color}44`,
                animation:   statusCfg.pulse ? 'fidsPulse 1.2s ease-in-out infinite' : 'none',
              }} className="fids-status-badge">
                {effectiveStatus.toUpperCase()}
              </div>
            )}
          </div>

          {/* Gate changed banner */}
          {isGateChanged && (
            <div style={styles.gateChangedBanner} className="fids-gate-changed-banner">
              ⚠ GATE CHANGED TO {f.GateNumber}
            </div>
          )}

          {/* Check-in closing */}
          {display.checkInStatus?.checkInCloseTime &&
            timeUntilDeparture !== null &&
            timeUntilDeparture <= 30 &&
            timeUntilDeparture > 0 && (
            <div style={styles.checkInBanner} className="fids-checkin-banner">
              FLIGHT CLOSES IN {formatTimeRemaining(Math.max(0, timeUntilDeparture - 5))}
            </div>
          )}

          {/* DGR image */}
          <div style={styles.dangerousGoodsWrapper} className="fids-dgr-wrapper">
            <img
              src="/dgr-gate.png"
              alt="Dangerous Goods — Not Allowed"
              style={styles.dangerousGoodsImg}
              onError={(e) => { e.currentTarget.style.display = 'none'; }}
            />
          </div>
        </div>
      </div>

      <Divider />

      {/* FOOTER */}
      <div style={styles.footer} className="fids-footer">
        <div style={styles.footerMeta} className="fids-footer-meta">
          <span>LAST UPDATE&nbsp;&nbsp;{lastUpdate}</span>
          <span style={{ opacity: .35 }}>│</span>
          <span>NEXT UPDATE&nbsp;&nbsp;{nextUpdate}</span>
        </div>
        {display.nextFlight && (
          <div style={styles.nextFlight} className="fids-next-flight">
            <span style={styles.nextLabel}>NEXT FLIGHT</span>
            <span style={styles.nextFN} className="fids-next-fn">
              {display.nextFlight.FlightNumber}
            </span>
            <span style={styles.nextDest} className="fids-next-dest">
              {display.nextFlight.DestinationAirportCode} — {display.nextFlight.DestinationCityName}
            </span>
            <span style={styles.nextTime} className="fids-next-time">
              {display.nextFlight.ScheduledDepartureTime}
            </span>
          </div>
        )}
      </div>

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Share+Tech+Mono&family=Rajdhani:wght@500;600;700&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        @keyframes fidsPulse { 0%,100%{opacity:1} 50%{opacity:.55} }
        @keyframes spin { to { transform: rotate(360deg); } }
        html,body,#__next { width:100vw; height:100vh; overflow:hidden; background:#070d1a; }
        /* Empty state responsive - kompaktno */
.fids-empty-gate { font-size: clamp(8rem, 18vw, 16rem) !important; }
.fids-empty-status-icon { font-size: 2.5rem !important; }
.fids-empty-language-text { font-size: clamp(1rem, 2vw, 1.4rem) !important; }
.fids-empty-subtext-text { font-size: clamp(0.65rem, 1vw, 0.8rem) !important; }

@media (max-width: 768px) {
  .fids-empty-gate { font-size: clamp(6rem, 15vw, 12rem) !important; }
  .fids-empty-status-icon { font-size: 2rem !important; }
  .fids-empty-language-row { gap: 0.3rem !important; }
  .fids-empty-language-code { font-size: 0.55rem !important; }
  .fids-empty-language-text { font-size: 0.9rem !important; }
  .fids-empty-subtext-row { gap: 0.3rem !important; }
  .fids-empty-subtext-text { font-size: 0.55rem !important; }
  .fids-empty-meta { flex-direction: column !important; gap: 0.3rem !important; padding: 0.4rem 0.8rem !important; margin-top: 0.5rem !important; }
  .fids-empty-meta-divider { display: none !important; }
  .fids-empty-footer { padding: 0.3rem 0.8rem !important; }
  .fids-empty-footer-text { font-size: 0.5rem !important; }
}

@media (max-width: 480px) {
  .fids-empty-gate { font-size: clamp(5rem, 12vw, 10rem) !important; }
  .fids-empty-language-stack { gap: 0.15rem !important; }
  .fids-empty-language-text { font-size: 0.75rem !important; }
  .fids-empty-subtext-stack { gap: 0.1rem !important; }
  .fids-empty-subtext-text { font-size: 0.45rem !important; }
}

        @media (max-width: 1024px) {
          .fids-topbar { padding: 0.6rem 1.5rem !important; }
          .fids-topbar-left { gap: 0.5rem !important; }
          .fids-main { padding: 1rem 1.5rem !important; }
          .fids-left-col { padding-right: 1.5rem !important; }
          .fids-v-divider { margin: 0 1.5rem !important; }
          .fids-footer { padding: 0.7rem 1.5rem !important; }
          .fids-next-dest { max-width: 200px !important; }
        }
        @media (max-width: 768px) {
          html, body, #__next { overflow: auto !important; height: auto !important; min-height: 100vh !important; }
          .fids-root { overflow-y: auto !important; overflow-x: hidden !important; height: auto !important; min-height: 100vh !important; }
          .fids-topbar { padding: 0.5rem 1rem !important; flex-wrap: wrap !important; gap: 0.2rem !important; position: sticky !important; top: 0 !important; z-index: 10 !important; }
          .fids-topbar-left { gap: 0.4rem !important; flex-wrap: wrap !important; }
          .fids-clock { font-size: 1.4rem !important; }
          .fids-main { flex-direction: column !important; padding: 0.8rem 1rem !important; gap: 1rem !important; }
          .fids-left-col { flex: none !important; width: 100% !important; padding-right: 0 !important; gap: 0.5rem !important; }
          .fids-logo-card { height: 70px !important; border-radius: 8px !important; }
          .fids-flight-number { font-size: 3rem !important; }
          .fids-codeshare { font-size: 0.8rem !important; overflow: hidden !important; text-overflow: ellipsis !important; white-space: nowrap !important; }
          .fids-dest-code { font-size: 2rem !important; }
          .fids-dest-city { font-size: 2.8rem !important; }
          .fids-charger-warning { flex-direction: column !important; gap: 0.25rem !important; padding: 0.5rem 0.7rem !important; }
          .fids-charger-warning .fids-charger-icon, .fids-boarding-notice .fids-boarding-icon { display: none !important; }
          .fids-boarding-notice { flex-direction: column !important; gap: 0.25rem !important; padding: 0.5rem 0.7rem !important; }
          .fids-v-divider { width: 100% !important; height: 1px !important; margin: 0 !important; background: linear-gradient(90deg, transparent 0%, #1e3a5f 20%, #1e3a5f 80%, transparent 100%) !important; }
          .fids-right-col { width: 100% !important; gap: 0.7rem !important; }
          .fids-time-value { font-size: 2.8rem !important; }
          .fids-countdown { flex-direction: column !important; gap: 0.15rem !important; }
          .fids-status-badge { font-size: 1.4rem !important; padding: 0.35em 0.8em !important; }
          .fids-gate-changed-banner { font-size: 0.9rem !important; padding: 0.4rem 0.8rem !important; }
          .fids-checkin-banner { font-size: 0.85rem !important; padding: 0.35rem 0.8rem !important; }
          .fids-dgr-wrapper { justify-content: center !important; padding: 0.5rem 0 !important; flex: none !important; }
          .fids-dgr-wrapper img { max-height: 100px !important; }
          .fids-footer { flex-direction: column !important; padding: 0.6rem 1rem !important; gap: 0.4rem !important; align-items: flex-start !important; }
          .fids-footer-meta { font-size: 0.7rem !important; }
          .fids-next-flight { flex-wrap: wrap !important; gap: 0.3rem 0.8rem !important; }
          .fids-next-fn { font-size: 1.6rem !important; }
          .fids-next-dest { font-size: 1.4rem !important; max-width: 100% !important; white-space: normal !important; order: 10 !important; width: 100% !important; }
          .fids-next-time { font-size: 1.6rem !important; }
        }
        @media (max-width: 480px) {
          .fids-topbar { padding: 0.4rem 0.6rem !important; }
          .fids-main { padding: 0.6rem !important; gap: 0.7rem !important; }
          .fids-logo-card { height: 55px !important; border-radius: 6px !important; }
          .fids-flight-number { font-size: 2.4rem !important; }
          .fids-dest-code { font-size: 1.6rem !important; }
          .fids-dest-city { font-size: 2rem !important; }
          .fids-charger-warning, .fids-boarding-notice { padding: 0.4rem 0.5rem !important; border-radius: 6px !important; }
          .fids-time-value { font-size: 2.2rem !important; }
          .fids-status-badge { font-size: 1.2rem !important; padding: 0.3em 0.6em !important; }
          .fids-dgr-wrapper img { max-height: 70px !important; }
          .fids-footer { padding: 0.5rem 0.6rem !important; }
          .fids-next-fn, .fids-next-time { font-size: 1.3rem !important; }
          .fids-next-dest { font-size: 1.1rem !important; }
          .fids-gate-changed-banner, .fids-checkin-banner { font-size: 0.8rem !important; padding: 0.3rem 0.6rem !important; }
        }
          /* Empty state responsive */
.fids-empty-gate { font-size: clamp(12rem, 25vw, 22rem) !important; }
.fids-empty-status-text { font-size: clamp(2rem, 5vw, 4rem) !important; }
.fids-empty-meta { gap: 1rem !important; padding: 0.8rem 1.2rem !important; }

@media (max-width: 768px) {
  .fids-empty-gate { font-size: clamp(8rem, 20vw, 14rem) !important; }
  .fids-empty-status-text { font-size: clamp(1.6rem, 4vw, 2.5rem) !important; }
  .fids-empty-status-icon { font-size: 2.5rem !important; }
  .fids-empty-meta { flex-direction: column !important; gap: 0.5rem !important; }
  .fids-empty-meta-divider { display: none !important; }
  .fids-empty-footer-text { font-size: 0.7rem !important; }
}
  
        @media (max-height: 600px) and (min-width: 769px) {
          .fids-main { padding: 0.6rem 1.5rem !important; gap: 0.5rem !important; }
          .fids-left-col { gap: 0.4rem !important; }
          .fids-right-col { gap: 0.5rem !important; }
          .fids-logo-card { height: 60px !important; }
          .fids-dest-city { font-size: 3.5rem !important; }
          .fids-time-value { font-size: 2.8rem !important; }
          .fids-status-badge { font-size: 1.4rem !important; padding: 0.3em 0.7em !important; }
          .fids-dgr-wrapper img { max-height: 60px !important; }
          .fids-footer { padding: 0.4rem 1.5rem !important; }
          .fids-next-fn, .fids-next-dest, .fids-next-time { font-size: 1.6rem !important; }
        }
      `}</style>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Stilovi
// ─────────────────────────────────────────────────────────────

const FONT_DISPLAY = `'Rajdhani', 'Share Tech Mono', monospace`;
const FONT_MONO    = `'Share Tech Mono', 'Courier New', monospace`;
const C = {
  bg:        '#070d1a',
  panel:     '#0d1629',
  border:    '#1e3a5f',
  accent:    '#1e90ff',
  gold:      '#e6a817',
  text:      '#cfe4ff',
  textMuted: '#4a6fa5',
  white:     '#f0f8ff',
};

const styles: Record<string, React.CSSProperties> = {
  root: { width: '100vw', height: '100vh', display: 'flex', flexDirection: 'column', background: C.bg, fontFamily: FONT_DISPLAY, color: C.white, padding: '0', overflow: 'hidden' },
  topBar: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.9rem 2.5rem', background: C.panel, borderBottom: `1px solid ${C.border}`, flexShrink: 0 },
  topBarLeft: { display: 'flex', alignItems: 'baseline', gap: '0.7rem' },
  topBarLabel: { fontSize: '0.95rem', fontWeight: 600, letterSpacing: '.18em', color: C.textMuted, fontFamily: FONT_MONO },
  topBarGate: { fontSize: '3.2rem', fontWeight: 700, lineHeight: 1, color: C.gold, letterSpacing: '.04em' },
  topBarTerminal: { fontSize: '2rem', fontWeight: 600, color: C.text, letterSpacing: '.06em' },
  topBarSep: { color: C.border, fontSize: '1.8rem', margin: '0 0.4rem' },
  clock: { fontFamily: FONT_MONO, fontSize: '2.2rem', fontWeight: 400, color: C.accent, letterSpacing: '.08em' },
  divider: { height: '1px', background: `linear-gradient(90deg, transparent 0%, ${C.border} 20%, ${C.border} 80%, transparent 100%)`, flexShrink: 0 },
  main: { display: 'flex', flex: 1, overflow: 'visible', padding: '1.5rem 2.5rem', gap: '0', minHeight: 0 },
  leftCol: { display: 'flex', flexDirection: 'column', justifyContent: 'space-evenly', flex: '0 0 52%', gap: '.8rem', paddingRight: '2.5rem', overflow: 'visible' },
  logoCard: { width: '100%', height: 'clamp(120px, 14vh, 200px)', background: '#ffffff', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', boxShadow: `0 0 0 1px ${C.border}, 0 4px 40px rgba(30,144,255,0.12)`, flexShrink: 0 },
  logoImg: { width: '100%', height: '100%', objectFit: 'contain', padding: '10px 20px' },
  logoFallback: { color: '#6b7280', fontSize: '14px', fontFamily: FONT_MONO, fontWeight: 600, letterSpacing: '.12em' },
  flightNumber: { fontSize: 'clamp(4.5rem, 9vw, 8rem)', fontWeight: 700, letterSpacing: '.05em', color: C.white, lineHeight: 1 },
  codeshare: { fontSize: '1rem', color: C.textMuted, letterSpacing: '.08em', fontFamily: FONT_MONO },
  codeshareList: { color: C.text, fontWeight: 600 },
  destCode: { fontSize: 'clamp(2.8rem, 5.5vw, 5rem)', fontWeight: 700, letterSpacing: '.12em', color: C.accent, lineHeight: 1 },
  destCity: { fontSize: 'clamp(4.5rem, 9vw, 9rem)', fontWeight: 700, color: C.white, letterSpacing: '.03em', lineHeight: 1, wordBreak: 'break-word' as const, overflowWrap: 'break-word' as const },
  chargerWarning: { display: 'flex', alignItems: 'flex-start', gap: '.7rem', background: 'rgba(234,179,8,0.12)', border: '1px solid rgba(234,179,8,0.35)', borderRadius: '10px', padding: '.7rem 1rem' },
  chargerIcon: { fontSize: '1.3rem', color: '#eab308', flexShrink: 0, lineHeight: '1.3' as unknown as number },
  chargerText: { fontSize: 'clamp(0.85rem, 1.4vw, 1.25rem)', fontWeight: 600, color: '#fde047', letterSpacing: '.04em', lineHeight: '1.4' as unknown as number, fontFamily: FONT_DISPLAY },
  boardingNotice: { display: 'flex', alignItems: 'flex-start', gap: '.7rem', background: 'rgba(30,144,255,0.1)', border: '1px solid rgba(30,144,255,0.3)', borderRadius: '10px', padding: '.7rem 1rem' },
  boardingIcon: { fontSize: '1.3rem', flexShrink: 0, lineHeight: '1.3' as unknown as number },
  boardingText: { fontSize: 'clamp(0.85rem, 1.4vw, 1.25rem)', fontWeight: 600, color: C.text, letterSpacing: '.04em', lineHeight: '1.4' as unknown as number, fontFamily: FONT_DISPLAY },
  vDivider: { width: '1px', alignSelf: 'stretch', flexShrink: 0, background: `linear-gradient(180deg, transparent 0%, ${C.border} 15%, ${C.border} 85%, transparent 100%)`, margin: '0 2.5rem' },
  rightCol: { flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: '1rem' },
  timeBlock: { display: 'flex', flexDirection: 'column', gap: '.3rem' },
  timeLabel: { fontSize: '0.85rem', fontWeight: 600, letterSpacing: '.18em', color: C.textMuted, fontFamily: FONT_MONO },
  timeValue: { fontFamily: FONT_MONO, fontSize: 'clamp(3.5rem, 7vw, 6.5rem)', fontWeight: 400, letterSpacing: '.1em', color: C.white, lineHeight: 1 },
  countdown: { display: 'flex', alignItems: 'baseline', gap: '.7rem' },
  countdownVal: { fontFamily: FONT_MONO, fontSize: 'clamp(1.6rem, 3vw, 2.8rem)', color: C.gold, fontWeight: 400 },
  countdownLabel: { fontSize: '0.85rem', color: C.textMuted, letterSpacing: '.12em', fontFamily: FONT_MONO },
  statusBlock: { display: 'flex', alignItems: 'flex-start' },
  statusBadge: { display: 'inline-block', fontSize: 'clamp(1.6rem, 3vw, 2.8rem)', fontWeight: 700, letterSpacing: '.12em', padding: '.45em 1.2em', borderRadius: '8px', fontFamily: FONT_DISPLAY },
  gateChangedBanner: { background: '#431407', border: '1px solid #ea580c', borderRadius: '8px', padding: '.6rem 1.2rem', color: '#fed7aa', fontSize: '1.1rem', fontWeight: 700, letterSpacing: '.12em', fontFamily: FONT_MONO },
  checkInBanner: { background: '#3b0764', border: '1px solid #a855f7', borderRadius: '8px', padding: '.5rem 1.2rem', color: '#e9d5ff', fontSize: '1rem', fontWeight: 600, letterSpacing: '.1em', fontFamily: FONT_MONO },
  dangerousGoodsWrapper: { flex: 1, display: 'flex', alignItems: 'flex-end', justifyContent: 'flex-end', paddingTop: '0.5rem', minHeight: 0 },
  dangerousGoodsImg: { maxWidth: '100%', maxHeight: '100%', width: 'auto', height: 'auto', objectFit: 'contain', borderRadius: '8px' },
  footer: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '1rem 2.5rem', background: C.panel, borderTop: `1px solid ${C.border}`, flexShrink: 0, gap: '2rem' },
  footerMeta: { display: 'flex', gap: '1.2rem', alignItems: 'center', color: C.textMuted, fontSize: '.8rem', letterSpacing: '.12em', fontFamily: FONT_MONO, flexShrink: 0 },
  nextFlight: { display: 'flex', alignItems: 'center', gap: '1.8rem', overflow: 'hidden' },
  nextLabel: { fontSize: '1rem', fontWeight: 600, color: C.textMuted, letterSpacing: '.16em', fontFamily: FONT_MONO, flexShrink: 0 },
  nextFN: { fontSize: '2.5rem', fontWeight: 700, color: C.text, letterSpacing: '.08em', flexShrink: 0 },
  nextDest: { fontSize: '2.3rem', fontWeight: 600, color: C.textMuted, letterSpacing: '.04em', overflow: 'hidden', whiteSpace: 'nowrap' as const, textOverflow: 'ellipsis' },
  nextTime: { fontFamily: FONT_MONO, fontSize: '2.3rem', color: C.gold, letterSpacing: '.08em', flexShrink: 0 },
  // ─── EMPTY STATE (NO FLIGHTS) STYLES ──────────────────────────
emptyMain: { 
  flex: 1, 
  display: 'flex', 
  flexDirection: 'column', 
  alignItems: 'center', 
  justifyContent: 'center', 
  gap: '0.8rem',  // SMANJENO sa 2rem
  padding: '1rem',  // SMANJENO sa 2rem
  overflow: 'hidden'  // PROMIJENJENO sa 'auto' - nema scrolla
},
emptyGateNumber: { 
  fontSize: 'clamp(10rem, 20vw, 18rem)',  // SMANJENO (bilo 22rem max)
  fontWeight: 800, 
  color: C.gold, 
  letterSpacing: '.06em', 
  fontFamily: FONT_DISPLAY,
  textShadow: `0 0 30px rgba(230,168,23,0.3)`,
  lineHeight: 1,
  marginBottom: '0.25rem'  // SMANJENO sa 1rem
},
emptyStatusWrapper: { 
  display: 'flex', 
  flexDirection: 'column', 
  alignItems: 'center', 
  gap: '0.6rem',  // SMANJENO sa 1.5rem
  maxWidth: '90vw'
},
emptyStatusIcon: { 
  fontSize: '3rem',  // SMANJENO sa 5rem
  opacity: 0.9,
  filter: 'drop-shadow(0 0 10px rgba(230,168,23,0.4))',
  marginBottom: '0'  // UKLONJENO
},
emptyLanguageStack: {
  display: 'flex',
  flexDirection: 'column' as const,
  gap: '0.25rem',  // SMANJENO sa 0.6rem
  alignItems: 'center'
},
emptyLanguageRow: {
  display: 'flex',
  alignItems: 'baseline',
  gap: '0.6rem',  // SMANJENO sa 1rem
  flexWrap: 'wrap' as const,
  justifyContent: 'center'
},
emptyLanguageCode: {
  fontSize: '0.7rem',  // SMANJENO sa 0.8rem
  fontWeight: 700,
  color: C.accent,
  letterSpacing: '.1em',
  fontFamily: FONT_MONO,
  background: 'rgba(30,144,255,0.15)',
  padding: '0.15rem 0.4rem',  // SMANJENO
  borderRadius: '4px'
},
emptyLanguageText: {
  fontSize: 'clamp(1.1rem, 2.2vw, 1.6rem)',  // SMANJENO (bilo 1.4-2.2rem)
  fontWeight: 600,
  color: '#cfe4ff',
  letterSpacing: '.05em'
},
emptySubtextStack: {
  display: 'flex',
  flexDirection: 'column' as const,
  gap: '0.2rem',  // SMANJENO sa 0.4rem
  alignItems: 'center',
  marginTop: '0'  // UKLONJENO
},
emptySubtextRow: {
  display: 'flex',
  alignItems: 'baseline',
  gap: '0.5rem',  // SMANJENO sa 0.8rem
  flexWrap: 'wrap' as const,
  justifyContent: 'center'
},
emptySubtextCode: {
  fontSize: '0.55rem',  // SMANJENO sa 0.65rem
  fontWeight: 600,
  color: C.textMuted,
  fontFamily: FONT_MONO,
  opacity: 0.7
},
emptySubtextText: {
  fontSize: 'clamp(0.7rem, 1.2vw, 0.85rem)',  // SMANJENO (bilo 0.85-1.1rem)
  color: C.textMuted,
  letterSpacing: '.03em'
},
emptyMeta: { 
  display: 'flex', 
  gap: '1.5rem',  // SMANJENO sa 2rem
  alignItems: 'center', 
  marginTop: '0.8rem',  // SMANJENO sa 2rem
  padding: '0.5rem 1.2rem',  // SMANJENO
  background: 'rgba(13,22,41,0.8)',
  borderRadius: '10px',
  backdropFilter: 'blur(8px)',
  border: `1px solid ${C.border}`
},
emptyMetaItem: { 
  display: 'flex', 
  flexDirection: 'column' as const, 
  alignItems: 'center', 
  gap: '0.2rem'  // SMANJENO sa 0.3rem
},
emptyMetaLabel: { 
  fontSize: '0.6rem',  // SMANJENO sa 0.7rem
  fontWeight: 600, 
  letterSpacing: '.12em', 
  color: C.textMuted, 
  fontFamily: FONT_MONO 
},
emptyMetaValue: { 
  fontSize: '0.9rem',  // SMANJENO sa 1.1rem
  fontWeight: 500, 
  fontFamily: FONT_MONO, 
  color: C.accent 
},
emptyMetaDivider: { 
  width: '1px', 
  height: '1.5rem',  // SMANJENO sa 2rem
  background: C.border 
},
emptyFooter: { 
  padding: '0.4rem 2rem',  // SMANJENO
  textAlign: 'center' as const, 
  background: C.panel, 
  borderTop: `1px solid ${C.border}` 
},
emptyFooterStack: {
  display: 'flex',
  flexWrap: 'wrap' as const,
  justifyContent: 'center',
  gap: '0.1rem'  // SMANJENO
},
emptyFooterText: { 
  fontSize: '0.65rem',  // SMANJENO sa 0.75rem
  color: C.textMuted, 
  letterSpacing: '.04em', 
  fontFamily: FONT_MONO 
},
emptyFooterSeparator: {
  color: C.border,
  margin: '0 0.2rem'
},


  splash: { width: '100vw', height: '100vh', background: C.bg, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', fontFamily: FONT_DISPLAY, gap: '1rem' },
  splashIcon: { fontSize: '4rem', color: C.gold, opacity: .6 },
  splashTitle: { fontSize: '2.2rem', color: C.text, fontWeight: 600, letterSpacing: '.1em' },
  splashSub: { fontSize: '1rem', color: C.textMuted, letterSpacing: '.08em', fontFamily: FONT_MONO },
  gateLabel: { fontWeight: 800, color: C.gold, letterSpacing: '.06em', fontFamily: FONT_DISPLAY },
  spinner: { width: 56, height: 56, border: `3px solid ${C.border}`, borderTop: `3px solid ${C.accent}`, borderRadius: '50%', animation: 'spin 1s linear infinite' },
  metaRow: { display: 'flex', gap: '1rem', alignItems: 'center', marginTop: '1.2rem', color: C.textMuted, fontSize: '.9rem', letterSpacing: '.1em', fontFamily: FONT_MONO },
  weatherWidget: { display: 'flex', alignItems: 'center', gap: '.5rem', background: 'rgba(30,144,255,0.08)', border: '1px solid rgba(30,144,255,0.2)', borderRadius: '8px', padding: '.4rem .9rem', alignSelf: 'center', flexShrink: 0 },
  weatherTemp: { fontFamily: FONT_MONO, fontSize: 'clamp(1.2rem, 2.2vw, 1.8rem)', color: C.accent, fontWeight: 400, letterSpacing: '.08em' },
};