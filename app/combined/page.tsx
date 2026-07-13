// app/combined/page.tsx
// Server komponenta — BEZ 'use client'.
//
// Nema dinamičkog segmenta i nema server-side fetch-a, pa ovdje NIJE
// potreban generateStaticParams kao kod checkin/[deskNumber] stranice —
// ovo je jedna fiksna ruta. force-static eksplicitno garantuje da Next.js
// ovu stranicu prerenderuje kao statički HTML shell u build-u i servira je
// sa CDN-a, umjesto da je po potrebi renderuje na Vercel funkciji.
//
// Svi podaci (letovi, dodjele šaltera/gate-ova, status) i dalje dolaze
// isključivo klijentski kroz polling u CombinedPageClient.tsx — force-static
// utiče SAMO na HTML okvir stranice, ne na podatke.
import CombinedPageClient from './CombinedPageClient';

export const dynamic = 'force-static';

export default function Page() {
  return <CombinedPageClient />;
}