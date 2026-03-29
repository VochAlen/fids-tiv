import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { airlinesTable } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ iataCode: string }> }
) {
  try {
    const { iataCode } = await params;
    
    const [airline] = await db.select()
      .from(airlinesTable)
      .where(eq(airlinesTable.iataCode, iataCode));

    if (!airline) {
      return NextResponse.json(
        { error: 'Avio kompanija nije pronađena' },
        { status: 404 }
      );
    }

    return NextResponse.json(airline);
  } catch (error) {
    console.error('Error fetching airline:', error);
    return NextResponse.json(
      { error: 'Greška pri učitavanju avio kompanije' },
      { status: 500 }
    );
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ iataCode: string }> }
) {
  try {
    const { iataCode } = await params;
    const body = await request.json();
    
    console.log('Updating airline:', iataCode, 'with data:', body);

    // Proveri da li avio kompanija postoji
    const [existing] = await db.select()
      .from(airlinesTable)
      .where(eq(airlinesTable.iataCode, iataCode));

    if (!existing) {
      return NextResponse.json(
        { error: 'Avio kompanija nije pronađena' },
        { status: 404 }
      );
    }

    // Ažuriraj
    const [airline] = await db.update(airlinesTable)
      .set({
        airlineName: body.airlineName,
        hasBusinessClass: body.hasBusinessClass,
        winterSchedule: body.winterSchedule,
        summerSchedule: body.summerSchedule,
        updatedAt: new Date()
      })
      .where(eq(airlinesTable.iataCode, iataCode))
      .returning();

    console.log('Updated airline:', airline);

    return NextResponse.json(airline);
  } catch (error) {
    console.error('Error updating airline:', error);
    return NextResponse.json(
      { error: 'Greška pri ažuriranju avio kompanije: ' + (error as Error).message },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ iataCode: string }> }
) {
  try {
    const { iataCode } = await params;

    const [deleted] = await db.delete(airlinesTable)
      .where(eq(airlinesTable.iataCode, iataCode))
      .returning();

    if (!deleted) {
      return NextResponse.json(
        { error: 'Avio kompanija nije pronađena' },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting airline:', error);
    return NextResponse.json(
      { error: 'Greška pri brisanju avio kompanije' },
      { status: 500 }
    );
  }
}