// app/pa/page.tsx
// Server komponenta — isti obrazac kao app/combined/page.tsx. Nema
// dinamičkog segmenta, nema server-side fetch-a — force-static znači
// da se HTML okvir servira sa CDN-a, ne renderuje na Vercel funkciji
// pri svakom posjetu. Svi podaci (letovi, najave) dolaze isključivo
// klijentskim pollingom u PaPageClient.tsx.
import PaPageClient from './PaPageClient';

export const dynamic = 'force-static';

export default function Page() {
  return <PaPageClient />;
}
