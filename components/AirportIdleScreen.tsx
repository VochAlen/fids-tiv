'use client';

import { useEffect, useState, type ReactNode } from 'react';

// ------------------------------------------------------------
// AirportIdleScreen — zajednički "prazan/zatvoren" ekran za gate i check-in
// (redizajn 2026-10-18). Paleta: crna, navy, sky blue, narandžasta
// (more, Jadran, Crna Gora). Samo CSS + lokalni sat: bez mreže, bez novih
// zahtjeva, bez troška. Kompatibilno sa Chrome 109 kioscima.
// ------------------------------------------------------------
const FONT = `'Rajdhani', 'Segoe UI', Arial, sans-serif`;
const FONT_MONO = `'Share Tech Mono', 'Courier New', monospace`;

const C = {
  black:   '#02060d',
  navy:    '#07163a',
  navy2:   '#0b2a63',
  sky:     '#38bdf8',
  skySoft: '#bae6fd',
  orange:  '#ff8a1f',
  white:   '#f8fbff',
};

/** Mali potpis autora — fiksiran u donjem desnom uglu, ne smeta sadržaju. */
export function DevCredit() {
  return (
    <div
      style={{
        position: 'fixed', right: '.8rem', bottom: '.25rem', zIndex: 50,
        fontFamily: FONT, fontSize: '.7rem', fontWeight: 500, letterSpacing: '.08em',
        color: 'rgba(186,230,253,.55)', pointerEvents: 'none', userSelect: 'none',
      }}
    >
      Developed by Alen
    </div>
  );
}

function IdleClock() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    const tick = () => setNow(new Date());
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);
  const time = now ? now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false }) : '';
  const date = now ? now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }) : '';
  return (
    <div style={{ textAlign: 'right' }}>
      <div style={{ fontFamily: FONT_MONO, fontSize: 'clamp(2.4rem, 5vw, 5rem)', lineHeight: 1, color: C.white, letterSpacing: '.06em' }}>{time}</div>
      <div style={{ fontFamily: FONT, fontSize: 'clamp(1rem, 1.8vw, 1.8rem)', fontWeight: 600, color: C.skySoft, letterSpacing: '.14em', textTransform: 'uppercase', marginTop: '.3rem' }}>{date}</div>
    </div>
  );
}

export interface AirportIdleScreenProps {
  /** "GATE" ili "CHECK-IN" */
  label: string;
  number: string;
  /** true = narandžasto (zatvoreno), false = sky blue (nema letova) */
  closed: boolean;
  statusText: string;
  hintEn: string;
  hintLocal: string;
  /** opciono: red sa podacima o dodijeljenom letu (npr. kad je check-in zatvoren) */
  flightLine?: ReactNode;
  lastUpdate: string;
  nextUpdate?: string;
  diagnostics?: ReactNode;
}

export default function AirportIdleScreen(p: AirportIdleScreenProps) {
  const accent = p.closed ? C.orange : C.sky;
  return (
    <div style={{
      width: '100vw', height: '100vh', position: 'relative', overflow: 'hidden',
      display: 'flex', flexDirection: 'column', fontFamily: FONT, color: C.white,
      background: `radial-gradient(120% 90% at 20% 10%, ${C.navy2} 0%, ${C.navy} 45%, ${C.black} 100%)`,
    }}>
      {/* more: dva sloja valova pri dnu (samo transform animacija) */}
      <div className="ai-wave ai-wave-a" />
      <div className="ai-wave ai-wave-b" />
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: '30%', background: `linear-gradient(180deg, transparent 0%, ${C.black} 100%)`, pointerEvents: 'none' }} />

      {/* GORNJA TRAKA */}
      <div style={{ position: 'relative', zIndex: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: 'clamp(1rem, 2.5vh, 2.2rem) clamp(1.5rem, 4vw, 4rem)' }}>
        <div>
          <div style={{ fontSize: 'clamp(1.4rem, 2.6vw, 2.6rem)', fontWeight: 700, letterSpacing: '.22em', color: C.white }}>TIVAT AIRPORT</div>
          <div style={{ fontSize: 'clamp(.9rem, 1.4vw, 1.4rem)', fontWeight: 600, letterSpacing: '.3em', color: C.orange, marginTop: '.2rem' }}>AERODROM TIVAT · CRNA GORA</div>
        </div>
        <IdleClock />
      </div>

      {/* SREDIŠNJI DIO */}
      <div style={{ position: 'relative', zIndex: 2, flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 0, paddingBottom: 'clamp(1.2rem, 3vh, 2.4rem)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1.4rem' }}>
          <div style={{ width: 'clamp(3rem, 8vw, 8rem)', height: 6, background: `linear-gradient(90deg, transparent, ${C.orange})`, borderRadius: 3 }} />
          <div style={{ fontSize: 'clamp(2rem, 4vw, 4rem)', fontWeight: 700, letterSpacing: '.5em', color: C.sky, paddingLeft: '.5em' }}>{p.label}</div>
          <div style={{ width: 'clamp(3rem, 8vw, 8rem)', height: 6, background: `linear-gradient(270deg, transparent, ${C.orange})`, borderRadius: 3 }} />
        </div>

        <div style={{
          fontSize: 'clamp(10rem, min(46vw, 48vh), 40rem)', fontWeight: 700, lineHeight: .9, letterSpacing: '.02em',
          color: C.white, textShadow: `0 0 .12em ${C.sky}, 0 0 .5em rgba(56,189,248,.35)`,
          margin: '.02em 0 .06em',
        }}>
          {p.number}
        </div>

        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: '1rem',
          padding: '.3em 1.3em', borderRadius: 999,
          border: `3px solid ${accent}`, background: p.closed ? 'rgba(255,138,31,.14)' : 'rgba(56,189,248,.12)',
          color: accent, fontSize: 'clamp(1.6rem, 3.2vw, 3.2rem)', fontWeight: 700, letterSpacing: '.16em',
        }}>
          <span style={{ width: '.45em', height: '.45em', borderRadius: '50%', background: accent, display: 'inline-block' }} />
          {p.statusText}
        </div>

        {p.flightLine && (
          <div style={{ marginTop: 'clamp(.5rem, 1.4vh, 1.1rem)', color: C.orange, fontSize: 'clamp(1.2rem, 2.4vw, 2.4rem)', fontWeight: 700, letterSpacing: '.08em', textAlign: 'center' }}>
            {p.flightLine}
          </div>
        )}

        <div style={{ marginTop: 'clamp(.5rem, 1.4vh, 1.2rem)', textAlign: 'center', maxWidth: '86vw' }}>
          <div style={{ fontSize: 'clamp(1.1rem, 2vw, 2rem)', fontWeight: 600, color: C.skySoft, letterSpacing: '.04em' }}>{p.hintEn}</div>
          <div style={{ fontSize: 'clamp(1rem, 1.6vw, 1.6rem)', fontWeight: 500, color: 'rgba(186,230,253,.7)', letterSpacing: '.04em', marginTop: '.2rem' }}>{p.hintLocal}</div>
        </div>
      </div>

      {/* STANJE OSVJEŽAVANJA — sitno, u donjem lijevom uglu (ne ulazi u sadržaj) */}
      <div style={{ position: 'fixed', left: '1.2rem', bottom: '.25rem', zIndex: 50, display: 'flex', gap: '.8rem', color: 'rgba(186,230,253,.5)', fontFamily: FONT_MONO, fontSize: '.7rem', letterSpacing: '.1em', pointerEvents: 'none' }}>
        <span>Updated {p.lastUpdate || '—'}</span>
        {p.nextUpdate && (<><span style={{ opacity: .5 }}>•</span><span>Next {p.nextUpdate}</span></>)}
      </div>
      {p.diagnostics}
      <DevCredit />

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Share+Tech+Mono&family=Rajdhani:wght@500;600;700&display=swap');
        html,body,#__next { width:100vw; height:100vh; overflow:hidden; background:${C.black}; }
        .ai-wave { position:absolute; left:0; bottom:0; width:200%; height:34%; pointer-events:none; opacity:.9;
          background-repeat:repeat-x; background-size:50% 100%; will-change:transform; }
        .ai-wave-a { background-image:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1200 200' preserveAspectRatio='none'><path d='M0 100 C150 40 300 40 450 100 S750 160 900 100 S1050 40 1200 100 V200 H0Z' fill='%2338bdf8' fill-opacity='0.22'/></svg>"); animation: aiWave 22s linear infinite; }
        .ai-wave-b { height:26%; background-image:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1200 200' preserveAspectRatio='none'><path d='M0 110 C200 150 400 150 600 110 S1000 70 1200 110 V200 H0Z' fill='%23ff8a1f' fill-opacity='0.16'/></svg>"); animation: aiWave 34s linear infinite reverse; }
        @keyframes aiWave { from { transform: translateX(0); } to { transform: translateX(-50%); } }
      `}</style>
    </div>
  );
}
