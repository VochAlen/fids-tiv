// app/pa/page.tsx — Server komponenta, BEZ 'use client'.
// Sav sadržaj (Ably pretplata, Web Speech API) je klijentski,
// isti princip kao border/departures/arrivals.
import PaPageClient from './PaPageClient';

export default function Page() {
  return <PaPageClient />;
}
