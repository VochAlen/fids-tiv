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
import { isNightHours } from '@/lib/night-hours';
import { getInitialAirlineLogoSrc } from '@/lib/airline-logo';
import { useKioskResilience } from '@/hooks/use-kiosk-resilience';
import Image from 'next/image';

// ------------------------------------------------------------
// ═══════════════════════════════════════════════════════════
// FIX (SPAJANJE DVA POLL CIKLUSA U JEDAN — Vercel Edge Requests):
// Ranije su postojala DVA nezavisna polling ciklusa na ovoj stranici:
//   1) "brzi" poll (9-12s) → samo /api/test/gate-status-override,
//      lagan payload, čiji je jedini posao bio da DETEKTUJE promjenu
//      i onda pokrene loadFlights() van reda.
//   2) "spori" poll (14-90s, adaptivan) → loadFlights() → /api/flights,
//      koji sadrži i sam gate status (gateEntries polje).
//
// Pošto /api/flights VEĆ sadrži gateEntries (gate status override
// podatak), poseban "brzi" watchdog je bio suvišan — loadFlights()
// sam po sebi već otkriva promjenu statusa na svakom pozivu. Sad
// postoji SAMO JEDAN ciklus, na brzoj (9-12s) kadenci, koji radi
// istovremeno oba posla u jednom pozivu. Ovo:
//   • eliminiše ~495.000 poziva/mjesec po gate ekranu (odvojeni
//     watchdog sloj), bez ikakvog gubitka u brzini reagovanja
//   • ubrzava osvježavanje rasporeda leta (bilo do 53s, sad 9-12s
//     kao i status)
//   • pojednostavljuje kod — jedan tajmer umjesto dva koordinirana
// ═══════════════════════════════════════════════════════════
const REFRESH_INTERVAL_MS    = 14_000;
const HARD_RESET_INTERVAL_MS = 6 * 60 * 60 * 1000;

const getJitterMs            = () => Math.floor(Math.random() * 4_000);

const getIntervalWithJitter = () => REFRESH_INTERVAL_MS + Math.floor(Math.random() * 4_000);

// ── JEDINI poll ciklus — zahtjev osoblja: gate treba da se otvori/
// zatvori na ekranu vidljivo u roku od 10-12s od trenutka dodjele.
// Baza 9s + do 3s jitter = raspon 9-12s, WORST-CASE TAČNO 12s.
// Usklađeno sa GATE_STATUS_CACHE_CONTROL (max-age=10, ispod 12s
// garancije) i sa identičnim ciklusom na check-in ekranima. Sad
// pokreće SAM loadFlights() (koji već čita i gateEntries status),
// umjesto da postoji poseban watchdog za samo status.
const FAST_POLL_BASE_MS   = 9_000;
const FAST_POLL_JITTER_MS = 3_000;
const getFastPollInterval = () => FAST_POLL_BASE_MS + Math.floor(Math.random() * FAST_POLL_JITTER_MS);

// Klasa → boja (isti sistem kao u check-in display-u)
const CLASS_STYLES: Record<string, { bg: string; border: string; text: string }> = {
  ECONOMY:      { bg: 'rgba(37,99,235,0.20)',  border: '#3b82f6', text: '#93c5fd' },
  BUSINESS:     { bg: 'rgba(194,65,12,0.25)',  border: '#f97316', text: '#fdba74' },
  PREMIUM:      { bg: 'rgba(109,40,217,0.25)', border: '#a855f7', text: '#d8b4fe' },
  PRIORITY:     { bg: 'rgba(22,101,52,0.25)',  border: '#22c55e', text: '#86efac' },
  EASYJET_PLUS: { bg: 'rgba(234,88,12,0.25)',  border: '#f97316', text: '#fdba74' },
};

const CLASS_EMOJI: Record<string, string> = {
  ECONOMY:      '💺',
  BUSINESS:     '💼',
  PREMIUM:      '👑',
  PRIORITY:     '⭐',
  EASYJET_PLUS: '🟠',
};

const CLASS_LABELS: Record<string, string> = {
  EASYJET_PLUS: 'EASYJET PLUS',
};


// ------------------------------------------------------------
// Error Boundary
// ------------------------------------------------------------
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

// ------------------------------------------------------------
// ClassBadge — prikazuje klasu putnika na gate ekranu
// ------------------------------------------------------------
const ClassBadge = memo(function ClassBadge({ classType }: { classType: string | null }) {
  if (!classType) return null;
  const key = classType.toUpperCase();
  const style = CLASS_STYLES[key] ?? { bg: 'rgba(255,255,255,0.1)', border: '#ffffff44', text: '#ffffff' };
  const emoji = CLASS_EMOJI[key] ?? '✈️';

  return (
    <div style={{
      display:        'inline-flex',
      alignItems:     'center',
      gap:            '0.6rem',
      background:     style.bg,
      border:         `2px solid ${style.border}`,
      borderRadius:   '10px',
      padding:        '0.5rem 1.4rem',
      color:          style.text,
      fontSize:       'clamp(1.8rem, 3.5vw, 3rem)',
      fontWeight:     700,
      letterSpacing:  '.12em',
      fontFamily:     FONT_DISPLAY,
      lineHeight:     1,
    }} className="fids-class-badge">
      <span style={{ fontSize: 'clamp(1.5rem, 3vw, 2.5rem)', lineHeight: 1 }}>{emoji}</span>
      <span>{CLASS_LABELS[key] ?? key}</span>
    </div>
  );
});

// ------------------------------------------------------------
// Airline Logo
// ------------------------------------------------------------
const AirlineLogo = memo(function AirlineLogo(
  { icao, flightNumber, name }: { icao: string; flightNumber: string; name: string }
) {
  const code = icao || flightNumber?.substring(0, 2).toUpperCase() || '';
  const [src, setSrc] = useState('');
  const [errored, setErrored] = useState(false);

  useEffect(() => {
  if (!code) return;
  setSrc(getInitialAirlineLogoSrc(code, ''));
}, [code]);

return (
  <div style={styles.logoCard} className="fids-logo-card">
    {src && !errored
      ? (
        <Image
          src={src}
          alt={name}
          fill
          style={{ objectFit: 'contain', padding: '10px 20px' }}
          onError={() => setErrored(true)}
          unoptimized
        />
      )
      : <span style={styles.logoFallback}>{name || code || '—'}</span>
    }
  </div>
);
});

// ------------------------------------------------------------
// Pomocne funkcije za vrijeme
// ------------------------------------------------------------
const parseDepartureTime = (t: string): Date | null => {
  if (!t) return null;
  try {
    if (t.includes('T') || (t.includes('-') && t.length > 8)) {
      const d = new Date(t);
      if (!isNaN(d.getTime())) return d;
    }
    const [h, m] = t.split(':').map(Number);
    if (isNaN(h) || isNaN(m)) return null;
    const d = new Date();
    d.setHours(h, m, 0, 0);
    const THREE_HOURS = 3 * 60 * 60 * 1000;
    if (Date.now() - d.getTime() > THREE_HOURS) d.setDate(d.getDate() + 1);
    return d;
  } catch { return null; }
};

const getEffectiveDepartureTime = (flight: Flight): Date | null => {
  const t = flight.EstimatedDepartureTime || flight.ScheduledDepartureTime;
  return t ? parseDepartureTime(t) : null;
};

const getEffectiveDepartureMs = (flight: Flight): number => {
  const d = getEffectiveDepartureTime(flight);
  return d ? d.getTime() : Infinity;
};

const formatTimeRemaining = (min: number): string => {
  if (min <= 0) return 'Now';
  if (min >= 60) { const h = Math.floor(min / 60), m = min % 60; return m ? `${h}h ${m}m` : `${h}h`; }
  return `${min}m`;
};

const flightChanged = (a: Flight | null, b: Flight | null): boolean =>
  a?.FlightNumber !== b?.FlightNumber ||
  a?.ScheduledDepartureTime !== b?.ScheduledDepartureTime ||
  a?.StatusEN !== b?.StatusEN;

// ------------------------------------------------------------
// Status helpers
// ------------------------------------------------------------
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

// ------------------------------------------------------------
// Tipovi
// ------------------------------------------------------------
interface FlightDisplayState {
  flight:               Flight | null;
  checkInStatus:        CheckInStatus | null;
  nextFlight:           Flight | null;
  gateChangedAt:        number | undefined;
  manualGateStatus:     string | null;
  overrideFlightNumber: string | null;
  classType:            string | null;   // ← NOVO
}

const EMPTY_STATE: FlightDisplayState = {
  flight:               null,
  checkInStatus:        null,
  nextFlight:           null,
  gateChangedAt:        undefined,
  manualGateStatus:     null,
  overrideFlightNumber: null,
  classType:            null,            // ← NOVO
};

// ------------------------------------------------------------
// Micro komponente
// ------------------------------------------------------------
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

function Divider() {
  return <div style={styles.divider} className="fids-divider" />;
}

// ------------------------------------------------------------
// Glavna komponenta — klijentska logika (nepromijenjena)
// ------------------------------------------------------------
export default function GatePageClient() {
  return <GateErrorBoundary><GateDisplay /></GateErrorBoundary>;
}

// ------------------------------------------------------------
// GateDisplay - sva logika
// ------------------------------------------------------------
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
const manualGateStatusRef = useRef<string | null>(null);
const stdSwitchTimerRef   = useRef<ReturnType<typeof setTimeout> | null>(null);
const etagStatusRef = useRef<string | null>(null);
// FIX (klasa se ne prikazuje/kasni): ovo je sad JEDINI izvor istine za
// status/klasu/broj leta ovog gate-a — puni ga poseban brzi poll (vidi
// efekat "Brzi status/klasa poll" niže), ne loadFlights()/api/flights.
const authoritativeGateStatusRef = useRef<{ status: string | null; flightNumber: string | null; classType: string | null } | null>(null);
const etagGateStatusRef = useRef<string | null>(null);

// ── NOVO: hash-check da se izbjegne nepotreban /api/flights fetch ──
const lastKnownHashRef  = useRef<string | null>(null);
const lastFlightsDataRef = useRef<{ departures: Flight[]; arrivals: Flight[] } | null>(null);
const etagGateRef = useRef<string | null>(null);
const loadFlightsRef = useRef(false);
// Ref za setTimeout handle glavnog (jedinog) poll ciklusa — potreban
// za cleanup u effect-u koji ga postavlja.
const mainTidRef      = useRef<ReturnType<typeof setTimeout> | null>(null);

// ── FIX: AbortController za /api/flights poziv unutar loadFlights.
// Kreira se jednom po lifecycle-u glavnog polling efekta i abort-uje
// se u njegovom cleanup-u — sprječava da fetch koji je "u letu" pri
// unmountu (ili promjeni gateNumber-a) i dalje završi i pozove
// setState na već odjavljenoj komponenti.
const abortControllerRef = useRef<AbortController | null>(null);

  // ------------------------------------------------------------
  // (fetchGateStatusOverride uklonjen — bio je mrtav kod, nikad
  // pozvan. Gate override podatak dolazi iz gateEntries polja u
  // odgovoru glavnog /api/flights poziva unutar loadFlights().)
  // ------------------------------------------------------------
  // Provjera da li let odgovara gate-u
  // ------------------------------------------------------------
  const flightMatchesGate = useCallback((f: Flight, gate: string): boolean => {
    if (!f.GateNumber) return false;
    const gates   = f.GateNumber.split(',').map((g: string) => g.trim());
    const gNorm   = gate.replace(/^0+/, '');
    const gPadded = gate.padStart(2, '0');
    return gates.some(g =>
      g === gate   ||
      g === gNorm  ||
      g === gPadded ||
      g.replace(/^0+/, '') === gNorm
    );
  }, []);

  // ------------------------------------------------------------
  // Odluka da li se let prikazuje
  // ------------------------------------------------------------
  const shouldDisplayFlight = useCallback((f: Flight): boolean => {
    const s = (f.StatusEN || '').toLowerCase().trim();
    if (s.includes('cancelled') || s.includes('canceled') || s.includes('otkazan')) return false;
    if (s.includes('diverted')  || s.includes('preusmjeren')) return false;
    if (manualGateStatusRef.current === 'open') {
      if (s.includes('departed') || s.includes('poletio')) return false;
      return true;
    }
    if (s.includes('departed') || s.includes('poletio')) return false;
    const stdDep = parseDepartureTime(f.ScheduledDepartureTime || '');
    if (stdDep) {
      const ONE_MIN_MS = 60 * 1000;
      if (Date.now() >= stdDep.getTime() - ONE_MIN_MS) return false;
    }
    return true;
  }, []);

  // ------------------------------------------------------------
  // Check-in status za let
  // ------------------------------------------------------------
  const getFlightCheckInStatus = useCallback(async (f: Flight): Promise<CheckInStatus | null> => {
    try {
      return await getEnhancedCheckInStatus(
        f.FlightNumber, f.ScheduledDepartureTime || '', f.StatusEN || ''
      );
    } catch { return null; }
  }, []);

  // ------------------------------------------------------------
  // Ažuriranje countdown-a
  // ------------------------------------------------------------
  const updateCountdown = useCallback((f: Flight | null) => {
    if (!f) { setTimeUntilDeparture(null); return; }
    const dep = getEffectiveDepartureTime(f);
    if (dep) setTimeUntilDeparture(Math.floor((dep.getTime() - Date.now()) / 60_000));
    else     setTimeUntilDeparture(null);
  }, []);

  // ------------------------------------------------------------
  // Glavna funkcija za učitavanje podataka
  // ------------------------------------------------------------
// ------------------------------------------------------------
// Glavna funkcija za učitavanje podataka
// ------------------------------------------------------------
const loadFlights = useCallback(async () => {
  if (!isMountedRef.current) return;
  if (isNightHours()) {
    setLoading(false);
    return;
  }

  // ⚠️ ZAŠTITA OD KONKURENTNIH POZIVA
  if (loadFlightsRef.current) {
    console.log('[gate] loadFlights već u toku, preskačem');
    if (isMountedRef.current) setLoading(false);   // ← DODATO: ne ostavljaj UI na spinneru
                                                     // dok se u pozadini već izvršava
                                                     // legitiman fetch — kad taj drugi
                                                     // poziv završi, on će ionako
                                                     // ažurirati display state
    return;
  }
  loadFlightsRef.current = true;

  try {
    // FIX (klasa se ne prikazuje/kasni — trošak-svjesno rješenje): status/
    // klasa/broj leta za OVAJ gate sad dolaze iz POSEBNOG, jeftinog, brzog
    // poll-a (vidi authoritativeGateStatusRef i efekat "Brzi status/klasa
    // poll" niže) koji cilja /api/test/gate-status-override?gateNumber=X —
    // mali, već kešrandom (max-age=10) endpoint, isti princip kao
    // CheckInPageClient.tsx (koji NIKAD nije imao ovaj bug jer je uvijek
    // koristio ovaj obrazac). /api/flights se i dalje poziva ovdje, ali
    // SAMO za PUN raspored leta (destinacija, vrijeme) — ne više za
    // status/klasu, pa /api/flights može ostati na dugom (45s), jeftinom
    // CDN kešu bez štete po brzinu prikaza klase.
    let data: { departures: Flight[]; arrivals: Flight[] } | null = null;
    const gateOverrideFromStatus = authoritativeGateStatusRef.current;

    const headers: HeadersInit = {};
    if (etagStatusRef.current) {
      headers['If-None-Match'] = etagStatusRef.current;
    }

    // FIX: fetch sada koristi eksterni AbortSignal (iz efekta koji
    // pokreće polling) + interni timeout, po istom principu kao na
    // ostalim stranicama (departures/arrivals/combined). Ovo
    // osigurava da fetch koji je u toku bude stvarno prekinut pri
    // unmountu/promjeni gate-a, a ne samo da mu se rezultat ignoriše.
    const timeoutController = new AbortController();
    const timeoutId = setTimeout(() => timeoutController.abort(), 10_000);
    const externalSignal = abortControllerRef.current?.signal;
    if (externalSignal) {
      if (externalSignal.aborted) timeoutController.abort();
      else externalSignal.addEventListener('abort', () => timeoutController.abort(), { once: true });
    }

    let statusRes: Response;
    try {
      statusRes = await fetch('/api/flights', { headers, signal: timeoutController.signal });
    } finally {
      clearTimeout(timeoutId);
    }

    if (statusRes.status === 304) {
      data = lastFlightsDataRef.current;
    } else if (statusRes.ok) {
      const statusData = await statusRes.json();
      const newEtag = statusRes.headers.get('ETag');
      if (newEtag) etagStatusRef.current = newEtag;

      data = { departures: statusData.departures ?? [], arrivals: statusData.arrivals ?? [] };
      lastFlightsDataRef.current = data;
    }

    // 2. Ako nema podataka - izađi
    if (!data) {
      console.error('[gate] Nema podataka');
      setLoading(false);
      return;
    }

    // 3. Override - KORISTI PODATKE IZ BRZOG STATUS POLL-A (vidi gore)
    let overrideStatus: string | null = gateOverrideFromStatus?.status ?? null;
    let overrideFlightNumber: string | null = gateOverrideFromStatus?.flightNumber ?? null;
    let classType: string | null = gateOverrideFromStatus?.classType ?? null;

    manualGateStatusRef.current = overrideStatus;

    // 4. Ako je ručno zatvoren -> prazan ekran
    if (overrideStatus === 'closed') {
      if (!isMountedRef.current) return;
      currentFlightRef.current = null;
      currentStatusRef.current = null;
      setDisplay({
        flight: null,
        checkInStatus: null,
        nextFlight: null,
        gateChangedAt: undefined,
        manualGateStatus: 'closed',
        overrideFlightNumber: null,
        classType,
      });
      setLastUpdate(new Date().toLocaleTimeString('en-GB'));
      setLoading(false);
      return;
    }

    // 5. Kandidati za prikaz
    let candidates: Flight[] = [];

    if (overrideStatus === 'open' && overrideFlightNumber) {
      // 🔥 SLUČAJ A: Override je aktivan - prikaži SAMO taj let
      const overriddenFlight = data.departures.find(f => f.FlightNumber === overrideFlightNumber);
      
      if (!overriddenFlight) {
        console.warn(`[gate] Let ${overrideFlightNumber} nije pronađen u keširanim podacima`);
        setDisplay({
          flight: null,
          checkInStatus: null,
          nextFlight: null,
          gateChangedAt: undefined,
          manualGateStatus: 'open',
          overrideFlightNumber,
          classType,
        });
        setLoading(false);
        return;
      }
      
      candidates = [overriddenFlight];
    } else {
      // 🔥 SLUČAJ B: Nema override-a - prikaži sve letove s ovog gate-a
      candidates = data.departures.filter(f => flightMatchesGate(f, gateNumber));
    }

    // 6. Check-in status za kandidate
    const withStatus = await Promise.all(
      candidates.map(async (f) => ({
        ...f,
        checkInStatus: await getFlightCheckInStatus(f),
      }))
    );

    // 7. Sortiranje
    const sorted = [...withStatus].sort((a, b) => {
      if (overrideStatus === 'open') {
        const ta = parseDepartureTime(a.ScheduledDepartureTime || '')?.getTime() ?? Infinity;
        const tb = parseDepartureTime(b.ScheduledDepartureTime || '')?.getTime() ?? Infinity;
        return ta - tb;
      }
      return getEffectiveDepartureMs(a) - getEffectiveDepartureMs(b);
    });

    // 8. Odaberi current let
    let current: typeof sorted[0] | null = null;
    
    if (overrideStatus === 'open') {
      current = sorted[0] ?? null;
    } else {
      current = sorted.find(f => shouldDisplayFlight(f)) ?? null;
    }

    // 9. Next flight
    let nextFlight: typeof sorted[0] | null = null;
    const idx = current ? sorted.findIndex(f => f.FlightNumber === current!.FlightNumber) : -1;
    if (idx >= 0) {
      for (let i = idx + 1; i < sorted.length; i++) {
        if (overrideStatus === 'open' || shouldDisplayFlight(sorted[i])) {
          nextFlight = sorted[i];
          break;
        }
      }
    }

    // 10. Detekcija promjene gate-a
    let gateChangedAt: number | undefined;
    if (
      overrideStatus !== 'open' &&
      current?.GateNumber &&
      currentFlightRef.current?.GateNumber !== current.GateNumber
    ) {
      const prev = currentFlightRef.current?.GateNumber;
      if (prev && prev !== '-') gateChangedAt = Date.now();
    }

    if (!isMountedRef.current) return;

    // 11. Ažuriranje state-a
    const hasChanged = flightChanged(current, currentFlightRef.current) || !!gateChangedAt;

    if (hasChanged) {
      currentFlightRef.current = current;
      currentStatusRef.current = current?.checkInStatus ?? null;
      setDisplay({
        flight: current,
        checkInStatus: current?.checkInStatus ?? null,
        nextFlight,
        gateChangedAt,
        manualGateStatus: overrideStatus,
        overrideFlightNumber,
        classType,
      });
      updateCountdown(current);
    } else {
      setDisplay(prev => prev.classType !== classType ? { ...prev, classType } : prev);
    }

    setLastUpdate(new Date().toLocaleTimeString('en-GB'));
    setLoading(false);

  } catch (err) {
    // FIX: ako je greška zbog abort-a pri unmountu/gašenju komponente,
    // ne loguj kao "critical" i ne diraj state — komponenta se gasi.
    if ((err as Error)?.name === 'AbortError') {
      return;
    }
    console.error('Gate load error:', err);
    if (isMountedRef.current) setLoading(false);
  } finally {
    loadFlightsRef.current = false;
  }
}, [gateNumber, flightMatchesGate, getFlightCheckInStatus, updateCountdown, shouldDisplayFlight]);


// ── FIX (troškovno-svjesno vraćanje na 30-45s za PUN raspored leta):
// klasa/status/broj leta se sad rješavaju kroz poseban, jeftin brzi poll
// (vidi efekat "Brzi status/klasa poll" niže) — loadFlights() (poziva
// veći, /api/flights) više ne mora da radi na 9-12s kadenci, jer nije
// više odgovoran za vremenski osjetljive podatke. Ovo vraća /api/flights
// pozive na relaksiran tempo, smanjujući Vercel Active CPU trošak, bez
// gubitka brzine prikaza klase/statusa (to sad garantuje brzi poll ispod).
const getGateNextInterval = useCallback((): number => {
  return 30_000 + Math.floor(Math.random() * 15_000); // 30-45s
}, []);

useEffect(() => {
  isMountedRef.current = true;
  abortControllerRef.current = new AbortController();
 
  const schedule = () => {
    const interval = getGateNextInterval();
    setNextUpdate(new Date(Date.now() + interval).toLocaleTimeString('en-GB'));
    mainTidRef.current = setTimeout(async () => {
      if (isMountedRef.current) {
        if (!isNightHours()) {
          await loadFlights();
        }
        schedule();
      }
    }, interval);
  };
 
  if (!isNightHours()) {
    loadFlights().then(schedule);
  } else {
    setLoading(false);
    schedule();
  }
 
  return () => {
    isMountedRef.current = false;
    if (mainTidRef.current) clearTimeout(mainTidRef.current);
    abortControllerRef.current?.abort();
  };
}, [loadFlights, getGateNextInterval]);

// ------------------------------------------------------------
// FIX (klasa se ne prikazuje/kasni — pravo rješenje bez dodatnog
// Vercel Active CPU troška): BRZI STATUS/KLASA POLL — cilja mali, već
// jeftin /api/test/gate-status-override?gateNumber=X (per-gate, ETag,
// max-age=10 CDN keš), IDENTIČAN princip kao CheckInPageClient.tsx koji
// NIKAD nije imao ovaj bug. Ovo je sad JEDINI izvor istine za
// status/klasu/broj leta (loadFlights() gore samo dopunjava PUNE detalje
// rasporeda za taj flightNumber). Kad detektuje promjenu, ODMAH patch-uje
// display state — bez čekanja na sledeći loadFlights() ciklus — garantuje
// vidljivost promjene u roku od 9-12s (FAST_POLL kadenca), sigurno ispod
// tražene granice od 15s.
// ------------------------------------------------------------
useEffect(() => {
  if (!gateNumber) return;

  let tid: ReturnType<typeof setTimeout>;
  let cancelled = false;
  const controller = new AbortController();

  const poll = async () => {
    if (cancelled) return;

    if (isNightHours()) {
      tid = setTimeout(poll, getFastPollInterval());
      return;
    }

    try {
      const headers: HeadersInit = {};
      if (etagGateStatusRef.current) headers['If-None-Match'] = etagGateStatusRef.current;

      const res = await fetch(
        `/api/test/gate-status-override?gateNumber=${gateNumber}`,
        { headers, signal: controller.signal }
      );

      if (res.status === 304) {
        const newEtag = res.headers.get('ETag');
        if (newEtag) etagGateStatusRef.current = newEtag;
      } else if (res.ok) {
        const newEtag = res.headers.get('ETag');
        if (newEtag) etagGateStatusRef.current = newEtag;

        const entry = await res.json();
        const fresh = {
          status: entry?.status ?? null,
          flightNumber: entry?.flightNumber ?? null,
          classType: entry?.classType ?? null,
        };
        const prev = authoritativeGateStatusRef.current;
        const changed = !prev
          || prev.status !== fresh.status
          || prev.flightNumber !== fresh.flightNumber
          || prev.classType !== fresh.classType;

        authoritativeGateStatusRef.current = fresh;

        // Ako se SAMO klasa (ili status, bez promjene leta) promijenila,
        // patch-uj display ODMAH — ne čekaj sledeći loadFlights() ciklus
        // (koji može biti do 45s daleko). Ako se PROMIJENIO flightNumber,
        // prepusti puni loadFlights() ciklus (treba mu novi flight detalj).
        if (changed && fresh.flightNumber === prev?.flightNumber) {
          setDisplay(d => ({ ...d, classType: fresh.classType }));
        } else if (changed) {
          // Novi let na ovom gate-u ili status closed/open promjena —
          // pokreni pun loadFlights() da povuče detalje novog leta.
          loadFlights();
        }
      }
    } catch (err) {
      if ((err as Error)?.name !== 'AbortError') {
        console.warn('[gate] brzi status/klasa poll greška:', err);
      }
    } finally {
      if (!cancelled) tid = setTimeout(poll, getFastPollInterval());
    }
  };

  poll();

  return () => {
    cancelled = true;
    clearTimeout(tid);
    controller.abort();
  };
}, [gateNumber, loadFlights]);


 
// ------------------------------------------------------------
// FIX (SPAJANJE POLL CIKLUSA — vidi opširan komentar uz
// FAST_POLL_BASE_MS na vrhu fajla): odvojeni "brzi" watchdog koji je
// ovdje ranije postojao (poseban poziv ka /api/test/gate-status-override
// svakih 9-12s, samo da bi detektovao promjenu i onda pokrenuo
// loadFlights()) je UKLONJEN. Glavni ciklus iznad sad SAM radi na
// 9-12s kadenci (getNextInterval → getFastPollInterval) i loadFlights()
// već čita gateEntries (gate status override) iz /api/flights odgovora
// na SVAKOM pozivu — nema više potrebe za posebnim, dupliranim pozivom
// koji je čitao IDENTIČAN podatak sa drugog endpointa.
//
// Ušteda: ~495.000 zahtjeva/mjesec manje po gate ekranu, uz BOLJU (ne
// istu) odzivnost za sam raspored leta (bio je do 53s star, sad je
// svježe koliko i status — 9-12s).
// ------------------------------------------------------------

  // ------------------------------------------------------------
  // Timer za automatsko prebacivanje na STD-1min
  // ------------------------------------------------------------
  useEffect(() => {
    if (stdSwitchTimerRef.current) {
      clearTimeout(stdSwitchTimerRef.current);
      stdSwitchTimerRef.current = null;
    }
    if (!display.flight) return;
    if (manualGateStatusRef.current === 'open') return;
    const stdDep = parseDepartureTime(display.flight.ScheduledDepartureTime || '');
    if (!stdDep) return;
    const triggerAt = stdDep.getTime() - 60 * 1000;
    const ms = triggerAt - Date.now();
    if (ms > 0) {
      stdSwitchTimerRef.current = setTimeout(() => {
        if (isMountedRef.current) loadFlights();
      }, ms);
    } else if (ms > -5 * 60 * 1000) {
      loadFlights();
    }
    return () => {
      if (stdSwitchTimerRef.current) {
        clearTimeout(stdSwitchTimerRef.current);
        stdSwitchTimerRef.current = null;
      }
    };
  }, [display.flight, loadFlights]);

  // ------------------------------------------------------------
  // Countdown ticker
  // ------------------------------------------------------------
  useEffect(() => {
    const id = setInterval(() => updateCountdown(currentFlightRef.current), 30_000);
    return () => clearInterval(id);
  }, [updateCountdown]);

  // ------------------------------------------------------------
  // Hard reset nakon 6h
  // ------------------------------------------------------------
// FIX (24/7 rad bez nadzora) — zamijenjen "goli" hard-reset tajmer
// punim setom zaštita (heartbeat watchdog, globalni error handler,
// handler za neuhvaćene odbijene promise-e — ranije nije postojao na
// ovoj stranici). Vidi opširan komentar u hooks/use-kiosk-resilience.ts.
useKioskResilience({
  pageName: `gate-${gateNumber}`,
  hardResetIntervalMs: HARD_RESET_INTERVAL_MS,
});

  // ------------------------------------------------------------
  // Kiosk mode
  // ------------------------------------------------------------
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

  // ------------------------------------------------------------
  // Izvedeni statusi
  // ------------------------------------------------------------
  const { isCancelled, isDiverted } = checkFlightStatus(display.flight?.StatusEN || '');
  const isGateChanged = !!(display.gateChangedAt && (Date.now() - display.gateChangedAt < 15_000));
  const hasDel = display.flight?.EstimatedDepartureTime &&
    display.flight.EstimatedDepartureTime !== display.flight.ScheduledDepartureTime;

  const effectiveStatus = useMemo(() => {
    const raw = display.flight?.StatusEN || '';
    if (!display.flight || isCancelled || isDiverted) return raw;
    const s = raw.toLowerCase();
    if (s.includes('departed') || s.includes('poletio') ||
        s.includes('final call') || s.includes('boarding') || s.includes('gate open')) return raw;
    const refTime = display.flight.EstimatedDepartureTime || display.flight.ScheduledDepartureTime || '';
    const dep = parseDepartureTime(refTime);
    if (!dep) return raw;
    const minUntil = Math.floor((dep.getTime() - Date.now()) / 60_000);
    if (minUntil <= 30 && minUntil > 5) return 'Boarding';
    return raw;
  }, [display.flight, isCancelled, isDiverted]);

  const statusCfg = getStatusConfig(effectiveStatus);

  // ------------------------------------------------------------
  // Weather
  // ------------------------------------------------------------
  const weather = useWeather({
    cityName:    display.flight?.DestinationCityName,
    airportCode: display.flight?.DestinationAirportCode,
  }, 0);

  // ------------------------------------------------------------
  // RENDER: Loading
  // ------------------------------------------------------------
  if (loading) return (
    <div style={styles.splash}>
      <div style={styles.spinner} />
      <div style={styles.splashTitle}>Loading gate information…</div>
    </div>
  );

// ------------------------------------------------------------
// RENDER: Nema leta
// ------------------------------------------------------------
if (!display.flight) {
  const closed = display.manualGateStatus === 'closed';
  return (
    <div style={styles.splash} className="fids-splash">

      {/* ── Ikona aviona ── */}
      <div style={{ width: '60px', height: '60px', marginBottom: '0.5rem' }}>
        <svg viewBox="0 0 24 24" fill="none" style={{ width: '100%', height: '100%' }}>
          <path
            d="M21 16v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V9l-8 5v2l8-2.5V19l-2.5 1.5V22l4-1 4 1v-1.5L13 19v-5.5l8 2.5z"
            strokeWidth="1.2"
            strokeLinejoin="round"
            fill={closed ? '#ef4444' : '#e6a817'}
            fillOpacity={closed ? 0.10 : 0.06}
            stroke={closed ? '#ef4444' : '#e6a817'}
            strokeOpacity={0.5}
          />
        </svg>
      </div>

      {/* ── Label "GATE" (iznad broja) ── */}
      <div style={{
        fontSize: 'clamp(1.2rem, 3vw, 2.5rem)',
        fontWeight: 600,
        letterSpacing: '0.2em',
        color: '#94a3b8',
        textTransform: 'uppercase',
        marginBottom: '0.2rem',
      }}>
        GATE
      </div>

      {/* ── Broj gate ── */}
      <div style={{
        ...styles.gateLabel,
        fontSize: 'clamp(6rem, 20vw, 28rem)',
        lineHeight: 1,
        marginTop: '-0.2rem',
      }}>
        {gateNumber}
      </div>

      {/* ── Status pill ── */}
      <div style={{
        fontSize: '1.2rem',
        fontWeight: 600,
        letterSpacing: '.08em',
        color: closed ? '#ef4444' : '#94a3b8',
        marginTop: '0.5rem',
        background: closed ? 'rgba(239,68,68,0.10)' : 'rgba(230,168,23,0.06)',
        padding: '0.4rem 1.2rem',
        borderRadius: '999px',
        border: `1px solid ${closed ? 'rgba(239,68,68,0.25)' : 'rgba(230,168,23,0.15)'}`,
      }}>
        {closed ? 'GATE CLOSED' : 'NO FLIGHTS SCHEDULED'}
      </div>

      {/* ── REKLAMNI TEKST (english, bez "tranzitne zone") ── */}
      <div style={{
        fontSize: 'clamp(0.9rem, 1.4vw, 1.3rem)',
        fontWeight: 500,
        color: '#cbd5e1',
        textAlign: 'center',
        maxWidth: '600px',
        marginTop: '1rem',
        padding: '0.5rem 1rem',
        borderTop: '1px solid rgba(255,255,255,0.06)',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        letterSpacing: '0.02em',
        lineHeight: 1.5,
      }}>
        ✈️ While you wait for your flight to be assigned to a specific gate,<br />
        visit our <strong style={{ color: '#e6a817' }}>DUTY FREE SHOP</strong>!
      </div>

      {/* ── Donja metrika ── */}
      <div style={styles.metaRow}>
        <span>Updated {lastUpdate}</span>
        <span style={{ opacity: .4 }}>•</span>
        <span>Next {nextUpdate}</span>
      </div>

    </div>
  );
}
  // ------------------------------------------------------------
  // RENDER: Aktivan let
  // ------------------------------------------------------------
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
          {/* Klasa u top baru — odmah vidljiva  ← NOVO */}
          {display.classType && (
            <>
              <span style={styles.topBarSep}>|</span>
              <ClassBadge classType={display.classType} />
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
          <AirlineLogo
            icao={f.AirlineICAO}
            flightNumber={f.FlightNumber}
            name={f.AirlineName}
          />

          {/* Klasa ispod logoa — velika, uočljiva  ← NOVO */}
          {display.classType && (
            <div style={{ marginTop: '0.3rem', marginBottom: '0.2rem' }}>
              <ClassBadge classType={display.classType} />
            </div>
          )}

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

          {/* Power bank warning */}
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
                className="fids-status-badge">
                CANCELLED
              </div>
            ) : isDiverted ? (
              <div style={{ ...styles.statusBadge, background: '#7c2d12', color: '#fdba74' }}
                className="fids-status-badge">
                DIVERTED
              </div>
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

          {/* Check-in closing warning */}
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

      {/* GLOBAL STYLES */}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Share+Tech+Mono&family=Rajdhani:wght@500;600;700&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        @keyframes fidsPulse { 0%,100%{opacity:1} 50%{opacity:.55} }
        @keyframes spin { to { transform: rotate(360deg); } }
        html,body,#__next { width:100vw; height:100vh; overflow:hidden; background:#070d1a; }

        @media (max-width: 1024px) {
          .fids-topbar { padding: 0.6rem 1.5rem !important; }
          .fids-main { padding: 1rem 1.5rem !important; }
          .fids-left-col { padding-right: 1.5rem !important; }
          .fids-v-divider { margin: 0 1.5rem !important; }
          .fids-footer { padding: 0.7rem 1.5rem !important; }
          .fids-next-dest { max-width: 200px !important; }
        }
        @media (max-width: 768px) {
          html, body, #__next { overflow: auto !important; height: auto !important; min-height: 100vh !important; }
          .fids-root { overflow-y: auto !important; overflow-x: hidden !important; height: auto !important; min-height: 100vh !important; }
          .fids-topbar { padding: 0.5rem 1rem !important; flex-wrap: wrap !important; position: sticky !important; top: 0 !important; z-index: 10 !important; }
          .fids-class-badge { font-size: 1.2rem !important; padding: 0.3rem 0.8rem !important; }
          .fids-main { flex-direction: column !important; padding: 0.8rem 1rem !important; gap: 1rem !important; }
          .fids-left-col { flex: none !important; width: 100% !important; padding-right: 0 !important; }
          .fids-logo-card { height: 70px !important; }
          .fids-flight-number { font-size: 3rem !important; }
          .fids-dest-code { font-size: 2rem !important; }
          .fids-dest-city { font-size: 2.8rem !important; }
          .fids-charger-warning, .fids-boarding-notice { flex-direction: column !important; gap: 0.25rem !important; padding: 0.5rem 0.7rem !important; }
          .fids-v-divider { width: 100% !important; height: 1px !important; margin: 0 !important; background: linear-gradient(90deg, transparent 0%, #1e3a5f 20%, #1e3a5f 80%, transparent 100%) !important; }
          .fids-right-col { width: 100% !important; gap: 0.7rem !important; }
          .fids-time-value { font-size: 2.8rem !important; }
          .fids-countdown { flex-direction: column !important; gap: 0.15rem !important; }
          .fids-status-badge { font-size: 1.4rem !important; padding: 0.35em 0.8em !important; }
          .fids-gate-changed-banner, .fids-checkin-banner { font-size: 0.9rem !important; padding: 0.4rem 0.8rem !important; }
          .fids-footer { flex-direction: column !important; padding: 0.6rem 1rem !important; align-items: flex-start !important; gap: 0.4rem !important; }
          .fids-next-flight { flex-wrap: wrap !important; gap: 0.3rem 0.8rem !important; }
          .fids-next-dest { max-width: 100% !important; white-space: normal !important; order: 10 !important; width: 100% !important; }
        }
        @media (max-width: 480px) {
          .fids-logo-card { height: 55px !important; }
          .fids-flight-number { font-size: 2.4rem !important; }
          .fids-dest-code { font-size: 1.6rem !important; }
          .fids-dest-city { font-size: 2rem !important; }
          .fids-time-value { font-size: 2.2rem !important; }
          .fids-status-badge { font-size: 1.2rem !important; }
          .fids-class-badge { font-size: 1rem !important; }
          .fids-dgr-wrapper img { max-height: 70px !important; }
          .fids-next-fn, .fids-next-time { font-size: 1.3rem !important; }
          .fids-next-dest { font-size: 1.1rem !important; }
        }
      `}</style>
    </div>
  );
}

// ------------------------------------------------------------
// Stilovi
// ------------------------------------------------------------
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
  topBarLeft: { display: 'flex', alignItems: 'baseline', gap: '0.7rem', flexWrap: 'wrap' as const },
  topBarLabel: { fontSize: '0.95rem', fontWeight: 600, letterSpacing: '.18em', color: C.textMuted, fontFamily: FONT_MONO },
  topBarGate: { fontSize: '3.2rem', fontWeight: 700, lineHeight: 1, color: C.gold, letterSpacing: '.04em' },
  topBarTerminal: { fontSize: '2rem', fontWeight: 600, color: C.text, letterSpacing: '.06em' },
  topBarSep: { color: C.border, fontSize: '1.8rem', margin: '0 0.4rem' },
  clock: { fontFamily: FONT_MONO, fontSize: '2.2rem', fontWeight: 400, color: C.accent, letterSpacing: '.08em', flexShrink: 0 },
  divider: { height: '1px', background: `linear-gradient(90deg, transparent 0%, ${C.border} 20%, ${C.border} 80%, transparent 100%)`, flexShrink: 0 },
  main: { display: 'flex', flex: 1, overflow: 'visible', padding: '1.5rem 2.5rem', gap: '0', minHeight: 0 },
  leftCol: { display: 'flex', flexDirection: 'column', justifyContent: 'space-evenly', flex: '0 0 52%', gap: '.8rem', paddingRight: '2.5rem', overflow: 'visible' },
logoCard: { width: '100%', height: 'clamp(120px, 14vh, 200px)', background: '#ffffff', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', boxShadow: `0 0 0 1px ${C.border}, 0 4px 40px rgba(30,144,255,0.12)`, flexShrink: 0, position: 'relative' },  logoImg: { width: '100%', height: '100%', objectFit: 'contain' as const, padding: '10px 20px' },
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
  dangerousGoodsImg: { maxWidth: '100%', maxHeight: '100%', width: 'auto', height: 'auto', objectFit: 'contain' as const, borderRadius: '8px' },
  footer: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '1rem 2.5rem', background: C.panel, borderTop: `1px solid ${C.border}`, flexShrink: 0, gap: '2rem' },
  footerMeta: { display: 'flex', gap: '1.2rem', alignItems: 'center', color: C.textMuted, fontSize: '.8rem', letterSpacing: '.12em', fontFamily: FONT_MONO, flexShrink: 0 },
  nextFlight: { display: 'flex', alignItems: 'center', gap: '1.8rem', overflow: 'hidden' },
  nextLabel: { fontSize: '1rem', fontWeight: 600, color: C.textMuted, letterSpacing: '.16em', fontFamily: FONT_MONO, flexShrink: 0 },
  nextFN: { fontSize: '2.5rem', fontWeight: 700, color: C.text, letterSpacing: '.08em', flexShrink: 0 },
  nextDest: { fontSize: '2.3rem', fontWeight: 600, color: C.textMuted, letterSpacing: '.04em', overflow: 'hidden', whiteSpace: 'nowrap' as const, textOverflow: 'ellipsis' },
  nextTime: { fontFamily: FONT_MONO, fontSize: '2.3rem', color: C.gold, letterSpacing: '.08em', flexShrink: 0 },
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