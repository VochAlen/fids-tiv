// app/admin/users/page.tsx — korisnici admin panela (samo uloga "admin"; middleware i API to provjeravaju).
'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, UserPlus, KeyRound, Download, RefreshCw } from 'lucide-react';

type Role = 'admin' | 'operator';
type U = { username: string; role: Role; active: boolean; created: number; lastLogin: number | null; mustChange: boolean };

const fmt = (t: number | null) => (t ? new Date(t).toLocaleString('sr-Latn-ME', { dateStyle: 'short', timeStyle: 'short' }) : '—');

async function call(body: Record<string, unknown>): Promise<{ ok: boolean; error?: string; [k: string]: unknown }> {
  try {
    const res = await fetch('/api/admin/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    return res.ok ? { ok: true, ...data } : { ok: false, error: data.error || `Greška ${res.status}` };
  } catch {
    return { ok: false, error: 'Greška u vezi sa serverom' };
  }
}

export default function UsersPage() {
  const [users, setUsers] = useState<U[] | null>(null);
  const [envPending, setEnvPending] = useState<string[]>([]);
  const [me, setMe] = useState('');
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [nu, setNu] = useState({ username: '', password: '', role: 'operator' as Role });
  const [reset, setReset] = useState<{ username: string; password: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const [l, m] = await Promise.all([
        fetch('/api/admin/users', { cache: 'no-store' }),
        fetch('/api/admin/me', { cache: 'no-store' }),
      ]);
      if (m.ok) setMe(((await m.json()) as { username: string }).username);
      if (l.ok) {
        const d = (await l.json()) as { users: U[]; envPending: string[] };
        setUsers(d.users); setEnvPending(d.envPending);
      } else {
        const d = (await l.json().catch(() => ({}))) as { error?: string };
        setMsg({ kind: 'err', text: d.error || `Greška ${l.status}` });
        setUsers([]);
      }
    } catch {
      setMsg({ kind: 'err', text: 'Greška u vezi sa serverom' });
      setUsers([]);
    }
  }, []);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  const run = useCallback(async (body: Record<string, unknown>, okText: string) => {
    setBusy(true); setMsg(null);
    const r = await call(body);
    setBusy(false);
    setMsg(r.ok ? { kind: 'ok', text: okText } : { kind: 'err', text: r.error || 'Greška' });
    if (r.ok) await load();
    return r.ok;
  }, [load]);

  const card = 'bg-white/5 backdrop-blur-sm rounded-xl border border-white/10';
  const field = 'px-3 py-2 bg-white/10 border border-white/20 rounded-lg text-white placeholder-white/40 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 text-white p-4 sm:p-8">
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">Korisnici</h1>
            <p className="text-white/60 text-sm">Admin vidi sve; operator radi dodjelu šaltera/gate-ova i vidi radar.</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => void load()} className="p-2.5 rounded-lg border border-white/15 hover:bg-white/10" aria-label="Osvježi"><RefreshCw className="w-4 h-4" /></button>
            <Link href="/admin" className="flex items-center gap-2 px-3 py-2.5 rounded-lg border border-white/15 hover:bg-white/10 text-sm"><ArrowLeft className="w-4 h-4" /> Panel</Link>
          </div>
        </div>

        {msg && (
          <div role={msg.kind === 'err' ? 'alert' : 'status'} className={`px-4 py-3 rounded-lg text-sm border ${msg.kind === 'ok' ? 'bg-emerald-500/15 border-emerald-400/40 text-emerald-100' : 'bg-red-500/20 border-red-500/50 text-red-200'}`}>
            {msg.text}
          </div>
        )}

        {envPending.length > 0 && (
          <div className="px-4 py-4 rounded-xl border border-amber-400/40 bg-amber-500/10 text-amber-100 text-sm space-y-3">
            <div>
              U <code className="font-mono">ADMIN_USERS</code> ima korisnika koji još nisu u bazi: <b>{envPending.join(', ')}</b>.
              Uvezeni računi zadržavaju iste lozinke i dobijaju ulogu admin (ulogu možeš odmah promijeniti u tabeli).
              Poslije uvoza env lista više ne važi čim u bazi postoji aktivan admin, pa je preporučljivo <b>ukloniti ADMIN_USERS iz Vercel Environment Variables</b> (lozinke tamo stoje kao čist tekst).
            </div>
            <button disabled={busy} onClick={() => void run({ action: 'import-env' }, 'Korisnici su uvezeni')} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-500 text-slate-900 font-semibold disabled:opacity-50">
              <Download className="w-4 h-4" /> Uvezi iz ADMIN_USERS
            </button>
          </div>
        )}

        <div className={`${card} overflow-x-auto`}>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-white/50 text-xs uppercase tracking-wider border-b border-white/10">
                <th className="px-4 py-3">Korisnik</th><th className="px-4 py-3">Uloga</th><th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 hidden md:table-cell">Zadnja prijava</th><th className="px-4 py-3 text-right">Radnje</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {users === null && <tr><td colSpan={5} className="px-4 py-6 text-white/50">Učitavanje…</td></tr>}
              {users?.length === 0 && <tr><td colSpan={5} className="px-4 py-6 text-white/50">Nema korisnika u bazi.</td></tr>}
              {users?.map((u) => {
                const self = u.username === me;
                return (
                  <tr key={u.username} className={u.active ? '' : 'opacity-50'}>
                    <td className="px-4 py-3">
                      <div className="font-semibold">{u.username}{self && <span className="ml-2 text-[10px] uppercase text-sky-300">ti</span>}</div>
                      {u.mustChange && <div className="text-[11px] text-amber-300">mora promijeniti lozinku</div>}
                    </td>
                    <td className="px-4 py-3">
                      <select
                        value={u.role} disabled={busy || self} aria-label={`Uloga za ${u.username}`}
                        onChange={(e) => void run({ action: 'update', username: u.username, role: e.target.value }, `Uloga za ${u.username} promijenjena (nova prijava)`)}
                        className={`${field} disabled:opacity-60`}
                      >
                        <option value="admin" className="text-black">admin</option>
                        <option value="operator" className="text-black">operator</option>
                      </select>
                    </td>
                    <td className="px-4 py-3">
                      <button
                        disabled={busy || self}
                        onClick={() => void run({ action: 'update', username: u.username, active: !u.active }, u.active ? `${u.username} je deaktiviran` : `${u.username} je aktiviran`)}
                        className={`px-3 py-1.5 rounded-full text-xs font-bold disabled:opacity-50 ${u.active ? 'bg-emerald-500/20 text-emerald-300' : 'bg-slate-500/30 text-slate-300'}`}
                      >
                        {u.active ? 'Aktivan' : 'Neaktivan'}
                      </button>
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell text-white/60 tabular-nums">{fmt(u.lastLogin)}</td>
                    <td className="px-4 py-3 text-right">
                      <button onClick={() => setReset({ username: u.username, password: '' })} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/15 hover:bg-white/10 text-xs">
                        <KeyRound className="w-3.5 h-3.5" /> Reset lozinke
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {reset && (
          <form
            className={`${card} p-4 flex flex-col sm:flex-row sm:items-end gap-3`}
            onSubmit={async (e) => { e.preventDefault(); if (await run({ action: 'reset', ...reset }, `Lozinka za ${reset.username} je resetovana (mora je promijeniti pri prijavi)`)) setReset(null); }}
          >
            <div className="flex-1">
              <label className="block text-xs text-white/60 mb-1" htmlFor="rp">Privremena lozinka za <b>{reset.username}</b> (najmanje 10 znakova)</label>
              <input id="rp" type="text" autoComplete="off" required minLength={10} className={`${field} w-full`} value={reset.password} onChange={(e) => setReset({ ...reset, password: e.target.value })} />
            </div>
            <div className="flex gap-2">
              <button disabled={busy} className="px-4 py-2 rounded-lg bg-blue-600 font-semibold text-sm disabled:opacity-50">Postavi</button>
              <button type="button" onClick={() => setReset(null)} className="px-4 py-2 rounded-lg border border-white/15 text-sm">Odustani</button>
            </div>
          </form>
        )}

        <form
          className={`${card} p-4 grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto_auto] gap-3 items-end`}
          onSubmit={async (e) => { e.preventDefault(); if (await run({ action: 'create', ...nu }, `Korisnik ${nu.username.trim().toLowerCase()} je dodat`)) setNu({ username: '', password: '', role: 'operator' }); }}
        >
          <div>
            <label className="block text-xs text-white/60 mb-1" htmlFor="nu">Novi korisnik</label>
            <input id="nu" required autoComplete="off" placeholder="korisničko ime" className={`${field} w-full`} value={nu.username} onChange={(e) => setNu({ ...nu, username: e.target.value })} />
          </div>
          <div>
            <label className="block text-xs text-white/60 mb-1" htmlFor="np">Privremena lozinka</label>
            <input id="np" required minLength={10} autoComplete="off" placeholder="najmanje 10 znakova" className={`${field} w-full`} value={nu.password} onChange={(e) => setNu({ ...nu, password: e.target.value })} />
          </div>
          <div>
            <label className="block text-xs text-white/60 mb-1" htmlFor="nr">Uloga</label>
            <select id="nr" className={field} value={nu.role} onChange={(e) => setNu({ ...nu, role: e.target.value as Role })}>
              <option value="operator" className="text-black">operator</option>
              <option value="admin" className="text-black">admin</option>
            </select>
          </div>
          <button disabled={busy} className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-blue-600 font-semibold text-sm disabled:opacity-50">
            <UserPlus className="w-4 h-4" /> Dodaj
          </button>
        </form>

        <p className="text-xs text-white/40">
          Deaktivacija, promjena uloge i reset lozinke odjavljuju tog korisnika u roku od oko minute. Ne možeš deaktivirati ni degradirati sebe, a mora ostati bar jedan aktivan admin.
        </p>
      </div>
    </div>
  );
}
