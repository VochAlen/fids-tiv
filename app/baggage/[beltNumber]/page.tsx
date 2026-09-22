// app/baggage/[beltNumber]/page.tsx
// Server komponenta — BEZ 'use client'. Isti princip kao kod
// gate/[gateNumber] i checkin/[deskNumber]: HTML shell se
// pre-renderuje u build-u, stvarni podaci dolaze isključivo preko
// Ably real-time feeda u BaggagePageClient.tsx.
import BaggagePageClient from './BaggagePageClient';

// ── TAČAN SPISAK TRAKA ZA PRTLJAG ──────────────────────────────
// Pretpostavka: 2 trake ('1', '2') — applyDefaultBaggageBelt()
// u lib/flight-data-service.ts već koristi '2' kao fallback za
// dolaske bez eksplicitno dodijeljene trake, što implicira da
// tačno te dvije trake fizički postoje. Ako Tivat ima više traka,
// samo dodaj brojeve u ovaj niz — isti obrazac kao GATE_NUMBERS u
// app/ver2/ver2/gate/[gateNumber]/page.tsx.
const BELT_NUMBERS: string[] = ['1', '2'];

export function generateStaticParams() {
  return BELT_NUMBERS.map((beltNumber) => ({ beltNumber }));
}

// Fiksan spisak fizičkih traka — onemogući on-demand SSR fallback.
export const dynamicParams = false;

// NAPOMENA: 'revalidate' NIJE dodat namjerno — isti razlog kao kod
// gate/checkin stranica: sav sadržaj dolazi klijentski (Ably +
// /api/flights/snapshot), server-side revalidate bi samo trošio
// nepotrebne serverless invocations.

export default function Page() {
  return <BaggagePageClient />;
}
