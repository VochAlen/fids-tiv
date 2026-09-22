// app/api/admin/cleanup-overrides/route.ts
//
// v4 FIX: Ova ruta se poziva iz Vercel Cron-a (svaka 4h, vidi vercel.json).
// Vercel Cron automatski šalje `Authorization: Bearer ${CRON_SECRET}` header.
// Bez provjere, bilo ko sa javnim URL-om bi mogao okinuti cleanup i
// obrisati aktivne override-e.

import { NextResponse } from 'next/server';
import { runAutoReset } from '@/lib/override-utils';
import { getCurrentFlightData } from '@/lib/flight-data-service';
import { requireCronSecret } from '@/lib/admin-auth';
import type { Flight } from '@/types/flight';

async function fetchAllFlights(): Promise<Flight[]> {
  try {
    const data = await getCurrentFlightData();
    return [...(data.departures || []), ...(data.arrivals || [])];
  } catch (err) {
    console.error('[cleanup] Greška pri dohvatu letova:', err);
    return [];
  }
}

async function runCleanup() {
  try {
    const allFlights = await fetchAllFlights();

    if (!allFlights.length) {
      return NextResponse.json({
        success: false,
        message: 'Nisu dostupni podaci o letovima'
      });
    }

    const results = await runAutoReset(allFlights);

    return NextResponse.json({
      success: true,
      resetCount: results.length,
      details: results,
      message: results.length > 0
        ? `Resetovano ${results.length} polja`
        : 'Nema zastarjelih override-ova'
    });

  } catch (error) {
    console.error('[cleanup] Greška:', error);
    return NextResponse.json({ error: 'Greška pri cleanup-u' }, { status: 500 });
  }
}

export async function GET(request: Request) {
  // ── v4: Cron secret check ──
  const cronAuth = requireCronSecret(request);
  if (cronAuth) return cronAuth;
  return runCleanup();
}

export async function POST(request: Request) {
  // ── v4: Cron secret check ──
  const cronAuth = requireCronSecret(request);
  if (cronAuth) return cronAuth;
  return runCleanup();
}
