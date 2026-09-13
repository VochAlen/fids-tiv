// app/admin/login/page.tsx
//
// FIX (po zahtjevu — login + redirekcija na /admin mora stati u 2s):
// Server komponenta — BEZ 'use client' (isti obrazac kao app/combined/
// page.tsx, app/pa/page.tsx). Prije ove izmjene, CIJELI login fajl je
// bio 'use client', što znači da Next.js NIJE mogao da primijeni
// `export const dynamic = 'force-static'` — ta postavka se čita SAMO
// iz Server komponenti tokom build-a. Bez nje, svaka posjeta
// /admin/login je zahtijevala poziv ka Vercel serverless funkciji da
// vrati stranicu (uz mogući cold start), umjesto da se HTML okvir
// servira direktno sa CDN-a.
//
// Prava login forma (klik, fetch, redirect) je sad u
// AdminLoginClient.tsx — nedirano, samo premješteno. force-static
// utiče SAMO na to KAKO se HTML okvir stranice isporučuje, ne na
// login logiku (fetch ka /api/admin/login je i dalje uvijek uživo).
import AdminLoginClient from './AdminLoginClient';

export const dynamic = 'force-static';

export default function Page() {
  return <AdminLoginClient />;
}
