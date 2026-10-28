'use client';

// /admin/radar — radar aviona iz NAŠEG rasporeda (dolasci + odlasci) oko Tivta, 200 NM.
// Zaštita: middleware (/admin/*) + requireAdmin() u /api/admin/radar. Podatke dobija od naše rute (ne direktno
// od adsb.lol), koja ih dijeli između svih gledalaca. Osvježavanje diktira server (raspored letova):
// ~3,5 min blizu leta, ≤12 min između letova, noću nikako. Između osvježavanja avioni se pomjeraju
// ekstrapolacijom (brzina + kurs) svake 2 s — bez dodatnih zahtjeva.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { COAST_POLYGONS, BORDER_LINES, IMG_RECT, IMG_WATER, IMG_COAST, MNE_POLYGONS, CITIES } from '@/lib/radar-coast';
import { operatorOf } from '@/lib/radar-fleet';
import { TIV, bearingDeg, distanceNm, etaMinutes, extrapolate, hhmm, type RadarAircraft, type RadarGround, type RadarOther, type RadarResponse } from '@/lib/radar';

const SIZE = 800;
const C = SIZE / 2;
const R_PX = 380;
const COS0 = Math.cos((TIV.lat * Math.PI) / 180);
const projK = (k: number) => (lat: number, lon: number) => ({ x: C + (lon - TIV.lon) * COS0 * 60 * k, y: C - (lat - TIV.lat) * 60 * k });
// Mjesta oko Tivta: [naziv, lat, lon, najveći radijus (NM) pri kojem se prikazuju]
const TOWNS: Array<[string, number, number, number]> = [
  ['Kotor', 42.4247, 18.7712, 50], ['Herceg Novi', 42.4531, 18.5375, 50], ['Budva', 42.2864, 18.84, 100], ['Cetinje', 42.3931, 18.9142, 100],
  ['Bar', 42.0937, 19.1003, 100], ['Ulcinj', 41.9294, 19.2244, 100], ['Nikšić', 42.7731, 18.9445, 100],
];
const LOGO_EXTS = ['.png', '.avif', '.jpg', '.svg', '.webp', '.jpeg'];
type Radius = 50 | 100 | 200;
const RADII: Radius[] = [50, 100, 200];
const RINGS: Record<Radius, number[]> = { 50: [10, 20, 30, 40, 50], 100: [25, 50, 75, 100], 200: [50, 100, 150, 200] };
const PLANE = 'M12 1.5 L13.7 8.5 L22 13.2 L22 15.2 L13.7 12.8 L13.3 18.6 L16 20.6 L16 22 L12 21 L8 22 L8 20.6 L10.7 18.6 L10.3 12.8 L2 15.2 L2 13.2 L10.3 8.5 Z';
const MAX_DR_SEC = 15 * 60;

const buildPath = (polys: number[][], proj: ReturnType<typeof projK>, close = true) => polys.map((flat) => {
  let d = '';
  for (let i = 0; i < flat.length; i += 2) {
    const p = proj(flat[i + 1], flat[i]);
    d += `${i ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
  }
  return close ? d + 'Z' : d;
}).join('');

type Live = RadarAircraft & { plat: number; plon: number; ldist: number; lbrg: number; leta: number | null };

function livePos(a: RadarAircraft, baseMs: number, nowT: number): Live {
  const sec = Math.max(0, Math.min(MAX_DR_SEC, (nowT - baseMs) / 1000 + a.age));
  const p = !a.gnd && a.gs > 30 ? extrapolate(a.lat, a.lon, a.gs, a.trk, sec) : { lat: a.lat, lon: a.lon };
  const ldist = distanceNm(TIV.lat, TIV.lon, p.lat, p.lon);
  return { ...a, plat: p.lat, plon: p.lon, ldist, lbrg: bearingDeg(TIV.lat, TIV.lon, p.lat, p.lon), leta: a.sched.type === 'arrival' && !a.gnd ? etaMinutes(ldist, a.gs) : null };
}

const fl = (a: { alt: number; gnd: boolean }) => (a.gnd ? 'GND' : a.alt >= 5000 ? `FL${String(Math.round(a.alt / 100)).padStart(3, '0')}` : `${a.alt}ft`);
const otherL1 = (a: RadarOther) => `${a.cs || a.hex}${a.r ? ` · ${a.r}` : ''}`;
const otherL2 = (a: RadarOther) => `${a.t || '—'} · ${fl(a)} · ${a.gs}kt`;

const fmtAlt = (a: RadarAircraft) => (a.gnd ? 'na zemlji' : a.alt >= 5000 ? `FL${String(Math.round(a.alt / 100)).padStart(3, '0')}` : `${a.alt.toLocaleString('de-DE')} ft`);
const vrArrow = (vr: number) => (vr > 300 ? '↑' : vr < -300 ? '↓' : '');
const fmtIn = (min: number) => (min < 60 ? `${Math.round(min)} min` : `${Math.floor(min / 60)} h ${Math.round(min % 60)} min`);

/** Logo kompanije (Air Montenegro / Air Serbia) iznad ikonice; ako slika ne postoji, ne crta se ništa. */
function LogoBadge({ icao, src, w, h, onFail }: { icao: string; src: string | null; w: number; h: number; onFail: (icao: string, src: string) => void }) {
  if (!src) return null;
  return (
    <g transform={`translate(${-w / 2} ${-(h + 20)})`}>
      <rect width={w} height={h} rx="4" fill="#ffffff" stroke="#04122c" strokeWidth="1" />
      <image key={src} href={src} x="2" y="1.5" width={w - 4} height={h - 3} preserveAspectRatio="xMidYMid meet" onError={() => onFail(icao, src)} />
    </g>
  );
}

const DEV_MIN = 10; // odstupanje ETA od plana (min) koje se označava

/** 'late' / 'early' / null — samo za dolaske sa poznatom ETA. */
function deviation(etaMs: number | null, atMs: number): { kind: 'late' | 'early'; min: number } | null {
  if (etaMs == null) return null;
  const d = Math.round((etaMs - atMs) / 60000);
  if (d > DEV_MIN) return { kind: 'late', min: d };
  if (d < -DEV_MIN) return { kind: 'early', min: d };
  return null;
}

function GroundCell({ g, type }: { g: RadarGround | undefined; type: 'arrival' | 'departure' }) {
  if (!g) return <span className="text-sky-200/40">—</span>;
  const state = (items: Array<{ open: boolean }>) => (g.planned ? 'plan' : items.some((i) => i.open) ? 'otvoren' : 'zatvoren');
  const dot = (st: string) => (st === 'otvoren' ? 'text-emerald-300' : st === 'zatvoren' ? 'text-red-300' : 'text-sky-300/60');
  const rows: Array<{ k: string; v: string; st: string }> = [];
  if (g.gates.length) rows.push({ k: 'Gate', v: g.gates.map((x) => x.id).join(', '), st: state(g.gates) });
  if (g.desks.length && type === 'departure') rows.push({ k: 'Šalter', v: g.desks.map((x) => x.id).join(', '), st: state(g.desks) });
  if (type === 'arrival' && g.belt) rows.push({ k: 'Traka', v: g.belt, st: '' });
  if (!rows.length) return <span className="text-sky-200/40">—</span>;
  return (
    <div className="space-y-0.5 text-[12px] leading-tight">
      {rows.map((r) => (
        <div key={r.k} className="whitespace-nowrap">
          <span className="text-sky-200/60">{r.k}</span> <b className="text-white">{r.v}</b>
          {r.st && <span className={`ml-1.5 ${dot(r.st)}`}>● {r.st}</span>}
        </div>
      ))}
    </div>
  );
}

function Delta({ etaMs, atMs }: { etaMs: number; atMs: number }) {
  const d = Math.round((etaMs - atMs) / 60000);
  const cls = d > 10 ? 'text-amber-300' : d < -3 ? 'text-emerald-300' : 'text-sky-200';
  return <span className={cls}>{d === 0 ? 'na vrijeme' : d > 0 ? `+${d} min` : `−${Math.abs(d)} min`}</span>;
}

export default function RadarPage() {
  const [data, setData] = useState<RadarResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tickT, setTickT] = useState(0);
  const [nextPollAt, setNextPollAt] = useState<number | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [onlyMne, setOnlyMne] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const scrollOnSelect = useRef(false);
  const [kiosk, setKiosk] = useState(false);
  const [showTrail, setShowTrail] = useState(true);
  const [soundOn, setSoundOn] = useState(false);
  const [trails, setTrails] = useState<Record<string, Array<[number, number]>>>({});
  const [groundLive, setGroundLive] = useState<Record<string, RadarGround> | null>(null);
  const [toasts, setToasts] = useState<Array<{ id: number; text: string }>>([]);
  const audioRef = useRef<AudioContext | null>(null);
  const alerted = useRef<Set<string>>(new Set());
  const alertInit = useRef(false);
  // Logo: pokušava /airlines/<ICAO>.png, pa .avif, .jpg, .svg, .webp, .jpeg; nakon zadnje se odustaje.
  const [logoTry, setLogoTry] = useState<Record<string, number>>({});
  // Više elemenata istovremeno prijavi grešku za ISTU sliku → računa se samo napredak od te slike (ne preskače ekstenzije).
  const onLogoFail = useCallback((icao: string, src: string) => {
    const n = LOGO_EXTS.findIndex((e) => src.endsWith(e));
    if (n >= 0) setLogoTry((p) => ((p[icao] ?? 0) > n ? p : { ...p, [icao]: n + 1 }));
  }, []);
  const logoSrc = useCallback((icao: string): string | null => {
    const n = logoTry[icao] ?? 0;
    return n < LOGO_EXTS.length ? `/airlines/${icao}${LOGO_EXTS[n]}` : null;
  }, [logoTry]);
  const showAllRef = useRef(false);
  const [radius, setRadius] = useState<Radius>(200);
  const [labels, setLabels] = useState(true);
  const K = R_PX / radius;
  const proj = useMemo(() => projK(K), [K]);
  const landPath = useMemo(() => buildPath(COAST_POLYGONS, proj), [proj]);
  const borderPath = useMemo(() => buildPath(BORDER_LINES, proj, false), [proj]);
  const rectPath = useMemo(() => buildPath([[IMG_RECT[0], IMG_RECT[1], IMG_RECT[2], IMG_RECT[1], IMG_RECT[2], IMG_RECT[3], IMG_RECT[0], IMG_RECT[3]]], proj), [proj]);
  const waterPath = useMemo(() => buildPath(IMG_WATER, proj), [proj]);
  const imgCoastPath = useMemo(() => buildPath(IMG_COAST, proj, false), [proj]);
  const mnePath = useMemo(() => buildPath(MNE_POLYGONS, proj), [proj]);
  const skew = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastManual = useRef(0);
  const loadRef = useRef<() => Promise<void>>(async () => undefined);

  const clock = useCallback(() => Date.now() + skew.current, []);

  const load = useCallback(async () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    let waitMs = 60_000;
    try {
      const res = await fetch(showAllRef.current ? '/api/admin/radar?all=1' : '/api/admin/radar', { cache: 'no-store' });
      if (res.status === 401) { window.location.assign('/admin/login'); return; }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = (await res.json()) as RadarResponse;
      skew.current = j.now - Date.now();
      setData(j);
      setGroundLive(null);
      setTrails((prev) => {
        const next: Record<string, Array<[number, number]>> = {};
        for (const a of j.aircraft) {
          const old = prev[a.hex] ?? [];
          const last = old[old.length - 1];
          const arr = last && last[0] === a.lat && last[1] === a.lon ? old : [...old, [a.lat, a.lon] as [number, number]];
          next[a.hex] = arr.slice(-8);
        }
        return next;
      });
      setErr(null);
      setTickT(j.now);
      waitMs = (j.intervalSec ?? 1800) * 1000;
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'greška');
    }
    setNextPollAt(Date.now() + skew.current + waitMs);
    timer.current = setTimeout(() => { if (!document.hidden) void loadRef.current(); else setNextPollAt(null); }, waitMs);
  }, []);
  useEffect(() => { loadRef.current = load; }, [load]);

  // Zapamćen izbor prikaza (po pregledaču).
  useEffect(() => {
    try {
      const q = new URLSearchParams(window.location.search);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (q.get('kiosk') === '1') setKiosk(true);
      const qr = Number(q.get('r'));
      if (qr === 50 || qr === 100 || qr === 200) setRadius(qr);
      if (q.get('mne') === '1') setOnlyMne(true);
      if (q.get('all') === '1') { showAllRef.current = true; setShowAll(true); }
      if (localStorage.getItem('radar_trail') === '0') setShowTrail(false);
      if (localStorage.getItem('radar_sound') === '1') setSoundOn(true);
    } catch { /* ignore */ }
    try {
      if (localStorage.getItem('radar_show_all') === '1') { showAllRef.current = true; setShowAll(true); }
      const r = Number(localStorage.getItem('radar_radius'));
      if (!new URLSearchParams(window.location.search).get('r') && (r === 50 || r === 100)) setRadius(r);
      if (localStorage.getItem('radar_only_mne') === '1') setOnlyMne(true);
      if (localStorage.getItem('radar_labels') === '0') setLabels(false);
    } catch { /* bez localStorage */ }
  }, []);
  const pickRadius = useCallback((r: Radius) => { setRadius(r); try { localStorage.setItem('radar_radius', String(r)); } catch { /* ignore */ } }, []);
  const toggleMne = useCallback(() => setOnlyMne((v) => { try { localStorage.setItem('radar_only_mne', v ? '0' : '1'); } catch { /* ignore */ } return !v; }), []);
  const selectFromMap = useCallback((hex: string) => { scrollOnSelect.current = true; setSelected((c) => (c === hex ? null : hex)); }, []);
  const toggleTrail = useCallback(() => setShowTrail((v) => { try { localStorage.setItem('radar_trail', v ? '0' : '1'); } catch { /* ignore */ } return !v; }), []);
  const toggleSound = useCallback(() => {
    setSoundOn((v) => {
      const nv = !v;
      try { localStorage.setItem('radar_sound', nv ? '1' : '0'); } catch { /* ignore */ }
      if (nv) {
        try { // AudioContext se smije napraviti tek nakon klika (pravilo preglednika)
          const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
          if (Ctx && !audioRef.current) audioRef.current = new Ctx();
          void audioRef.current?.resume();
        } catch { /* bez zvuka */ }
      }
      return nv;
    });
  }, []);
  const toggleLabels = useCallback(() => setLabels((v) => { try { localStorage.setItem('radar_labels', v ? '0' : '1'); } catch { /* ignore */ } return !v; }), []);
  const toggleAll = useCallback(() => {
    const v = !showAllRef.current;
    showAllRef.current = v;
    setShowAll(v);
    try { localStorage.setItem('radar_show_all', v ? '1' : '0'); } catch { /* ignore */ }
    void loadRef.current();
  }, []);

  // Start + pauza kad je tab skriven (nula zahtjeva), nastavak čim se vrati.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    const onVis = () => { if (!document.hidden) void load(); else if (timer.current) { clearTimeout(timer.current); timer.current = null; } };
    document.addEventListener('visibilitychange', onVis);
    return () => { document.removeEventListener('visibilitychange', onVis); if (timer.current) clearTimeout(timer.current); };
  }, [load]);

  // Ekstrapolacija pozicija + odbrojavanje: svake 2 s, samo dok je tab vidljiv.
  useEffect(() => {
    const id = setInterval(() => { if (!document.hidden) setTickT(clock()); }, 2000);
    return () => clearInterval(id);
  }, [clock]);

  const base = data?.fetchedAt ?? data?.now ?? 0;
  const live = useMemo(() => (data ? data.aircraft.map((a) => livePos(a, base, tickT || data.now)).filter((a) => !onlyMne || operatorOf(a.hex, a.r, a.cs)?.icao === 'MNE') : []), [data, base, tickT, onlyMne]);

  const tableLive = useMemo(() => live.filter((a) => a.ldist <= radius + 2), [live, radius]);

  const liveOthers = useMemo(() => {
    if (!data?.allOthers || !showAll) return [] as Array<RadarOther & { plat: number; plon: number; ldist: number; lbrg: number }>;
    const t = tickT || data.now;
    return data.allOthers.map((a) => {
      const sec = Math.max(0, Math.min(MAX_DR_SEC, (t - base) / 1000 + a.age));
      const p = !a.gnd && a.gs > 30 ? extrapolate(a.lat, a.lon, a.gs, a.trk, sec) : { lat: a.lat, lon: a.lon };
      return { ...a, plat: p.lat, plon: p.lon, ldist: distanceNm(TIV.lat, TIV.lon, p.lat, p.lon), lbrg: bearingDeg(TIV.lat, TIV.lon, p.lat, p.lon) };
    }).filter((a) => !onlyMne || operatorOf(a.hex, a.r, a.cs)?.icao === 'MNE').sort((x, y) => x.ldist - y.ldist);
  }, [data, base, tickT, showAll, onlyMne]);

  const othersShown = useMemo(() => {
    const vis = liveOthers.filter((a) => a.ldist <= radius + 2);
    const top = vis.slice(0, 40);
    const sel = selected ? vis.find((a) => a.hex === selected) : undefined;
    return { total: vis.length, rows: sel && !top.includes(sel) ? [sel, ...top] : top };
  }, [liveOthers, radius, selected]);

  // Klik na avion na mapi → tabela se pomjeri do tog reda.
  useEffect(() => {
    if (!selected || !scrollOnSelect.current) return;
    scrollOnSelect.current = false;
    document.getElementById(`radar-row-${selected}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [selected]);

  // Raspored oznaka bez preklapanja: naši letovi prvi (uvijek prikazani), zatim ostali od najbližeg TIV-u.
  const sides = useMemo(() => {
    const out = new Map<string, 'r' | 'l' | null>();
    if (!labels) return out;
    const rects: Array<[number, number, number, number]> = [];
    const hit = (r: [number, number, number, number]) => r[0] < 0 || r[2] > SIZE || rects.some((q) => r[0] < q[2] && r[2] > q[0] && r[1] < q[3] && r[3] > q[1]);
    const place = (hex: string, x: number, y: number, w: number, h: number, off: number, force: boolean) => {
      const R: [number, number, number, number] = [x + off, y - h / 2 - 2, x + off + w, y + h / 2 + 2];
      const L: [number, number, number, number] = [x - off - w, y - h / 2 - 2, x - off, y + h / 2 + 2];
      const first = x < 560 ? 'r' : 'l';
      const order: Array<'r' | 'l'> = first === 'r' ? ['r', 'l'] : ['l', 'r'];
      for (const sd of order) {
        const rc = sd === 'r' ? R : L;
        if (!hit(rc)) { rects.push(rc); out.set(hex, sd); return; }
      }
      if (force) { const rc = first === 'r' ? R : L; rects.push(rc); out.set(hex, first); } else out.set(hex, null);
    };
    for (const a of live) {
      if (a.ldist > radius + 2) continue;
      const p = proj(a.plat, a.plon);
      place(a.hex, p.x, p.y, 8.4 * Math.max((a.cs || a.sched.fn).length + (a.r ? a.r.length + 3 : 0), 18), 34, 28, true);
    }
    for (const a of liveOthers) {
      if (a.ldist > radius + 2) continue;
      const p = proj(a.plat, a.plon);
      place(a.hex, p.x, p.y, 7.3 * Math.max(otherL1(a).length, otherL2(a).length), 26, 14, false);
    }
    return out;
  }, [labels, live, liveOthers, proj, radius]);

  const groundMap = groundLive ?? data?.ground;

  // Lagano osvježavanje samo dodjela (gate/šalter) — jedno Redis čitanje, bez poziva ka izvoru aviona.
  // Brzo (60 s) kad je let blizu, sporo (5 min) između letova, nikako noću ili dok je tab skriven.
  const groundEvery = data?.mode === 'fast' ? 60_000 : data?.mode === 'slow' ? 300_000 : 0;
  useEffect(() => {
    if (!groundEvery) return;
    const id = setInterval(async () => {
      if (document.hidden) return;
      try {
        const r = await fetch('/api/admin/radar?ground=1', { cache: 'no-store' });
        if (r.status === 401) { window.location.assign('/admin/login'); return; }
        if (r.ok) setGroundLive(((await r.json()) as { ground: Record<string, RadarGround> }).ground);
      } catch { /* zadrži prethodno */ }
    }, groundEvery);
    return () => clearInterval(id);
  }, [groundEvery]);

  // Obavještenje kad dolazak iz našeg rasporeda uđe u 50 NM (jednom po letu). Letovi koji su već unutra pri otvaranju stranice ne alarmiraju.
  useEffect(() => {
    if (!data) return;
    const fresh: string[] = [];
    for (const a of live) {
      if (a.sched.type !== 'arrival' || a.gnd || a.ldist > 50) continue;
      const key = a.sched.fn;
      if (alerted.current.has(key)) continue;
      alerted.current.add(key);
      if (alertInit.current) fresh.push(`${a.cs || a.sched.fn}${a.r ? ` (${a.r})` : ''} ulazi u 50 NM${a.leta != null ? ` · ETA ${hhmm((tickT || data.now) + a.leta * 60000)}` : ''}`);
    }
    alertInit.current = true;
    if (!fresh.length) return;
    const stamp = Date.now();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setToasts((t) => [...t, ...fresh.map((text, i) => ({ id: stamp + i, text }))]);
    for (let i = 0; i < fresh.length; i++) setTimeout(() => setToasts((t) => t.filter((x) => x.id !== stamp + i)), 25_000);
    if (soundOn && audioRef.current) {
      try {
        const ctx = audioRef.current;
        [880, 1175, 880].forEach((f, i) => {
          const o = ctx.createOscillator(); const g = ctx.createGain();
          o.frequency.value = f; o.connect(g); g.connect(ctx.destination);
          const t0 = ctx.currentTime + i * 0.24;
          g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.3, t0 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.2);
          o.start(t0); o.stop(t0 + 0.22);
        });
      } catch { /* bez zvuka */ }
    }
  }, [live, data, tickT, soundOn]);

  const modeChip = data?.mode === 'fast' ? { t: 'Brzo osvježavanje · ~3,5 min', c: 'bg-sky-400/20 text-sky-200 border-sky-300/40' }
    : data?.mode === 'slow' ? { t: 'Mirno · između letova', c: 'bg-blue-400/15 text-blue-200 border-blue-300/30' }
    : data?.mode === 'night' ? { t: 'Noćni režim · bez osvježavanja', c: 'bg-indigo-400/15 text-indigo-200 border-indigo-300/30' } : null;
  const minToPoll = nextPollAt && tickT ? Math.max(0, Math.round((nextPollAt - tickT) / 60000)) : null;

  return (
    <div className={kiosk ? 'h-screen overflow-hidden text-slate-100' : 'min-h-screen text-slate-100'} style={{ background: 'radial-gradient(1200px 700px at 50% -10%, #12408a 0%, #0a2250 38%, #050f26 100%)' }}>
      <style>{`@keyframes radar-spin{to{transform:rotate(360deg)}}@keyframes radar-pulse{0%{opacity:.9}50%{opacity:.35}100%{opacity:.9}}@media (prefers-reduced-motion:reduce){.radar-sweep{animation:none!important}}`}</style>
      {toasts.length > 0 && (
        <div className="fixed inset-x-0 top-4 z-50 flex flex-col items-center gap-2 px-4">
          {toasts.map((t) => (
            <button key={t.id} type="button" onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))} className="max-w-full rounded-2xl border-2 border-white/80 bg-orange-500 px-5 py-3 text-left text-sm font-bold text-[#04122c] shadow-[0_10px_40px_rgba(251,146,60,0.55)]">
              ✈ {t.text}
            </button>
          ))}
        </div>
      )}
      {kiosk && (
        <div className="fixed left-3 top-3 z-30 flex items-center gap-2 text-[11px] text-sky-100/80">
          {modeChip && <span className={`rounded-full border px-2.5 py-0.5 font-semibold ${modeChip.c}`}>{modeChip.t}</span>}
          <span>Podaci {data?.fetchedAt ? hhmm(data.fetchedAt) : '—'}{data?.stale ? ' (stariji)' : ''}</span>
          <button type="button" onClick={toggleSound} className="rounded-full border border-sky-300/30 bg-white/5 px-2.5 py-0.5 font-semibold">{soundOn ? '🔔 zvuk' : '🔇 zvuk'}</button>
        </div>
      )}
      <div className={kiosk ? 'flex h-full items-center justify-center p-2' : 'mx-auto max-w-6xl px-4 pb-10 pt-5'}>
        {!kiosk && <>
        <header className="mb-4 flex flex-wrap items-center gap-3">
          <a href="/admin" className="rounded-xl border border-sky-300/20 bg-white/5 px-3 py-2 text-xs font-semibold text-sky-100 transition hover:bg-white/10">← Admin</a>
          <div className="mr-auto">
            <h1 className="text-xl font-bold tracking-tight text-white sm:text-2xl">Radar · Tivat <span className="text-sky-300">LYTV</span></h1>
            <p className="text-xs text-sky-200/70">{showAll ? "Svi avioni (naši letovi istaknuti)" : "Samo letovi iz našeg rasporeda"} · domet {radius} NM</p>
          </div>
          {modeChip && <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${modeChip.c}`}>{modeChip.t}</span>}
          {data?.next && (
            <span className="rounded-full border border-sky-300/25 bg-white/5 px-3 py-1 text-xs text-sky-100">
              Sljedeći: <b>{data.next.flightNumber}</b> {data.next.type === 'arrival' ? 'dolazak' : 'odlazak'} {data.next.hm}
            </span>
          )}
          <div role="radiogroup" aria-label="Radijus" className="flex overflow-hidden rounded-xl border border-sky-300/25 bg-white/5 text-xs font-semibold">
            {RADII.map((r) => (
              <button key={r} type="button" role="radio" aria-checked={radius === r} onClick={() => pickRadius(r)} className={`px-3 py-2 transition ${radius === r ? 'bg-sky-400 text-[#04122c]' : 'text-sky-100 hover:bg-white/10'}`}>{r} NM</button>
            ))}
          </div>
          <button type="button" role="switch" aria-checked={labels} onClick={toggleLabels} className="flex items-center gap-2 rounded-xl border border-sky-300/25 bg-white/5 px-3 py-2 text-xs font-semibold text-sky-100 transition hover:bg-white/10">
            <span className={`relative inline-block h-5 w-9 rounded-full transition ${labels ? 'bg-sky-400' : 'bg-blue-900 border border-sky-300/30'}`}>
              <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${labels ? 'left-[18px]' : 'left-0.5'}`} />
            </span>
            <span>Oznake na radaru</span>
          </button>
          <button type="button" role="switch" aria-checked={showTrail} onClick={toggleTrail} className="flex items-center gap-2 rounded-xl border border-sky-300/25 bg-white/5 px-3 py-2 text-xs font-semibold text-sky-100 transition hover:bg-white/10">
            <span className={`relative inline-block h-5 w-9 rounded-full transition ${showTrail ? 'bg-sky-400' : 'bg-blue-900 border border-sky-300/30'}`}>
              <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${showTrail ? 'left-[18px]' : 'left-0.5'}`} />
            </span>
            <span>Trag aviona</span>
          </button>
          <button type="button" role="switch" aria-checked={soundOn} onClick={toggleSound} title="Zvučni signal kad dolazak uđe u 50 NM (vizuelno obavještenje je uvijek uključeno)" className="flex items-center gap-2 rounded-xl border border-sky-300/25 bg-white/5 px-3 py-2 text-xs font-semibold text-sky-100 transition hover:bg-white/10">
            <span className={`relative inline-block h-5 w-9 rounded-full transition ${soundOn ? 'bg-sky-400' : 'bg-blue-900 border border-sky-300/30'}`}>
              <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${soundOn ? 'left-[18px]' : 'left-0.5'}`} />
            </span>
            <span>🔔 Zvuk na 50 NM</span>
          </button>
          <button type="button" role="switch" aria-checked={onlyMne} onClick={toggleMne} className="flex items-center gap-2 rounded-xl border border-sky-300/25 bg-white/5 px-3 py-2 text-xs font-semibold text-sky-100 transition hover:bg-white/10">
            <span className={`relative inline-block h-5 w-9 rounded-full transition ${onlyMne ? 'bg-sky-400' : 'bg-blue-900 border border-sky-300/30'}`}>
              <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${onlyMne ? 'left-[18px]' : 'left-0.5'}`} />
            </span>
            <span>Samo Air Montenegro</span>
          </button>
          <button type="button" role="switch" aria-checked={showAll} onClick={toggleAll} className="flex items-center gap-2 rounded-xl border border-sky-300/25 bg-white/5 px-3 py-2 text-xs font-semibold text-sky-100 transition hover:bg-white/10">
            <span className={showAll ? 'text-sky-300/60' : 'text-white'}>Samo Tivat</span>
            <span className={`relative inline-block h-5 w-9 rounded-full transition ${showAll ? 'bg-sky-400' : 'bg-blue-900 border border-sky-300/30'}`}>
              <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${showAll ? 'left-[18px]' : 'left-0.5'}`} />
            </span>
            <span className={showAll ? 'text-white' : 'text-sky-300/60'}>Svi avioni</span>
          </button>
          <button
            type="button"
            onClick={() => { const t = Date.now(); if (t - lastManual.current > 30_000) { lastManual.current = t; void load(); } }}
            className="rounded-xl border border-sky-300/30 bg-sky-500/20 px-3 py-2 text-xs font-semibold text-sky-50 transition hover:bg-sky-500/30 active:scale-95"
          >⟳ Osvježi</button>
        </header>

        <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-sky-200/70">
          <span>Podaci: {data?.fetchedAt ? hhmm(data.fetchedAt) : '—'}{data?.stale ? ' (stariji snimak)' : ''}</span>
          {minToPoll != null && data?.mode !== 'night' && <span>sljedeće osvježavanje za ~{minToPoll} min</span>}
          {data && <span>{showAll ? `ostalih aviona u dometu: ${data.others}` : `u dometu još ${data.others} aviona koji nisu naš raspored`}</span>}
          {data?.note && <span className="text-amber-300">⚠ {data.note}</span>}
          {err && <span className="text-red-300">⚠ {err}</span>}
        </div>
        </>}

        <section className={kiosk ? '' : 'mx-auto w-full max-w-[760px]'} style={kiosk ? { width: 'min(96vh, 98vw)' } : undefined}>
          <div className="relative aspect-square w-full overflow-hidden rounded-3xl border border-sky-300/20 shadow-[0_0_80px_-20px_rgba(56,140,255,0.6)]" style={{ background: 'radial-gradient(circle at 50% 50%, #0c3a80 0%, #082a63 45%, #051a40 100%)' }}>
            <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="absolute inset-0 h-full w-full" aria-hidden>
              <defs><radialGradient id="sea" gradientUnits="userSpaceOnUse" cx={C} cy={C} r="566"><stop offset="0" stopColor="#0c3a80" /><stop offset="0.45" stopColor="#082a63" /><stop offset="1" stopColor="#051a40" /></radialGradient><clipPath id="rr"><circle cx={C} cy={C} r={R_PX} /></clipPath></defs>
              <g clipPath="url(#rr)">
                <path d={landPath} fill="#194d9d" fillRule="evenodd" />
                <path d={landPath} fill="none" stroke="#5fb0ff" strokeOpacity="0.8" strokeWidth="1.1" strokeLinejoin="round" />
                <path d={rectPath} fill="#194d9d" />
                <path d={waterPath} fill="url(#sea)" fillRule="evenodd" />
                <path d={mnePath} fill="#3a7fe0" fillOpacity="0.3" fillRule="evenodd" />
                <path d={borderPath} fill="none" stroke="#cfe6ff" strokeOpacity="0.55" strokeWidth="1" strokeDasharray="6 3" strokeLinejoin="round" />
                <path d={imgCoastPath} fill="none" stroke="#5fb0ff" strokeOpacity="0.9" strokeWidth="1.2" strokeLinejoin="round" strokeLinecap="round" />
              </g>
              {RINGS[radius].map((nm) => (
                <g key={nm}>
                  <circle cx={C} cy={C} r={nm * K} fill="none" stroke="#7cc4ff" strokeOpacity={nm === radius ? 0.7 : 0.28} strokeWidth={nm === radius ? 2 : 1} strokeDasharray={nm === radius ? undefined : '4 6'} />
                  <text x={C + 6} y={C - nm * K - 4} fontSize="12" fill="#9bd1ff" fillOpacity="0.8">{nm} NM</text>
                </g>
              ))}
              {[...CITIES.filter((c) => radius >= 100 || c[0] === 'Dubrovnik').map((c) => [c[0], c[2], c[1]] as [string, number, number]), ...TOWNS.filter((t) => radius <= t[3]).map((t) => [t[0], t[1], t[2]] as [string, number, number])].map(([n, lat, lon]) => {
                const q = proj(lat, lon);
                if (Math.hypot(q.x - C, q.y - C) > R_PX - 6) return null;
                return (
                  <g key={n}>
                    <circle cx={q.x} cy={q.y} r="2.6" fill="#cfe6ff" fillOpacity="0.85" />
                    <text x={q.x + 6} y={q.y + 3.5} fontSize="11" fill="#cfe6ff" fillOpacity="0.8" stroke="#06265a" strokeWidth="3" paintOrder="stroke" strokeLinejoin="round">{n}</text>
                  </g>
                );
              })}
              <line x1={C} y1={C - R_PX} x2={C} y2={C + R_PX} stroke="#7cc4ff" strokeOpacity="0.14" />
              <line x1={C - R_PX} y1={C} x2={C + R_PX} y2={C} stroke="#7cc4ff" strokeOpacity="0.14" />
              {[['N', C, C - R_PX - 6], ['E', C + R_PX + 12, C + 5], ['S', C, C + R_PX + 18], ['W', C - R_PX - 12, C + 5]].map(([l, x, y]) => (
                <text key={String(l)} x={x as number} y={y as number} fontSize="14" fontWeight="700" textAnchor="middle" fill="#bfe1ff">{l}</text>
              ))}
            </svg>

            <div className="radar-sweep pointer-events-none absolute rounded-full" style={{ left: `${((C - R_PX) / SIZE) * 100}%`, top: `${((C - R_PX) / SIZE) * 100}%`, width: `${((2 * R_PX) / SIZE) * 100}%`, height: `${((2 * R_PX) / SIZE) * 100}%`, background: 'conic-gradient(from 0deg, rgba(56,189,248,0) 0deg, rgba(56,189,248,0) 280deg, rgba(56,189,248,0.22) 340deg, rgba(147,220,255,0.75) 360deg)', animation: 'radar-spin 7s linear infinite', willChange: 'transform' }} />

            <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="absolute inset-0 h-full w-full" aria-label="Avioni">
              <circle cx={C} cy={C} r="5" fill="#fff" />
              <circle cx={C} cy={C} r="11" fill="none" stroke="#fff" strokeOpacity="0.6" />
              <text x={C + 14} y={C + 18} fontSize="13" fontWeight="700" fill="#fff">TIV</text>
              {liveOthers.map((a) => {
                if (a.ldist > radius + 2) return null;
                const p = proj(a.plat, a.plon);
                return (
                  <g key={a.hex} transform={`translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})`} opacity={a.gnd ? 0.45 : 1} onClick={() => selectFromMap(a.hex)} style={{ cursor: 'pointer' }}>
                    <circle r="16" fill="transparent" />
                    {selected === a.hex && <circle r="22" fill="none" stroke="#ffffff" strokeWidth="2.5" strokeDasharray="5 4" />}
                    <path d={PLANE} fill="#ffe14d" stroke="#04122c" strokeWidth="0.8" transform={`rotate(${a.trk}) scale(1.15) translate(-12 -12)`} />
                    {(() => { const op = operatorOf(a.hex, a.r, a.cs); return op ? <LogoBadge icao={op.icao} src={logoSrc(op.icao)} w={30} h={17} onFail={onLogoFail} /> : null; })()}
                    {labels && sides.get(a.hex) && (() => {
                      const sd = sides.get(a.hex);
                      const x = sd === 'r' ? 14 : -14;
                      return (
                        <g fontFamily="ui-monospace, Menlo, Consolas, monospace" fontSize="10.5" textAnchor={sd === 'r' ? 'start' : 'end'}>
                          {[true, false].map((halo) => (
                            <g key={halo ? 'h' : 'f'} stroke={halo ? '#04122c' : 'none'} strokeWidth={halo ? 3.5 : 0} strokeLinejoin="round">
                              <text x={x} y={-1} fill={halo ? 'none' : '#fff3a8'} fontWeight="700">{otherL1(a)}</text>
                              <text x={x} y={11} fill={halo ? 'none' : '#e8d98a'}>{otherL2(a)}</text>
                            </g>
                          ))}
                        </g>
                      );
                    })()}
                  </g>
                );
              })}
              {showTrail && live.map((a) => {
                const tr = trails[a.hex];
                if (!tr || tr.length < 1 || a.gnd) return null;
                const pts = [...tr.map(([la, lo]) => proj(la, lo)), proj(a.plat, a.plon)];
                return <polyline key={`t${a.hex}`} points={pts.map((q) => `${q.x.toFixed(1)},${q.y.toFixed(1)}`).join(' ')} fill="none" stroke="#ff8a1f" strokeOpacity="0.65" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />;
              })}
              {live.map((a) => {
                const p = proj(a.plat, a.plon);
                if (a.ldist > radius + 2) return null;
                const arr = a.sched.type === 'arrival';
                const col = a.gnd ? '#c58a4a' : '#ff8a1f';
                const right = (sides.get(a.hex) ?? (p.x < 560 ? 'r' : 'l')) === 'r';
                const tx = right ? 28 : -28;
                const anchor = right ? 'start' : 'end';
                return (
                  <g key={a.hex}>
                    {arr && !a.gnd && <line x1={p.x} y1={p.y} x2={C} y2={C} stroke="#38bdf8" strokeOpacity="0.35" strokeDasharray="3 5" />}
                    <g transform={`translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})`} onClick={() => selectFromMap(a.hex)} style={{ cursor: 'pointer' }}>
                      {selected === a.hex && <circle r="34" fill="none" stroke="#ffffff" strokeWidth="3" strokeDasharray="6 4" />}
                      <circle r="24" fill={col} fillOpacity="0.18" style={{ animation: 'radar-pulse 2.4s ease-in-out infinite' }} />
                      <path d={PLANE} fill={col} stroke="#04122c" strokeWidth="0.8" transform={`rotate(${a.trk}) scale(1.7) translate(-12 -12)`} />
                      {(() => { const op = operatorOf(a.hex, a.r, a.cs); return op ? <LogoBadge icao={op.icao} src={logoSrc(op.icao)} w={40} h={22} onFail={onLogoFail} /> : null; })()}
                      {(() => {
                        const dv = arr ? deviation(a.leta != null ? (tickT || 0) + a.leta * 60000 : null, a.sched.atMs) : null;
                        if (!dv) return null;
                        const late = dv.kind === 'late';
                        return (
                          <g transform="translate(0 40)">
                            <rect x="-50" y="-10" width="100" height="19" rx="9.5" fill={late ? '#f59e0b' : '#34d399'} stroke="#04122c" strokeWidth="1.2" />
                            <text y="4" fontSize="12" fontWeight="800" textAnchor="middle" fill="#04122c">{late ? `KASNI +${dv.min}` : `RANIJE ${dv.min}`}</text>
                          </g>
                        );
                      })()}
                      {labels && (
                        <g fontFamily="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" textAnchor={anchor}>
                          {[true, false].map((halo) => (
                            <g key={halo ? 'h' : 'f'} fill={halo ? 'none' : undefined} stroke={halo ? '#04122c' : 'none'} strokeWidth={halo ? 4 : 0} strokeLinejoin="round">
                              <text x={tx} y={-5} fontSize="14" fontWeight="700" fill={halo ? 'none' : '#ffffff'}>{a.cs || a.sched.fn}{a.via === 'est' ? ' ≈' : ''}{a.r ? ` · ${a.r}` : ''}</text>
                              <text x={tx} y={12} fontSize="12.5" fill={halo ? 'none' : '#ffd9a8'}>{a.t || '—'} · {fmtAlt(a)}{vrArrow(a.vr)} · {a.gs} kt</text>
                            </g>
                          ))}
                        </g>
                      )}
                    </g>
                  </g>
                );
              })}
            </svg>

            {data && tableLive.length === 0 && (
              <div className="pointer-events-none absolute inset-x-0 bottom-[7%] text-center text-sm text-sky-100/80">
                {data.mode === 'night' ? 'Noćni režim — radar miruje.' : onlyMne ? 'Nijedan avion Air Montenegra nije u dometu.' : 'Nijedan avion iz našeg rasporeda trenutno nije u dometu.'}
              </div>
            )}
            {!data && !err && <div className="absolute inset-0 grid place-items-center text-sky-100/80">Učitavanje radara…</div>}
          </div>
        </section>

        {!kiosk && <>
        <section className="mt-6 overflow-hidden rounded-2xl border border-sky-300/20 bg-[#071b40]/80 backdrop-blur">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[960px] text-left text-sm">
              <thead className="bg-[#0b2a5e] text-[11px] uppercase tracking-wider text-sky-200/80">
                <tr>
                  {['Let', 'Reg.', 'Tip', 'Visina', 'Brzina', 'Udalj.', 'Pravac', 'ETA / odlazak', 'Naš raspored', 'Zemlja'].map((h) => (
                    <th key={h} className="px-3 py-2.5 font-semibold">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-sky-300/10">
                {tableLive.map((a) => {
                  const arr = a.sched.type === 'arrival';
                  const etaMs = a.leta != null ? tickT + a.leta * 60000 : null;
                  const dv = arr ? deviation(etaMs, a.sched.atMs) : null;
                  const bar = selected === a.hex ? 'shadow-[inset_4px_0_0_#fb923c]' : dv?.kind === 'late' ? 'shadow-[inset_4px_0_0_#f59e0b]' : dv?.kind === 'early' ? 'shadow-[inset_4px_0_0_#34d399]' : '';
                  const bg = selected === a.hex ? 'bg-orange-500/25' : dv?.kind === 'late' ? 'bg-amber-500/10 hover:bg-amber-500/15' : dv?.kind === 'early' ? 'bg-emerald-500/10 hover:bg-emerald-500/15' : 'hover:bg-sky-400/5';
                  return (
                    <tr key={a.hex} id={`radar-row-${a.hex}`} onClick={() => setSelected((c) => (c === a.hex ? null : a.hex))} className={`cursor-pointer transition-colors ${bg} ${bar}`}>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-2">
                          <span className={`inline-block h-2.5 w-2.5 rounded-full bg-orange-400`} />
                          {(() => {
                            const op = operatorOf(a.hex, a.r, a.cs);
                            const src = op ? logoSrc(op.icao) : null;
                            if (!op || !src) return null;
                            // Običan <img> namjerno (ne next/image): bez optimizacije slika na Vercelu, nema dodatnog troška.
                            // eslint-disable-next-line @next/next/no-img-element
                            return <img key={src} src={src} alt={op.name} title={op.name} className="h-5 w-auto rounded bg-white p-0.5" onError={() => onLogoFail(op.icao, src)} />;
                          })()}
                          <div><div className="font-mono font-bold text-white">{a.cs || a.sched.fn}{a.via === 'est' ? <span title="Procjena po vremenu i kursu — callsign nema broj leta" className="ml-1 text-amber-300">≈</span> : null}</div><div className="text-[11px] text-sky-200/70">{a.sched.fn} · {arr ? '↓ dolazak' : '↑ odlazak'} · {a.sched.city}</div></div>
                        </div>
                      </td>
                      <td className="px-3 py-2.5 font-mono text-sky-100">{a.r || '—'}</td>
                      <td className="px-3 py-2.5 font-mono text-sky-100">{a.t || '—'}</td>
                      <td className="px-3 py-2.5 tabular-nums">{fmtAlt(a)} {vrArrow(a.vr)}</td>
                      <td className="px-3 py-2.5 tabular-nums">{a.gs} kt</td>
                      <td className="px-3 py-2.5 tabular-nums">{Math.round(a.ldist)} NM</td>
                      <td className="px-3 py-2.5 tabular-nums">{Math.round(a.lbrg)}°</td>
                      <td className="px-3 py-2.5">
                        {arr ? (a.leta != null && etaMs != null ? <><b className="text-white">{hhmm(etaMs)}</b> <span className="text-[11px] text-sky-200/70">(za {fmtIn(a.leta)})</span></> : <span className="text-sky-200/60">—</span>) : <span className="text-sky-200/70">{a.gnd ? 'na zemlji' : 'poletio'}</span>}
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="tabular-nums text-sky-100">{a.sched.etd || a.sched.std}{a.sched.etd && a.sched.etd !== a.sched.std ? <span className="text-[11px] text-sky-200/60"> (plan {a.sched.std})</span> : null}</div>
                        {etaMs != null && <div className="text-[11px]"><Delta etaMs={etaMs} atMs={a.sched.atMs} /></div>}
                        {dv && <span className={`mt-0.5 inline-block rounded-full px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide text-[#04122c] ${dv.kind === 'late' ? 'bg-amber-400' : 'bg-emerald-400'}`}>{dv.kind === 'late' ? `Kasni ${dv.min} min` : `Ranije ${Math.abs(dv.min)} min`}</span>}
                      </td>
                      <td className="px-3 py-2.5"><GroundCell g={groundMap?.[a.sched.fn.replace(/[^A-Za-z0-9]/g, '').toUpperCase()]} type={a.sched.type} /></td>
                    </tr>
                  );
                })}
                {data && tableLive.length === 0 && (
                  <tr><td colSpan={10} className="px-3 py-6 text-center text-sky-200/60">{onlyMne ? 'Nijedan avion Air Montenegra nije na radaru.' : 'Nijedan avion iz našeg rasporeda nije na radaru.'}</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        {showAll && (
          <section className="mt-4 overflow-hidden rounded-2xl border border-sky-300/15 bg-[#071b40]/60">
            <div className="px-3 py-2 text-[11px] uppercase tracking-wider text-sky-200/70">Ostali avioni na radaru ({othersShown.total}){othersShown.total > 40 ? ' · prikazano 40 najbližih' : ''}</div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[700px] text-left text-xs text-sky-100/90">
                <tbody className="divide-y divide-sky-300/10">
                  {othersShown.rows.map((a) => (
                    <tr key={a.hex} id={`radar-row-${a.hex}`} onClick={() => setSelected((c) => (c === a.hex ? null : a.hex))} className={`cursor-pointer transition-colors ${selected === a.hex ? 'bg-yellow-400/20 shadow-[inset_4px_0_0_#facc15]' : 'hover:bg-sky-400/5'}`}>
                      <td className="px-3 py-1.5 font-mono font-semibold">{a.cs || a.hex}</td>
                      <td className="px-3 py-1.5 font-mono">{a.r || '—'}</td>
                      <td className="px-3 py-1.5 font-mono">{a.t || '—'}</td>
                      <td className="px-3 py-1.5 tabular-nums">{a.gnd ? 'na zemlji' : a.alt >= 5000 ? `FL${String(Math.round(a.alt / 100)).padStart(3, '0')}` : `${a.alt} ft`} {vrArrow(a.vr)}</td>
                      <td className="px-3 py-1.5 tabular-nums">{a.gs} kt</td>
                      <td className="px-3 py-1.5 tabular-nums">{Math.round(a.ldist)} NM</td>
                      <td className="px-3 py-1.5 tabular-nums">{Math.round(a.lbrg)}°</td>
                    </tr>
                  ))}
                  {liveOthers.length === 0 && <tr><td className="px-3 py-4 text-center text-sky-200/60">Nema drugih aviona u dometu.</td></tr>}
                </tbody>
              </table>
            </div>
          </section>
        )}

        <p className="mt-3 text-[11px] leading-relaxed text-sky-200/50">
          Izvor: adsb.lol (ADS-B, zajednica). Uparivanje preko oznake leta (callsign) sa našim rasporedom — avioni sa drugačijim callsign-om ili bez ADS-B signala se ne prikazuju.
          Pokrivenost na maloj visini oko Tivata može biti slaba. ETA je procjena (udaljenost ÷ brzina uz korekciju prilaza).
        </p>
        </>}
      </div>
    </div>
  );
}
