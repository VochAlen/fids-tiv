// app/ver2/ver2/gate/[gateNumber]/page.tsx
// Server komponenta — BEZ 'use client'.
//
// Isti princip kao kod checkin/[deskNumber]: HTML shell se pre-renderuje
// u build-u, dok stvarni podaci (dodijeljen let, status, override) i
// dalje dolaze isključivo preko postojećeg klijentskog polling-a u
// GatePageClient.tsx (fetchGateStatusOverride, fetchFlightData, itd.) —
// to se ovom promjenom NE mijenja.
import GatePageClient from './GatePageClient';

// ── TAČAN SPISAK GATE-OVA (preuzet iz admin panela) ──────────
const GATE_NUMBERS: string[] = [
  '2','3','4','5','6',
  '21','22','23','24','25','26','27','28','29','30','31',
];

export function generateStaticParams() {
  return GATE_NUMBERS.map((gateNumber) => ({ gateNumber }));
}

// Fiksan spisak fizičkih gate-ova — onemogući on-demand SSR fallback.
export const dynamicParams = false;

// ── DODAJ OVO: Forsira SSG umjesto SSR ──────────────────────
export const dynamic = 'force-static';

// NAPOMENA: 'revalidate' NIJE dodat namjerno. Ova stranica nema nikakav
// server-side fetch/podatak koji bi ISR trebalo da osvježava — sav sadržaj
// dolazi klijentski (polling u GatePageClient.tsx). Dodavanje revalidate-a
// bi periodično pokretalo serverless funkciju da regeneriše IDENTIČAN HTML,
// vraćajući invocations koje je čist SSG (dynamicParams=false, bez
// revalidate) sveo na 0 nakon build-a.

export default function Page() {
  return <GatePageClient />;
}