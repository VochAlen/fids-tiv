// app/api/test/gate-status-override/route.ts
import { NextResponse } from 'next/server';
import { getRedisClient } from '@/lib/redis';

// ⭐ Pomoćna funkcija za dohvatanje STDa leta
async function getFlightScheduledTime(flightNumber: string): Promise<string | null> {
  try {
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
    const res = await fetch(`${baseUrl}/api/flights?flightNumber=${flightNumber}&nocache=${Date.now()}`);
    if (!res.ok) return null;
    const data = await res.json();
    const allFlights = [...(data.departures || []), ...(data.arrivals || [])];
    const flight = allFlights.find((f: any) => f.FlightNumber === flightNumber);
    return flight?.ScheduledDepartureTime || null;
  } catch {
    return null;
  }
}

// ⭐ Parsiranje vremena
function parseTimeToDate(timeStr: string, dateRef: Date = new Date()): Date | null {
  if (!timeStr) return null;
  const [h, m] = timeStr.split(':').map(Number);
  if (isNaN(h) || isNaN(m)) return null;
  const d = new Date(dateRef);
  d.setHours(h, m, 0, 0);
  // Ako je vrijeme već prošlo danas, dodaj dan
  if (d < dateRef && dateRef.getTime() - d.getTime() > 30 * 60 * 1000) {
    d.setDate(d.getDate() + 1);
  }
  return d;
}

// ⭐ Pomoćna funkcija za dohvatanje STDa i ETDa leta
async function getFlightTimes(flightNumber: string): Promise<{ std: string | null; etd: string | null }> {
  try {
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
    const res = await fetch(`${baseUrl}/api/flights?flightNumber=${flightNumber}&nocache=${Date.now()}`);
    if (!res.ok) return { std: null, etd: null };
    const data = await res.json();
    const allFlights = [...(data.departures || []), ...(data.arrivals || [])];
    const flight = allFlights.find((f: any) => f.FlightNumber === flightNumber);
    return {
      std: flight?.ScheduledDepartureTime || null,
      etd: flight?.EstimatedDepartureTime || null,
    };
  } catch {
    return { std: null, etd: null };
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const gateNumber = searchParams.get('gateNumber');
  const client = getRedisClient();
  const now = new Date();

  if (gateNumber) {
    const redisKey = `test:gate-status:${gateNumber}`;
    const value = await client.get(redisKey);
    if (!value) {
      return NextResponse.json({ status: null, flightNumber: null, setAt: null });
    }
    
    const data = JSON.parse(value);
    
    // ⭐ Provjeri da li je let već poletio
if (data.flightNumber && data.status === 'open') {
  const { std, etd } = await getFlightTimes(data.flightNumber);
  // Koristi ETD ako postoji, inače STD
  const timeStr = etd || std;
  if (timeStr) {
    const depDate = parseTimeToDate(timeStr, new Date(data.setAt || now));
    // Dodaj tampon zonu od 30 minuta nakon polaska
    if (depDate && depDate.getTime() + 30 * 60 * 1000 < now.getTime()) {
      await client.del(redisKey);
      console.log(`[gate-cleanup] Deleted completed flight: ${data.flightNumber} (${timeStr} +30min passed)`);
      return NextResponse.json({ status: null, flightNumber: null, setAt: null });
    }
  }
}
    
    return NextResponse.json(data);
  }

  // Vrati sve gate-ove (uz čišćenje starih)
  const all: Record<string, any> = {};
  let cursor = '0';
  let cleanedCount = 0;
  
  do {
    const [nextCursor, keys] = await client.scan(cursor, 'MATCH', 'test:gate-status:*', 'COUNT', 100);
    cursor = nextCursor;
    for (const key of keys) {
      const gate = key.replace('test:gate-status:', '');
      const value = await client.get(key);
      if (value) {
        try {
          const data = JSON.parse(value);
          
          // ⭐ Provjeri da li je let već poletio
          let shouldDelete = false;
          if (data.flightNumber && data.status === 'open') {
            const stdTime = await getFlightScheduledTime(data.flightNumber);
            if (stdTime) {
              const stdDate = parseTimeToDate(stdTime, new Date(data.setAt || now));
              if (stdDate && stdDate < now) {
                shouldDelete = true;
                cleanedCount++;
                console.log(`[gate-cleanup] Deleting completed flight: ${data.flightNumber} (STD ${stdTime} passed) for gate ${gate}`);
              }
            }
          }
          
          if (shouldDelete) {
            await client.del(key);
            continue;
          }
          
          all[gate] = data;
        } catch (err) {
          console.warn(`[gate-cleanup] Deleting invalid key: ${key}`);
          await client.del(key);
          cleanedCount++;
        }
      }
    }
  } while (cursor !== '0');

  if (cleanedCount > 0) {
    console.log(`[gate-cleanup] Total cleaned: ${cleanedCount} old gate-status keys`);
  }

  return NextResponse.json(all);
}

export async function POST(request: Request) {
  const { gateNumber, action, flightNumber } = await request.json();
  const client = getRedisClient();
  const redisKey = `test:gate-status:${gateNumber}`;

  if (!gateNumber) {
    return NextResponse.json({ error: 'gateNumber required' }, { status: 400 });
  }

  if (action === 'open' && flightNumber) {
    // ⭐ Povećan TTL sa 3600 (1h) na 21600 (6h)
    const value = JSON.stringify({ status: 'open', flightNumber, setAt: Date.now() });
    await client.set(redisKey, value, 'EX', 21600);
    return NextResponse.json({ success: true, ttl: 21600 });
  }
  
  if (action === 'closed') {
    // ⭐ Povećan TTL sa 3600 (1h) na 21600 (6h)
    const value = JSON.stringify({ status: 'closed', flightNumber: flightNumber || '', setAt: Date.now() });
    await client.set(redisKey, value, 'EX', 21600);
    return NextResponse.json({ success: true, ttl: 21600 });
  }
  
  if (action === 'clear') {
    await client.del(redisKey);
    return NextResponse.json({ success: true });
  }
  
  return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
}