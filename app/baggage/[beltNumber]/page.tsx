// app/baggage/[beltNumber]/page.tsx
// Server komponenta — BEZ 'use client'.
//
// Baggage stranica ima dinamički segment ([beltNumber]), pa je za
// force-static neophodan generateStaticParams — bez njega Next.js
// ne zna unaprijed koje sve /baggage/X rute postoje, pa bi ih morao
// renderovati on-demand na Vercel funkciji pri svakom prvom posjetu.
//
// dynamicParams: true znači da AKO neko otvori belt broj koji NIJE
// u listi ispod (npr. dodaš treći belt kasnije, a zaboraviš ažurirati
// ovu listu), Next.js će tu jednu rutu ipak renderovati on-demand
// (ne baca 404) — samo neće biti unaprijed statički generisana.
//
// Svi podaci (letovi, hash-check, keš) i dalje dolaze isključivo
// klijentski kroz BaggagePageClient.tsx — force-static utiče SAMO
// na HTML okvir stranice, ne na podatke.
import BaggagePageClient from './BaggagePageClient';

export const dynamic = 'force-static';
export const dynamicParams = true;

export async function generateStaticParams() {
  // TODO: prilagodi listu ako postoji više/drugačiji beltovi
  return [
    { beltNumber: '1' },
    { beltNumber: '2' },
  ];
}

export default function Page() {
  return <BaggagePageClient />;
}