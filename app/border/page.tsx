// app/border/page.tsx
// Server komponenta — BEZ 'use client'.
//
// Fiksna ruta, force-static dovoljan (bez generateStaticParams).
// Podaci dolaze klijentski kroz polling u ArrivalsPageClient.tsx.
import ArrivalsPageClient from './ArrivalsPageClient';

export const dynamic = 'force-static';

export default function Page() {
  return <ArrivalsPageClient />;
}