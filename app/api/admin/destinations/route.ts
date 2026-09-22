// app/api/admin/destinations/route.ts
// FIX (migracija sa SQLite na Redis) — vidi lib/business-class-store.ts.
import { NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import { getAllDestinationsFromStore, createDestinationInStore } from '@/lib/business-class-store';

const BUSINESS_CLASS_CACHE_CONTROL =
  'public, max-age=60, s-maxage=3600, stale-while-revalidate=600';

export async function GET() {
  try {
    const destinations = await getAllDestinationsFromStore();
    return NextResponse.json(destinations, {
      headers: {
        'Cache-Control': BUSINESS_CLASS_CACHE_CONTROL,
        'Cache-Tag': 'business-class',
        'Vercel-Cache-Tag': 'business-class',
      },
    });
  } catch (error) {
    console.error('Error fetching destinations:', error);
    return NextResponse.json({ error: 'Greška pri učitavanju destinacija' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const result = await createDestinationInStore(body);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    revalidateTag('business-class');
    return NextResponse.json(result.destination, { status: 201 });
  } catch (error) {
    console.error('Error creating destination:', error);
    return NextResponse.json({ error: 'Greška pri kreiranju destinacije' }, { status: 500 });
  }
}
