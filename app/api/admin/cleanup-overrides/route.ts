import { NextResponse } from 'next/server';
import { runAutoReset, cleanupDepartedResourceAssignments } from '@/lib/override-utils';
import { getCurrentFlightDataSafe } from '@/lib/flight-data-service';

async function fetchAllFlights(): Promise<any[]> {
  try {
    const data = await getCurrentFlightDataSafe(); // ← direktan poziv, bez HTTP self-fetch-a
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

    // FIX (automatsko čišćenje DEPARTED dodjela — sigurnosna mreža): vidi
    // opširan komentar iznad cleanupDepartedResourceAssignments() u
    // lib/override-utils.ts. Pokriva test:gate-status:all/test:desk-status:all
    // sistem koji assign-checkin panel stvarno koristi (odvojen od
    // override:* sistema koji runAutoReset iznad čisti).
    const departedCleanup = await cleanupDepartedResourceAssignments(allFlights);

    return NextResponse.json({
      success: true,
      resetCount: results.length,
      details: results,
      departedCleanupCount: departedCleanup.length,
      departedCleanupDetails: departedCleanup,
      message: results.length > 0 || departedCleanup.length > 0
        ? `Resetovano ${results.length} override polja, uklonjeno ${departedCleanup.length} dodjela za poletjele letove`
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