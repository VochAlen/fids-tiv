// app/api/admin/desk-status-override/route.ts
import { NextResponse } from 'next/server';
import { getRedisClient } from '@/lib/redis';

// Helper za dobijanje STD vremena leta za dati desk
async function getFlightScheduledTimeForDesk(deskNumber: string): Promise<string | null> {
  try {
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
    const response = await fetch(`${baseUrl}/api/flights?nocache=${Date.now()}`, {
      cache: 'no-store',
      headers: { 'Cache-Control': 'no-cache' }
    });
    
    if (!response.ok) return null;
    const data = await response.json();
    
    // Pronađi let koji koristi ovaj desk
    const allFlights = [...(data.departures || []), ...(data.arrivals || [])];
    const flight = allFlights.find((f: any) => {
      if (!f.CheckInDesk) return false;
      const desks = f.CheckInDesk.split(',').map((d: string) => d.trim());
      return desks.includes(deskNumber) || 
             desks.includes(deskNumber.replace(/^0+/, '')) ||
             desks.includes(deskNumber.padStart(2, '0'));
    });
    
    return flight?.ScheduledDepartureTime || null;
  } catch (error) {
    console.error('Error fetching scheduled time:', error);
    return null;
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

    if (action === 'open' || action === 'closed') {
      // Default TTL: 2 sata
      let ttlSeconds = 2 * 60 * 60; // 7200 sekundi = 2 sata
      
      // Pokušaj dobiti STD za ovaj desk
      const scheduledTime = await getFlightScheduledTimeForDesk(deskNumber);
      
      if (scheduledTime) {
        const [h, m] = scheduledTime.split(':').map(Number);
        if (!isNaN(h) && !isNaN(m)) {
          const stdDate = new Date();
          stdDate.setHours(h, m, 0, 0);
          
          // Ako je STD već prošao danas, gledaj sutra
          if (stdDate.getTime() < Date.now()) {
            stdDate.setDate(stdDate.getDate() + 1);
          }
          
          const secondsUntilSTD = Math.floor((stdDate.getTime() - Date.now()) / 1000);
          
          if (secondsUntilSTD > 0) {
            // TTL = STD + 5 minuta (300 sekundi)
            ttlSeconds = secondsUntilSTD + 300;
            console.log(`[desk-status-override] Desk ${deskNumber} - STD: ${scheduledTime}, TTL: ${ttlSeconds}s (${Math.floor(ttlSeconds / 60)}min, do ${new Date(Date.now() + ttlSeconds * 1000).toLocaleTimeString()})`);
          }
        }
      }
      
      await client.set(redisKey, action, 'EX', ttlSeconds);
      
    } else if (action === 'clear') {
      await client.del(redisKey);
    } else {
      return NextResponse.json({ message: 'Nepoznata akcija' }, { status: 400 });
    }

    return NextResponse.json({ 
      success: true, 
      message: `Status saltera ${deskNumber} ažuriran` 
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