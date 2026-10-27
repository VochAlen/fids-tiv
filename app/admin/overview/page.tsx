/* eslint-disable react-hooks/set-state-in-effect */
// app/admin/overview/page.tsx
//
// Pregled šaltera i gate-ova: jedan ekran sa mrežom svih resursa — ko je otvoren, koji let, koliko dugo
// i da li monitor prikazuje isto. Osvježava se svakih 30 s samo dok je tab vidljiv.
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, Moon, RefreshCw, Sun } from 'lucide-react';
import type { OverviewResponse, OverviewResource } from '@/lib/overview-types';
import type { KioskInfo } from '@/lib/kiosk-health';

const REFRESH_MS = 30_000;
const DESK_IDS = [...Array.from({ length: 12 }, (_, i) => String(i + 1)), ...Array.from({ length: 6 }, (_, i) => String(i + 21))];
const GATE_IDS = [...Array.from({ length: 5 }, (_, i) => String(i + 2)), ...Array.from({ length: 10 }, (_, i) => String(i + 21))];

const fmtSince = (min: number) => (min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${min % 60} min`);
const byNum = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });

const KIOSK_LABEL: Record<KioskInfo['status'], string> = {
  ok: 'monitor OK', silent: 'monitor se ne javlja', mismatch: 'monitor prikazuje drugo', stale: 'zastarjeli podaci', night: 'noć',
};

function Card({ label, res, kiosk, dark }: { label: string; res?: OverviewResource; kiosk?: KioskInfo; dark: boolean }) {
  const isOpen = res?.status === 'open';
  const bad = kiosk && (kiosk.status === 'silent' || kiosk.status === 'mismatch' || kiosk.status === 'stale');
  const border = bad ? 'border-red-500/70' : isOpen ? 'border-emerald-500/60' : dark ? 'border-white/10' : 'border-slate-200';
  const bg = isOpen ? (dark ? 'bg-emerald-500/10' : 'bg-emerald-50') : dark ? 'bg-white/[0.04]' : 'bg-white';
  const sub = dark ? 'text-white/55' : 'text-slate-500';
  return (
    <div className={`rounded-xl border-2 p-3 ${border} ${bg}`}>
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold">{label}</span>
        <span className={`text-[11px] font-medium ${isOpen ? 'text-emerald-500' : sub}`}>{isOpen ? 'OTVOREN' : 'zatvoren'}</span>
      </div>
      <div className="mt-1 text-lg font-bold tabular-nums">{isOpen ? res?.flight || '—' : '—'}</div>
      <div className={`text-xs ${sub}`}>{isOpen && res ? `od ${fmtSince(res.sinceMin)}` : ' '}</div>
      <div className={`mt-1 text-xs ${bad ? 'font-semibold text-red-500' : sub}`}>
        {kiosk ? (
          <>
            {KIOSK_LABEL[kiosk.status]}
            {kiosk.status === 'mismatch' && kiosk.expected ? ` (treba ${kiosk.expected})` : ''}
            {kiosk.status === 'silent' ? ` — ${Math.round(kiosk.ageSec / 60)} min` : ''}
          </>
        ) : 'bez izvještaja'}
      </div>
    </div>
  );
}

export default function OverviewPage() {
  const [data, setData] = useState<OverviewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [dark, setDark] = useState(false);
  const inFlight = useRef(false);

  useEffect(() => {
    try { setDark(localStorage.getItem('theme') === 'dark'); } catch { /* ignoriši */ }
  }, []);

  const load = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setLoading(true);
    try {
      const res = await fetch('/api/admin/overview', { cache: 'no-store' });
      if (res.status === 401) { window.location.href = '/admin/login'; return; }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Nepoznata greška');
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const onVis = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', onVis);
    const id = setInterval(() => { if (document.visibilityState === 'visible') load(); }, REFRESH_MS);
    return () => { document.removeEventListener('visibilitychange', onVis); clearInterval(id); };
  }, [load]);

  const kioskMap = new Map((data?.kiosks ?? []).map((k) => [k.id, k]));
  const deskIds = [...new Set([...DESK_IDS, ...Object.keys(data?.desks ?? {})])].sort(byNum);
  const gateIds = [...new Set([...GATE_IDS, ...Object.keys(data?.gates ?? {})])].sort(byNum);
  const openDesks = Object.values(data?.desks ?? {}).filter((r) => r.status === 'open').length;
  const openGates = Object.values(data?.gates ?? {}).filter((r) => r.status === 'open').length;
  const problems = (data?.kiosks ?? []).filter((k) => k.status === 'silent' || k.status === 'mismatch' || k.status === 'stale').length;

  return (
    <div className={`min-h-screen p-4 sm:p-6 ${dark ? 'bg-slate-950 text-white' : 'bg-slate-50 text-slate-900'}`}>
      <div className="mx-auto max-w-7xl">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <a href="/admin/health" className="inline-flex items-center gap-1 text-sm opacity-70 hover:opacity-100"><ArrowLeft size={16} /> Zdravlje sistema</a>
          <h1 className="text-xl font-bold">Pregled šaltera i gate-ova</h1>
          <div className="ml-auto flex items-center gap-2">
            <span className="text-xs opacity-60">{data ? new Date(data.checkedAt).toLocaleTimeString('sr-Latn-ME') : ''}</span>
            <button onClick={load} className="rounded-lg border border-current/20 p-2 opacity-70 hover:opacity-100" aria-label="Osvježi"><RefreshCw size={16} className={loading ? 'animate-spin' : ''} /></button>
            <button
              onClick={() => { const d = !dark; setDark(d); try { localStorage.setItem('theme', d ? 'dark' : 'light'); } catch { /* ignoriši */ } }}
              className="rounded-lg border border-current/20 p-2 opacity-70 hover:opacity-100" aria-label="Tema"
            >{dark ? <Sun size={16} /> : <Moon size={16} />}</button>
          </div>
        </div>

        {error && <div className="mb-4 rounded-lg border border-red-500/50 bg-red-500/10 p-3 text-sm text-red-500">Greška: {error}</div>}
        {data && !data.ok && <div className="mb-4 rounded-lg border border-amber-500/50 bg-amber-500/10 p-3 text-sm text-amber-600">Stanje dodjela nije moglo biti pročitano — prikaz je nepotpun.</div>}
        {data?.night && <div className="mb-4 rounded-lg border border-slate-400/40 p-3 text-sm opacity-80">Noćni režim — monitori se ne provjeravaju.</div>}

        <div className="mb-6 flex flex-wrap gap-3 text-sm">
          <span className="rounded-full bg-emerald-500/15 px-3 py-1">Šalteri otvoreni: <b>{openDesks}</b></span>
          <span className="rounded-full bg-emerald-500/15 px-3 py-1">Gate-ovi otvoreni: <b>{openGates}</b></span>
          <span className={`rounded-full px-3 py-1 ${problems ? 'bg-red-500/15 text-red-500' : 'bg-slate-500/15'}`}>Problemi na monitorima: <b>{problems}</b></span>
        </div>

        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide opacity-60">Check-in šalteri</h2>
        <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
          {deskIds.map((id) => <Card key={id} label={`Check-in ${id}`} res={data?.desks[id]} kiosk={kioskMap.get(`checkin-${id}`)} dark={dark} />)}
        </div>

        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide opacity-60">Gate-ovi</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
          {gateIds.map((id) => <Card key={id} label={`Gate ${id}`} res={data?.gates[id]} kiosk={kioskMap.get(`gate-${id}`)} dark={dark} />)}
        </div>
      </div>
    </div>
  );
}
