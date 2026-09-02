import { NextRequest, NextResponse } from 'next/server';
import { db, specificFlightsTable, initializeDatabase } from '@/lib/db';
import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';

// Helper za dekodiranje flightNumber
function decodeFlightNumber(encodedFlightNumber: string): string {
  console.log('Decoding flight number:', encodedFlightNumber);
  const decoded = decodeURIComponent(encodedFlightNumber).toUpperCase();
  console.log('Decoded flight number:', decoded);
  return decoded;
}

// Helper funkcija za parsiranje daysOfWeek
function parseDaysOfWeek(daysOfWeek: any): number[] {
  try {
    if (Array.isArray(daysOfWeek)) {
      return daysOfWeek;
    }
    
    if (typeof daysOfWeek === 'string') {
      const parsed = JSON.parse(daysOfWeek);
      return Array.isArray(parsed) ? parsed : [];
    }
    
    return [];
  } catch (error) {
    console.error('Error parsing daysOfWeek:', error);
    return [];
  }
}

// Helper funkcija za formatiranje datuma
function formatDate(date: Date | null): string | null {
  if (!date) return null;
  
  try {
    return date.toISOString();
  } catch (error) {
    console.error('Error formatting date:', error);
    return null;
  }
}

// Izmeni ovu definiciju - koristi Promise za params
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ flightNumber: string }> }
) {
  try {
    console.log('=== GET SPECIFIC FLIGHT API ===');
    
    // Await-uj params
    const resolvedParams = await params;
    console.log('Params:', resolvedParams);
    
    await initializeDatabase();
    const { flightNumber } = resolvedParams;
    const decodedFlightNumber = decodeFlightNumber(flightNumber);
    
    console.log('Looking for flight:', decodedFlightNumber);
    
    const [flight] = await db.select()
      .from(specificFlightsTable)
      .where(eq(specificFlightsTable.flightNumber, decodedFlightNumber));
    
    console.log('Found flight:', flight);
    
    if (!flight) {
      console.log('Flight not found');
      return NextResponse.json(
        { error: 'Flight not found' },
        { status: 404 }
      );
    }
    
    // Parse daysOfWeek
    const daysOfWeek = parseDaysOfWeek(flight.daysOfWeek);
    
    // Formatiraj datume
    const validFrom = flight.validFrom instanceof Date ? flight.validFrom : null;
    const validUntil = flight.validUntil instanceof Date ? flight.validUntil : null;
    const createdAt = flight.createdAt instanceof Date ? flight.createdAt : new Date();
    const updatedAt = flight.updatedAt instanceof Date ? flight.updatedAt : new Date();
    
    // Formatiraj odgovor
    const formattedFlight = {
      id: flight.id,
      flightNumber: flight.flightNumber,
      airlineIata: flight.airlineIata,
      alwaysBusinessClass: Boolean(flight.alwaysBusinessClass),
      winterOnly: Boolean(flight.winterOnly),
      summerOnly: Boolean(flight.summerOnly),
      daysOfWeek: daysOfWeek,
      validFrom: formatDate(validFrom),
      validUntil: formatDate(validUntil),
      createdAt: formatDate(createdAt) || '',
      updatedAt: formatDate(updatedAt) || ''
    };
    
    console.log('Formatted flight response:', formattedFlight);
    
    return NextResponse.json(formattedFlight);
    
  } catch (error) {
    console.error('=== GET SPECIFIC FLIGHT API ERROR ===');
    console.error('Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch specific flight' },
      { status: 500 }
    );
  }
}

// UPDATE let - isto izmeni
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ flightNumber: string }> }
) {
  try {
    console.log('=== UPDATE FLIGHT API ===');
    
    // Await-uj params
    const resolvedParams = await params;
    console.log('Params:', resolvedParams);
    
    await initializeDatabase();
    const { flightNumber } = resolvedParams;
    const decodedFlightNumber = decodeFlightNumber(flightNumber);
    const data = await request.json();
    
    console.log('Flight number to update:', decodedFlightNumber);
    console.log('Received data:', JSON.stringify(data, null, 2));
    
    // Proveri da li let postoji
    const [existingFlight] = await db.select()
      .from(specificFlightsTable)
      .where(eq(specificFlightsTable.flightNumber, decodedFlightNumber));
    
    console.log('Existing flight:', existingFlight);
    
    if (!existingFlight) {
      console.log('Flight not found for update');
      return NextResponse.json(
        { error: 'Flight not found' },
        { status: 404 }
      );
    }
    
    // Pripremi podatke za ažuriranje
    const updateData: any = {
      updatedAt: new Date()
    };
    
    // Ažuriraj samo data koja su poslata
    if (data.airlineIata !== undefined) updateData.airlineIata = data.airlineIata.toUpperCase();
    if (data.alwaysBusinessClass !== undefined) updateData.alwaysBusinessClass = Boolean(data.alwaysBusinessClass);
    if (data.winterOnly !== undefined) updateData.winterOnly = Boolean(data.winterOnly);
    if (data.summerOnly !== undefined) updateData.summerOnly = Boolean(data.summerOnly);
    
    if (data.daysOfWeek !== undefined) {
      updateData.daysOfWeek = Array.isArray(data.daysOfWeek) 
        ? data.daysOfWeek // Pošaljemo direktno array, Drizzle će ga serijalizovati
        : [];
    }
    
    // Handluj null vrednosti za datume
    if (data.validFrom !== undefined) {
      updateData.validFrom = data.validFrom ? new Date(data.validFrom) : null;
    }
    
    if (data.validUntil !== undefined) {
      updateData.validUntil = data.validUntil ? new Date(data.validUntil) : null;
    }
    
    console.log('Update data prepared:', updateData);
    
    // Izvrši ažuriranje
    const [updatedFlight] = await db.update(specificFlightsTable)
      .set(updateData)
      .where(eq(specificFlightsTable.flightNumber, decodedFlightNumber))
      .returning();
    
    console.log('Flight updated successfully:', updatedFlight);
    
    // Revalidiraj putanju
    revalidatePath('/admin/business-class');
    
    // Parse daysOfWeek za odgovor
    const daysOfWeek = parseDaysOfWeek(updatedFlight.daysOfWeek);
    
    // Formatiraj odgovor
    const formattedFlight = {
      id: updatedFlight.id,
      flightNumber: updatedFlight.flightNumber,
      airlineIata: updatedFlight.airlineIata,
      alwaysBusinessClass: Boolean(updatedFlight.alwaysBusinessClass),
      winterOnly: Boolean(updatedFlight.winterOnly),
      summerOnly: Boolean(updatedFlight.summerOnly),
      daysOfWeek: daysOfWeek,
      validFrom: formatDate(updatedFlight.validFrom),
      validUntil: formatDate(updatedFlight.validUntil),
      createdAt: formatDate(updatedFlight.createdAt) || '',
      updatedAt: formatDate(updatedFlight.updatedAt) || ''
    };
    
    console.log('Formatted response:', formattedFlight);
    
    return NextResponse.json(formattedFlight);
    
  } catch (error) {
    console.error('=== UPDATE SPECIFIC FLIGHT API ERROR ===');
    console.error('Error:', error);
    if (error instanceof Error) {
      console.error('Error message:', error.message);
      console.error('Error stack:', error.stack);
    }
    return NextResponse.json(
      { error: 'Failed to update specific flight' },
      { status: 500 }
    );
  }
}

// DELETE let - isto izmeni
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ flightNumber: string }> }
) {
  try {
    console.log('=== DELETE FLIGHT API ===');
    
    // Await-uj params
    const resolvedParams = await params;
    console.log('Params:', resolvedParams);
    
    await initializeDatabase();
    const { flightNumber } = resolvedParams;
    const decodedFlightNumber = decodeFlightNumber(flightNumber);
    
    console.log('Flight number to delete:', decodedFlightNumber);
    
    // Prvo proveri da li postoji
    const [existingFlight] = await db.select()
      .from(specificFlightsTable)
      .where(eq(specificFlightsTable.flightNumber, decodedFlightNumber));
    
    console.log('Flight to delete exists:', existingFlight);
    
    if (!existingFlight) {
      console.log('Flight not found for deletion');
      return NextResponse.json(
        { error: 'Flight not found' },
        { status: 404 }
      );
    }
    
    // Obriši let
    const [deletedFlight] = await db.delete(specificFlightsTable)
      .where(eq(specificFlightsTable.flightNumber, decodedFlightNumber))
      .returning();
    
    console.log('Flight deleted successfully:', deletedFlight);
    
    // Revalidiraj putanju
    revalidatePath('/admin/business-class');
    
    return NextResponse.json({ 
      success: true,
      message: `Flight ${decodedFlightNumber} deleted successfully`
    });
    
  } catch (error) {
    console.error('=== DELETE SPECIFIC FLIGHT API ERROR ===');
    console.error('Error:', error);
    if (error instanceof Error) {
      console.error('Error message:', error.message);
      console.error('Error stack:', error.stack);
    }
    return NextResponse.json(
      { error: 'Failed to delete specific flight' },
      { status: 500 }
    );
  }
}