'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams } from 'next/navigation';

const POLL_INTERVAL_MS = 10_000;
const isDevelopment = process.env.NODE_ENV === 'development';
const API_PREFIX = isDevelopment ? '/api/test' : '/api/test';

// ============================================================
// TIPOVI
// ============================================================
interface GateAssignment {
  status: 'open' | 'closed' | null;
  flightNumber: string | null;
  setAt: number | null;
  airlineName: string;
  airlineICAO: string;
  destinationCity: string;
  destinationCode: string;
  scheduledTime: string;
  estimatedTime: string;
  terminal: string;
  flightStatus: string;
  codeshareFlights: string[];
  isCancelled: boolean;
  isDiverted: boolean;
}

const EMPTY_ASSIGNMENT: GateAssignment = {
  status: null, flightNumber: null, setAt: null,
  airlineName: '', airlineICAO: '', destinationCity: '',
  destinationCode: '', scheduledTime: '', estimatedTime: '',
  terminal: '', flightStatus: '', codeshareFlights: [],
  isCancelled: false, isDiverted: false,
};

// ============================================================
// HELPER: format vremena
// ============================================================
function getStatusConfig(raw: string): { label: string; color: string; pulse: boolean } {
  const s = (raw || '').toLowerCase().trim();
  if (s.includes('final call'))   return { label: raw, color: '#ef4444', pulse: true };
  if (s.includes('boarding'))     return { label: raw, color: '#22c55e', pulse: false };
  if (s.includes('delay'))        return { label: raw, color: '#f59e0b', pulse: false };
  if (s.includes('cancelled'))    return { label: raw, color: '#ef4444', pulse: false };
  if (s.includes('diverted'))     return { label: raw, color: '#f97316', pulse: false };
  if (s.includes('departed'))     return { label: raw, color: '#6b7280', pulse: false };
  return { label: raw, color: '#eab308', pulse: false };
}

function formatTimeRemaining(min: number): string {
  if (min <= 0) return 'Now';
  if (min >= 60) {
    const h = Math.floor(min / 60);
    const m = min % 60;
    return m ? `${h}h ${m}m` : `${h}h`;
  }
  return `${min}m`;
}

// ============================================================
// KOMPONENTA ZA LOGO (bez hydration error)
// ============================================================
function AirlineLogo({ icao, flightNumber, name }: { icao: string; flightNumber: string; name: string }) {
  const code = icao || flightNumber?.substring(0, 2).toUpperCase() || '';
  const [src, setSrc] = useState<string>('');
  const [errored, setErrored] = useState(false);

  useEffect(() => {
    if (!code) return;
    let cancelled = false;
    const checkImg = (url: string): Promise<boolean> =>
      new Promise((resolve) => {
        const img = new window.Image();
        img.onload = () => resolve(true);
        img.onerror = () => resolve(false);
        setTimeout(() => resolve(false), 1200);
        img.src = url;
      });
    (async () => {
      const [hasJpg, hasPng] = await Promise.all([
        checkImg(`/airlines/${code}.jpg`),
        checkImg(`/airlines/${code}.png`),
      ]);
      if (cancelled) return;
      if (hasJpg) setSrc(`/airlines/${code}.jpg`);
      else if (hasPng) setSrc(`/airlines/${code}.png`);
      else setSrc(`https://www.flightaware.com/images/airline_logos/180px/${code}.png`);
    })();
    return () => { cancelled = true; };
  }, [code]);

  if (src && !errored) {
    return <img src={src} alt={name} style={styles.logoImg} onError={() => setErrored(true)} />;
  }
  return <span style={styles.logoFallback}>{name || code || '—'}</span>;
}

// ============================================================
// LIVE CLOCK (sprečava hydration mismatch)
// ============================================================
function LiveClock() {
  const [time, setTime] = useState('--:--:--');
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
    const tick = () => setTime(new Date().toLocaleTimeString('en-GB', { hour12: false }));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);
  return <span style={styles.clock} suppressHydrationWarning>{mounted ? time : '--:--:--'}</span>;
}

// ============================================================
// GLAVNA KOMPONENTA
// ============================================================
export default function GatePage() {
  const params = useParams();
  const gateNumber = params.gateNumber as string;

  const [assignment, setAssignment] = useState<GateAssignment>(EMPTY_ASSIGNMENT);
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState('');
  const [timeUntilDeparture, setTimeUntilDeparture] = useState<number | null>(null);
  const [mounted, setMounted] = useState(false);

  const isMountedRef = useRef(true);

  useEffect(() => { setMounted(true); }, []);

  // Kiosk mode
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

  // Countdown timer
  useEffect(() => {
    if (!assignment.scheduledTime) { setTimeUntilDeparture(null); return; }
    const calc = () => {
      let dep: Date | null = null;
      if (assignment.scheduledTime.includes('T')) {
        dep = new Date(assignment.scheduledTime);
      } else {
        const [h, m] = assignment.scheduledTime.split(':').map(Number);
        if (!isNaN(h) && !isNaN(m)) {
          dep = new Date();
          dep.setHours(h, m, 0, 0);
          if (Date.now() - dep.getTime() > 6 * 60 * 60 * 1000) dep.setDate(dep.getDate() + 1);
        }
      }
      if (dep) setTimeUntilDeparture(Math.floor((dep.getTime() - Date.now()) / 60_000));
    };
    calc();
    const id = setInterval(calc, 30_000);
    return () => clearInterval(id);
  }, [assignment.scheduledTime]);

  // Glavni fetch – dohvati dodjelu gate-a i detalje leta
  const fetchGateData = useCallback(async () => {
    if (!isMountedRef.current) return;
    try {
      const res = await fetch(`${API_PREFIX}/gate-status-override?gateNumber=${gateNumber}`);
      if (!res.ok) throw new Error('Failed to fetch gate status');
      const data = await res.json();

      if (!isMountedRef.current) return;
      setLastUpdate(new Date().toLocaleTimeString('en-GB'));

      if (!data || !data.flightNumber || data.status !== 'open') {
        setAssignment(EMPTY_ASSIGNMENT);
        setLoading(false);
        return;
      }

      let flightDetails: Record<string, any> = {};
      try {
        const fRes = await fetch('/api/flights?nocache=' + Date.now());
        const fData = await fRes.json();
        const all = [...(fData.departures || []), ...(fData.arrivals || [])];
        const match = all.find((f: any) => f.FlightNumber === data.flightNumber);
        if (match) flightDetails = match;
      } catch (err) {
        console.warn('Could not fetch flight details, using fallback');
      }

      const statusStr = flightDetails.StatusEN || '';
      const sl = statusStr.toLowerCase();
      const isCancelled = sl.includes('cancelled') || sl.includes('canceled') || sl.includes('otkazan');
      const isDiverted = sl.includes('diverted') || sl.includes('preusmjeren');

      setAssignment({
        status: data.status,
        flightNumber: data.flightNumber,
        setAt: data.setAt || null,
        airlineName: flightDetails.AirlineName || '',
        airlineICAO: flightDetails.AirlineICAO || '',
        destinationCity: flightDetails.DestinationCityName || '',
        destinationCode: flightDetails.DestinationAirportCode || '',
        scheduledTime: flightDetails.ScheduledDepartureTime || '',
        estimatedTime: flightDetails.EstimatedDepartureTime || '',
        terminal: flightDetails.Terminal || '',
        flightStatus: statusStr,
        codeshareFlights: flightDetails.CodeShareFlights || [],
        isCancelled,
        isDiverted,
      });
      setLoading(false);
    } catch (err) {
      console.error('fetchGateData error:', err);
      if (isMountedRef.current) {
        setLastUpdate(new Date().toLocaleTimeString('en-GB'));
        setLoading(false);
      }
    }
  }, [gateNumber]);

  useEffect(() => {
    isMountedRef.current = true;
    fetchGateData();
    const interval = setInterval(fetchGateData, POLL_INTERVAL_MS);
    return () => {
      isMountedRef.current = false;
      clearInterval(interval);
    };
  }, [fetchGateData]);

  if (!mounted) {
    return <div style={{ background: '#070d1a', width: '100vw', height: '100vh' }} />;
  }

  if (loading) {
    return (
      <div style={styles.splash}>
        <div style={styles.spinner} />
        <div style={styles.splashTitle}>Loading gate information…</div>
      </div>
    );
  }

  const isOpen = assignment.status === 'open' && assignment.flightNumber;
  if (!isOpen) {
    const closed = assignment.status === 'closed';
    return (
      <div style={styles.splash}>
        <div style={{ ...styles.gateLabel, fontSize: 'clamp(5rem,18vw,14rem)' }}>{gateNumber}</div>
        <div style={{ fontSize: '2rem', fontWeight: 600, color: closed ? '#ef4444' : '#475569' }}>
          {closed ? 'GATE CLOSED' : 'NO FLIGHTS ASSIGNED'}
        </div>
        {assignment.flightNumber && !isOpen && (
          <div style={styles.flightHint}>
            {assignment.flightNumber} → {assignment.destinationCity || assignment.destinationCode}
            {assignment.scheduledTime && ` · ${assignment.scheduledTime}`}
          </div>
        )}
        <div style={styles.metaRow}>Updated {lastUpdate}</div>
      </div>
    );
  }

  // AKTIVNI EKRAN
  const statusCfg = getStatusConfig(assignment.flightStatus);
  const hasDelay = assignment.estimatedTime && assignment.estimatedTime !== assignment.scheduledTime;

  return (
    <div style={styles.root}>
      {/* Top bar */}
      <div style={styles.topBar}>
        <div style={styles.topBarLeft}>
          <span style={styles.topBarLabel}>GATE</span>
          <span style={styles.topBarGate}>{gateNumber}</span>
          {assignment.terminal && (
            <>
              <span style={styles.topBarSep}>|</span>
              <span style={styles.topBarLabel}>TERMINAL</span>
              <span style={styles.topBarTerminal}>{assignment.terminal.replace('T0', 'T')}</span>
            </>
          )}
        </div>
        <LiveClock />
      </div>

      <div style={styles.divider} />

      {/* Main content */}
      <div style={styles.main}>
        <div style={styles.leftCol}>
          <div style={styles.logoCard}>
            <AirlineLogo
              icao={assignment.airlineICAO}
              flightNumber={assignment.flightNumber || ''}
              name={assignment.airlineName}
            />
          </div>
          <div style={styles.flightNumber}>{assignment.flightNumber}</div>
          {assignment.codeshareFlights.length > 0 && (
            <div style={styles.codeshare}>
              Also operating as:&nbsp;
              <span style={styles.codeshareList}>{assignment.codeshareFlights.join(' · ')}</span>
            </div>
          )}
          <div style={styles.destCode}>{assignment.destinationCode}</div>
          <div style={styles.destCity}>{assignment.destinationCity}</div>
        </div>

        <div style={styles.vDivider} />

        {/* RIGHT COLUMN – enhanced with side‑by‑side times and DGR image */}
        <div style={styles.rightCol}>
          {/* Times container */}
          <div style={styles.timesContainer}>
            {/* Scheduled */}
            <div style={styles.timeBlock}>
              <div style={styles.timeLabel}>SCHEDULED DEPARTURE</div>
              <div style={styles.timeValue}>{assignment.scheduledTime}</div>
            </div>
            {/* Estimated (only if different) */}
            {hasDelay && (
              <div style={styles.timeBlock}>
                <div style={{ ...styles.timeLabel, color: '#f59e0b' }}>ESTIMATED DEPARTURE</div>
                <div style={{ ...styles.timeValue, color: '#f59e0b' }}>{assignment.estimatedTime}</div>
              </div>
            )}
          </div>

          <div style={styles.divider} />

          {/* Status badge */}
          <div style={styles.statusBlock}>
            {assignment.isCancelled ? (
              <div style={{ ...styles.statusBadge, background: '#7f1d1d', color: '#fca5a5' }}>CANCELLED</div>
            ) : assignment.isDiverted ? (
              <div style={{ ...styles.statusBadge, background: '#7c2d12', color: '#fdba74' }}>DIVERTED</div>
            ) : (
              <div style={{
                ...styles.statusBadge,
                background: statusCfg.pulse ? `${statusCfg.color}22` : '#1e293b',
                color: statusCfg.color,
                border: `1.5px solid ${statusCfg.color}44`,
                animation: statusCfg.pulse ? 'fidsPulse 1.2s ease-in-out infinite' : 'none',
              }}>
                {statusCfg.label.toUpperCase()}
              </div>
            )}
          </div>

          {/* Countdown */}
          {!assignment.isCancelled && !assignment.isDiverted && timeUntilDeparture !== null && timeUntilDeparture > 0 && (
            <div style={styles.countdown}>
              <span style={styles.countdownVal}>{formatTimeRemaining(timeUntilDeparture)}</span>
              <span style={styles.countdownLabel}>until departure</span>
            </div>
          )}

          {/* DGR image – exact placement from old code */}
          <div style={styles.dangerousGoodsWrapper}>
            <img
              src="/dgr-gate.png"
              alt="Dangerous Goods — Not Allowed"
              style={styles.dangerousGoodsImg}
              onError={(e) => { e.currentTarget.style.display = 'none'; }}
            />
          </div>
        </div>
      </div>

      <div style={styles.divider} />

      {/* Footer */}
      <div style={styles.footer}>
        <div style={styles.footerMeta}>
          <span>LAST UPDATE&nbsp;&nbsp;{lastUpdate}</span>
          {assignment.setAt && (
            <>
              <span style={{ opacity: 0.35 }}>│</span>
              <span>ASSIGNED&nbsp;&nbsp;{new Date(assignment.setAt).toLocaleTimeString('en-GB')}</span>
            </>
          )}
        </div>
        <div style={styles.footerRight}>
          <span style={{ color: '#4a6fa5', fontSize: '.75rem', letterSpacing: '.12em', fontFamily: `'Share Tech Mono', monospace` }}>
            GATE {gateNumber}
          </span>
        </div>
      </div>

      <style>{`
        @keyframes fidsPulse { 0%,100%{opacity:1} 50%{opacity:.55} }
        @keyframes spin { to { transform: rotate(360deg); } }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        html,body,#__next { width:100vw; height:100vh; overflow:hidden; background:#070d1a; }

        /* Responsive adjustments for times container */
        @media (max-width: 768px) {
          .times-container { flex-direction: column !important; gap: 0.5rem !important; align-items: flex-start !important; }
        }
      `}</style>
    </div>
  );
}

// ============================================================
// STILOVI (inline, prošireni za novi sadržaj)
// ============================================================
const FONT_DISPLAY = `'Rajdhani', 'Share Tech Mono', monospace`;
const FONT_MONO = `'Share Tech Mono', 'Courier New', monospace`;

const C = {
  bg: '#070d1a',
  panel: '#0d1629',
  border: '#1e3a5f',
  accent: '#1e90ff',
  gold: '#e6a817',
  text: '#cfe4ff',
  textMuted: '#4a6fa5',
  white: '#f0f8ff',
};

const styles: Record<string, React.CSSProperties> = {
  root: {
    width: '100vw', height: '100vh',
    display: 'flex', flexDirection: 'column',
    background: C.bg, fontFamily: FONT_DISPLAY,
    color: C.white, overflow: 'hidden',
  },
  topBar: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '0.9rem 2.5rem',
    background: C.panel, borderBottom: `1px solid ${C.border}`,
    flexShrink: 0,
  },
  topBarLeft: { display: 'flex', alignItems: 'baseline', gap: '0.7rem' },
  topBarLabel: { fontSize: '0.95rem', fontWeight: 600, letterSpacing: '.18em', color: C.textMuted, fontFamily: FONT_MONO },
  topBarGate: { fontSize: '3.2rem', fontWeight: 700, lineHeight: 1, color: C.gold, letterSpacing: '.04em' },
  topBarTerminal: { fontSize: '2rem', fontWeight: 600, color: C.text, letterSpacing: '.06em' },
  topBarSep: { color: C.border, fontSize: '1.8rem', margin: '0 0.4rem' },
  clock: { fontFamily: FONT_MONO, fontSize: '2.2rem', fontWeight: 400, color: C.accent, letterSpacing: '.08em' },
  divider: {
    height: '1px', flexShrink: 0,
    background: `linear-gradient(90deg, transparent 0%, ${C.border} 20%, ${C.border} 80%, transparent 100%)`,
  },
  main: {
    display: 'flex', flex: 1, overflow: 'hidden',
    padding: '1.5rem 2.5rem', gap: 0, minHeight: 0,
  },
  leftCol: {
    display: 'flex', flexDirection: 'column', justifyContent: 'space-evenly',
    flex: '0 0 52%', gap: '.8rem', paddingRight: '2.5rem', overflow: 'hidden',
  },
  logoCard: {
    width: '100%', height: 'clamp(120px, 14vh, 200px)',
    background: '#ffffff', borderRadius: '12px',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    overflow: 'hidden', flexShrink: 0,
  },
  logoImg: { width: '100%', height: '100%', objectFit: 'contain', padding: '10px 20px' },
  logoFallback: { color: '#6b7280', fontSize: '14px', fontFamily: FONT_MONO, fontWeight: 600, letterSpacing: '.12em' },
  flightNumber: {
    fontSize: 'clamp(4.5rem, 9vw, 8rem)',
    fontWeight: 700, letterSpacing: '.05em',
    color: C.white, lineHeight: 1,
  },
  codeshare: { fontSize: '1rem', color: C.textMuted, letterSpacing: '.08em', fontFamily: FONT_MONO },
  codeshareList: { color: C.text, fontWeight: 600 },
  destCode: {
    fontSize: 'clamp(2.8rem, 5.5vw, 5rem)',
    fontWeight: 700, letterSpacing: '.12em',
    color: C.accent, lineHeight: 1,
  },
  destCity: {
    fontSize: 'clamp(4.5rem, 9vw, 9rem)',
    fontWeight: 700, color: C.white,
    letterSpacing: '.03em', lineHeight: 1,
    wordBreak: 'break-word',
    overflowWrap: 'break-word',
  },
  vDivider: {
    width: '1px', alignSelf: 'stretch', flexShrink: 0,
    background: `linear-gradient(180deg, transparent 0%, ${C.border} 15%, ${C.border} 85%, transparent 100%)`,
    margin: '0 2.5rem',
  },
  rightCol: {
    flex: 1, display: 'flex', flexDirection: 'column',
    justifyContent: 'space-between', gap: '1.2rem',
  },
  timesContainer: {
    display: 'flex', gap: '2rem', alignItems: 'flex-end', flexWrap: 'wrap',
  },
  timeBlock: { display: 'flex', flexDirection: 'column', gap: '.3rem' },
  timeLabel: { fontSize: '0.85rem', fontWeight: 600, letterSpacing: '.18em', color: C.textMuted, fontFamily: FONT_MONO },
  timeValue: { fontFamily: FONT_MONO, fontSize: 'clamp(3rem, 6vw, 5.5rem)', fontWeight: 400, letterSpacing: '.1em', color: C.white, lineHeight: 1 },
  statusBlock: { display: 'flex', alignItems: 'flex-start' },
  statusBadge: {
    display: 'inline-block',
    fontSize: 'clamp(1.6rem, 3vw, 2.8rem)',
    fontWeight: 700, letterSpacing: '.12em',
    padding: '.45em 1.2em', borderRadius: '8px',
    fontFamily: FONT_DISPLAY,
  },
  countdown: { display: 'flex', alignItems: 'baseline', gap: '.7rem', marginTop: '.5rem' },
  countdownVal: { fontFamily: FONT_MONO, fontSize: 'clamp(2rem, 4vw, 3.5rem)', color: C.gold, fontWeight: 400 },
  countdownLabel: { fontSize: '1rem', color: C.textMuted, letterSpacing: '.12em', fontFamily: FONT_MONO },
  dangerousGoodsWrapper: {
    flex: 1, display: 'flex', alignItems: 'flex-end', justifyContent: 'flex-end',
    paddingTop: '0.5rem', minHeight: 0,
  },
  dangerousGoodsImg: {
    maxWidth: '100%', maxHeight: '100%', width: 'auto', height: 'auto',
    objectFit: 'contain', borderRadius: '8px',
  },
  footer: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '1rem 2.5rem',
    background: C.panel, borderTop: `1px solid ${C.border}`,
    flexShrink: 0, gap: '2rem',
  },
  footerMeta: {
    display: 'flex', gap: '1.2rem', alignItems: 'center',
    color: C.textMuted, fontSize: '.8rem',
    letterSpacing: '.12em', fontFamily: FONT_MONO,
    flexShrink: 0,
  },
  footerRight: { display: 'flex', alignItems: 'center' },
  splash: {
    width: '100vw', height: '100vh', background: C.bg,
    display: 'flex', flexDirection: 'column',
    alignItems: 'center', justifyContent: 'center',
    fontFamily: FONT_DISPLAY, gap: '1rem',
  },
  splashTitle: { fontSize: '2.2rem', color: C.text, fontWeight: 600, letterSpacing: '.1em' },
  gateLabel: { fontWeight: 800, color: C.gold, letterSpacing: '.06em', fontFamily: FONT_DISPLAY },
  spinner: {
    width: 56, height: 56,
    border: `3px solid ${C.border}`,
    borderTop: `3px solid ${C.accent}`,
    borderRadius: '50%',
    animation: 'spin 1s linear infinite',
  },
  metaRow: {
    marginTop: '1.2rem', color: C.textMuted,
    fontSize: '.9rem', letterSpacing: '.1em', fontFamily: FONT_MONO,
  },
  flightHint: {
    marginTop: '1.5rem', padding: '.8rem 2rem',
    background: '#0d1629', border: '1px solid #1e3a5f',
    borderRadius: 10, color: '#4a6fa5',
    fontSize: '1.2rem', letterSpacing: '.1em',
    fontFamily: FONT_MONO,
  },
};