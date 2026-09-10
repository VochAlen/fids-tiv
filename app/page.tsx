// app/page.tsx
//
// Server komponenta — BEZ 'use client' (isti obrazac kao app/combined/
// page.tsx, app/admin/page.tsx). Ovo je PRVA stranica koju bilo ko
// vidi kad otvori fids-tiv.vercel.app bez konkretne rute — brzina
// prvog utiska je ovdje najbitnija od svih stranica u aplikaciji,
// pa force-static garantuje da se servira direktno sa CDN-a, bez
// ijednog server round-trip-a.
//
// Prava landing stranica (hero, features, tema, login/logout dugme)
// je u HomeClient.tsx.
import HomeClient from './HomeClient';

export const dynamic = 'force-static';

export default function Page() {
  return <HomeClient />;
}
