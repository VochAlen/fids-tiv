import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { airlinesTable } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

export async function GET() {
  try {
    const airlines = await db.select().from(airlinesTable);
    return NextResponse.json(airlines);
  } catch (error) {
    console.error('Error fetching airlines:', error);
    return NextResponse.json(
      { error: 'Greška pri učitavanju avio kompanija' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    
    // Provera da li IATA kod već postoji
    const existing = await db.select()
      .from(airlinesTable)
      .where(eq(airlinesTable.iataCode, body.iataCode))
      .limit(1);
    
    if (existing.length > 0) {
      return NextResponse.json(
        { error: 'Avio kompanija sa ovim IATA kodom već postoji' },
        { status: 400 }
      );
    }
    
    const [airline] = await db.insert(airlinesTable).values(body).returning();
    return NextResponse.json(airline);
  } catch (error) {
    console.error('Error creating airline:', error);
    return NextResponse.json(
      { error: 'Greška pri kreiranju avio kompanije' },
      { status: 500 }
    );
  }
}