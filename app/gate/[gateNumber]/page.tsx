// app/gate/[gateNumber]/page.tsx
//
// FIX (problematičan scenario — "mina" u kodu): ovo je do sad bila puna,
// 531-linijska STARA implementacija gate ekrana (drugi lib —
// lib/flight-service.ts, drugi poll interval — 60s — potpuno nezavisna
// od ver2/ver2 arhitekture koju svi fizički gate monitori stvarno
// koriste). middleware.ts je već redirektovao /gate/[gateNumber] →
// /ver2/ver2/gate/[gateNumber] PRIJE nego što se ova stranica ikad
// renderuje, pa ovog trenutka NIJE aktivna — ali je i dalje sjedila kao
// potpuno funkcionalan, nezavisan kod koji bi "oživio" (sa svojim
// vlastitim, nezavisno održavanim pollingom) da se middleware matcher
// ikad promijeni ili greškom izbriše taj redirect blok.
//
// app/checkin/[deskNumber]/page.tsx je već davno dobio TAČNO ovaj tretman
// (redirect stub umjesto pune implementacije) — ovo samo usklađuje gate
// rutu sa istim, već uspostavljenim obrascem. Stara implementacija je
// sačuvana kao page.OLD-531-lines.txt.bak u istom folderu za slučaj da
// zatreba referenca.
import { redirect } from 'next/navigation';

export default function LegacyGateRedirect({
  params,
}: {
  params: { gateNumber: string };
}) {
  redirect(`/ver2/ver2/gate/${params.gateNumber}`);
}
