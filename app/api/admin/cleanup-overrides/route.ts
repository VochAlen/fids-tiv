/**
 * /api/admin/cleanup-overrides
 *
 * Jedan endpoint koji radi SVE:
 *  1. Briše override-ove za Departed/Cancelled/Diverted letove
 *  2. Resetuje CheckInDesk na STD - 30 minuta
 *  3. Resetuje GateNumber na ETD (ili STD ako ETD ne postoji)
 *
 * Poziva se:
 *  - Automatski svakih 60s iz /api/admin/auto-reset (cron/interval)
 *  - Tiho u pozadini iz getAllOverrides handlera
 *  - Ručno: GET /api/admin/cleanup-overrides
 */

import { NextResponse } from 'next/server';
import { runAutoReset } from '@/lib/override-utils';

const BASE_URL = (() => {
  const raw = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
  if (raw.startsWith('http')) return raw.replace(/\/$/, '');
  return `https://${raw.replace(/\/$/, '')}`;
})();

async function fetchAllFlights(): Promise<any[]> {
  try {
    const res = await fetch(`${BASE_URL}/api/flights?nocache=${Date.now()}`, {
      cache: 'no-store',
      headers: { 'Cache-Control': 'no-cache' }
    });
    if (!res.ok) return [];
    const data = await res.json();
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

    // runAutoReset iz override-utils sadrži svu logiku:
    //  - departed/cancelled/diverted → full delete + desk-status cleanup
    //  - CheckInDesk → reset na STD-30min
    //  - GateNumber → reset na ETD/STD
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

export async function GET() {
  return runCleanup();
}

export async function POST() {
  return runCleanup();
}