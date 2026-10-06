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
//
// NOVO (po zahtjevu — AI/GEO optimizacija, 2026-10-05):
// 1) metadata ispod (naslov/opis na engleskom — ciljni kupci su
//    aerodromi širom svijeta, pa to čitaju i pretraživači i AI),
//    canonical URL, Open Graph i Twitter kartica;
// 2) JSON-LD strukturirani podaci (SoftwareApplication + FAQPage +
//    WebSite) iz lib/site-content.ts — mašinski čitljive činjenice o
//    proizvodu i cijenama, iz ISTIH stringova kao vidljiva FAQ sekcija.
import type { Metadata } from 'next';
import HomeClient from './HomeClient';
import { SITE_URL, SITE_NAME, jsonLdString } from '@/lib/site-content';

export const dynamic = 'force-static';

const TITLE = `${SITE_NAME} — Flight Information Display System (FIDS) for Small and Regional Airports`;
const DESCRIPTION =
  'Cloud FIDS for small and regional airports: live departures and arrivals boards, gate and check-in displays, staff admin and automated announcements. Running at Tivat Airport. From €249/month.';

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: '/' },
  openGraph: {
    type: 'website',
    url: SITE_URL,
    siteName: SITE_NAME,
    title: TITLE,
    description: DESCRIPTION,
    images: [{ url: '/departures-DEMO.jpg', width: 1855, height: 1018, alt: 'TIV FIDS departures board at Tivat Airport' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: TITLE,
    description: DESCRIPTION,
    images: ['/departures-DEMO.jpg'],
  },
};

export default function Page() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdString() }}
      />
      <HomeClient />
    </>
  );
}
