'use client';

import {
  useEffect, useState, useCallback, memo,
  Component, type ErrorInfo, type ReactNode, useRef,
} from 'react';
import type { Flight } from '@/types/flight';
import { fetchFlightData } from '@/lib/flight-service';

// REFRESH INTERVAL (podaci)
const REFRESH_INTERVAL_MS = 60_000;

// ==========================================
// ERROR BOUNDARY
// ==========================================
interface EBState { hasError: boolean; message: string }
class SecurityErrorBoundary extends Component<{ children: ReactNode }, EBState> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }
  static getDerivedStateFromError(e: Error) { return { hasError: true, message: e.message }; }
  componentDidCatch(e: Error, i: ErrorInfo) {
    console.error('🚨 Security ErrorBoundary:', e, i);
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

// ==========================================
// LOGIKA ZA VRIJEME I PRIORITET
// ==========================================
const parseDepartureTime = (t: string): Date | null => {
  if (!t) return null;
  try {
    if (t.includes('T')) { const d = new Date(t); if (!isNaN(d.getTime())) return d; }
    const [h, m] = t.split(':').map(Number);
    if (isNaN(h) || isNaN(m)) return null;
    const d = new Date(); d.setHours(h, m, 0, 0);
    if (Date.now() - d.getTime() > 6 * 60 * 60 * 1000) d.setDate(d.getDate() + 1);
    return d;
  } catch { return null; }
};

const formatCountdown = (ms: number): string => {
  const totalSeconds = Math.floor(ms / 1000);
  const sign = totalSeconds < 0 ? '-' : '';
  const absSeconds = Math.abs(totalSeconds);
  
  const h = Math.floor(absSeconds / 3600);
  const m = Math.floor((absSeconds % 3600) / 60);
  const s = absSeconds % 60;

  if (h > 0) return `${sign}${h}h ${m}m`;
  if (m > 0) return `${sign}${m}m ${s}s`;
  return `${sign}${s}s`;
};

const getPriorityConfig = (minutesLeft: number): { color: string; label: string; bg: string; priorityText: string } => {
  if (minutesLeft <= 0) return { color: '#64748b', label: 'DEPARTED', bg: 'rgba(100, 116, 139, 0.1)', priorityText: '' };
  
  if (minutesLeft <= 30) return { 
    color: '#ef4444', 
    label: 'URGENT', 
    bg: 'rgba(239, 68, 68, 0.15)',
    priorityText: '🔴 URGENT - PROCEED TO FRONT OF QUEUE'
  };
  if (minutesLeft <= 60) return { 
    color: '#f97316', 
    label: 'PRIORITY', 
    bg: 'rgba(249, 115, 22, 0.15)',
    priorityText: '🟠 PRIORITY - PROCEED TO FRONT OF QUEUE'
  };
  if (minutesLeft <= 90) return { 
    color: '#eab308', 
    label: 'SOON', 
    bg: 'rgba(234, 179, 8, 0.15)',
    priorityText: ''
  };
  return { 
    color: '#22c55e', 
    label: 'NORMAL', 
    bg: 'rgba(34, 197, 94, 0.1)',
    priorityText: ''
  };
};

function LiveClock() {
  const [time, setTime] = useState('');
  useEffect(() => {
    const tick = () => setTime(new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);
  return <span style={styles.clock} className="sec-clock">{time}</span>;
}

function Divider() { return <div style={styles.divider} className="sec-divider" />; }

// ==========================================
// RED ZA LET (Left Panel) - SA BLINK EFEKTOM
// ==========================================
interface PriorityFlightRowProps {
  flight: Flight;
  currentTime: Date;
}

const PriorityFlightRow = memo(function PriorityFlightRow({ flight, currentTime }: PriorityFlightRowProps) {
  const depTime = parseDepartureTime(flight.ScheduledDepartureTime || '');
  
  if (!depTime) return null;

  const diffMs = depTime.getTime() - currentTime.getTime();
  const minutesLeft = Math.floor(diffMs / 60000);
  
  const priority = getPriorityConfig(minutesLeft);
  const destCode = flight.DestinationAirportCode || '---';
  const city = flight.DestinationCityName || 'Unknown';
  const countdownStr = formatCountdown(diffMs);
  
  // Da li treba da blinka (URGENT ili PRIORITY)
  const shouldBlink = minutesLeft <= 60 && minutesLeft > 0;
  const isUrgent = minutesLeft <= 30 && minutesLeft > 0;
  const isPriority = minutesLeft <= 60 && minutesLeft > 30;

  return (
    <div 
      style={{
        ...styles.flightRow,
        borderLeft: `6px solid ${priority.color}`,
        background: minutesLeft <= 60 ? priority.bg : undefined,
        animation: shouldBlink ? 'blinkBorder 0.8s ease-in-out infinite' : 'slideIn 0.3s ease-out forwards',
      }} 
      className={`sec-flight-row ${shouldBlink ? 'blinking-row' : ''}`}
    >
      {/* Vrijeme Polaska */}
      <div style={styles.rowTime}>{flight.ScheduledDepartureTime || '--:--'}</div>
      
      {/* Let & Destinacija */}
      <div style={styles.rowInfo}>
        <div style={styles.rowFlightNum}>{flight.FlightNumber}</div>
        <div style={styles.rowDest}>
          <span style={{ color: '#fff' }}>{destCode}</span>
          <span style={{ color: '#64748b' }}> · </span>
          <span style={{ color: '#94a3b8' }}>{city}</span>
        </div>
      </div>

      {/* Gate & Priority Badge */}
      <div style={styles.rowStatusGroup}>
        {flight.GateNumber && (
          <div style={styles.rowGate}>{flight.GateNumber}</div>
        )}
        <div style={{ ...styles.priorityBadge, color: priority.color, background: priority.bg, border: `1px solid ${priority.color}40` }}>
          {priority.label}
        </div>
      </div>

      {/* Countdown Timer */}
      <div style={styles.countdownContainer}>
        <div style={{ ...styles.countdownValue, color: priority.color }}>{countdownStr}</div>
        <div style={styles.countdownLabel}>TO DEPARTURE</div>
      </div>

      {/* Priority Message - SAMO ZA URGENT I PRIORITY */}
      {(isUrgent || isPriority) && (
        <div style={{ ...styles.priorityMessage, backgroundColor: priority.bg, borderLeft: `4px solid ${priority.color}` }}>
          <span style={styles.priorityMessageIcon}>{isUrgent ? '🔴' : '🟠'}</span>
          <span style={styles.priorityMessageText}>{priority.priorityText}</span>
          <span style={styles.priorityMessageAction}>→ GO TO FRONT OF QUEUE ←</span>
        </div>
      )}
    </div>
  );
});

// ==========================================
// GLAVNA KOMPONENTA
// ==========================================
export default function SecurityPage() {
  return <SecurityErrorBoundary><SecurityDisplay /></SecurityErrorBoundary>;
}

function SecurityDisplay() {
  const [flights, setFlights] = useState<Flight[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState('');
  const [nextUpdate, setNextUpdate] = useState('');
  const [currentTime, setCurrentTime] = useState(new Date());
  const isMountedRef = useRef(true);

  const loadPriorityFlights = useCallback(async () => {
    if (!isMountedRef.current) return;
    try {
      const data = await fetchFlightData();
      const now = new Date();

      // 1. FILTRIRANJE: Uzmi samo polaske, NIJE otkazan, NIJE departed, NIJE preusmjeren
      const activeFlights = data.departures.filter((f: Flight) => {
        const s = (f.StatusEN || '').toLowerCase();
        if (s.includes('cancelled') || s.includes('canceled') || s.includes('otkazan')) return false;
        if (s.includes('diverted') || s.includes('preusmjeren')) return false;
        if (s.includes('departed') || s.includes('poletio')) return false;
        return true;
      });

      // 2. Parsiraj vrijeme
      const withParsedTime = activeFlights
        .map(f => ({ ...f, depTime: parseDepartureTime(f.ScheduledDepartureTime || '') }))
        .filter(f => f.depTime !== null) as (Flight & { depTime: Date })[];
      
      // 3. Sortiraj po rastućem vremenu
      const sorted = withParsedTime.sort((a, b) => a.depTime.getTime() - b.depTime.getTime());

      // 4. Uzmi prvih 3 (promijenjeno sa 5 na 3)
      const top3 = sorted.slice(0, 3);

      if (isMountedRef.current) {
        setFlights(top3);
        setLoading(false);
        setLastUpdate(now.toLocaleTimeString('en-GB'));
        setNextUpdate(new Date(now.getTime() + REFRESH_INTERVAL_MS).toLocaleTimeString('en-GB'));
      }
    } catch (err) {
      console.error('Security load error:', err);
      if (isMountedRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    isMountedRef.current = true;
    const interval = setInterval(() => {
      if (isMountedRef.current) loadPriorityFlights();
    }, REFRESH_INTERVAL_MS);
    loadPriorityFlights();
    return () => {
      isMountedRef.current = false;
      clearInterval(interval);
    };
  }, [loadPriorityFlights]);

  useEffect(() => {
    const tick = () => setCurrentTime(new Date());
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <div style={styles.root} className="sec-root">
      
      {/* HEADER - Orange Color */}
      <div style={styles.topBar} className="sec-topbar">
        <div style={{...styles.topBarLeft, color: '#f97316'}} className="sec-topbar-left">
          <span style={styles.topBarLabel}>PREBOARDING & SECURITY CONTROL</span>
          <span style={styles.topBarSep}>|</span>
          <span style={styles.topBarLabel}>PRIORITY SCREENING (TOP 3)</span>
        </div>
        <LiveClock />
      </div>

      <Divider />

      {/* MAIN CONTENT - SPLIT */}
      <div style={styles.main} className="sec-main">
        
        {/* LEFT PANEL - LISTA LETOVA */}
        <div style={styles.leftCol} className="sec-left-col">
          <div style={styles.panelHeader}>NEXT DEPARTURES</div>
          {loading ? (
            <div style={styles.loadingContainer}>
               <div style={styles.spinner} />
               <div style={{ color: '#64748b', marginTop: '1rem', fontSize: '1.5rem' }}>Loading flights...</div>
            </div>
          ) : flights.length === 0 ? (
             <div style={styles.noFlights}>No priority flights found.</div>
          ) : (
            <div style={styles.flightList}>
              {flights.map((f, i) => (
                <PriorityFlightRow key={`${f.FlightNumber}-${i}`} flight={f} currentTime={currentTime} />
              ))}
            </div>
          )}
        </div>

        {/* VERTICAL DIVIDER */}
        <div style={styles.vDivider} className="sec-v-divider" />

        {/* RIGHT PANEL - VIDEO */}
        <div style={styles.rightCol} className="sec-right-col">
          <div style={styles.panelHeader}>INSTRUCTIONS</div>
          <div style={styles.videoWrapper}>
            <video 
              src="/security.mp4" 
              autoPlay 
              loop 
              muted 
              playsInline
              style={styles.videoElement}
            >
              Your browser does not support the video tag.
            </video>
          </div>
          <div style={styles.videoCaption}>
            Please observe security screening priority.
          </div>
        </div>

      </div>

      <Divider />

      {/* FOOTER */}
      <div style={styles.footer} className="sec-footer">
        <div style={styles.footerMeta}>
          <span>LAST UPDATE&nbsp;&nbsp;{lastUpdate}</span>
          <span style={{ opacity: .35 }}>│</span>
          <span>NEXT UPDATE&nbsp;&nbsp;{nextUpdate}</span>
        </div>
        <div style={{ color: '#1e3a5f', fontSize: '0.9rem', letterSpacing: '.05em' }}>
          PRIORITY MODE: TIME-BASED
        </div>
      </div>

      {/* GLOBAL STYLES */}
      <style jsx global>{`
        @import url('https://fonts.googleapis.com/css2?family=Share+Tech+Mono&family=Rajdhani:wght@500;600;700&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        html,body,#__next { width:100vw; height:100vh; overflow:hidden; background:#070d1a; }

        /* Blink animacija za border i cijeli red */
        @keyframes blinkBorder {
          0%, 100% { 
            border-left-color: #ef4444;
            box-shadow: 0 0 0px rgba(239, 68, 68, 0);
          }
          50% { 
            border-left-color: #ff6666;
            box-shadow: 0 0 20px rgba(239, 68, 68, 0.5);
          }
        }
        
        @keyframes blinkBackground {
          0%, 100% { background-color: rgba(239, 68, 68, 0.15); }
          50% { background-color: rgba(239, 68, 68, 0.35); }
        }
        
        @keyframes slideIn { 
          from { opacity: 0; transform: translateX(-10px); } 
          to { opacity: 1; transform: translateX(0); } 
        }
        
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.7; }
        }
        
        .blinking-row {
          animation: blinkBackground 0.8s ease-in-out infinite !important;
        }
        
        .blinking-row .priority-badge {
          animation: pulse 0.8s ease-in-out infinite;
        }

        @media (max-width: 1024px) {
          .sec-topbar { padding: 0.8rem 1.5rem !important; }
          .sec-main { padding: 1.5rem 1.5rem !important; }
          .sec-left-col { padding-right: 1.5rem !important; }
          .sec-right-col { padding-left: 1.5rem !important; }
        }

        @media (max-width: 768px) {
          html, body, #__next { overflow: auto !important; height: auto !important; min-height: 100vh !important; }
          .sec-root { height: auto !important; min-height: 100vh !important; overflow: visible !important; }
          .sec-main { flex-direction: column !important; padding: 1.5rem !important; gap: 2rem !important; }
          .sec-v-divider { width: 100% !important; height: 2px !important; margin: 0 !important; }
          .sec-left-col, .sec-right-col { width: 100% !important; padding: 0 !important; flex: none !important; }
          .sec-flight-row { flex-direction: column !important; align-items: stretch !important; gap: 0.8rem !important; }
          .priority-message { font-size: 0.9rem !important; }
        }

        .sec-flight-row:hover {
          background: rgba(30, 58, 95, 0.6) !important;
          transform: scale(1.01);
          transition: all 0.2s ease;
        }
      `}</style>
    </div>
  );
}

// ==========================================
// STYLES
// ==========================================
const FONT_DISPLAY = `'Rajdhani', 'Share Tech Mono', monospace`;
const FONT_MONO    = `'Share Tech Mono', 'Courier New', monospace`;
const C = {
  bg: '#070d1a', panel: '#0d1629', border: '#1e3a5f',
  accent: '#1e90ff', gold: '#e6a817', text: '#cfe4ff',
  textMuted: '#4a6fa5', white: '#f0f8ff', orange: '#f97316',
};

const styles: Record<string, React.CSSProperties> = {
  root: { width: '100vw', height: '100vh', display: 'flex', flexDirection: 'column', background: C.bg, fontFamily: FONT_DISPLAY, color: C.white, padding: '0', overflow: 'hidden' },
  
  topBar: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '1.2rem 3rem', background: C.panel, borderBottom: `2px solid ${C.border}`, flexShrink: 0 },
  topBarLeft: { display: 'flex', alignItems: 'baseline', gap: '1rem' },
  topBarLabel: { fontSize: '1.5rem', fontWeight: 700, letterSpacing: '.15em', fontFamily: FONT_MONO, textShadow: '0 0 10px rgba(249,115,22,0.4)' },
  topBarSep: { color: C.border, fontSize: '2rem', margin: '0 0.4rem' },
  clock: { fontFamily: FONT_MONO, fontSize: '2.5rem', fontWeight: 700, color: C.accent, letterSpacing: '.08em' },

  divider: { height: '2px', background: `linear-gradient(90deg, transparent 0%, ${C.border} 20%, ${C.border} 80%, transparent 100%)`, flexShrink: 0 },

  main: { display: 'flex', flex: 1, overflow: 'hidden', padding: '2rem 3rem', gap: '0' },
  leftCol: { flex: 1, display: 'flex', flexDirection: 'column', paddingRight: '2.5rem', overflow: 'hidden' },
  rightCol: { flex: 1, display: 'flex', flexDirection: 'column', paddingLeft: '2.5rem', overflow: 'hidden' },

  vDivider: { width: '2px', alignSelf: 'stretch', flexShrink: 0, background: `linear-gradient(180deg, transparent 0%, ${C.border} 15%, ${C.border} 85%, transparent 100%)`, margin: '0 2.5rem' },

  panelHeader: { fontSize: '1.1rem', fontWeight: 700, letterSpacing: '.2em', color: C.textMuted, marginBottom: '1.5rem', textTransform: 'uppercase', fontFamily: FONT_MONO, textAlign: 'center', borderBottom: `1px solid ${C.border}`, paddingBottom: '0.5rem' },

  flightList: { flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '1rem', paddingBottom: '1.5rem' },
  flightRow: { 
    display: 'flex', alignItems: 'center', justifyContent: 'space-between', 
    background: 'rgba(30,58,95,0.2)', border: `1px solid ${C.border}`, borderRadius: '12px', 
    padding: '1.2rem 1.5rem', transition: 'all 0.2s ease', position: 'relative' as const,
    flexWrap: 'wrap' as const, gap: '0.5rem'
  },
  rowTime: { fontFamily: FONT_MONO, fontSize: '2.5rem', color: C.gold, fontWeight: 700, width: '6rem', flexShrink: 0 },
  rowInfo: { flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '0.3rem', margin: '0 1.5rem' },
  rowFlightNum: { fontSize: '2.8rem', fontWeight: 800, color: C.white, letterSpacing: '.05em' },
  rowDest: { fontSize: '1.4rem', color: '#94a3b8', letterSpacing: '.05em', textTransform: 'uppercase' },
  
  rowStatusGroup: { display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.6rem', flexShrink: 0 },
  rowGate: { background: '#1e3a5f', color: C.accent, padding: '0.3rem 0.8rem', borderRadius: '6px', fontSize: '1.3rem', fontWeight: 700, fontFamily: FONT_MONO },
  priorityBadge: { 
    fontSize: '0.9rem', fontWeight: 700, padding: '0.4em 0.9em', borderRadius: '6px', 
    letterSpacing: '.1em', fontFamily: FONT_MONO, minWidth: '100px', textAlign: 'center'
  },

  countdownContainer: { display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.1rem', marginLeft: '1.5rem', flexShrink: 0, minWidth: '140px' },
  countdownValue: { fontFamily: FONT_MONO, fontSize: '2.2rem', fontWeight: 700, lineHeight: 1 },
  countdownLabel: { fontSize: '0.8rem', color: C.textMuted, letterSpacing: '.1em', fontFamily: FONT_MONO, textTransform: 'uppercase' },

  // Priority Message - novi stil za poruku
  priorityMessage: {
    width: '100%',
    marginTop: '0.8rem',
    padding: '0.6rem 1rem',
    borderRadius: '8px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '0.8rem',
    flexWrap: 'wrap' as const,
    fontSize: '1.1rem',
    fontWeight: 700,
    letterSpacing: '.05em',
  },
  priorityMessageIcon: {
    fontSize: '1.3rem',
  },
  priorityMessageText: {
    color: '#fff',
  },
  priorityMessageAction: {
    color: '#fef08a',
    fontWeight: 800,
    letterSpacing: '.1em',
  },

  videoWrapper: { 
    flex: 1, background: '#000', borderRadius: '16px', overflow: 'hidden', 
    boxShadow: `0 0 30px rgba(0,0,0,0.6)`, border: `2px solid ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center' 
  },
  videoElement: { width: '100%', height: '100%', objectFit: 'contain' },
  videoCaption: { marginTop: '1.5rem', color: C.textMuted, fontSize: '1.1rem', textAlign: 'center', fontFamily: FONT_MONO, letterSpacing: '.1em' },

  loadingContainer: { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' },
  spinner: { width: 60, height: 60, border: `4px solid ${C.border}`, borderTop: `4px solid ${C.accent}`, borderRadius: '50%', animation: 'spin 1s linear infinite' },
  noFlights: { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748b', fontSize: '2rem', letterSpacing: '.1em' },

  footer: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '1.2rem 3rem', background: C.panel, borderTop: `2px solid ${C.border}`, flexShrink: 0 },
  footerMeta: { display: 'flex', gap: '1.5rem', alignItems: 'center', color: C.textMuted, fontSize: '1rem', letterSpacing: '.12em', fontFamily: FONT_MONO, flexShrink: 0 },

  splash: { width: '100vw', height: '100vh', background: C.bg, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', fontFamily: FONT_DISPLAY, gap: '1rem' },
  splashIcon: { fontSize: '5rem', color: C.gold, opacity: .6 },
  splashTitle: { fontSize: '2.5rem', color: C.text, fontWeight: 600, letterSpacing: '.1em' },
  splashSub: { fontSize: '1.2rem', color: C.textMuted, letterSpacing: '.08em', fontFamily: FONT_MONO },
};