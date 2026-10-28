// app/admin/access-log/page.tsx
//
// Istorija pristupa admin dijelu (zadnjih 30 dana): prijave, neuspjeli pokušaji i otvorene stranice, sa IP adresom, državom,
// operativnim sistemom i pregledačem. Učitava se samo pri otvaranju (dugme za osvježavanje); nema automatskog pozivanja.
'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Moon, RefreshCw, Sun } from 'lucide-react';
import { EVENT_LABEL, type AccessEvent, type AccessEventType } from '@/lib/access-log';

const FILTERS: Array<{ key: 'all' | AccessEventType | 'foreign'; label: string }> = [
  { key: 'all', label: 'Sve' },
  { key: 'login_ok', label: 'Prijave' },
  { key: 'login_fail', label: 'Neuspjele' },
  { key: 'open', label: 'Otvorene stranice' },
  { key: 'foreign', label: 'Van Crne Gore' },
];

const fmt = (t: number) => new Date(t).toLocaleString('sr-Latn-ME', { timeZone: 'Europe/Podgorica', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });

const isForeign = (e: AccessEvent) => e.cc !== 'ME';

export default function AccessLogPage() {
  const [events, setEvents] = useState<AccessEvent[]>([]);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]['key']>('all');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [dark, setDark] = useState(false);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { try { setDark(localStorage.getItem('theme') === 'dark'); } catch { /* ignoriši */ } }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/access-log', { cache: 'no-store' });
      if (res.status === 401) { window.location.href = '/admin/login'; return; }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setEvents((await res.json()).events as AccessEvent[]);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Nepoznata greška');
    } finally {
      setLoading(false);
    }
  }, []);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  const shown = useMemo(() => events.filter((e) => filter === 'all' ? true : filter === 'foreign' ? isForeign(e) : e.e === filter), [events, filter]);
  const stats = useMemo(() => ({
    ips: new Set(events.map((e) => e.ip)).size,
    fails: events.filter((e) => e.e === 'login_fail' || e.e === 'login_blocked').length,
    foreign: events.filter(isForeign).length,
  }), [events]);

  const sub = dark ? 'text-white/55' : 'text-slate-500';
  return (
    <div className={`min-h-screen p-4 sm:p-6 ${dark ? 'bg-slate-950 text-white' : 'bg-slate-50 text-slate-900'}`}>
      <div className="mx-auto max-w-6xl">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <a href="/admin/health" className="inline-flex items-center gap-1 text-sm opacity-70 hover:opacity-100"><ArrowLeft size={16} /> Zdravlje sistema</a>
          <h1 className="text-xl font-bold">Istorija pristupa</h1>
          <div className="ml-auto flex items-center gap-2">
            <button onClick={load} className="rounded-lg border border-current/20 p-2 opacity-70 hover:opacity-100" aria-label="Osvježi"><RefreshCw size={16} className={loading ? 'animate-spin' : ''} /></button>
            <button onClick={() => { const d = !dark; setDark(d); try { localStorage.setItem('theme', d ? 'dark' : 'light'); } catch { /* ignoriši */ } }}
              className="rounded-lg border border-current/20 p-2 opacity-70 hover:opacity-100" aria-label="Tema">{dark ? <Sun size={16} /> : <Moon size={16} />}</button>
          </div>
        </div>

        {error && <div className="mb-4 rounded-lg border border-red-500/50 bg-red-500/10 p-3 text-sm text-red-500">Greška: {error}</div>}

        <div className="mb-4 flex flex-wrap gap-3 text-sm">
          <span className="rounded-full bg-slate-500/15 px-3 py-1">Različitih IP adresa: <b>{stats.ips}</b></span>
          <span className={`rounded-full px-3 py-1 ${stats.fails ? 'bg-amber-500/20 text-amber-600' : 'bg-slate-500/15'}`}>Neuspjeli pokušaji: <b>{stats.fails}</b></span>
          <span className={`rounded-full px-3 py-1 ${stats.foreign ? 'bg-red-500/15 text-red-500' : 'bg-slate-500/15'}`}>Van Crne Gore: <b>{stats.foreign}</b></span>
        </div>

        <div className="mb-4 flex flex-wrap gap-2">
          {FILTERS.map((f) => (
            <button key={f.key} onClick={() => setFilter(f.key)}
              className={`rounded-lg border px-3 py-1.5 text-sm ${filter === f.key ? 'border-yellow-400 bg-yellow-400/20 font-semibold' : dark ? 'border-white/15 hover:bg-white/10' : 'border-slate-200 bg-white hover:bg-slate-100'}`}>{f.label}</button>
          ))}
        </div>

        <div className={`overflow-x-auto rounded-xl border ${dark ? 'border-white/10 bg-white/[0.04]' : 'border-slate-200 bg-white'}`}>
          <table className="w-full text-left text-sm">
            <thead className={sub}><tr>
              <th className="p-2">Vrijeme</th><th className="p-2">Događaj</th><th className="p-2">Korisnik</th><th className="p-2">IP adresa</th>
              <th className="p-2">Država / grad</th><th className="p-2">Sistem</th><th className="p-2">Pregledač</th>
            </tr></thead>
            <tbody>
              {shown.length === 0 && <tr><td colSpan={7} className={`p-3 ${sub}`}>Nema zapisa.</td></tr>}
              {shown.map((e, i) => {
                const bad = e.e === 'login_fail' || e.e === 'login_blocked';
                return (
                  <tr key={`${e.t}-${i}`} className={`border-t ${dark ? 'border-white/5' : 'border-slate-100'}`}>
                    <td className="whitespace-nowrap p-2 tabular-nums">{fmt(e.t)}</td>
                    <td className={`whitespace-nowrap p-2 font-medium ${bad ? 'text-amber-500' : ''}`}>{EVENT_LABEL[e.e] ?? e.e}{e.p ? <span className={`ml-1 text-xs ${sub}`}>{e.p}</span> : null}</td>
                    <td className="p-2">{e.u ?? <span className={sub}>—</span>}</td>
                    <td className="p-2 font-mono text-xs">{e.ip}</td>
                    <td className={`whitespace-nowrap p-2 ${isForeign(e) ? 'font-semibold text-red-500' : ''}`}>{e.cc}{e.city ? ` · ${e.city}` : ''}</td>
                    <td className="whitespace-nowrap p-2">{e.os}{e.dev === 'mobile' ? <span className={`ml-1 text-xs ${sub}`}>(mobilni)</span> : null}</td>
                    <td className="whitespace-nowrap p-2">{e.br}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-4 text-xs opacity-50">Vrijeme je po aerodromskom satu. Čuva se 30 dana (najviše 2000 zapisa). Država i grad su procjena prema IP adresi. Pokušaje koje blokira Vercel Firewall vidi u Vercelu (Firewall → pregled), ne ovdje.</p>
      </div>
    </div>
  );
}
