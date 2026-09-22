// app/admin/layout.tsx
'use client';

import { usePathname } from 'next/navigation';
import { useCallback } from 'react';
import { useIdleLogout } from '@/hooks/useIdleLogout';
import { logoutAndRedirect } from '@/lib/admin-logout';

// 3 minuta neaktivnosti → automatska odjava. Ovo je DODATNI, čisto
// klijentski sloj zaštite iznad postojeće JWT sesije (24h,
// SESSION_DURATION_SECONDS u lib/auth-session.ts) — ne mijenja tu
// sesiju niti middleware.ts, samo proaktivno odjavljuje osoblje ako
// ostavi admin panel otvoren bez nadzora.
//
// Primjenjuje se na SVE /admin/* rute (assign-checkin, i bilo koja
// buduća admin stranica) jer je ovdje, na nivou layout-a — nema
// potrebe dodavati isti kod u svaku stranicu pojedinačno.
//
// Kiosk stranice (check-in/gate monitori) nisu pod /admin i ne koriste
// admin-session cookie — ovo ih se uopšte ne tiče.
const IDLE_LOGOUT_MS = 5 * 60 * 1000;

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  // Na login stranici nema aktivne sesije za odjaviti — isključi tajmer
  // da se ne šalje nepotreban POST ka /api/admin/logout na svakih 3 min
  // dok neko npr. čita login formu.
  const isLoginPage = pathname === '/admin/login';

  const handleIdleLogout = useCallback(() => {
    // FIX (po zahtjevu — "traje predugo" prijavljeno na admin
    // stranici): portovano u dijeljen, timeout-zaštićen helper — vidi
    // lib/admin-logout.ts za pun kontekst (uključujući razlog za
    // window.location umjesto router.push, prenesen tamo).
    logoutAndRedirect();
  }, []);

  useIdleLogout(handleIdleLogout, IDLE_LOGOUT_MS, !isLoginPage);

  return <>{children}</>;
}