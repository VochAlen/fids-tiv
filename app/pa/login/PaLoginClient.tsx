'use client';

// app/pa/login/PaLoginClient.tsx
//
// Namjenska login forma SAMO za razglas — potpuno odvojena od
// /admin/login (vidi opširan komentar u app/api/pa/login/route.ts).
import { useState, useCallback, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { Radio, LogIn } from 'lucide-react';

function LoginForm() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const searchParams = useSearchParams();

  const next = searchParams.get('next') === 'admin' ? '/admin/pa' : '/pa';
  const wasIdleLogout = searchParams.get('reason') === 'idle';

  // FIX (KRITIČNO — isti uzrok beskonačne petlje kao na app/admin/login/
  // AdminLoginClient.tsx, vidi opširan komentar tamo): ovdje su RANIJE
  // postojala DVA useEffect-a — router.prefetch(next) (beskoristan bez
  // router.push, vidi ispod) i provjera "ako localStorage kaže
  // paAuthenticated=true, odmah redirektuj" — BEZ provjere da li je ta
  // vrijednost i dalje tačna. middleware.ts VEĆ pouzdano rješava tačno
  // ovaj slučaj preko PRAVOG pa-authenticated cookie-ja (isPaLoginPage
  // && isPaAuthenticated → redirect), PRIJE nego što ovaj React kod
  // uopšte dobije priliku da se izvrši. Ako bi localStorage flag ostao
  // "true" od isteknute sesije, ova dva mehanizma bi se sudarala u
  // beskonačnoj petlji — oba uklonjena, redirekt poslije prijave ide
  // preko window.location.href (ispod), auto-redirekt za već-prijavljene
  // je u potpunosti prepušten middleware-u.

  const handleLogin = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const response = await fetch('/api/pa/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
        signal: AbortSignal.timeout(5000),
      });

      const data = await response.json();

      if (data.success) {
        localStorage.setItem('paAuthenticated', 'true');
        // FIX: window.location.href umjesto router.push — isti razlog
        // kao app/admin/login/AdminLoginClient.tsx (puna navigacija, ne
        // zavisi od prefetch tajminga, /pa i /admin/pa su force-static
        // gdje god je to primjenjivo).
        window.location.href = next;
      } else {
        setError(data.message || 'Pogrešno korisničko ime ili lozinka');
        setLoading(false);
      }
    } catch (error) {
      console.error('PA login error:', error);
      setError('Došlo je do greške pri prijavljivanju');
      setLoading(false);
    }
  }, [username, password, next]);

  return (
    <div className="h-screen overflow-y-auto flex items-center justify-center bg-gradient-to-br from-slate-900 to-slate-800">
      <div className="max-w-md w-full space-y-8 p-8 bg-white/10 backdrop-blur-lg rounded-2xl border border-white/20 shadow-2xl">
        <div className="text-center">
          <div className="mx-auto w-16 h-16 bg-sky-600 rounded-full flex items-center justify-center mb-4">
            <Radio className="w-8 h-8 text-white" />
          </div>
          <h2 className="text-3xl font-bold text-white">Razglas</h2>
          <p className="mt-2 text-white/80">TIV FIDS — pristup samo za osoblje Operativnog centra</p>
        </div>

        <form className="mt-8 space-y-6" onSubmit={handleLogin}>
          {wasIdleLogout && !error && (
            <div className="bg-yellow-500/20 border border-yellow-500/50 text-yellow-200 px-4 py-3 rounded-lg text-sm">
              Odjavljeni ste zbog neaktivnosti. Prijavite se ponovo da nastavite.
            </div>
          )}
          {error && (
            <div className="bg-red-500/20 border border-red-500/50 text-red-200 px-4 py-3 rounded-lg">
              {error}
            </div>
          )}

          <div className="space-y-4">
            <div>
              <label htmlFor="username" className="block text-sm font-medium text-white/90 mb-1">
                Korisničko ime
              </label>
              <input
                id="username"
                name="username"
                type="text"
                required
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full px-4 py-3 bg-white/10 border border-white/20 rounded-lg text-white placeholder-white/50 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent"
                placeholder="Unesite korisničko ime"
                disabled={loading}
                autoComplete="off"
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-white/90 mb-1">
                Lozinka
              </label>
              <input
                id="password"
                name="password"
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-3 bg-white/10 border border-white/20 rounded-lg text-white placeholder-white/50 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent"
                placeholder="Unesite lozinku"
                disabled={loading}
                autoComplete="off"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full flex items-center justify-center gap-2 py-3 px-4 bg-gradient-to-r from-sky-600 to-sky-700 text-white font-semibold rounded-lg hover:from-sky-700 hover:to-sky-800 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-offset-2 focus:ring-offset-slate-900 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
          >
            {loading ? (
              <>
                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                <span>Prijavljivanje...</span>
              </>
            ) : (
              <>
                <LogIn className="w-5 h-5" />
                <span>Prijavi se</span>
              </>
            )}
          </button>
        </form>

        <div className="text-center text-white/60 text-sm">
          <p>© 2026 Aerodrom Tivat. Sva prava zadržana.</p>
        </div>
      </div>
    </div>
  );
}

export default function PaLoginClient() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
