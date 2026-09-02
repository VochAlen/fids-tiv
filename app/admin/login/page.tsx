// app/admin/login/page.tsx
'use client';

import { useState, useEffect, useCallback, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Lock, LogIn } from 'lucide-react';

function LoginForm() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();

  // FIX (staff dobija poruku umjesto da se zbunjeno pita "zašto sam
  // izbačen?"): kad useIdleLogout (hooks/use-idle-logout.ts) automatski
  // odjavi korisnika, redirect ide na /admin/login?reason=idle — ovdje
  // to prepoznajemo i prikazujemo prijateljsku poruku umjesto praznog
  // login ekrana.
  const wasIdleLogout = searchParams.get('reason') === 'idle';

  // FIX (ubrzaj login — dio 1/2, dio 2 je Edge runtime u
  // app/api/admin/login/route.ts): pripremi (prefetch) JS bundle za
  // /admin STRANICU dok korisnik još kuca korisničko ime/lozinku, umjesto
  // da se preuzimanje tog bundle-a tek pokrene NAKON uspješne prijave.
  // Next.js router.push('/admin') poslije prijave tada koristi već
  // preuzeti, keširani chunk — nema dodatnog mrežnog čekanja na
  // navigaciju, samo trenutni render.
  useEffect(() => {
    router.prefetch('/admin');
  }, [router]);

  // Optimizovana provera sesije - brža i bez nepotrebnog renderovanja.
  // NAPOMENA: cookie 'admin-authenticated' je od sada httpOnly (vidi
  // app/api/admin/login/route.ts) — JS ga namjerno NE MOŽE čitati, to je
  // svrha httpOnly zaštite. Zato se ovdje oslanjamo SAMO na localStorage
  // kao brzu, isključivo kozmetičku prečicu ("vjerovatno si već
  // prijavljen, hajde da odmah probamo /admin"). Ako je localStorage flag
  // zastario/pogrešan, middleware.ts svejedno provjerava pravi cookie na
  // serveru i vraća na login ako sesija zaista nije validna — nema
  // sigurnosnog rizika u ovoj brzoj client-side provjeri.
  useEffect(() => {
    const isLocalAuth = localStorage.getItem('adminAuthenticated') === 'true';
    if (isLocalAuth) {
      router.push('/admin');
    }
  }, [router]);

  const handleLogin = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const response = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
        signal: AbortSignal.timeout(5000),
      });

      const data = await response.json();

      if (data.success) {
        // FIX (sigurnost): pravi auth cookie je httpOnly i već je
        // postavljen NA SERVERU u odgovoru iznad (Set-Cookie header) —
        // više ga NE postavljamo ovdje ručno preko document.cookie. Stari
        // kod je to radio, što je imalo dva problema: (1) bilo koji JS u
        // konzoli je mogao izvršiti istu liniju i lažirati prijavu bez
        // lozinke, i (2) čak i nakon što je server počeo da šalje pravi
        // httpOnly cookie, ova client-side linija bi ga ODMAH PREPISALA
        // običnim (ne-httpOnly) cookie-jem istog imena — tiho poništavajući
        // sigurnosnu zaštitu na svakoj prijavi.
        //
        // localStorage flag ostaje — koristi ga SAMO brza kozmetička
        // provjera iznad, ne middleware/autentifikacija.
        localStorage.setItem('adminAuthenticated', 'true');
        localStorage.setItem('adminLoginTime', new Date().toISOString());

        // /admin je već prefetch-ovan (vidi useEffect iznad) — ova
        // navigacija sad koristi keširan bundle.
        router.push('/admin');
      } else {
        setError(data.message || 'Pogrešno korisničko ime ili lozinka');
        setLoading(false);
      }
    } catch (error) {
      console.error('Login error:', error);
      setError('Došlo je do greške pri prijavljivanju');
      setLoading(false);
    }
  }, [username, password, router]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 to-slate-800">
      <div className="max-w-md w-full space-y-8 p-8 bg-white/10 backdrop-blur-lg rounded-2xl border border-white/20 shadow-2xl">
        <div className="text-center">
          <div className="mx-auto w-16 h-16 bg-blue-600 rounded-full flex items-center justify-center mb-4">
            <Lock className="w-8 h-8 text-white" />
          </div>
          <h2 className="text-3xl font-bold text-white">Administracija</h2>
          <p className="mt-2 text-white/80">Tivat Airport Check-in System</p>
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
                className="w-full px-4 py-3 bg-white/10 border border-white/20 rounded-lg text-white placeholder-white/50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
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
                className="w-full px-4 py-3 bg-white/10 border border-white/20 rounded-lg text-white placeholder-white/50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="Unesite lozinku"
                disabled={loading}
                autoComplete="off"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full flex items-center justify-center gap-2 py-3 px-4 bg-gradient-to-r from-blue-600 to-blue-700 text-white font-semibold rounded-lg hover:from-blue-700 hover:to-blue-800 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-slate-900 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
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
          <p>© 2025 Tivat Airport. Sva prava zadržana.</p>
        </div>
      </div>
    </div>
  );
}

export default function AdminLoginPage() {
  // useSearchParams zahtijeva Suspense granicu u App Router-u.
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
