/* eslint-disable react-hooks/set-state-in-effect */
// app/admin/overview/page.tsx
//
// Pregled šaltera i gate-ova: jedan ekran sa mrežom svih resursa — ko je otvoren, koji let, koliko dugo
// i da li monitor prikazuje isto. Osvježava se svakih 30 s samo dok je tab vidljiv.
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, ArrowLeft, Clock, Moon, RefreshCw, Sun, Trash2 } from 'lucide-react';
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

type Busy = 'sending' | 'sent' | 'error';

interface CardProps {
  label: string;
  res?: OverviewResource;
  kiosk?: KioskInfo;
  dark: boolean;
  reload: Busy | undefined;
  removing: boolean;
  onReload: () => void;
  onRemove: () => void;
}

function Card({ label, res, kiosk, dark, reload, removing, onReload, onRemove }: CardProps) {
  const isOpen = res?.status === 'open';
  const bad = kiosk && (kiosk.status === 'silent' || kiosk.status === 'mismatch' || kiosk.status === 'stale');
  const stale = isOpen ? res?.stale : undefined;
  const border = bad ? 'border-red-500/70' : stale ? 'border-amber-400' : isOpen ? 'border-emerald-500/60' : dark ? 'border-white/10' : 'border-slate-200';
  const bg = stale ? (dark ? 'bg-amber-400/15' : 'bg-amber-100') : isOpen ? (dark ? 'bg-emerald-500/10' : 'bg-emerald-50') : dark ? 'bg-white/[0.04]' : 'bg-white';
  const sub = dark ? 'text-white/55' : 'text-slate-500';
  return (
    <div className={`flex flex-col rounded-xl border-2 p-3 ${border} ${bg}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold">{label}</span>
        <span className="flex items-center gap-2">
          <span className={`text-[11px] font-medium ${isOpen ? 'text-emerald-500' : sub}`}>{isOpen ? 'OTVOREN' : 'zatvoren'}</span>
          {/* Ukloni let: mala ikonica u uglu, namjerno daleko od dugmeta Reload i uvijek sa potvrdom */}
          {isOpen && (
            <button type="button" onClick={onRemove} disabled={removing} title={`Ukloni let ${res?.flight ?? ''} sa ovog resursa`} aria-label="Ukloni let"
              className="rounded-md border border-red-500/40 p-1 text-red-500 transition hover:bg-red-500/15 disabled:opacity-40">
              <Trash2 size={14} className={removing ? 'animate-pulse' : ''} />
            </button>
          )}
        </span>
      </div>
      <div className="mt-1 text-lg font-bold tabular-nums">{isOpen ? res?.flight || '—' : '—'}</div>
      <div className={`text-xs ${sub}`}>{isOpen && res ? `od ${fmtSince(res.sinceMin)}` : ' '}</div>
      {stale && (
        <div className={`mt-1 flex items-start gap-1 rounded-md bg-amber-400/25 px-1.5 py-1 text-[11px] font-semibold leading-snug ${dark ? 'text-amber-300' : 'text-amber-700'}`}>
          <Clock size={12} className="mt-0.5 shrink-0" />
          <span>{stale === 'departed' ? 'Let je poletio — ukloni dodjelu?' : `Otvoreno već ${fmtSince(res?.sinceMin ?? 0)} — zaboravljeno?`}</span>
        </div>
      )}
      <div className={`mt-1 text-xs ${bad ? 'font-semibold text-red-500' : sub}`}>
        {kiosk ? (
          <>
            {KIOSK_LABEL[kiosk.status]}
            {kiosk.status === 'mismatch' && kiosk.expected ? ` (treba ${kiosk.expected})` : ''}
            {kiosk.status === 'silent' ? ` — ${Math.round(kiosk.ageSec / 60)} min` : ''}
          </>
        ) : 'bez izvještaja'}
      </div>
      {kiosk?.err && (
        <div className="mt-1 flex items-start gap-1 text-[11px] leading-snug text-red-500" title={kiosk.err}>
          <AlertTriangle size={12} className="mt-0.5 shrink-0" />
          <span className="line-clamp-2 break-words">Greška: {kiosk.err}</span>
        </div>
      )}
      {/* Reload: jasno istaknuto plavo dugme preko cijele širine kartice */}
      <button type="button" onClick={onReload} disabled={reload === 'sending'}
        className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-blue-500 active:scale-95 disabled:opacity-60">
        <RefreshCw size={16} className={reload === 'sending' ? 'animate-spin' : ''} />
        {reload === 'sending' ? 'Šalje…' : kiosk?.canRestart ? 'RESTART monitora' : 'RELOAD monitora'}
      </button>
      {reload === 'sent' && <div className="mt-1 text-center text-[11px] text-emerald-500">✓ komanda poslana</div>}
      {reload === 'error' && <div className="mt-1 text-center text-[11px] text-red-500">komanda nije poslana</div>}
    </div>
  );
}

export default function OverviewPage() {
  const [data, setData] = useState<OverviewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [dark, setDark] = useState(false);
  const inFlight = useRef(false);
  const [reloads, setReloads] = useState<Record<string, Busy>>({});
  const [removing, setRemoving] = useState<Record<string, boolean>>({});

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

  const sendReload = async (kioskId: string, label: string, canRestart: boolean) => {
    if (!window.confirm(`${canRestart ? 'Restartovati aplikaciju' : 'Ponovo učitati stranicu'} na monitoru: ${label}?`)) return;
    setReloads((p) => ({ ...p, [kioskId]: 'sending' }));
    try {
      const res = await fetch('/api/admin/kiosk-command', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: kioskId, cmd: 'restart' }) });
      if (res.status === 401) { window.location.assign('/admin/login'); return; }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setReloads((p) => ({ ...p, [kioskId]: 'sent' }));
      setTimeout(() => load(), 30_000);
    } catch {
      setReloads((p) => ({ ...p, [kioskId]: 'error' }));
    }
  };

  const removeFlight = async (type: 'desk' | 'gate', id: string, label: string, flight: string) => {
    if (!window.confirm(`Da li ste sigurni da želite ukloniti let ${flight || '(nepoznat)'} sa: ${label}?\n\nMonitor će prestati da prikazuje taj let.`)) return;
    const key = `${type}-${id}`;
    setRemoving((p) => ({ ...p, [key]: true }));
    try {
      const res = await fetch(`/api/test/${type}-status-override`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(type === 'desk' ? { deskNumber: id, action: 'clear' } : { gateNumber: id, action: 'clear' }),
      });
      if (res.status === 401) { window.location.assign('/admin/login'); return; }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await load();
    } catch (e) {
      window.alert(`Let nije uklonjen: ${e instanceof Error ? e.message : 'greška'}`);
    } finally {
      setRemoving((p) => ({ ...p, [key]: false }));
    }
  };

  const kioskMap = new Map((data?.kiosks ?? []).map((k) => [k.id, k]));
  const deskIds = [...new Set([...DESK_IDS, ...Object.keys(data?.desks ?? {})])].sort(byNum);
  const gateIds = [...new Set([...GATE_IDS, ...Object.keys(data?.gates ?? {})])].sort(byNum);
  const openDesks = Object.values(data?.desks ?? {}).filter((r) => r.status === 'open').length;
  const openGates = Object.values(data?.gates ?? {}).filter((r) => r.status === 'open').length;
  const staleCount = [...Object.values(data?.desks ?? {}), ...Object.values(data?.gates ?? {})].filter((r) => r.status === 'open' && r.stale).length;
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
          <span className={`rounded-full px-3 py-1 ${staleCount ? 'bg-amber-400/25 text-amber-700' : 'bg-slate-500/15'}`}>Moguće zaboravljene dodjele: <b>{staleCount}</b></span>
          <span className={`rounded-full px-3 py-1 ${problems ? 'bg-red-500/15 text-red-500' : 'bg-slate-500/15'}`}>Problemi na monitorima: <b>{problems}</b></span>
        </div>

        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide opacity-60">Check-in šalteri</h2>
        <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
          {deskIds.map((id) => {
            const k = kioskMap.get(`checkin-${id}`); const r = data?.desks[id]; const label = `Check-in ${id}`;
            return <Card key={id} label={label} res={r} kiosk={k} dark={dark} reload={reloads[`checkin-${id}`]} removing={!!removing[`desk-${id}`]}
              onReload={() => sendReload(`checkin-${id}`, label, !!k?.canRestart)} onRemove={() => removeFlight('desk', id, label, r?.flight ?? '')} />;
          })}
        </div>

        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide opacity-60">Gate-ovi</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
          {gateIds.map((id) => {
            const k = kioskMap.get(`gate-${id}`); const r = data?.gates[id]; const label = `Gate ${id}`;
            return <Card key={id} label={label} res={r} kiosk={k} dark={dark} reload={reloads[`gate-${id}`]} removing={!!removing[`gate-${id}`]}
              onReload={() => sendReload(`gate-${id}`, label, !!k?.canRestart)} onRemove={() => removeFlight('gate', id, label, r?.flight ?? '')} />;
          })}
        </div>
      </div>
    </div>
  );
}
