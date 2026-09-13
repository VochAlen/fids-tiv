// app/api/admin/destinations/[destinationCode]/[airlineIata]/route.ts
// FIX (migracija sa SQLite na Redis) — vidi lib/business-class-store.ts.
import { NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import {
  getDestinationFromStore, updateDestinationInStore, deleteDestinationFromStore,
} from '@/lib/business-class-store';

const BUSINESS_CLASS_CACHE_CONTROL =
  'public, max-age=60, s-maxage=3600, stale-while-revalidate=600';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ destinationCode: string; airlineIata: string }> }
) {
  try {
    const { destinationCode, airlineIata } = await params;
    const destination = await getDestinationFromStore(destinationCode, airlineIata);
    if (!destination) {
      return NextResponse.json({ error: 'Destinacija nije pronađena' }, { status: 404 });
    }
    return NextResponse.json(destination, {
      headers: {
        'Cache-Control': BUSINESS_CLASS_CACHE_CONTROL,
        'Cache-Tag': 'business-class',
        'Vercel-Cache-Tag': 'business-class',
      },
    });
  } catch (error) {
    console.error('Error fetching destination:', error);
    return NextResponse.json({ error: 'Greška pri učitavanju destinacije' }, { status: 500 });
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ destinationCode: string; airlineIata: string }> }
) {
  try {
    const { destinationCode, airlineIata } = await params;
    const body = await request.json();
    const result = await updateDestinationInStore(destinationCode, airlineIata, body);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    revalidateTag('business-class');
    return NextResponse.json(result.destination);
  } catch (error) {
    console.error('Error updating destination:', error);
    return NextResponse.json({ error: 'Greška pri ažuriranju destinacije' }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ destinationCode: string; airlineIata: string }> }
) {
  try {
    const { destinationCode, airlineIata } = await params;
    const deleted = await deleteDestinationFromStore(destinationCode, airlineIata);
    if (!deleted) {
      return NextResponse.json({ error: 'Destinacija nije pronađena' }, { status: 404 });
    }
    revalidateTag('business-class');
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting destination:', error);
    return NextResponse.json({ error: 'Greška pri brisanju destinacije' }, { status: 500 });
  }
}
