// app/api/admin/specific-flights/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { db, specificFlightsTable, initializeDatabase } from '@/lib/db';
import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';

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

// Helper funkcija za formatiranje datuma - JEDNOSTAVNA
function formatDateSimple(date: any): string {
  if (!date) return '';
  
  try {
    // Ako je već string, vrati ga
    if (typeof date === 'string') {
      return date;
    }
    
    // Ako je Date objekat
    if (date instanceof Date) {
      // Provera za "Invalid Date"
      if (date.toString() === 'Invalid Date') {
        return '';
      }
      const timestamp = date.getTime();
      if (isNaN(timestamp)) {
        return '';
      }
      return date.toISOString();
    }
    
    return '';
  } catch {
    return '';
  }
}

// Helper funkcija za parsiranje datuma - JEDNOSTAVNA
function parseDateSimple(dateValue: any): Date | null {
  if (!dateValue) return null;
  
  try {
    // Ako je već Date objekat
    if (dateValue instanceof Date) {
      if (dateValue.toString() === 'Invalid Date') {
        return null;
      }
      return dateValue;
    }
    
    // Ako je string, pokušaj parsiranje
    if (typeof dateValue === 'string') {
      const date = new Date(dateValue);
      if (date.toString() === 'Invalid Date' || isNaN(date.getTime())) {
        return null;
      }
      return date;
    }
    
    return null;
  } catch {
    return null;
  }
}

// GET svi letovi
export async function GET(request: NextRequest) {
  try {
    console.log('=== GET ALL FLIGHTS API ===');
    
    await initializeDatabase();
    
    const flights = await db.select().from(specificFlightsTable).orderBy(specificFlightsTable.flightNumber);
    
    console.log('Found flights in DB:', flights.length);
    
    const formattedFlights = flights.map(flight => {
      const daysOfWeek = parseDaysOfWeek(flight.daysOfWeek);
      
      return {
        id: flight.id,
        flightNumber: flight.flightNumber,
        airlineIata: flight.airlineIata,
        alwaysBusinessClass: Boolean(flight.alwaysBusinessClass),
        winterOnly: Boolean(flight.winterOnly),
        summerOnly: Boolean(flight.summerOnly),
        daysOfWeek: daysOfWeek,
        validFrom: formatDateSimple(flight.validFrom),
        validUntil: formatDateSimple(flight.validUntil),
        createdAt: formatDateSimple(flight.createdAt),
        updatedAt: formatDateSimple(flight.updatedAt)
      };
    });
    
    console.log('Formatted flights:', formattedFlights.length);
    
    return NextResponse.json(formattedFlights);
  } catch (error) {
    console.error('=== GET ALL FLIGHTS API ERROR ===');
    console.error('Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch flights' },
      { status: 500 }
    );
  }
}

// CREATE novi let
export async function POST(request: NextRequest) {
  try {
    console.log('=== CREATE FLIGHT API ===');
    
    await initializeDatabase();
    const data = await request.json();
    
    console.log('Received data:', data);
    
    if (!data.flightNumber || !data.airlineIata) {
      console.log('Validation failed: flight number or airline IATA missing');
      return NextResponse.json(
        { error: 'Flight number and airline IATA code are required' },
        { status: 400 }
      );
    }
    
    const existingFlight = await db.select()
      .from(specificFlightsTable)
      .where(eq(specificFlightsTable.flightNumber, data.flightNumber.toUpperCase()))
      .limit(1);
    
    console.log('Existing flight check:', existingFlight.length > 0 ? 'Found' : 'Not found');
    
    if (existingFlight.length > 0) {
      console.log('Flight already exists');
      return NextResponse.json(
        { error: 'Flight already exists' },
        { status: 409 }
      );
    }
    
    // Parsiraj datume
    const validFrom = parseDateSimple(data.validFrom);
    const validUntil = parseDateSimple(data.validUntil);
    
    console.log('Parsed dates:', {
      validFrom: validFrom ? 'Valid' : 'Invalid/Null',
      validUntil: validUntil ? 'Valid' : 'Invalid/Null'
    });
    
    const flightData = {
      flightNumber: data.flightNumber.toUpperCase(),
      airlineIata: data.airlineIata.toUpperCase(),
      alwaysBusinessClass: Boolean(data.alwaysBusinessClass),
      winterOnly: Boolean(data.winterOnly),
      summerOnly: Boolean(data.summerOnly),
      daysOfWeek: Array.isArray(data.daysOfWeek) ? data.daysOfWeek : [],
      validFrom: validFrom,
      validUntil: validUntil,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    
    console.log('Inserting flight data:', flightData);
    
    const [newFlight] = await db.insert(specificFlightsTable)
      .values(flightData)
      .returning();
    
    console.log('Flight created successfully');
    
    revalidatePath('/admin/business-class');
    
    const daysOfWeek = parseDaysOfWeek(newFlight.daysOfWeek);
    
    const responseFlight = {
      id: newFlight.id,
      flightNumber: newFlight.flightNumber,
      airlineIata: newFlight.airlineIata,
      alwaysBusinessClass: Boolean(newFlight.alwaysBusinessClass),
      winterOnly: Boolean(newFlight.winterOnly),
      summerOnly: Boolean(newFlight.summerOnly),
      daysOfWeek: daysOfWeek,
      validFrom: formatDateSimple(newFlight.validFrom),
      validUntil: formatDateSimple(newFlight.validUntil),
      createdAt: formatDateSimple(newFlight.createdAt),
      updatedAt: formatDateSimple(newFlight.updatedAt)
    };
    
    console.log('Sending response');
    
    return NextResponse.json(responseFlight, { status: 201 });
    
  } catch (error) {
    console.error('=== CREATE FLIGHT API ERROR ===');
    console.error('Error:', error);
    if (error instanceof Error) {
      console.error('Error message:', error.message);
    }
    return NextResponse.json(
      { error: 'Failed to create flight' },
      { status: 500 }
    );
  }
}

// UPDATE let
export async function PUT(request: NextRequest) {
  try {
    console.log('=== UPDATE FLIGHT API ===');
    
    await initializeDatabase();
    const data = await request.json();
    
    console.log('Received data for update:', data);
    
    if (!data.id) {
      console.log('Validation failed: ID missing');
      return NextResponse.json(
        { error: 'Flight ID is required' },
        { status: 400 }
      );
    }
    
    // Parsiraj datume
    const validFrom = parseDateSimple(data.validFrom);
    const validUntil = parseDateSimple(data.validUntil);
    
    console.log('Parsed dates for update:', {
      validFrom: validFrom ? 'Valid' : 'Invalid/Null',
      validUntil: validUntil ? 'Valid' : 'Invalid/Null'
    });
    
    const updateData = {
      flightNumber: data.flightNumber?.toUpperCase(),
      airlineIata: data.airlineIata?.toUpperCase(),
      alwaysBusinessClass: data.alwaysBusinessClass !== undefined ? Boolean(data.alwaysBusinessClass) : undefined,
      winterOnly: data.winterOnly !== undefined ? Boolean(data.winterOnly) : undefined,
      summerOnly: data.summerOnly !== undefined ? Boolean(data.summerOnly) : undefined,
      daysOfWeek: data.daysOfWeek !== undefined ? (Array.isArray(data.daysOfWeek) ? data.daysOfWeek : []) : undefined,
      validFrom: data.validFrom !== undefined ? validFrom : undefined,
      validUntil: data.validUntil !== undefined ? validUntil : undefined,
      updatedAt: new Date()
    };
    
    // Ukloni undefined vrednosti
    const cleanUpdateData = Object.fromEntries(
      Object.entries(updateData).filter(([_, v]) => v !== undefined)
    );
    
    console.log('Updating flight with data:', cleanUpdateData);
    
    const [updatedFlight] = await db.update(specificFlightsTable)
      .set(cleanUpdateData)
      .where(eq(specificFlightsTable.id, data.id))
      .returning();
    
    console.log('Flight updated successfully');
    
    revalidatePath('/admin/business-class');
    
    const daysOfWeek = parseDaysOfWeek(updatedFlight.daysOfWeek);
    
    const responseFlight = {
      id: updatedFlight.id,
      flightNumber: updatedFlight.flightNumber,
      airlineIata: updatedFlight.airlineIata,
      alwaysBusinessClass: Boolean(updatedFlight.alwaysBusinessClass),
      winterOnly: Boolean(updatedFlight.winterOnly),
      summerOnly: Boolean(updatedFlight.summerOnly),
      daysOfWeek: daysOfWeek,
      validFrom: formatDateSimple(updatedFlight.validFrom),
      validUntil: formatDateSimple(updatedFlight.validUntil),
      createdAt: formatDateSimple(updatedFlight.createdAt),
      updatedAt: formatDateSimple(updatedFlight.updatedAt)
    };
    
    console.log('Sending response for update');
    
    return NextResponse.json(responseFlight);
    
  } catch (error) {
    console.error('=== UPDATE FLIGHT API ERROR ===');
    console.error('Error:', error);
    if (error instanceof Error) {
      console.error('Error message:', error.message);
    }
    return NextResponse.json(
      { error: 'Failed to update flight' },
      { status: 500 }
    );
  }
}

// DELETE let
export async function DELETE(request: NextRequest) {
  try {
    console.log('=== DELETE FLIGHT API ===');
    
    await initializeDatabase();
    
    const url = new URL(request.url);
    const id = url.searchParams.get('id');
    
    console.log('Deleting flight with ID:', id);
    
    if (!id) {
      console.log('Validation failed: ID missing');
      return NextResponse.json(
        { error: 'Flight ID is required' },
        { status: 400 }
      );
    }
    
    const [deletedFlight] = await db.delete(specificFlightsTable)
      .where(eq(specificFlightsTable.id, parseInt(id)))
      .returning();
    
    if (!deletedFlight) {
      console.log('Flight not found for deletion');
      return NextResponse.json(
        { error: 'Flight not found' },
        { status: 404 }
      );
    }
    
    console.log('Flight deleted successfully:', deletedFlight.flightNumber);
    
    revalidatePath('/admin/business-class');
    
    return NextResponse.json({ 
      success: true, 
      message: `Flight ${deletedFlight.flightNumber} deleted successfully` 
    });
    
  } catch (error) {
    console.error('=== DELETE FLIGHT API ERROR ===');
    console.error('Error:', error);
    if (error instanceof Error) {
      console.error('Error message:', error.message);
    }
    return NextResponse.json(
      { error: 'Failed to delete flight' },
      { status: 500 }
    );
  }
}