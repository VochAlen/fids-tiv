// app/admin/login/page.tsx
'use client';

import { useState, useEffect, useCallback, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { Lock, LogIn } from 'lucide-react';

function LoginForm() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const searchParams = useSearchParams();

  // FIX (staff dobija poruku umjesto da se zbunjeno pita "zašto sam
  // izbačen?"): kad useIdleLogout (hooks/use-idle-logout.ts) automatski
  // odjavi korisnika, redirect ide na /admin/login?reason=idle — ovdje
  // to prepoznajemo i prikazujemo prijateljsku poruku umjesto praznog
  // login ekrana.
  const wasIdleLogout = searchParams.get('reason') === 'idle';

  // FIX (istraga "Prijavljivanje traje dugo" — uklonjen router.prefetch):
  // ranije je ovdje postojao `router.prefetch('/admin')`, korisno SAMO
  // ako se navigacija poslije prijave radi preko router.push() (Next.js
  // klijentska tranzicija, koristi prefetch-ovan RSC payload iz router
  // keša). Sad se navigacija radi preko window.location.href (vidi
  // handleLogin ispod, i opširan komentar tamo o ZAŠTO) — puna
  // navigacija ignoriše Next.js router keš u potpunosti, pa bi ovaj
  // prefetch poziv bio mrtav kod da je ostao (trošio bi mrežni poziv
  // bez ikakve koristi). useRouter() više nije potreban nigdje u ovoj
  // komponenti.

  // FIX (KRITIČNO — ovo je izazivalo beskonačnu petlju učitavanja,
  // login se uopšte nije mogao otvoriti): ovdje je RANIJE postojao
  // useEffect koji je, ako localStorage kaže "adminAuthenticated=true",
  // odmah radio window.location.href='/admin' — BEZ provjere da li je
  // TA vrijednost i dalje tačna. Problem: middleware.ts VEĆ pouzdano
  // rješava tačno ovaj slučaj, ali gleda PRAVI httpOnly cookie, ne
  // localStorage:
  //     if (isLoginPage && isAuthenticated) redirect('/admin')
  // Ako je localStorage flag OSTAO "true" od neke ranije sesije čiji je
  // pravi cookie u međuvremenu istekao (npr. nakon 8h, ili ručno
  // obrisan) — desi se ovo:
  //   1. Stranica se učita, naš useEffect vidi localStorage=true,
  //      šalje na /admin (PUNA navigacija)
  //   2. Middleware na /admin provjerava PRAVI cookie → nije validan →
  //      šalje NAZAD na /admin/login
  //   3. Stranica se PONOVO učita, naš useEffect OPET vidi
  //      localStorage=true (ništa ga nije očistilo) → korak 1 ponovo
  //   → beskonačna petlja, forma za login se nikad ne stigne prikazati.
  //
  // Sa ranijim router.push() ovo se možda dešavalo tiše (klijentska
  // tranzicija); prelazak na window.location.href (puna navigacija) je
  // istu, već postojeću grešku učinio vidljivom kao neprestano
  // učitavanje stranice.
  //
  // POPRAVKA: ovaj useEffect je u potpunosti UKLONJEN — middleware.ts
  // već ispravno i pouzdano radi TAČNO ovaj redirect (na osnovu pravog
  // cookie-ja, ne localStorage kopije), i to se dešava PRIJE nego što
  // React kod ove stranice uopšte dobije priliku da se izvrši. Ovaj
  // klijentski useEffect nikad nije imao valjanu svrhu koju middleware
  // već ne pokriva pouzdanije — samo je unosio rizik od baš ove petlje.

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

        // FIX (istraga "Prijavljivanje traje dugo"): setLoading(false) se
        // RANIJE nikad nije pozivao na USPJEŠNOJ prijavi — spinner je
        // ostajao prikazan cijelo vrijeme trajanja router.push('/admin')
        // klijentske tranzicije. Ta tranzicija zavisi od toga da li je
        // router.prefetch('/admin') (useEffect iznad) STIGAO da završi
        // prije klika — nepredvidivo, zavisi koliko brzo neko otkuca
        // korisničko ime/lozinku. Ako prefetch nije stigao, Next.js mora
        // dodatno da dovuče RSC payload za CIO admin dashboard (veća
        // 'use client' komponenta) PRIJE nego što išta prikaže — baš taj
        // nepredvidivi dodatni korak se osjećao kao "spor login".
        //
        // window.location.href umjesto router.push: puna navigacija,
        // NE zavisi od prefetch tajminga — /admin je force-static (vidi
        // app/admin/page.tsx), servira se kao gotov HTML direktno sa
        // CDN-a na prvi GET, dosljedno brzo bez obzira koliko brzo je
        // neko otkucao formu.
        window.location.href = '/admin';
      } else {
        setError(data.message || 'Pogrešno korisničko ime ili lozinka');
        setLoading(false);
      }
    } catch (error) {
      console.error('Login error:', error);
      setError('Došlo je do greške pri prijavljivanju');
      setLoading(false);
    }
  }, [username, password]);

  return (
    <div className="h-screen overflow-y-auto flex items-center justify-center bg-gradient-to-br from-slate-900 to-slate-800">
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

export default function AdminLoginClient() {
  // useSearchParams zahtijeva Suspense granicu u App Router-u.
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
