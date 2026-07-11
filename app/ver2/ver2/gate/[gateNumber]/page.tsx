// app/ver2/ver2/gate/[gateNumber]/page.tsx
import GatePageClient from './GatePageClient';

// ── TAČAN SPISAK GATE-OVA (preuzet iz admin panela) ──────────
const GATE_NUMBERS: string[] = [
  '2','3','4','5','6',
  '21','22','23','24','25','26','27','28','29','30','31',
];

export function generateStaticParams() {
  return GATE_NUMBERS.map((gateNumber) => ({ gateNumber }));
}

// Fiksan spisak fizičkih gate-ova — onemogući on-demand SSR fallback
export const dynamicParams = false;

// ⬇️ DODAJ OVO ⬇️
// ISR – stranica se regeneriše u pozadini svakih 60 sekundi
export const revalidate = 60;

export default function Page() {
  return <GatePageClient />;
}