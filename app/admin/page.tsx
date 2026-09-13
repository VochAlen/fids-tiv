// app/admin/page.tsx
//
// FIX (po zahtjevu — login + redirekcija na /admin mora stati u 2s):
// Server komponenta — BEZ 'use client' (isti obrazac kao
// app/admin/login/page.tsx, app/combined/page.tsx). Ovo je stranica na
// koju login redirektuje NAKON uspješne prijave — ako I ONA zahtijeva
// server round-trip (umjesto da se servira sa CDN-a), to direktno
// produžava percipirano vrijeme "login + redirekcija", čak i ako je
// sam /api/admin/login poziv brz. force-static rješava TAJ dio lanca.
//
// Stvarni dashboard (statistika, kartice, IdleWarningBanner) je sad u
// AdminDashboardClient.tsx — nedirano, samo premješteno. Podaci
// (statistika o letovima) se i dalje učitavaju isključivo klijentski,
// nakon što se stranica prikaže (force-static utiče samo na HTML
// okvir, ne na te podatke).
import AdminDashboardClient from './AdminDashboardClient';

export const dynamic = 'force-static';

export default function Page() {
  return <AdminDashboardClient />;
}
