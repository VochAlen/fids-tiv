import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { destinationsTable } from '@/lib/db/schema';
import { and, eq, desc } from 'drizzle-orm';

export async function GET() {
  try {
    const destinations = await db.select().from(destinationsTable).orderBy(desc(destinationsTable.createdAt));
    
    // Parse JSON schedule objekte
    const parsedDestinations = destinations.map(dest => ({
      ...dest,
      winterSchedule: typeof dest.winterSchedule === 'string' 
        ? JSON.parse(dest.winterSchedule) 
        : dest.winterSchedule,
      summerSchedule: typeof dest.summerSchedule === 'string'
        ? JSON.parse(dest.summerSchedule)
        : dest.summerSchedule
    }));
    
    return NextResponse.json(parsedDestinations);
  } catch (error) {
    console.error('Error fetching destinations:', error);
    return NextResponse.json(
      { error: 'Greška pri učitavanju destinacija' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    
    // Provera da li destinacija već postoji za ovu avio kompaniju
    const existing = await db.select()
      .from(destinationsTable)
      .where(
        and(
          eq(destinationsTable.destinationCode, body.destinationCode),
          eq(destinationsTable.airlineIata, body.airlineIata)
        )
      )
      .limit(1);
    
    if (existing.length > 0) {
      return NextResponse.json(
        { error: 'Ova destinacija već postoji za ovu avio kompaniju' },
        { status: 400 }
      );
    }
    
    // Pripremi podatke - schedule objekte pretvori u JSON string
    const insertData = {
      ...body,
      winterSchedule: body.winterSchedule ? JSON.stringify(body.winterSchedule) : '{"hasBusinessClass":false,"startDate":null,"endDate":null}',
      summerSchedule: body.summerSchedule ? JSON.stringify(body.summerSchedule) : '{"hasBusinessClass":false,"startDate":null,"endDate":null}',
    };
    
    const [destination] = await db.insert(destinationsTable).values(insertData).returning();
    
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
    
    return NextResponse.json(parsedDestination, { status: 201 });
  } catch (error) {
    console.error('Error creating destination:', error);
    return NextResponse.json(
      { error: 'Greška pri kreiranju destinacije' },
      { status: 500 }
    );
  }
}