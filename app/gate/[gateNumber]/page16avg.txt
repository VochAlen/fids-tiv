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

const REFRESH_INTERVAL_MS          = 20_000;
const DISPLAY_START_BEFORE_ETD_MS  = 30 * 60 * 1000; // 30 min PRIJE ETD — delayed let se prikazuje
const HIDE_BEFORE_ETD_MS           =  5 * 60 * 1000; //  5 min PRIJE ETD — delayed let se gasi
const CLOSE_BEFORE_DEPARTURE_MS    = 10 * 60 * 1000; // 10 min PRIJE STD — non-delayed let se gasi

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
// ─────────────────────────────────────────────────────────────
const parseDepartureTime = (t: string): Date | null => {
  if (!t) return null;
  try {
    if (t.includes('T')) { const d = new Date(t); if (!isNaN(d.getTime())) return d; }
    const [h, m] = t.split(':').map(Number);
    if (isNaN(h) || isNaN(m)) return null;
    const d = new Date();
    d.setHours(h, m, 0, 0);
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
  a?.StatusEN !== b?.StatusEN ||
  a?.EstimatedDepartureTime !== b?.EstimatedDepartureTime;

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
  //
  // OPTIMALNA VERZIJA — koristi msToDep pristup:
  //
  // Delayed let (ETD !== STD):
  //   msToDep > 5min  AND  msToDep <= 30min  → prikazuj
  //   msToDep <= 5min OR  msToDep > 30min    → ne prikazuj
  //
  // Non-delayed let:
  //   msToDep > 10min  → prikazuj
  //   msToDep <= 10min → ne prikazuj
  //
  const shouldDisplayFlight = useCallback((f: Flight): boolean => {
    const s = (f.StatusEN || '').toLowerCase().trim();

    if (s.includes('cancelled') || s.includes('canceled') || s.includes('otkazan')) return false;
    if (s.includes('diverted')  || s.includes('preusmjeren')) return false;
    if (manualGateStatusRef.current === 'open') return true;
    if (s.includes('departed') || s.includes('poletio')) return false;

    const isDelayed = !!(
      f.EstimatedDepartureTime &&
      f.EstimatedDepartureTime !== f.ScheduledDepartureTime
    );

    const refTime = isDelayed
      ? f.EstimatedDepartureTime
      : f.ScheduledDepartureTime || '';

    const dep = parseDepartureTime(refTime);
    if (!dep) return true;

    const msToDep = dep.getTime() - Date.now();

    if (isDelayed) {
      // Delayed: prikazuj SAMO između ETD-30min i ETD-5min
      return msToDep > HIDE_BEFORE_ETD_MS && msToDep <= DISPLAY_START_BEFORE_ETD_MS;
    } else {
      // Non-delayed: sakrij 10 minuta prije STD
      return msToDep > CLOSE_BEFORE_DEPARTURE_MS;
    }
  }, []);

  // ── Weather ─────────────────────────────────────────────────
  const weather = useWeather({
    cityName:    display.flight?.DestinationCityName,
    airportCode: display.flight?.DestinationAirportCode,
  }, 0);

  // ── Hard reset u 03:00 ───────────────────────────────────────
  useEffect(() => {
    const now = new Date();
    const reset = new Date();
    reset.setHours(3, 0, 0, 0);
    if (reset <= now) reset.setDate(reset.getDate() + 1);
    const ms = reset.getTime() - now.getTime();
    const id = setTimeout(() => window.location.reload(), ms);
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

      // 2. Check-in status (trenutno isključen)
      const withStatus = allForGate.map((f: Flight) => ({
        ...f,
        checkInStatus: null,
      }));

      // 3. Sortiraj po STD
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
      let current: (typeof sorted)[number] | null = null;

      if (manualGateStatusRef.current === 'open') {
        current = sorted.find(f => {
          const s = (f.StatusEN || '').toLowerCase();
          return !s.includes('cancelled') && !s.includes('otkazan') &&
                 !s.includes('diverted')  && !s.includes('preusmjeren');
        }) ?? null;
      } else {
        // Sva vremenska logika je u shouldDisplayFlight — samo nađi prvi koji prolazi
        for (const f of sorted) {
          if (shouldDisplayFlight(f)) {
            current = f;
            break;
          }
        }
        // NEMA redundantnog fallback — ako loop ne nađe, current ostaje null
      }

      // 6. Sljedeći let IZA currenta
      const idx = current
        ? sorted.findIndex(f =>
            f.FlightNumber === current!.FlightNumber &&
            f.ScheduledDepartureTime === current!.ScheduledDepartureTime
          )
        : -1;

      let nextFlight: (typeof sorted)[number] | null = null;
      for (let i = (idx >= 0 ? idx + 1 : 0); i < sorted.length; i++) {
        const candidate = sorted[i];
        const s = (candidate.StatusEN || '').toLowerCase();
        if (!s.includes('cancelled') && !s.includes('otkazan')) {
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

  // ── Switch timer ─────────────────────────────────────────────
  //
  // Delayed let:  okida se pri ETD - 5 min  (HIDE_BEFORE_ETD_MS)
  // Non-delayed:  okida se pri STD - 10 min (CLOSE_BEFORE_DEPARTURE_MS)
  //
  useEffect(() => {
    if (stdSwitchTimerRef.current) {
      clearTimeout(stdSwitchTimerRef.current);
      stdSwitchTimerRef.current = null;
    }
    if (!display.flight) return;
    if (manualGateStatusRef.current === 'open') return;

    const f = display.flight;
    const isDelayed = !!(
      f.EstimatedDepartureTime &&
      f.EstimatedDepartureTime !== f.ScheduledDepartureTime
    );

const departureTimeStr = isDelayed 
  ? (f.EstimatedDepartureTime || '') 
  : (f.ScheduledDepartureTime || '');
    const dep = parseDepartureTime(departureTimeStr);
    if (!dep) return;

    const hideBeforeMs = isDelayed ? HIDE_BEFORE_ETD_MS : CLOSE_BEFORE_DEPARTURE_MS;
    const triggerAt = dep.getTime() - hideBeforeMs;
    const ms = triggerAt - Date.now();

    if (ms > 0 && ms < 4 * 60 * 60 * 1000) {
      stdSwitchTimerRef.current = setTimeout(() => {
        if (isMountedRef.current) loadFlights();
      }, ms);
    } else if (ms <= 0 && ms > -30_000) {
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

  const effectiveStatus = useMemo(() => {
    return display.flight?.StatusEN || '';
  }, [display.flight]);

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
  // Render: nema leta (višejezično)
  // ─────────────────────────────────────────────────────────────

  if (!display.flight) {
    const closed = display.manualGateStatus === 'closed';

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

    const languages = ['me', 'de', 'fr', 'he', 'en'] as const;

    return (
      <div style={styles.emptyRoot} className="fids-empty-root">
        <div style={styles.topBar} className="fids-topbar">
          <div style={styles.topBarLeft} className="fids-topbar-left">
            <span style={styles.topBarLabel}>GATE</span>
            <span style={styles.topBarGate}>{gateNumber}</span>
          </div>
          <LiveClock />
        </div>

        <Divider />

        <div style={styles.emptyMain} className="fids-empty-main">
          <div style={styles.emptyGateNumber} className="fids-empty-gate">
            {gateNumber}
          </div>

          <div style={styles.emptyStatusWrapper}>
            <div style={styles.emptyStatusIcon}>
              {closed ? '🔒' : '✈️'}
            </div>

            <div style={styles.emptyLanguageStack}>
              {languages.map((lang) => (
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

            <div style={styles.emptySubtextStack}>
              {languages.map((lang) => (
                <div key={lang} style={styles.emptySubtextRow}>
                  <span style={styles.emptySubtextCode}>{lang.toUpperCase()}</span>
                  <span style={styles.emptySubtextText}>
                    {translations.subtext[lang]}
                  </span>
                </div>
              ))}
            </div>
          </div>

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
  root:                 { width: '100vw', height: '100vh', display: 'flex', flexDirection: 'column', background: C.bg, fontFamily: FONT_DISPLAY, color: C.white, padding: '0', overflow: 'hidden' },
  splash:               { width: '100vw', height: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: C.bg, fontFamily: FONT_DISPLAY, color: C.white, gap: '1.5rem' },
  splashIcon:           { fontSize: '4rem' },
  splashTitle:          { fontSize: '2rem', fontWeight: 700, letterSpacing: '.12em', color: C.white },
  splashSub:            { fontSize: '1rem', color: C.textMuted, fontFamily: FONT_MONO },
  spinner:              { width: '48px', height: '48px', border: `3px solid ${C.border}`, borderTopColor: C.accent, borderRadius: '50%', animation: 'spin .8s linear infinite' },
  topBar:               { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.9rem 2.5rem', background: C.panel, borderBottom: `1px solid ${C.border}`, flexShrink: 0 },
  topBarLeft:           { display: 'flex', alignItems: 'baseline', gap: '0.7rem' },
  topBarLabel:          { fontSize: '0.95rem', fontWeight: 600, letterSpacing: '.18em', color: C.textMuted, fontFamily: FONT_MONO },
  topBarGate:           { fontSize: '3.2rem', fontWeight: 700, lineHeight: 1, color: C.gold, letterSpacing: '.04em' },
  topBarTerminal:       { fontSize: '2rem', fontWeight: 600, color: C.text, letterSpacing: '.06em' },
  topBarSep:            { color: C.border, fontSize: '1.8rem', margin: '0 0.4rem' },
  clock:                { fontFamily: FONT_MONO, fontSize: '2.2rem', fontWeight: 400, color: C.accent, letterSpacing: '.08em' },
  divider:              { height: '1px', background: `linear-gradient(90deg, transparent 0%, ${C.border} 20%, ${C.border} 80%, transparent 100%)`, flexShrink: 0 },
  main:                 { display: 'flex', flex: 1, overflow: 'visible', padding: '1.5rem 2.5rem', gap: '0', minHeight: 0 },
  leftCol:              { display: 'flex', flexDirection: 'column', justifyContent: 'space-evenly', flex: '0 0 52%', gap: '.8rem', paddingRight: '2.5rem', overflow: 'visible' },
  logoCard:             { width: '100%', height: 'clamp(120px, 14vh, 200px)', background: '#ffffff', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', boxShadow: `0 0 0 1px ${C.border}, 0 4px 40px rgba(30,144,255,0.12)`, flexShrink: 0 },
  logoImg:              { width: '100%', height: '100%', objectFit: 'contain', padding: '10px 20px' },
  logoFallback:         { color: '#6b7280', fontSize: '14px', fontFamily: FONT_MONO, fontWeight: 600, letterSpacing: '.12em' },
  flightNumber:         { fontSize: 'clamp(4.5rem, 9vw, 8rem)', fontWeight: 700, letterSpacing: '.05em', color: C.white, lineHeight: 1 },
  codeshare:            { fontSize: '1rem', color: C.textMuted, letterSpacing: '.08em', fontFamily: FONT_MONO },
  codeshareList:        { color: C.text, fontWeight: 600 },
  destCode:             { fontSize: 'clamp(2.8rem, 5.5vw, 5rem)', fontWeight: 700, letterSpacing: '.12em', color: C.accent, lineHeight: 1 },
  destCity:             { fontSize: 'clamp(4.5rem, 9vw, 9rem)', fontWeight: 700, color: C.white, letterSpacing: '.03em', lineHeight: 1, wordBreak: 'break-word' as const, overflowWrap: 'break-word' as const },
  weatherWidget:        { display: 'flex', alignItems: 'center', gap: '.5rem', background: 'rgba(30,58,95,0.3)', borderRadius: '8px', padding: '.4rem .8rem' },
  weatherTemp:          { fontSize: '1.4rem', fontWeight: 600, color: C.text, fontFamily: FONT_MONO, letterSpacing: '.06em' },
  chargerWarning:       { display: 'flex', alignItems: 'flex-start', gap: '.7rem', background: 'rgba(234,179,8,0.12)', border: '1px solid rgba(234,179,8,0.35)', borderRadius: '10px', padding: '.7rem 1rem' },
  chargerIcon:          { fontSize: '1.3rem', color: '#eab308', flexShrink: 0, lineHeight: '1.3' as unknown as number },
  chargerText:          { fontSize: 'clamp(0.85rem, 1.4vw, 1.25rem)', fontWeight: 600, color: '#fde047', letterSpacing: '.04em', lineHeight: '1.4' as unknown as number, fontFamily: FONT_DISPLAY },
  boardingNotice:       { display: 'flex', alignItems: 'flex-start', gap: '.7rem', background: 'rgba(30,144,255,0.1)', border: '1px solid rgba(30,144,255,0.3)', borderRadius: '10px', padding: '.7rem 1rem' },
  boardingIcon:         { fontSize: '1.3rem', flexShrink: 0, lineHeight: '1.3' as unknown as number },
  boardingText:         { fontSize: 'clamp(0.85rem, 1.4vw, 1.25rem)', fontWeight: 600, color: C.text, letterSpacing: '.04em', lineHeight: '1.4' as unknown as number, fontFamily: FONT_DISPLAY },
  vDivider:             { width: '1px', alignSelf: 'stretch', flexShrink: 0, background: `linear-gradient(180deg, transparent 0%, ${C.border} 15%, ${C.border} 85%, transparent 100%)`, margin: '0 2.5rem' },
  rightCol:             { flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: '1rem' },
  timeBlock:            { display: 'flex', flexDirection: 'column', gap: '.3rem' },
  timeLabel:            { fontSize: '0.85rem', fontWeight: 600, letterSpacing: '.18em', color: C.textMuted, fontFamily: FONT_MONO },
  timeValue:            { fontFamily: FONT_MONO, fontSize: 'clamp(3.5rem, 7vw, 6.5rem)', fontWeight: 400, letterSpacing: '.1em', color: C.white, lineHeight: 1 },
  countdown:            { display: 'flex', alignItems: 'baseline', gap: '.7rem' },
  countdownVal:         { fontFamily: FONT_MONO, fontSize: 'clamp(1.6rem, 3vw, 2.8rem)', color: C.gold, fontWeight: 400 },
  countdownLabel:       { fontSize: '0.85rem', color: C.textMuted, letterSpacing: '.12em', fontFamily: FONT_MONO },
  statusBlock:          { display: 'flex', alignItems: 'flex-start' },
  statusBadge:          { display: 'inline-block', fontSize: 'clamp(1.6rem, 3vw, 2.8rem)', fontWeight: 700, letterSpacing: '.12em', padding: '.45em 1.2em', borderRadius: '8px', fontFamily: FONT_DISPLAY },
  gateChangedBanner:    { background: '#431407', border: '1px solid #ea580c', borderRadius: '8px', padding: '.6rem 1.2rem', color: '#fed7aa', fontSize: '1.1rem', fontWeight: 700, letterSpacing: '.12em', fontFamily: FONT_MONO },
  checkInBanner:        { background: '#3b0764', border: '1px solid #a855f7', borderRadius: '8px', padding: '.5rem 1.2rem', color: '#e9d5ff', fontSize: '1rem', fontWeight: 600, letterSpacing: '.1em', fontFamily: FONT_MONO },
  dangerousGoodsWrapper:{ flex: 1, display: 'flex', alignItems: 'flex-end', justifyContent: 'flex-end', paddingTop: '0.5rem', minHeight: 0 },
  dangerousGoodsImg:    { maxWidth: '100%', maxHeight: '100%', width: 'auto', height: 'auto', objectFit: 'contain', borderRadius: '8px' },
  footer:               { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '1rem 2.5rem', background: C.panel, borderTop: `1px solid ${C.border}`, flexShrink: 0, gap: '2rem' },
  footerMeta:           { display: 'flex', gap: '1.2rem', alignItems: 'center', color: C.textMuted, fontSize: '.85rem', fontFamily: FONT_MONO, letterSpacing: '.08em' },
  nextFlight:           { display: 'flex', alignItems: 'baseline', gap: '.8rem' },
  nextLabel:            { fontSize: '.75rem', fontWeight: 600, letterSpacing: '.15em', color: C.textMuted, fontFamily: FONT_MONO },
  nextFN:               { fontSize: '1.8rem', fontWeight: 700, color: C.accent, letterSpacing: '.06em' },
  nextDest:             { fontSize: '1.6rem', fontWeight: 600, color: C.text, letterSpacing: '.06em', maxWidth: '280px', whiteSpace: 'nowrap' as const, overflow: 'hidden' as const, textOverflow: 'ellipsis' as const },
  nextTime:             { fontSize: '1.8rem', fontWeight: 400, color: C.gold, fontFamily: FONT_MONO, letterSpacing: '.08em' },

  // ── Empty / no-flight stilovi ──────────────────────────────
  emptyRoot:            { width: '100vw', height: '100vh', display: 'flex', flexDirection: 'column', background: C.bg, fontFamily: FONT_DISPLAY, color: C.white, overflow: 'hidden' },
  emptyMain:            { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '2rem', padding: '2rem' },
  emptyGateNumber:      { fontSize: 'clamp(8rem, 18vw, 16rem)', fontWeight: 700, color: C.gold, letterSpacing: '.08em', lineHeight: 1, fontFamily: FONT_DISPLAY },
  emptyStatusWrapper:   { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1.5rem' },
  emptyStatusIcon:      { fontSize: '2.5rem' },
  emptyLanguageStack:   { display: 'flex', flexDirection: 'column', gap: '.35rem', alignItems: 'center' },
  emptyLanguageRow:     { display: 'flex', gap: '.6rem', alignItems: 'baseline' },
  emptyLanguageCode:    { fontSize: '.65rem', fontWeight: 700, color: C.textMuted, letterSpacing: '.15em', fontFamily: FONT_MONO, minWidth: '2rem' },
  emptyLanguageText:    { fontSize: 'clamp(1rem, 2vw, 1.4rem)', fontWeight: 700, letterSpacing: '.15em', color: C.white },
  emptySubtextStack:    { display: 'flex', flexDirection: 'column', gap: '.2rem', alignItems: 'center' },
  emptySubtextRow:      { display: 'flex', gap: '.5rem', alignItems: 'baseline' },
  emptySubtextCode:     { fontSize: '.55rem', fontWeight: 600, color: C.textMuted, letterSpacing: '.12em', fontFamily: FONT_MONO, minWidth: '2rem' },
  emptySubtextText:     { fontSize: 'clamp(0.65rem, 1vw, 0.8rem)', color: C.textMuted, letterSpacing: '.08em', fontFamily: FONT_DISPLAY },
  emptyMeta:            { display: 'flex', gap: '1.5rem', alignItems: 'center', background: 'rgba(30,58,95,0.2)', borderRadius: '8px', padding: '.6rem 1.5rem', marginTop: '1rem' },
  emptyMetaItem:        { display: 'flex', flexDirection: 'column', gap: '.15rem', alignItems: 'center' },
  emptyMetaLabel:       { fontSize: '.6rem', fontWeight: 600, letterSpacing: '.15em', color: C.textMuted, fontFamily: FONT_MONO },
  emptyMetaValue:       { fontSize: '.9rem', fontWeight: 600, color: C.accent, fontFamily: FONT_MONO, letterSpacing: '.06em' },
  emptyMetaDivider:     { width: '1px', height: '2rem', background: C.border },
  emptyFooter:          { padding: '1rem 2.5rem', background: C.panel, borderTop: `1px solid ${C.border}` },
  emptyFooterStack:     { display: 'flex', justifyContent: 'center', flexWrap: 'wrap', gap: '0' },
  emptyFooterText:      { fontSize: '.75rem', color: C.textMuted, letterSpacing: '.08em', fontFamily: FONT_DISPLAY },
  emptyFooterSeparator: { opacity: .3 },
};
