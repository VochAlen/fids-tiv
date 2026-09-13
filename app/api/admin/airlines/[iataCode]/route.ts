// app/api/admin/airlines/[iataCode]/route.ts
// FIX (migracija sa SQLite na Redis) — vidi lib/business-class-store.ts.
import { NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import {
  getAirlineFromStore, updateAirlineInStore, deleteAirlineFromStore,
} from '@/lib/business-class-store';

const BUSINESS_CLASS_CACHE_CONTROL =
  'public, max-age=60, s-maxage=3600, stale-while-revalidate=600';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ iataCode: string }> }
) {
  try {
    const { iataCode } = await params;
    const airline = await getAirlineFromStore(iataCode);
    if (!airline) {
      return NextResponse.json({ error: 'Avio kompanija nije pronađena' }, { status: 404 });
    }
    return NextResponse.json(airline, {
      headers: {
        'Cache-Control': BUSINESS_CLASS_CACHE_CONTROL,
        'Cache-Tag': 'business-class',
        'Vercel-Cache-Tag': 'business-class',
      },
    });
  } catch (error) {
    console.error('Error fetching airline:', error);
    return NextResponse.json({ error: 'Greška pri učitavanju avio kompanije' }, { status: 500 });
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ iataCode: string }> }
) {
  try {
    const { iataCode } = await params;
    const body = await request.json();
    const result = await updateAirlineInStore(iataCode, body);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    revalidateTag('business-class');
    return NextResponse.json(result.airline);
  } catch (error) {
    console.error('Error updating airline:', error);
    return NextResponse.json(
      { error: 'Greška pri ažuriranju avio kompanije: ' + (error as Error).message },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ iataCode: string }> }
) {
  try {
    const { iataCode } = await params;
    const deleted = await deleteAirlineFromStore(iataCode);
    if (!deleted) {
      return NextResponse.json({ error: 'Avio kompanija nije pronađena' }, { status: 404 });
    }
    revalidateTag('business-class');
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting airline:', error);
    return NextResponse.json({ error: 'Greška pri brisanju avio kompanije' }, { status: 500 });
  }
}
