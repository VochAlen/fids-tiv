// app/ver2/ver2/checkin/[deskNumber]/page.tsx
// Server komponenta — BEZ 'use client'.
//
// Cilj: pretvoriti ovu stranicu iz SSR-po-zahtjevu (svaki fizički kiosk
// displej koji je otvorio /ver2/ver2/checkin/X je do sada okidao Vercel
// funkciju) u statički pre-renderovan HTML shell koji se servira sa CDN-a.
// Stvarni podaci (dodjela šaltera, status leta) se i dalje dohvataju
// isključivo klijentski preko postojećeg polling mehanizma u
// CheckInPageClient.tsx — SSG ovdje utiče SAMO na sam HTML "okvir"
// stranice, ne na podatke.
//
// VAŽNO: spisak brojeva šaltera dolje MORA odgovarati stvarnim fizičkim
// šalterima na aerodromu. Ako se doda/ukloni šalter, ovaj spisak treba
// ažurirati i ponovo deploy-ovati (build-time generacija).
import CheckInPageClient from './CheckInPageClient';

// TODO: potvrdi da ova lista tačno odgovara svih 18 fizičkih šaltera —
// ovdje je preuzeta iz prethodnog prijedloga (1-12 + 21-26) kao pretpostavka.
const DESK_NUMBERS: string[] = [
  ...Array.from({ length: 12 }, (_, i) => String(i + 1)),
  '21', '22', '23', '24', '25', '26',
];

export function generateStaticParams() {
  return DESK_NUMBERS.map((deskNumber) => ({ deskNumber }));
}

// Spisak šaltera je fiksan (fizički kiosk uređaji) — onemogući on-demand
// SSR fallback za brojeve van liste. Ako neko otvori nepostojeći broj
// šaltera, dobiće 404 umjesto da Vercel tiho renderuje novu stranicu.
export const dynamicParams = false;

// ── DODAJ OVO: Forsira SSG umjesto SSR ──────────────────────
export const dynamic = 'force-static';

// NAPOMENA: 'revalidate' NIJE dodat namjerno. Ova stranica nema nikakav
// server-side fetch/podatak koji bi ISR trebalo da osvježava — sav sadržaj
// (dodjela šaltera, status leta) dolazi klijentski (polling u
// CheckInPageClient.tsx). Dodavanje revalidate-a bi periodično pokretalo
// serverless funkciju da regeneriše IDENTIČAN HTML, vraćajući invocations
// koje je čist SSG (dynamicParams=false, bez revalidate) sveo na 0 nakon
// build-a. Klijentski polling radi potpuno nezavisno od ove postavke —
// 60s revalidate na page-u ne bi ni ubrzao ni usporio osvježavanje
// podataka koje već kontroliše POLL_INTERVAL u CheckInPageClient.tsx.

export default function Page() {
  return <CheckInPageClient />;
}