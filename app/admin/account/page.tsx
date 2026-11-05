// app/admin/account/page.tsx — promjena sopstvene lozinke (svaka uloga).
'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { KeyRound, ArrowLeft, Check } from 'lucide-react';

export default function AccountPage() {
  const [first, setFirst] = useState(false);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setFirst(new URLSearchParams(window.location.search).get('first') === '1'); }, []);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  const submit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (next !== again) { setError('Nova lozinka i potvrda nisu iste'); return; }
    setBusy(true);
    try {
      const res = await fetch('/api/admin/account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ current, next }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (res.ok && data.ok) {
        setDone(true);
        setCurrent(''); setNext(''); setAgain('');
        // pun reload: kolačić sa novom verzijom sesije je već postavljen
        setTimeout(() => { window.location.href = '/admin/assign-checkin'; }, 1200);
      } else {
        setError(data.error || 'Promjena lozinke nije uspjela');
      }
    } catch {
      setError('Greška u vezi sa serverom');
    } finally {
      setBusy(false);
    }
  }, [current, next, again]);

  const input = 'w-full px-4 py-3 bg-white/10 border border-white/20 rounded-lg text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-blue-500';

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 to-slate-800 p-4">
      <div className="max-w-md w-full space-y-6 p-8 bg-white/10 backdrop-blur-lg rounded-2xl border border-white/20 shadow-2xl">
        <div className="text-center">
          <div className="mx-auto w-14 h-14 bg-blue-600 rounded-full flex items-center justify-center mb-4">
            <KeyRound className="w-7 h-7 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-white">Moj račun</h1>
          <p className="mt-1 text-white/70 text-sm">Promjena lozinke</p>
        </div>

        {first && !done && (
          <div className="bg-amber-500/15 border border-amber-400/40 text-amber-100 px-4 py-3 rounded-lg text-sm">
            Prijavljen/a si sa privremenom lozinkom. Postavi svoju lozinku prije nastavka.
          </div>
        )}
        {error && <div className="bg-red-500/20 border border-red-500/50 text-red-200 px-4 py-3 rounded-lg text-sm" role="alert">{error}</div>}
        {done && (
          <div className="flex items-center gap-2 bg-emerald-500/15 border border-emerald-400/40 text-emerald-100 px-4 py-3 rounded-lg text-sm" role="status">
            <Check className="w-4 h-4" /> Lozinka je promijenjena.
          </div>
        )}

        <form onSubmit={submit} className="space-y-4">
          <div>
            <label htmlFor="cur" className="block text-sm text-white/90 mb-1">Trenutna lozinka</label>
            <input id="cur" type="password" required autoComplete="current-password" className={input} value={current} onChange={(e) => setCurrent(e.target.value)} disabled={busy || done} />
          </div>
          <div>
            <label htmlFor="new" className="block text-sm text-white/90 mb-1">Nova lozinka <span className="text-white/50">(najmanje 10 znakova)</span></label>
            <input id="new" type="password" required minLength={10} autoComplete="new-password" className={input} value={next} onChange={(e) => setNext(e.target.value)} disabled={busy || done} />
          </div>
          <div>
            <label htmlFor="again" className="block text-sm text-white/90 mb-1">Ponovi novu lozinku</label>
            <input id="again" type="password" required minLength={10} autoComplete="new-password" className={input} value={again} onChange={(e) => setAgain(e.target.value)} disabled={busy || done} />
          </div>
          <button type="submit" disabled={busy || done} className="w-full py-3 bg-gradient-to-r from-blue-600 to-blue-700 text-white font-semibold rounded-lg disabled:opacity-50">
            {busy ? 'Spremam…' : 'Promijeni lozinku'}
          </button>
        </form>

        {!first && (
          <Link href="/admin" className="flex items-center justify-center gap-2 text-sm text-white/70 hover:text-white">
            <ArrowLeft className="w-4 h-4" /> Nazad na panel
          </Link>
        )}
      </div>
    </div>
  );
}
