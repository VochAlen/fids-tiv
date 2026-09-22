// app/admin/login/page.tsx
'use client';

import { useState, useCallback } from 'react';
import { Lock, LogIn } from 'lucide-react';

export default function AdminLoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Nema potrebe za useEffect proverom sesije ovdje —
  // middleware.ts već presreće /admin/login i redirektuje
  // ako je httpOnly kolačić (admin-session) validan.
  //
  // Napomena: useRouter/router više nije potreban ovdje — redirect
  // nakon uspješnog logina ide preko window.location.href (vidi niže),
  // ne preko router.push().

  const handleLogin = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const response = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });

      const data = await response.json();

      if (data.success) {
        // Kolačić je server već postavio (httpOnly, Set-Cookie header) —
        // ovdje nema ničega za ručno postaviti, samo redirect.
        //
        // NAMJERNO window.location umjesto router.push — na auth granici
        // (login → assign-checkin) želimo PUN reload, ne soft navigaciju.
        // Next.js App Router client-side Router Cache može vratiti
        // KEŠIRANU instancu /admin/assign-checkin komponente (sa starim
        // React state-om i useEffect-ima koji se ne pokreću ponovo) ako
        // je ta ruta posjećena unutar cache prozora (npr. prije logout-a)
        // — realtime hookovi bi tad ostali zaglavljeni na starom stanju
        // dok korisnik ručno ne uradi refresh. Hard navigacija to
        // eliminiše.
        window.location.href = '/admin/assign-checkin';
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