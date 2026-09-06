import { NextResponse } from 'next/server';
import { runAutoReset, cleanupDepartedResourceAssignments } from '@/lib/override-utils';
import { getCurrentFlightDataSafe } from '@/lib/flight-data-service';

// FIX (problematičan scenario — ruta bez ikakve autentifikacije, a STVARNO
// briše gate/desk dodjele i override polja): bilo ko sa ovim URL-om je
// mogao pokrenuti cleanup ručno, ponovljeno, bez ikakve provjere. Isti
// princip kao fix na app/api/cron/redis-cleanup/route.ts — pun kontekst
// tamo. Ovdje je važnije jer runAutoReset/cleanupDepartedResourceAssignments
// stvarno mijenjaju Redis stanje (override:*, test:gate-status:all,
// test:desk-status:all), ne samo dodaju TTL kao redis-cleanup.
function isAuthorizedCronRequest(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.warn('⚠️ CRON_SECRET nije podešen — /api/admin/cleanup-overrides je JAVNO dostupna ruta koja briše dodjele. Podesi CRON_SECRET env varijablu na Vercel-u.');
    return true;
  }
  return request.headers.get('authorization') === `Bearer ${secret}`;
}

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

export async function GET(request: Request) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return runCleanup();
}

export async function POST(request: Request) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return runCleanup();
}