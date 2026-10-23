/* eslint-disable react-hooks/set-state-in-effect */
// app/admin/health/page.tsx
//
// Moderna dijagnostička stranica za /api/admin/health (redizajn 2026-10-20).
// Čisto administrativna vidljivost: ne dira kiosk ekrane i ne poziva ništa dok je tab skriven.
// Auto-refresh je podesiv (zadano 60 s) i pauzira se kad tab nije vidljiv; pri povratku u tab odmah osvježi.
// Svijetla/tamna tema dijeli isti 'theme' ključ (localStorage) kao assign-checkin.

'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity, AlertTriangle, ArrowLeft, Brain, Check, CheckCircle2, Clock, Copy, Database, Info,
  ListChecks, Monitor, Moon, Plane, RefreshCw, Server, Sun, XCircle,
} from 'lucide-react';
import type { HealthResponse, HealthIssue, LearningKindSummary, KioskInfo } from '@/lib/health-types';

const HISTORY_MAX = 30;
const REFRESH_OPTIONS: Array<{ label: string; ms: number }> = [
  { label: 'Isključeno', ms: 0 },
  { label: '30 s', ms: 30_000 },
  { label: '1 min', ms: 60_000 },
  { label: '5 min', ms: 300_000 },
];

// ─── Pomoćne funkcije ───────────────────────────────────────────────
const fmtMinutes = (min: number) => {
  const h = Math.floor(min / 60), m = min % 60;
  return h === 0 ? `${m} min` : `${h} h ${m} min`;
};
const fmtUptime = (s: number | null) => {
  if (s === null) return '—';
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return d > 0 ? `${d} d ${h} h` : h > 0 ? `${h} h ${m} min` : `${m} min`;
};
const fmtBytes = (b: number | null) => {
  if (b === null) return '—';
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  if (b < 1024 * 1024 * 1024) return `${(b / 1048576).toFixed(1)} MB`;
  return `${(b / 1073741824).toFixed(2)} GB`;
};
const fmtTime = (iso: string | null) => {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleTimeString('sr-Latn-ME', { hour: '2-digit', minute: '2-digit', second: '2-digit' }); } catch { return iso; }
};
const pct = (x: number | null) => (x === null ? '—' : `${Math.round(x * 100)}%`);
const SOURCE_LABEL: Record<string, string> = { learned: 'naučeno', profile: 'profil', default: 'opšti raspored', note: 'napomena', model: 'model' };

interface Sample { t: number; redis: number | null; ably: number | null }

// ─── Gradivni elementi ──────────────────────────────────────────────
interface Theme {
  page: string; card: string; cardBorder: string; text: string; sub: string; faint: string;
  chip: string; row: string; btn: string; track: string;
}
const LIGHT: Theme = {
  page: 'bg-slate-50', card: 'bg-white', cardBorder: 'border-slate-200', text: 'text-slate-900', sub: 'text-slate-500',
  faint: 'text-slate-400', chip: 'bg-slate-100 text-slate-600', row: 'border-slate-100', btn: 'bg-white hover:bg-slate-50 border-slate-200 text-slate-700',
  track: 'bg-slate-100',
};
const DARK: Theme = {
  page: 'bg-slate-950', card: 'bg-white/[0.04]', cardBorder: 'border-white/10', text: 'text-white', sub: 'text-white/55',
  faint: 'text-white/35', chip: 'bg-white/10 text-white/70', row: 'border-white/5', btn: 'bg-white/5 hover:bg-white/10 border-white/10 text-white/80',
  track: 'bg-white/10',
};

function Sparkline({ values, color }: { values: Array<number | null>; color: string }) {
  const pts = values.filter((v): v is number => v !== null);
  if (pts.length < 2) return <div className="h-8" />;
  const max = Math.max(...pts, 1), min = Math.min(...pts, 0);
  const w = 100, h = 28;
  const step = w / (values.length - 1);
  const d = values
    .map((v, i) => (v === null ? null : `${(i * step).toFixed(1)},${(h - ((v - min) / (max - min || 1)) * (h - 4) - 2).toFixed(1)}`))
    .filter(Boolean)
    .join(' ');
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="h-8 w-full" aria-hidden>
      <polyline points={d} fill="none" stroke={color} strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function Panel({ t, title, icon, tone, children, right }: {
  t: Theme; title: string; icon: React.ReactNode; tone?: 'ok' | 'warn' | 'bad'; children: React.ReactNode; right?: React.ReactNode;
}) {
  const ring = tone === 'bad' ? 'ring-1 ring-red-500/40' : tone === 'warn' ? 'ring-1 ring-amber-500/40' : '';
  return (
    <section className={`rounded-2xl border ${t.card} ${t.cardBorder} ${ring} p-5 shadow-sm`}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className={`flex items-center gap-2 text-sm font-semibold ${t.text}`}>
          <span className={t.sub}>{icon}</span>{title}
        </h2>
        {right}
      </div>
      {children}
    </section>
  );
}

function Row({ t, label, value, bad }: { t: Theme; label: string; value: React.ReactNode; bad?: boolean }) {
  return (
    <div className={`flex items-center justify-between gap-3 border-b py-1.5 text-sm last:border-0 ${t.row}`}>
      <span className={t.sub}>{label}</span>
      <span className={`text-right font-medium ${bad ? 'text-red-500' : t.text}`}>{value}</span>
    </div>
  );
}

function Pill({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${ok ? 'bg-emerald-500/15 text-emerald-500' : 'bg-red-500/15 text-red-500'}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${ok ? 'bg-emerald-500' : 'bg-red-500 animate-pulse'}`} />{children}
    </span>
  );
}

function Bar({ t, ratio, color }: { t: Theme; ratio: number; color: string }) {
  return (
    <div className={`h-1.5 w-full overflow-hidden rounded-full ${t.track}`}>
      <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(100, Math.max(0, ratio * 100))}%`, background: color }} />
    </div>
  );
}

function Kpi({ t, label, value, unit, sub, spark, color, bad }: {
  t: Theme; label: string; value: React.ReactNode; unit?: string; sub?: React.ReactNode; spark?: Array<number | null>; color: string; bad?: boolean;
}) {
  return (
    <div className={`rounded-2xl border ${t.card} ${t.cardBorder} p-4 shadow-sm ${bad ? 'ring-1 ring-red-500/40' : ''}`}>
      <div className={`text-[11px] font-semibold uppercase tracking-wider ${t.faint}`}>{label}</div>
      <div className={`mt-1 flex items-baseline gap-1 ${bad ? 'text-red-500' : t.text}`}>
        <span className="text-3xl font-bold tabular-nums">{value}</span>
        {unit && <span className={`text-sm ${t.sub}`}>{unit}</span>}
      </div>
      {spark && <div className="mt-1"><Sparkline values={spark} color={color} /></div>}
      {sub && <div className={`mt-1 text-xs ${t.sub}`}>{sub}</div>}
    </div>
  );
}

function IssueRow({ t, issue }: { t: Theme; issue: HealthIssue }) {
  const cfg = {
    error: { icon: <XCircle size={18} className="text-red-500" />, bg: 'bg-red-500/10', label: 'Greška' },
    warn: { icon: <AlertTriangle size={18} className="text-amber-500" />, bg: 'bg-amber-500/10', label: 'Pažnja' },
    info: { icon: <Info size={18} className="text-sky-500" />, bg: 'bg-sky-500/10', label: 'Info' },
  }[issue.severity];
  return (
    <li className={`flex gap-3 rounded-xl px-3.5 py-3 ${cfg.bg}`}>
      <span className="mt-0.5 shrink-0">{cfg.icon}</span>
      <div className="min-w-0">
        <div className={`text-sm font-semibold ${t.text}`}>{issue.title}</div>
        {issue.hint && <div className={`mt-0.5 text-xs ${t.sub}`}>{issue.hint}</div>}
      </div>
    </li>
  );
}

function LearningBlock({ t, title, k }: { t: Theme; title: string; k: LearningKindSummary }) {
  return (
    <div className={`rounded-xl border ${t.cardBorder} p-3`}>
      <div className="flex items-center justify-between">
        <span className={`text-sm font-semibold ${t.text}`}>{title}</span>
        {k.distrust ? <Pill ok={false}>šabloni isključeni</Pill> : <Pill ok>u upotrebi</Pill>}
      </div>
      <div className={`mt-2 text-xs ${t.sub}`}>
        Tačnost prijedloga (4 sedmice): <b className={t.text}>{pct(k.hitRate)}</b> od {k.evaluated} ručnih dodjela
        {k.applied > 0 && <> · {k.applied} primijenjeno</>}
      </div>
      {k.bySource.length > 0 && (
        <div className="mt-2 space-y-1.5">
          {k.bySource.map(s => (
            <div key={s.source}>
              <div className={`flex justify-between text-[11px] ${t.sub}`}>
                <span>{SOURCE_LABEL[s.source] ?? s.source}</span><span>{pct(s.rate)} ({s.n})</span>
              </div>
              <Bar t={t} ratio={s.rate ?? 0} color="#38bdf8" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Glavna komponenta ───────────────────────────────────────────────
export default function AdminHealthPage() {
  const [data, setData] = useState<HealthResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastFetchedAt, setLastFetchedAt] = useState<Date | null>(null);
  const [refreshMs, setRefreshMs] = useState(60_000);
  const [isDark, setIsDark] = useState(false);
  const [history, setHistory] = useState<Sample[]>([]);
  const [copied, setCopied] = useState(false);
  const inFlight = useRef(false);

  // Tema: isti ključ kao assign-checkin; bez zapisa → prati sistem.
  useEffect(() => {
    try {
      const stored = localStorage.getItem('theme');
      setIsDark(stored ? stored === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches);
    } catch { /* ostaje svijetla */ }
  }, []);
  const toggleTheme = () => {
    setIsDark(d => {
      try { localStorage.setItem('theme', d ? 'light' : 'dark'); } catch { /* ignoriši */ }
      return !d;
    });
  };

  // Daljinski restart monitora (dugme u tabeli "Monitori"): stanje po id-u monitora.
  const [cmds, setCmds] = useState<Record<string, { status: 'sending' | 'sent' | 'error'; at: number; msg?: string }>>({});
  const fetchHealthRef = useRef<() => void>(() => {});

  const sendRestart = useCallback(async (k: KioskInfo, isNight: boolean) => {
    const what = k.canRestart ? 'Restartovati aplikaciju na' : 'Ponovo učitati stranicu na';
    const note = isNight ? '\n\nNapomena: noćni režim je aktivan — monitor je možda isključen iz realtime veze i neće primiti komandu.' : '';
    if (!window.confirm(`${what} monitoru ${k.id}?${note}`)) return;
    setCmds(p => ({ ...p, [k.id]: { status: 'sending', at: Date.now() } }));
    try {
      const res = await fetch('/api/admin/kiosk-command', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: k.id, cmd: 'restart' }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error || `HTTP ${res.status}`);
      setCmds(p => ({ ...p, [k.id]: { status: 'sent', at: Date.now() } }));
      // monitor se nakon restarta odmah javlja — osvježi pregled da se potvrda vidi bez čekanja
      setTimeout(() => fetchHealthRef.current(), 25_000);
      setTimeout(() => fetchHealthRef.current(), 60_000);
    } catch (e) {
      setCmds(p => ({ ...p, [k.id]: { status: 'error', at: Date.now(), msg: e instanceof Error ? e.message : 'greška' } }));
    }
  }, []);

  const fetchHealth = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setLoading(true);
    try {
      const res = await fetch('/api/admin/health', { cache: 'no-store' });
      if (res.status === 401) { window.location.href = '/admin/login'; return; }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: HealthResponse = await res.json();
      setData(json);
      setError(null);
      setLastFetchedAt(new Date());
      setHistory(h => [...h, { t: Date.now(), redis: json.checks.redis.latencyMs, ably: json.checks.ably.latencyMs }].slice(-HISTORY_MAX));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nepoznata greška');
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchHealthRef.current = fetchHealth; }, [fetchHealth]);
  useEffect(() => { fetchHealth(); }, [fetchHealth]);

  useEffect(() => {
    const onVisibility = () => { if (document.visibilityState === 'visible') fetchHealth(); };
    document.addEventListener('visibilitychange', onVisibility);
    let id: ReturnType<typeof setInterval> | null = null;
    if (refreshMs > 0) id = setInterval(() => { if (document.visibilityState === 'visible') fetchHealth(); }, refreshMs);
    return () => { if (id) clearInterval(id); document.removeEventListener('visibilitychange', onVisibility); };
  }, [refreshMs, fetchHealth]);

  const copyDiagnostics = async () => {
    if (!data) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(data, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard nedostupan */ }
  };

  const t = isDark ? DARK : LIGHT;
  const c = data?.checks;
  const hero = useMemo(() => {
    if (!data) return null;
    if (data.status === 'healthy') return { color: 'from-emerald-500 to-teal-600', icon: <CheckCircle2 size={34} />, title: 'Sve radi normalno', sub: 'Nema pronađenih problema.' };
    if (data.status === 'down') return { color: 'from-red-600 to-rose-700', icon: <XCircle size={34} />, title: 'Sistem ima ozbiljan problem', sub: 'Redis nije dostupan — vidi detalje ispod.' };
    const n = data.issues.filter(i => i.severity !== 'info').length;
    return { color: 'from-amber-500 to-orange-600', icon: <AlertTriangle size={34} />, title: 'Potrebna je pažnja', sub: `${n} ${n === 1 ? 'stavka traži' : 'stavke traže'} provjeru.` };
  }, [data]);

  const memRatio = c?.redis.usedMemoryBytes && c.redis.maxMemoryBytes ? c.redis.usedMemoryBytes / c.redis.maxMemoryBytes : null;
  const deskOpen = c?.assignments.open.filter(o => o.type === 'desk') ?? [];
  const gateOpen = c?.assignments.open.filter(o => o.type === 'gate') ?? [];

  return (
    <div className={`min-h-screen ${t.page} ${t.text}`}>
      {/* Gornja traka */}
      <header className={`sticky top-0 z-20 border-b backdrop-blur ${isDark ? 'border-white/10 bg-slate-950/80' : 'border-slate-200 bg-slate-50/85'}`}>
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <a href="/admin/assign-checkin" className={`flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-semibold transition active:scale-95 ${t.btn}`}>
              <ArrowLeft size={14} /> Dodjele
            </a>
            <div>
              <h1 className="flex items-center gap-2 text-base font-bold leading-tight sm:text-lg">
                <Activity size={18} className="text-sky-500" /> Stanje sistema
              </h1>
              <p className={`text-xs ${t.sub}`}>FIDS TIV · dijagnostika</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className={`flex items-center gap-2 text-xs ${t.sub}`}>
              Osvježavanje
              <select
                value={refreshMs}
                onChange={e => setRefreshMs(Number(e.target.value))}
                className={`rounded-lg border px-2 py-1.5 text-xs font-medium ${t.btn}`}
              >
                {REFRESH_OPTIONS.map(o => <option key={o.ms} value={o.ms}>{o.label}</option>)}
              </select>
            </label>
            <button onClick={copyDiagnostics} disabled={!data} title="Kopiraj dijagnostiku (JSON)"
              className={`flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-semibold transition active:scale-95 disabled:opacity-40 ${t.btn}`}>
              {copied ? <Check size={14} className="text-emerald-500" /> : <Copy size={14} />}{copied ? 'Kopirano' : 'Kopiraj'}
            </button>
            <button onClick={fetchHealth} disabled={loading}
              className="flex items-center gap-1.5 rounded-xl bg-sky-500 px-3.5 py-2 text-xs font-semibold text-white transition hover:bg-sky-600 active:scale-95 disabled:opacity-60">
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Osvježi
            </button>
            <button onClick={toggleTheme} className={`rounded-xl border p-2.5 transition active:scale-95 ${t.btn}`} aria-label="Promijeni temu">
              {isDark ? <Sun size={15} className="text-yellow-400" /> : <Moon size={15} />}
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-5 px-4 py-6 sm:px-6">
        {error && (
          <div className="rounded-2xl border border-red-500/40 bg-red-500/10 px-5 py-4 text-sm text-red-500">
            Provjera nije uspjela: {error}. {data && 'Prikazani su podaci iz prethodne provjere.'}
          </div>
        )}

        {loading && !data && (
          <div className={`rounded-2xl border ${t.card} ${t.cardBorder} p-10 text-center ${t.sub}`}>Učitavanje…</div>
        )}

        {data && hero && c && (
          <>
            {/* Status */}
            <div className={`flex flex-wrap items-center justify-between gap-4 rounded-2xl bg-gradient-to-r ${hero.color} px-6 py-5 text-white shadow-md`}>
              <div className="flex items-center gap-4">
                <div className="rounded-full bg-white/20 p-2.5">{hero.icon}</div>
                <div>
                  <div className="text-xl font-bold">{hero.title}</div>
                  <div className="text-sm text-white/85">{hero.sub}</div>
                </div>
              </div>
              <div className="text-right text-xs text-white/85">
                <div className="flex items-center justify-end gap-1.5"><Clock size={13} /> Aerodrom {data.system.airportTime}{data.system.isNight && ' · noćni režim'}</div>
                <div className="mt-0.5">Provjera {fmtTime(data.checkedAt)} · {data.durationMs} ms</div>
              </div>
            </div>

            {/* Šta traži pažnju */}
            {data.issues.length > 0 && (
              <Panel t={t} title="Šta traži pažnju" icon={<AlertTriangle size={16} />}>
                <ul className="space-y-2">{data.issues.map((i, k) => <IssueRow key={k} t={t} issue={i} />)}</ul>
              </Panel>
            )}

            {/* KPI */}
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Kpi t={t} label="Redis odziv" value={c.redis.latencyMs ?? '—'} unit="ms" color="#10b981"
                bad={!c.redis.ok} spark={history.map(h => h.redis)} sub={c.redis.ok ? 'veza ispravna' : 'nedostupan'} />
              <Kpi t={t} label="Ably odziv" value={c.ably.latencyMs ?? '—'} unit="ms" color="#8b5cf6"
                bad={!c.ably.ok} spark={history.map(h => h.ably)} sub={c.ably.ok ? 'realtime dostupan' : (c.ably.error ?? 'nedostupan')} />
              <Kpi t={t} label="Podaci o letovima" value={c.flightData.ageMinutes ?? '—'} unit="min star" color="#0ea5e9"
                bad={!c.flightData.ok} sub={`${c.flightData.totalFlights} letova · ${c.flightData.source}`} />
              <Kpi t={t} label="Otvorene dodjele" value={c.assignments.openDesks + c.assignments.openGates} color="#f59e0b"
                bad={c.assignments.staleAssignments.length > 0}
                sub={`${c.assignments.openDesks} šaltera · ${c.assignments.openGates} gate-ova`} />
            </div>

            {/* Detalji */}
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <Panel t={t} title="Redis" icon={<Database size={16} />} tone={c.redis.ok ? 'ok' : 'bad'} right={<Pill ok={c.redis.ok}>{c.redis.ok ? 'radi' : 'problem'}</Pill>}>
                <Row t={t} label="Circuit breaker" value={c.redis.circuitOpen ? 'OTVOREN' : 'zatvoren'} bad={c.redis.circuitOpen} />
                <Row t={t} label="Skorašnji neuspjesi" value={c.redis.recentFailures} />
                <Row t={t} label="Verzija / rad" value={`${c.redis.version ?? '—'} · ${fmtUptime(c.redis.uptimeSec)}`} />
                <Row t={t} label="Ključeva u bazi" value={c.redis.keys ?? '—'} />
                <Row t={t} label="Klijenata" value={c.redis.connectedClients ?? '—'} />
                <Row t={t} label="Pogodak keša (hit rate)" value={pct(c.redis.hitRate)} />
                <div className="pt-2">
                  <div className={`mb-1 flex justify-between text-xs ${t.sub}`}>
                    <span>Memorija</span>
                    <span>{fmtBytes(c.redis.usedMemoryBytes)}{c.redis.maxMemoryBytes ? ` / ${fmtBytes(c.redis.maxMemoryBytes)}` : ''}</span>
                  </div>
                  {memRatio !== null && <Bar t={t} ratio={memRatio} color={memRatio > 0.8 ? '#ef4444' : '#10b981'} />}
                </div>
              </Panel>

              <Panel t={t} title="Podaci o letovima i realtime" icon={<Plane size={16} />} tone={c.flightData.ok && c.ably.ok ? 'ok' : 'bad'}>
                <Row t={t} label="Izvor" value={c.flightData.source} />
                <Row t={t} label="Offline mod" value={c.flightData.isOfflineMode ? 'DA' : 'ne'} bad={c.flightData.isOfflineMode} />
                <Row t={t} label="Odlasci / dolasci" value={`${c.flightData.departures} / ${c.flightData.arrivals}`} />
                <Row t={t} label="Zadnje ažuriranje" value={`${fmtTime(c.flightData.lastUpdated)}${c.flightData.ageMinutes !== null ? ` (prije ${fmtMinutes(c.flightData.ageMinutes)})` : ''}`} />
                <Row t={t} label="Ably" value={<Pill ok={c.ably.ok}>{c.ably.ok ? `${c.ably.latencyMs} ms` : 'nedostupan'}</Pill>} />
                {c.flightData.warning && (
                  <p className="mt-2 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-600">{c.flightData.warning}</p>
                )}
              </Panel>
            </div>

            {/* Otvorene dodjele */}
            <Panel t={t} title="Otvorene dodjele" icon={<ListChecks size={16} />} tone={c.assignments.staleAssignments.length ? 'warn' : 'ok'}
              right={<span className={`text-xs ${t.sub}`}>zaboravljeno: šalter &gt; 4 h, gate &gt; 3 h</span>}>
              {c.assignments.open.length === 0 ? (
                <p className={`py-2 text-sm ${t.sub}`}>Trenutno nema otvorenih šaltera ni gate-ova.</p>
              ) : (
                <div className="grid grid-cols-1 gap-x-8 gap-y-4 md:grid-cols-2">
                  {([['Šalteri', deskOpen, 240], ['Gate-ovi', gateOpen, 180]] as const).map(([label, list, limit]) => (
                    <div key={label}>
                      <div className={`mb-1 text-[11px] font-semibold uppercase tracking-wider ${t.faint}`}>{label} ({list.length})</div>
                      {list.length === 0 && <p className={`text-sm ${t.sub}`}>—</p>}
                      {list.map(o => (
                        <div key={`${o.type}-${o.resourceId}`} className={`flex items-center gap-3 border-b py-1.5 last:border-0 ${t.row}`}>
                          <span className={`w-8 shrink-0 rounded-md px-1.5 py-0.5 text-center text-xs font-bold ${t.chip}`}>{o.resourceId}</span>
                          <span className="w-20 shrink-0 text-sm font-semibold">{o.flightNumber || '—'}</span>
                          <div className="min-w-0 flex-1"><Bar t={t} ratio={o.openSinceMinutesAgo / limit} color={o.stale ? '#f59e0b' : '#38bdf8'} /></div>
                          <span className={`w-20 shrink-0 text-right text-xs tabular-nums ${o.stale ? 'font-semibold text-amber-500' : t.sub}`}>{fmtMinutes(o.openSinceMinutesAgo)}</span>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </Panel>

            {/* Monitori (kiosci) */}
            <Panel t={t} title="Monitori" icon={<Monitor size={16} />}
              tone={c.kiosks.some(k => k.status === 'silent') ? 'bad' : c.kiosks.some(k => k.status === 'mismatch') ? 'warn' : 'ok'}
              right={<span className={`text-xs ${t.sub}`}>javljaju se uz svaku provjeru (~5 min) · verzija: <span className="font-mono">{data.system.build.slice(0, 7)}</span></span>}>
              {c.kiosks.length === 0 ? (
                <p className={`py-2 text-sm ${t.sub}`}>Još nijedan monitor nije javio status. Javljaju se čim učitaju ovu verziju aplikacije (nakon reload-a ili sljedećeg swap-a).</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className={t.faint}>
                      <tr><th className="py-1 pr-3 font-medium">Monitor</th><th className="pr-3 font-medium">Stanje</th><th className="pr-3 font-medium">Prikazuje</th><th className="pr-3 font-medium">Zadnji put</th><th className="pr-3 font-medium">Klijent</th><th className="pr-3 font-medium">Verzija</th><th className="pr-3 font-medium">Greška</th><th className="font-medium">Akcija</th></tr>
                    </thead>
                    <tbody>
                      {c.kiosks.map(k => {
                        const color = k.status === 'silent' ? 'text-red-500' : k.status === 'mismatch' ? 'text-amber-500' : k.status === 'night' ? t.sub : 'text-emerald-500';
                        const label = k.status === 'silent' ? 'ne javlja se' : k.status === 'mismatch' ? 'razlika' : k.status === 'night' ? 'noć' : 'ok';
                        const ago = k.ageSec < 90 ? `${k.ageSec} s` : k.ageSec < 5400 ? `${Math.round(k.ageSec / 60)} min` : fmtMinutes(Math.round(k.ageSec / 60));
                        return (
                          <tr key={k.id} className={`border-t ${t.row}`}>
                            <td className="py-1.5 pr-3 font-mono font-semibold">{k.id}</td>
                            <td className={`pr-3 font-semibold ${color}`}>{label}</td>
                            <td className="pr-3">{k.view === 'open' ? (k.flight || 'otvoren') : k.view}{k.expected ? <span className="text-amber-500"> (treba {k.expected})</span> : null}</td>
                            <td className="pr-3 tabular-nums">prije {ago}</td>
                            <td className="pr-3">{k.client === 'electron' ? 'Electron' : 'Chrome'}</td>
                            <td className={`pr-3 font-mono ${k.buildCurrent ? '' : 'text-amber-500'}`}>{k.build ? k.build.slice(0, 7) : '—'}{k.buildCurrent ? '' : ' ↻'}</td>
                            <td className={`max-w-[18rem] truncate pr-3 ${k.err ? 'text-red-400' : t.faint}`} title={k.err}>{k.err || '—'}</td>
                            <td className="whitespace-nowrap">
                              {(() => {
                                const cmd = cmds[k.id];
                                const seenAt = Date.parse(data.checkedAt) - k.ageSec * 1000;
                                const confirmed = !!cmd && cmd.status === 'sent' && seenAt > cmd.at && k.pageAgeMin < 2;
                                const waiting = !!cmd && cmd.status === 'sent' && !confirmed;
                                const noReply = waiting && Date.parse(data.checkedAt) - cmd!.at > 3 * 60_000;
                                return (
                                  <span className="flex items-center gap-2">
                                    <button type="button" disabled={cmd?.status === 'sending'} onClick={() => sendRestart(k, data.system.isNight)}
                                      className={`rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition active:scale-95 disabled:opacity-50 ${t.btn}`}>
                                      {cmd?.status === 'sending' ? 'šalje…' : k.canRestart ? 'Restart' : 'Reload'}
                                    </button>
                                    {confirmed && <span className="text-emerald-500">✓ ponovo pokrenut</span>}
                                    {waiting && !noReply && <span className={t.sub}>poslano…</span>}
                                    {noReply && <span className="text-amber-500">bez odgovora</span>}
                                    {cmd?.status === 'error' && <span className="text-red-500" title={cmd.msg}>nije poslano</span>}
                                  </span>
                                );
                              })()}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {/* Učenje */}
              <Panel t={t} title="AI sugestija i učenje" icon={<Brain size={16} />}>
                {c.learning ? (
                  <div className="space-y-3">
                    <div className={`flex gap-4 text-xs ${t.sub}`}>
                      <span>Brojača: <b className={t.text}>{c.learning.counterFields}</b></span>
                      <span>Primjera za model: <b className={t.text}>{c.learning.exampleCount}</b></span>
                    </div>
                    <LearningBlock t={t} title="Šalteri" k={c.learning.desk} />
                    <LearningBlock t={t} title="Gate-ovi" k={c.learning.gate} />
                  </div>
                ) : (
                  <p className={`text-sm ${t.sub}`}>Podaci o učenju nisu dostupni (Redis).</p>
                )}
              </Panel>

              {/* Sistem */}
              <Panel t={t} title="Sistem i deployment" icon={<Server size={16} />}>
                <Row t={t} label="Okruženje" value={data.system.environment ?? '—'} />
                <Row t={t} label="Region" value={data.system.region ?? '—'} />
                <Row t={t} label="Commit" value={data.system.commit ? <span className="font-mono">{data.system.commit}</span> : '—'} />
                {data.system.commitMessage && <Row t={t} label="Poruka" value={<span className="text-xs">{data.system.commitMessage}</span>} />}
                <Row t={t} label="Node" value={data.system.nodeVersion} />
                <Row t={t} label="Instanca radi" value={fmtUptime(data.system.uptimeSec)} />
                <Row t={t} label="Memorija instance" value={`${data.system.memoryMb} MB`} />
                <Row t={t} label="Vrijeme aerodroma" value={`${data.system.airportTime}${data.system.isNight ? ' · noćni režim' : ''}`} />
              </Panel>
            </div>

            {/* Prečice */}
            <div className="flex flex-wrap gap-2">
              {[
                { href: '/admin/assign-checkin', label: 'Dodjele šaltera i gate-ova' },
                { href: '/admin', label: 'Admin početna' },
                { href: '/admin/pa', label: 'PA obavještenja' },
              ].map(l => (
                <a key={l.href} href={l.href} className={`rounded-xl border px-3.5 py-2 text-xs font-semibold transition active:scale-95 ${t.btn}`}>{l.label}</a>
              ))}
            </div>
          </>
        )}

        {lastFetchedAt && (
          <p className={`pb-4 text-center text-xs ${t.faint}`}>
            Zadnje osvježeno u {lastFetchedAt.toLocaleTimeString('sr-Latn-ME')} · {refreshMs > 0 ? `automatski svakih ${refreshMs / 1000} s dok je tab vidljiv` : 'automatsko osvježavanje isključeno'}
          </p>
        )}
      </main>
    </div>
  );
}
