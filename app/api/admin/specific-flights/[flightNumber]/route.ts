// app/api/admin/specific-flights/[flightNumber]/route.ts
// FIX (migracija sa SQLite na Redis) — vidi lib/business-class-store.ts.
import { NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import {
  getSpecificFlightFromStore, updateSpecificFlightInStore, deleteSpecificFlightFromStore,
} from '@/lib/business-class-store';

const BUSINESS_CLASS_CACHE_CONTROL =
  'public, max-age=60, s-maxage=3600, stale-while-revalidate=600';

function decodeFlightNumber(encoded: string): string {
  return decodeURIComponent(encoded).toUpperCase();
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ flightNumber: string }> }
) {
  try {
    const { flightNumber } = await params;
    const flight = await getSpecificFlightFromStore(decodeFlightNumber(flightNumber));
    if (!flight) {
      return NextResponse.json({ error: 'Flight not found' }, { status: 404 });
    }
    return NextResponse.json(flight, {
      headers: {
        'Cache-Control': BUSINESS_CLASS_CACHE_CONTROL,
        'Cache-Tag': 'business-class',
        'Vercel-Cache-Tag': 'business-class',
      },
    });
  } catch (error) {
    console.error('Error fetching specific flight:', error);
    return NextResponse.json({ error: 'Failed to fetch specific flight' }, { status: 500 });
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ flightNumber: string }> }
) {
  try {
    const { flightNumber } = await params;
    const data = await request.json();
    const result = await updateSpecificFlightInStore(decodeFlightNumber(flightNumber), data);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    revalidateTag('business-class');
    return NextResponse.json(result.flight);
  } catch (error) {
    console.error('Error updating specific flight:', error);
    return NextResponse.json({ error: 'Failed to update specific flight' }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ flightNumber: string }> }
) {
  try {
    const { flightNumber } = await params;
    const decoded = decodeFlightNumber(flightNumber);
    const deleted = await deleteSpecificFlightFromStore(decoded);
    if (!deleted) {
      return NextResponse.json({ error: 'Flight not found' }, { status: 404 });
    }
    revalidateTag('business-class');
    return NextResponse.json({ success: true, message: `Flight ${decoded} deleted successfully` });
  } catch (error) {
    console.error('Error deleting specific flight:', error);
    return NextResponse.json({ error: 'Failed to delete specific flight' }, { status: 500 });
  }
}
