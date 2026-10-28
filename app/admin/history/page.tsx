// app/admin/history/page.tsx
//
// Istorija dodjela šaltera i gate-ova: ko je otvoren, koji let, od kad do kad. Zadnjih 7 dana, po danima, sa PDF preuzimanjem.
// Podaci se učitavaju samo pri otvaranju i promjeni dana (nema automatskog osvježavanja).
'use client';

import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, Download, Moon, RefreshCw, Sun } from 'lucide-react';
import { END_REASON_LABEL, fmtClock, fmtDuration, openState, type AssignInterval, type AssignSummary } from '@/lib/assign-log';

interface HistoryResponse { date: string; dates: string[]; intervals: AssignInterval[]; summary: AssignSummary; now: number }

const fmtDate = (d: string) => { const [y, m, day] = d.split('-'); return `${day}.${m}.${y}.`; };

function Table({ title, rows, label, dark, now }: { title: string; rows: AssignInterval[]; label: string; dark: boolean; now: number }) {
  const sub = dark ? 'text-white/55' : 'text-slate-500';
  return (
    <section className="mb-8">
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide opacity-60">{title} ({rows.length})</h2>
      <div className={`overflow-x-auto rounded-xl border ${dark ? 'border-white/10 bg-white/[0.04]' : 'border-slate-200 bg-white'}`}>
        <table className="w-full text-left text-sm">
          <thead className={sub}>
            <tr><th className="p-2">{label}</th><th className="p-2">Let</th><th className="p-2">Otvoreno</th><th className="p-2">Zatvoreno</th><th className="p-2">Trajanje</th><th className="p-2">Kraj</th><th className="p-2">Korisnik</th></tr>
          </thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={7} className={`p-3 ${sub}`}>Nema zabilježenih dodjela.</td></tr>}
            {rows.map((i, n) => (
              <tr key={`${i.y}${i.id}${i.start}${n}`} className={`border-t ${dark ? 'border-white/5' : 'border-slate-100'}`}>
                <td className="p-2 font-semibold tabular-nums">{i.id}</td>
                <td className="p-2 tabular-nums">{i.flight || '—'}</td>
                <td className="p-2 tabular-nums">{fmtClock(i.start)}</td>
                <td className="p-2 tabular-nums">{i.end !== null ? fmtClock(i.end) : openState(i, now) === 'open' ? <span className="text-emerald-500">još otvoreno</span> : <span className="text-amber-500">nije zabilježeno</span>}</td>
                <td className="p-2 tabular-nums">{i.end === null ? '—' : fmtDuration(Math.max(0, (i.end - i.start) / 60_000))}</td>
                <td className={`p-2 ${sub}`}>{i.endReason ? END_REASON_LABEL[i.endReason] : i.end === null && openState(i, now) === 'unknown' ? 'kraj nije zabilježen' : '—'}</td>
                <td className={`p-2 ${sub}`}>{i.openedBy ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default function HistoryPage() {
  const [data, setData] = useState<HistoryResponse | null>(null);
  const [date, setDate] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [dark, setDark] = useState(false);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { try { setDark(localStorage.getItem('theme') === 'dark'); } catch { /* ignoriši */ } }, []);

  const load = useCallback(async (d: string | null) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/history${d ? `?date=${d}` : ''}`, { cache: 'no-store' });
      if (res.status === 401) { window.location.href = '/admin/login'; return; }
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error || `HTTP ${res.status}`);
      setData(j as HistoryResponse);
      setDate((j as HistoryResponse).date);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Nepoznata greška');
    } finally {
      setLoading(false);
    }
  }, []);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(null); }, [load]);

  const desks = (data?.intervals ?? []).filter((i) => i.y === 'd');
  const gates = (data?.intervals ?? []).filter((i) => i.y === 'g');

  return (
    <div className={`min-h-screen p-4 sm:p-6 ${dark ? 'bg-slate-950 text-white' : 'bg-slate-50 text-slate-900'}`}>
      <div className="mx-auto max-w-5xl">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <a href="/admin/health" className="inline-flex items-center gap-1 text-sm opacity-70 hover:opacity-100"><ArrowLeft size={16} /> Zdravlje sistema</a>
          <h1 className="text-xl font-bold">Istorija dodjela</h1>
          <div className="ml-auto flex items-center gap-2">
            <button onClick={() => load(date)} className="rounded-lg border border-current/20 p-2 opacity-70 hover:opacity-100" aria-label="Osvježi"><RefreshCw size={16} className={loading ? 'animate-spin' : ''} /></button>
            <button onClick={() => { const d = !dark; setDark(d); try { localStorage.setItem('theme', d ? 'dark' : 'light'); } catch { /* ignoriši */ } }}
              className="rounded-lg border border-current/20 p-2 opacity-70 hover:opacity-100" aria-label="Tema">{dark ? <Sun size={16} /> : <Moon size={16} />}</button>
          </div>
        </div>

        {error && <div className="mb-4 rounded-lg border border-red-500/50 bg-red-500/10 p-3 text-sm text-red-500">Greška: {error}</div>}

        <div className="mb-4 flex flex-wrap items-center gap-2">
          {(data?.dates ?? []).map((d) => (
            <button key={d} onClick={() => load(d)}
              className={`rounded-lg border px-3 py-1.5 text-sm ${d === date ? 'border-yellow-400 bg-yellow-400/20 font-semibold' : dark ? 'border-white/15 hover:bg-white/10' : 'border-slate-200 bg-white hover:bg-slate-100'}`}>
              {fmtDate(d)}
            </button>
          ))}
          {date && (
            <a href={`/api/admin/history/pdf?date=${date}`} className="ml-auto inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500">
              <Download size={16} /> Preuzmi PDF ({fmtDate(date)})
            </a>
          )}
        </div>

        {data && (
          <div className="mb-6 flex flex-wrap gap-3 text-sm">
            <span className="rounded-full bg-slate-500/15 px-3 py-1">Check-in dodjela: <b>{data.summary.desks}</b></span>
            <span className="rounded-full bg-slate-500/15 px-3 py-1">Gate dodjela: <b>{data.summary.gates}</b></span>
            <span className="rounded-full bg-slate-500/15 px-3 py-1">Letova: <b>{data.summary.flights}</b></span>
          </div>
        )}

        <Table title="Check-in šalteri" rows={desks} label="Šalter" dark={dark} now={data?.now ?? 0} />
        <Table title="Gate-ovi" rows={gates} label="Gate" dark={dark} now={data?.now ?? 0} />
        <p className="text-xs opacity-50">Vrijeme je po aerodromskom satu. Istorija se čuva 7 dana. Dodjele otvorene prije pokretanja bilježenja ne vide se.</p>
      </div>
    </div>
  );
}
