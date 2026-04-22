// app/api/admin/desk-status-override/route.ts
import { NextResponse } from 'next/server';
import { getRedisClient } from '@/lib/redis';
import { computeOverrideTTL } from '@/lib/override-ttl';

// Helper za dobijanje vremena leta za dati desk
async function getFlightTimesForDesk(deskNumber: string): Promise<{ scheduledTime: string | null, estimatedTime: string | null }> {
  try {
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
    const response = await fetch(`${baseUrl}/api/flights?nocache=${Date.now()}`, {
      cache: 'no-store',
      headers: { 'Cache-Control': 'no-cache' }
    });
    
    if (!response.ok) return { scheduledTime: null, estimatedTime: null };
    const data = await response.json();
    
    const parseHHMM = (t: string): number | null => {
      const m = t?.match(/^(\d{1,2}):(\d{2})$/);
      if (!m) return null;
      const d = new Date();
      d.setHours(parseInt(m[1]), parseInt(m[2]), 0, 0);
      return d.getTime();
    };
    
    const allFlights = [...(data.departures || []), ...(data.arrivals || [])];
    
    // Pronađi sve letove koji koriste ovaj desk
    const relevantFlights = allFlights.filter((f: any) => {
      if (!f.CheckInDesk) return false;
      const desks = f.CheckInDesk.split(',').map((d: string) => d.trim());
      return desks.includes(deskNumber) || 
             desks.includes(deskNumber.replace(/^0+/, '')) ||
             desks.includes(deskNumber.padStart(2, '0'));
    });
    
    if (relevantFlights.length === 0) {
      return { scheduledTime: null, estimatedTime: null };
    }
    
    // Sortiraj po vremenu polijetanja
    const sorted = relevantFlights.sort((a, b) => {
      const timeA = parseHHMM(a.ScheduledDepartureTime) || Infinity;
      const timeB = parseHHMM(b.ScheduledDepartureTime) || Infinity;
      return timeA - timeB;
    });
    
    const now = Date.now();
    
    // Pronađi AKTIVNI let (check-in još nije zatvoren = STD - 30 min > now)
    const activeFlight = sorted.find(flight => {
      const stdMs = parseHHMM(flight.ScheduledDepartureTime);
      if (!stdMs) return false;
      const checkInClosesMs = stdMs - 30 * 60 * 1000; // STD - 30 min
      return checkInClosesMs > now;
    });
    
    // Ako nema aktivnog leta, vrati null (override će se obrisati)
    if (!activeFlight) {
      console.log(`[desk-helper] Desk ${deskNumber} - No active flight, override will be cleared`);
      return { scheduledTime: null, estimatedTime: null };
    }
    
    console.log(`[desk-helper] Desk ${deskNumber} - Active flight: ${activeFlight.FlightNumber} at ${activeFlight.ScheduledDepartureTime}`);
    
    return {
      scheduledTime: activeFlight.ScheduledDepartureTime,
      estimatedTime: activeFlight.EstimatedDepartureTime || null
    };
    
  } catch (error) {
    console.error('Error fetching flight times:', error);
    return { scheduledTime: null, estimatedTime: null };
  }
}

export async function POST(request: Request) {
  try {
    const { deskNumber, action } = await request.json();
    if (!deskNumber) {
      return NextResponse.json({ message: 'Nedostaje broj saltera' }, { status: 400 });
    }

    const client = getRedisClient();
    const redisKey = `desk-status:${deskNumber}`;
    
    let responseTtl = null;

    if (action === 'open' || action === 'closed') {
      // Dohvati vremena leta za ovaj desk
      const { scheduledTime, estimatedTime } = await getFlightTimesForDesk(deskNumber);
      
      // Ako nema aktivnog leta, odmah obriši override
      if (!scheduledTime) {
        await client.del(redisKey);
        return NextResponse.json({ 
          success: true, 
          message: `Nema aktivnog leta na salteru ${deskNumber}, override obrisan`,
          cleared: true
        });
      }
      
      // Izračunaj TTL koristeći computeOverrideTTL
      const ttl = computeOverrideTTL('CheckInDesk', scheduledTime, estimatedTime);
      responseTtl = ttl;
      
      console.log(`[desk-status-override] Desk ${deskNumber} - action: ${action}, TTL: ${ttl}s (${Math.floor(ttl / 60)}min)`);
      
      // Ako je TTL 0, odmah obriši (check-in je već zatvoren)
      if (ttl === 0) {
        await client.del(redisKey);
      } else {
        await client.set(redisKey, action, 'EX', ttl);
      }
      
    } else if (action === 'clear') {
      await client.del(redisKey);
    } else {
      return NextResponse.json({ message: 'Nepoznata akcija' }, { status: 400 });
    }

    return NextResponse.json({ 
      success: true, 
      message: `Status saltera ${deskNumber} ažuriran`,
      ...(responseTtl !== null && { ttl: responseTtl })
    });
    
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[desk-status-override] Redis error:', msg);
    return NextResponse.json(
      { message: 'Redis nedostupan, pokušajte ponovo za nekoliko sekundi' },
      { status: 503 }
    );
  }
}