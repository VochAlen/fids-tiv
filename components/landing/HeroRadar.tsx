'use client';

// components/landing/HeroRadar.tsx
//
// Simulacija radara za hero sekciju landing stranice. ČISTA ILUSTRACIJA:
// nema mrežnih poziva (ne dira /api/admin/radar, adsb.lol, Redis ni Ably), pa
// posjeta landing stranici ne košta ništa. Pozivi, rasporedi i podaci ispod su
// izmišljeni primjeri za prikaz izgleda — stvarni radar je u /admin/radar.
//
// Animacija: requestAnimationFrame ograničen na ~30 fps, staje kad komponenta
// nije vidljiva (IntersectionObserver) ili je tab skriven; uz
// prefers-reduced-motion prikazuje se jedan statičan kadar.

import { useEffect, useRef, useState } from 'react';

type Lang = 'me' | 'en';

const C = 200;          // centar viewBox-a
const R = 176;          // poluprečnik prikaza (= 100 NM)
const NM_PX = R / 100;  // px po NM

type Sim = {
  cs: string;
  type: string;
  alt: string;
  brg: number;      // azimut od Tivta (°)
  speed: number;    // NM/s u simulaciji
  offset: number;   // početna faza (NM)
  inbound: boolean; // true = dolazi ka Tivtu
  ours: boolean;    // naš let (narandžasto) ili tranzit (žuto)
};

const SIM: Sim[] = [
  { cs: 'ASL683', type: 'E195', alt: 'FL110', brg: 38, speed: 2.4, offset: 18, inbound: true, ours: true },
  { cs: 'MNE102', type: 'E195', alt: 'FL65', brg: 352, speed: 2.1, offset: 52, inbound: true, ours: true },
  { cs: 'TVS5523', type: 'A320', alt: 'FL240', brg: 292, speed: 2.8, offset: 80, inbound: true, ours: true },
  { cs: 'ASL80X', type: 'AT76', alt: 'FL45', brg: 118, speed: 1.9, offset: 30, inbound: false, ours: true },
  { cs: 'RYR41', type: 'B738', alt: 'FL370', brg: 160, speed: 3.4, offset: 60, inbound: false, ours: false },
  { cs: 'DLH9GF', type: 'A321', alt: 'FL350', brg: 215, speed: 3.1, offset: 5, inbound: true, ours: false },
];

const TEXT = {
  me: {
    title: 'Radar uživo',
    sim: 'simulacija',
    legendOurs: 'Let za Tivat',
    legendOther: 'Ostali avioni',
    rows: [
      { fn: 'JU683', from: 'Beograd', eta: '14:22', ground: 'Šalter 4–5 · Gate 2', via: 'callsign' },
      { fn: 'YM102', from: 'Podgorica', eta: '14:35', ground: 'Traka 1', via: 'HEX / registr.' },
      { fn: 'TVS5523', from: 'Prag', eta: '14:48', ground: 'Planirano', via: 'ETA ≈' },
    ],
    cols: ['Let', 'ETA', 'Zemlja', 'Prepoznat'],
    rings: 'NM',
  },
  en: {
    title: 'Live radar',
    sim: 'simulation',
    legendOurs: 'Tivat flight',
    legendOther: 'Other aircraft',
    rows: [
      { fn: 'JU683', from: 'Belgrade', eta: '14:22', ground: 'Desk 4–5 · Gate 2', via: 'callsign' },
      { fn: 'YM102', from: 'Podgorica', eta: '14:35', ground: 'Belt 1', via: 'HEX / reg.' },
      { fn: 'TVS5523', from: 'Prague', eta: '14:48', ground: 'Planned', via: 'ETA ≈' },
    ],
    cols: ['Flight', 'ETA', 'Ground', 'Matched by'],
    rings: 'NM',
  },
} as const;

function pos(s: Sim, t: number) {
  const run = (t * s.speed + s.offset) % 100;            // 0..100 NM
  const d = s.inbound ? 100 - run : run;                 // udaljenost od Tivta
  const a = (s.brg * Math.PI) / 180;
  const x = C + d * NM_PX * Math.sin(a);
  const y = C - d * NM_PX * Math.cos(a);
  const heading = s.inbound ? (s.brg + 180) % 360 : s.brg;
  // blagi fade na ulazu/izlazu iz kruga i blizu centra (slijetanje/polijetanje)
  const edge = Math.min(run, 100 - run);
  const opacity = Math.max(0, Math.min(1, edge / 8));
  return { x, y, heading, opacity, d };
}

const PLANE = 'M0,-10 L2.2,-3 L10,3 L10,5.2 L2.2,3.2 L1.6,8.6 L4.4,10.6 L4.4,11.8 L0,10.6 L-4.4,11.8 L-4.4,10.6 L-1.6,8.6 L-2.2,3.2 L-10,5.2 L-10,3 L-2.2,-3 Z';

export default function HeroRadar({ lang }: { lang: Lang }) {
  const t = TEXT[lang];
  const [clock, setClock] = useState(0);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const visibleRef = useRef(true);
  const reduceRef = useRef(false);

  useEffect(() => {
    try { reduceRef.current = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { /* ignore */ }
    if (reduceRef.current) {
      // statičan kadar
      setClock(14);
      return;
    }
    let raf = 0;
    let last = 0;
    const t0 = performance.now();
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      if (!visibleRef.current || document.hidden) return;
      if (now - last < 33) return; // ~30 fps
      last = now;
      setClock((now - t0) / 1000);
    };
    raf = requestAnimationFrame(loop);

    let io: IntersectionObserver | null = null;
    if (wrapRef.current && 'IntersectionObserver' in window) {
      io = new IntersectionObserver(([e]) => { visibleRef.current = !!e?.isIntersecting; }, { threshold: 0.05 });
      io.observe(wrapRef.current);
    }
    return () => { cancelAnimationFrame(raf); io?.disconnect(); };
  }, []);

  return (
    <div ref={wrapRef} className="relative min-w-0">
      <style>{`
        @keyframes hr-sweep { to { transform: rotate(360deg); } }
        .hr-sweep { animation: hr-sweep 7s linear infinite; }
        @keyframes hr-ping { 0% { transform: scale(.6); opacity: .9; } 100% { transform: scale(2.4); opacity: 0; } }
        .hr-ping { transform-box: fill-box; transform-origin: center; animation: hr-ping 2.4s ease-out infinite; }
        @media (prefers-reduced-motion: reduce) { .hr-sweep, .hr-ping { animation: none !important; } }
      `}</style>

      <div className="absolute -inset-4 rounded-[2rem] bg-sky-500/15 blur-2xl pointer-events-none" aria-hidden />
      <div
        className="relative rounded-2xl border border-sky-300/20 shadow-2xl shadow-sky-900/30 overflow-hidden"
        style={{ background: 'linear-gradient(160deg, #0A2347 0%, #07172F 60%, #061224 100%)' }}
        role="img"
        aria-label={`${t.title} (${t.sim})`}
      >
        {/* zaglavlje */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-white/10 bg-white/[0.03]">
          <div className="flex items-center gap-2.5">
            <span className="relative flex w-2.5 h-2.5">
              <span className="absolute inset-0 rounded-full bg-sky-400 opacity-60 animate-ping" />
              <span className="relative w-2.5 h-2.5 rounded-full bg-sky-400" />
            </span>
            <span className="font-black tracking-wide uppercase text-sm text-sky-200">{t.title}</span>
          </div>
          <span className="text-[10px] uppercase tracking-widest text-sky-200/60 border border-sky-200/20 rounded-full px-2 py-0.5">{t.sim}</span>
        </div>

        {/* scope */}
        <div className="relative px-4 pt-4">
          <div className="relative mx-auto aspect-square w-full max-w-[420px]">
            {/* sweep */}
            <div className="absolute inset-[2%] rounded-full overflow-hidden pointer-events-none" aria-hidden>
              <div
                className="hr-sweep absolute inset-0 rounded-full"
                style={{ background: 'conic-gradient(from 0deg, rgba(56,189,248,0) 0deg, rgba(56,189,248,0) 292deg, rgba(56,189,248,.30) 358deg, rgba(125,211,252,.55) 360deg)' }}
              />
            </div>

            <svg viewBox="0 0 400 400" className="relative w-full h-full" aria-hidden>
              <defs>
                <radialGradient id="hr-bg" cx="50%" cy="50%" r="50%">
                  <stop offset="0%" stopColor="#0E3563" stopOpacity=".55" />
                  <stop offset="100%" stopColor="#071A33" stopOpacity=".15" />
                </radialGradient>
              </defs>
              <circle cx={C} cy={C} r={R} fill="url(#hr-bg)" stroke="rgba(125,211,252,.35)" strokeWidth="1.2" />
              {[25, 50, 75].map((nm) => (
                <circle key={nm} cx={C} cy={C} r={nm * NM_PX} fill="none" stroke="rgba(125,211,252,.18)" strokeWidth="1" strokeDasharray={nm === 50 ? '0' : '3 5'} />
              ))}
              {/* osa N–S / E–W */}
              <line x1={C} y1={C - R} x2={C} y2={C + R} stroke="rgba(125,211,252,.14)" />
              <line x1={C - R} y1={C} x2={C + R} y2={C} stroke="rgba(125,211,252,.14)" />
              {/* oznake prstenova */}
              {[25, 50, 100].map((nm) => (
                <text key={nm} x={C + 4} y={C - nm * NM_PX + 11} fontSize="9" fill="rgba(186,230,253,.55)" fontFamily="ui-monospace, monospace">{nm} {t.rings}</text>
              ))}
              {/* strane svijeta */}
              <g fontSize="10" fontWeight="700" fill="rgba(186,230,253,.7)" textAnchor="middle" fontFamily="ui-sans-serif, system-ui">
                <text x={C} y={C - R - 6}>N</text>
                <text x={C + R + 9} y={C + 3}>E</text>
                <text x={C} y={C + R + 14}>S</text>
                <text x={C - R - 9} y={C + 3}>W</text>
              </g>

              {/* Tivat: centar + pista */}
              <g>
                <circle className="hr-ping" cx={C} cy={C} r="6" fill="none" stroke="#7DD3FC" strokeWidth="1.5" />
                <line x1={C - 9} y1={C + 5} x2={C + 9} y2={C - 5} stroke="#E0F2FE" strokeWidth="2.4" strokeLinecap="round" />
                <circle cx={C} cy={C} r="2.6" fill="#7DD3FC" />
                <text x={C + 12} y={C + 17} fontSize="10" fontWeight="800" fill="#E0F2FE" fontFamily="ui-sans-serif, system-ui">TIV</text>
              </g>

              {/* avioni */}
              {SIM.map((s) => {
                const p = pos(s, clock);
                const col = s.ours ? '#FB923C' : '#FACC15';
                const lx = p.x > C ? 12 : -12;
                const anchor = p.x > C ? 'start' : 'end';
                return (
                  <g key={s.cs} opacity={p.opacity}>
                    <g transform={`translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})`}>
                      <g transform={`rotate(${p.heading})`}>
                        <path d={PLANE} fill={col} stroke="#04101F" strokeWidth="1" strokeLinejoin="round" transform="scale(.95)" />
                      </g>
                      <g fontFamily="ui-monospace, monospace" textAnchor={anchor}>
                        <text x={lx} y="-2" fontSize="9.5" fontWeight="800" fill={col}
                          style={{ paintOrder: 'stroke', stroke: '#04101F', strokeWidth: 3, strokeLinejoin: 'round' }}>{s.cs}</text>
                        <text x={lx} y="9" fontSize="8" fill="#BAE6FD"
                          style={{ paintOrder: 'stroke', stroke: '#04101F', strokeWidth: 3, strokeLinejoin: 'round' }}>{s.type} · {s.alt}</text>
                      </g>
                    </g>
                  </g>
                );
              })}
            </svg>
          </div>

          {/* legenda */}
          <div className="flex items-center justify-center gap-5 pt-2 pb-3 text-[11px] text-sky-100/80">
            <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-orange-400" />{t.legendOurs}</span>
            <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-yellow-400" />{t.legendOther}</span>
          </div>
        </div>

        {/* mini tabela: "naš raspored" + zemlja */}
        <div className="border-t border-white/10 bg-white/[0.02]">
          <div className="grid grid-cols-[4.2rem_3rem_minmax(0,1fr)] sm:grid-cols-[4.5rem_3.2rem_minmax(0,1fr)_6rem] gap-x-2 px-5 py-1.5 text-[10px] uppercase tracking-widest text-sky-200/45">
            {t.cols.map((c, i) => <span key={c} className={i === 3 ? 'hidden sm:block' : undefined}>{c}</span>)}
          </div>
          <div className="divide-y divide-white/5 font-mono text-xs">
            {t.rows.map((r) => (
              <div key={r.fn} className="grid grid-cols-[4.2rem_3rem_minmax(0,1fr)] sm:grid-cols-[4.5rem_3.2rem_minmax(0,1fr)_6rem] gap-x-2 items-center px-5 py-2">
                <span className="font-bold text-orange-300">{r.fn}</span>
                <span className="text-sky-100 tabular-nums">{r.eta}</span>
                <span className="text-sky-100/90 truncate">{r.ground}</span>
                <span className="hidden sm:block text-sky-200/55 truncate">{r.via}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
