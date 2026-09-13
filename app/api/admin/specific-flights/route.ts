// app/api/admin/specific-flights/route.ts
//
// FIX (migracija sa SQLite na Redis) — vidi lib/business-class-store.ts.
//
// FIX (uklonjen mrtav kod): stari fajl je ovdje imao PUT i DELETE
// handlere koji su tražili zapis preko numeričkog `id` polja
// (data.id / ?id=) — ali app/admin/business-class/page.tsx (preko
// lib/business-class-service.ts) NIKAD nije pozivao PUT/DELETE na OVU
// putanju. Uvijek je koristio /api/admin/specific-flights/[flightNumber]
// (PUT/DELETE po broju leta), koja je i dalje tu i i dalje radi. Ti
// handleri ovdje su bili potpuno neupotrebljeni — uklonjeni umjesto
// migrirani, da se ne migrira mrtav kod.
import { NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import { getAllSpecificFlightsFromStore, createSpecificFlightInStore } from '@/lib/business-class-store';

const BUSINESS_CLASS_CACHE_CONTROL =
  'public, max-age=60, s-maxage=3600, stale-while-revalidate=600';

export async function GET() {
  try {
    const flights = await getAllSpecificFlightsFromStore();
    return NextResponse.json(flights, {
      headers: {
        'Cache-Control': BUSINESS_CLASS_CACHE_CONTROL,
        'Cache-Tag': 'business-class',
        'Vercel-Cache-Tag': 'business-class',
      },
    });
  } catch (error) {
    console.error('Error fetching specific flights:', error);
    return NextResponse.json({ error: 'Failed to fetch flights' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const data = await request.json();
    const result = await createSpecificFlightInStore(data);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    revalidateTag('business-class');
    return NextResponse.json(result.flight, { status: 201 });
  } catch (error) {
    console.error('Error creating specific flight:', error);
    return NextResponse.json({ error: 'Failed to create flight' }, { status: 500 });
  }
}
