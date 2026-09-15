// app/api/pa-announcements/route.ts
//
// JAVNA (bez admin logina) ruta koju PA stranica (app/pa/PaPageClient.tsx)
// poll-uje da vidi ima li novih RUČNIH najava koje je osoblje poslalo preko
// /admin/pa panela. Namjerno POSEBNA od /api/admin/pa-announcement (koja
// STVARA najavu i JESTE admin-only preko middleware.ts) — PA ekran je
// fizički računar u operativnom centru, ne treba login da bi SLUŠAO.
//
// Isti Cache-Tag + revalidateTag() obrazac kao ostatak aplikacije
// (weather, gate-status-override, business-class) — dugačak CDN keš,
// trenutna invalidacija na svaku novu najavu preko POST rute.
import { NextResponse } from 'next/server';
import { safeRedisGet } from '@/lib/redis';

const PA_ANNOUNCEMENTS_KEY = 'pa:announcements';
// FIX (po zahtjevu — provjera da PA sistem ostaje unutar Pro plana):
// s-maxage=15 je bio KRAĆI od prosječnog poll intervala (~6s), ali ne
// dovoljno duži da stvarno iskoristi keš — grubo ~40% poziva je i dalje
// bilo stvarno izvršavanje funkcije (jedan PA ekran × ~14.400 poziva
// dnevno na ovu rutu = realno ~170K Function Invocations mjesečno prije
// ove izmjene). Produženo na s-maxage=30 — isti obrazac kao gate/desk-
// status-override (revalidateTag() u POST ruti daje TRENUTNU
// invalidaciju čim stigne prava nova najava, NEZAVISNO od ove brojke —
// ovo produženje smanjuje samo koliko često se poziva funkcija KAD SE
// NIŠTA ne mijenja, ne utiče na brzinu isporuke stvarne najave).
const CACHE_CONTROL = 'public, max-age=2, s-maxage=30, stale-while-revalidate=20';

export async function GET() {
  try {
    const raw = await safeRedisGet(PA_ANNOUNCEMENTS_KEY);
    const announcements = raw ? JSON.parse(raw) : [];
    return NextResponse.json(
      { announcements },
      {
        headers: {
          'Cache-Control': CACHE_CONTROL,
          'Cache-Tag': 'pa-announcements',
          'Vercel-Cache-Tag': 'pa-announcements',
        },
      }
    );
  } catch (error) {
    console.error('Error fetching PA announcements:', error);
    return NextResponse.json({ announcements: [] }, { status: 500 });
  }
}
