import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { destinationsTable } from '@/lib/db/schema';
import { and, eq } from 'drizzle-orm';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ destinationCode: string; airlineIata: string }> }
) {
  try {
    const { destinationCode, airlineIata } = await params;
    
    const [destination] = await db.select()
      .from(destinationsTable)
      .where(
        and(
          eq(destinationsTable.destinationCode, destinationCode),
          eq(destinationsTable.airlineIata, airlineIata)
        )
      )
      .limit(1);

    if (!destination) {
      return NextResponse.json(
        { error: 'Destinacija nije pronađena' },
        { status: 404 }
      );
    }

    // Parse JSON schedule objekte
    const parsedDestination = {
      ...destination,
      winterSchedule: typeof destination.winterSchedule === 'string' 
        ? JSON.parse(destination.winterSchedule) 
        : destination.winterSchedule,
      summerSchedule: typeof destination.summerSchedule === 'string'
        ? JSON.parse(destination.summerSchedule)
        : destination.summerSchedule
    };

    return NextResponse.json(parsedDestination);
  } catch (error) {
    console.error('Error fetching destination:', error);
    return NextResponse.json(
      { error: 'Greška pri učitavanju destinacije' },
      { status: 500 }
    );
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ destinationCode: string; airlineIata: string }> }
) {
  try {
    const { destinationCode, airlineIata } = await params;
    const body = await request.json();
    
    // Pripremi podatke - schedule objekte pretvori u JSON string
    const updateData = {
      ...body,
      winterSchedule: body.winterSchedule ? JSON.stringify(body.winterSchedule) : '{"hasBusinessClass":false,"startDate":null,"endDate":null}',
      summerSchedule: body.summerSchedule ? JSON.stringify(body.summerSchedule) : '{"hasBusinessClass":false,"startDate":null,"endDate":null}',
      updatedAt: new Date()
    };

    const [destination] = await db.update(destinationsTable)
      .set(updateData)
      .where(
        and(
          eq(destinationsTable.destinationCode, destinationCode),
          eq(destinationsTable.airlineIata, airlineIata)
        )
      )
      .returning();

    if (!destination) {
      return NextResponse.json(
        { error: 'Destinacija nije pronađena' },
        { status: 404 }
      );
    }

    // Parse JSON stringove nazad u objekte
    const parsedDestination = {
      ...destination,
      winterSchedule: typeof destination.winterSchedule === 'string' 
        ? JSON.parse(destination.winterSchedule) 
        : destination.winterSchedule,
      summerSchedule: typeof destination.summerSchedule === 'string'
        ? JSON.parse(destination.summerSchedule)
        : destination.summerSchedule
    };

    return NextResponse.json(parsedDestination);
  } catch (error) {
    console.error('Error updating destination:', error);
    return NextResponse.json(
      { error: 'Greška pri ažuriranju destinacije' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ destinationCode: string; airlineIata: string }> }
) {
  try {
    const { destinationCode, airlineIata } = await params;

    const [deleted] = await db.delete(destinationsTable)
      .where(
        and(
          eq(destinationsTable.destinationCode, destinationCode),
          eq(destinationsTable.airlineIata, airlineIata)
        )
      )
      .returning();

    if (!deleted) {
      return NextResponse.json(
        { error: 'Destinacija nije pronađena' },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting destination:', error);
    return NextResponse.json(
      { error: 'Greška pri brisanju destinacije' },
      { status: 500 }
    );
  }
}