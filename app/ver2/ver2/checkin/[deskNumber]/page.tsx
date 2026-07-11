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
// app/ver2/ver2/checkin/[deskNumber]/page.tsx
import CheckInPageClient from './CheckInPageClient';

const DESK_NUMBERS: string[] = [
  ...Array.from({ length: 12 }, (_, i) => String(i + 1)),
  '21', '22', '23', '24', '25', '26',
];

export function generateStaticParams() {
  return DESK_NUMBERS.map((deskNumber) => ({ deskNumber }));
}

export const dynamicParams = false;

// ⬇️ DODAJ OVO ⬇️
// ISR – stranica se regeneriše u pozadini svakih 60 sekundi
// 60s je dovoljno za FIDS – podaci se ionako osvježavaju klijentski pollingom
export const revalidate = 60;

export default function Page() {
  return <CheckInPageClient />;
}