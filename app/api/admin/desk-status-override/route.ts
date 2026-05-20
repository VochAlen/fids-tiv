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
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const deskNumber = searchParams.get('deskNumber');
  if (!deskNumber) return NextResponse.json({ message: 'Missing deskNumber' }, { status: 400 });
  const client = getRedisClient();
  const status = await client.get(`desk-status:${deskNumber}`);
  return NextResponse.json({ status: status || null });
}

// Helper: parsira HH:MM u Date koji je uvijek u budućnosti,
// ali NE više od 20 sati u budućnosti (sprječava pomak na prekosutra)
function parseSTDtoDate(scheduledTime: string): Date | null {
  if (!scheduledTime) return null;
  const [h, m] = scheduledTime.split(':').map(Number);
  if (isNaN(h) || isNaN(m)) return null;

  const now = new Date();
  const stdDate = new Date(now);
  stdDate.setHours(h, m, 0, 0);

  // Ako je STD u prošlosti za više od 30 minuta → pomakni na sutra,
  // ali SAMO ako je razlika manja od 20 sati (ne radi se o letu od juče)
  const diffMs = now.getTime() - stdDate.getTime();
  const THIRTY_MIN_MS = 30 * 60 * 1000;
  const TWENTY_HOURS_MS = 20 * 60 * 60 * 1000;

  if (diffMs > THIRTY_MIN_MS && diffMs < TWENTY_HOURS_MS) {
    stdDate.setDate(stdDate.getDate() + 1);
  } else if (diffMs >= TWENTY_HOURS_MS) {
    // Let je letio juče ili ranije — ne pomjeramo, vraćamo null
    // da bi TTL bio kratak fallback (120s)
    console.warn(`[desk-status-override] STD ${scheduledTime} izgleda zastario (diff: ${Math.round(diffMs/3600000)}h), koristim fallback TTL`);
    return null;
  }

  return stdDate;
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
      let ttlSeconds = 2 * 60 * 60; // fallback: 2 sata

      const scheduledTime = await getFlightScheduledTimeForDesk(deskNumber);

      if (scheduledTime) {
        const stdDate = parseSTDtoDate(scheduledTime);

        if (stdDate) {
          const secondsUntilSTD = Math.floor((stdDate.getTime() - Date.now()) / 1000);
          // TTL = do STD - 30min (check-in se zatvara 30min prije polijetanja)
          const ttlUntilClose = secondsUntilSTD - 30 * 60;

          if (ttlUntilClose > 60) {
            ttlSeconds = ttlUntilClose;
            console.log(
              `[desk-status-override] Desk ${deskNumber} - STD: ${scheduledTime}, ` +
              `TTL: ${ttlSeconds}s (${Math.floor(ttlSeconds / 60)}min, ` +
              `istekne: ${new Date(Date.now() + ttlSeconds * 1000).toLocaleTimeString()})`
            );
          } else {
            // STD je blizu ili prošao — kratak TTL, 2 minute
            ttlSeconds = 120;
            console.warn(`[desk-status-override] Desk ${deskNumber} - STD blizu/prošao, TTL=120s`);
          }
        } else {
          // parseSTDtoDate vratio null → zastarjeli STD → kratak TTL
          ttlSeconds = 120;
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
      message: `Status saltera ${deskNumber} ažuriran`,
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