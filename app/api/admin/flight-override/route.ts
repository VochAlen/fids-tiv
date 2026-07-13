import { NextResponse } from 'next/server';
import { getRedisClient } from '@/lib/redis';
import { resetExpiredCheckInOverrides } from '@/lib/override-utils';
import { getCurrentFlightData } from '@/lib/flight-data-service';

// ============================================================
// SIGURNOSNA LISTA: Dozvoljava samo ova polja za upis u Redis
// ============================================================
const ALLOWED_FIELDS = [
  'GateNumber',
  'CheckInDesk',
  'BaggageReclaim',
  'StatusEN',
  'Note',
  'EstimatedDepartureTime',
  'Terminal'
];

// Vraća Date za HH:MM, SAMO ako nije stariji od 20 sati
function parseSTDtoDate(timeStr: string): Date | null {
  if (!timeStr) return null;
  const [hours, minutes] = timeStr.split(':').map(Number);
  if (isNaN(hours) || isNaN(minutes)) return null;

  const now = new Date();
  const d = new Date(now);
  d.setHours(hours, minutes, 0, 0);

  const diffMs = now.getTime() - d.getTime();
  const THIRTY_MIN_MS  = 30 * 60 * 1000;
  const TWENTY_HOURS_MS = 20 * 60 * 60 * 1000;

  if (diffMs > THIRTY_MIN_MS && diffMs < TWENTY_HOURS_MS) {
    d.setDate(d.getDate() + 1);
  } else if (diffMs >= TWENTY_HOURS_MS) {
    console.warn(`[parseSTDtoDate] Zastarjeli STD "${timeStr}" (diff: ${Math.round(diffMs / 3600000)}h) — odbačen`);
    return null;
  }

  return d;
}

function minutesUntilSTD(timeStr: string): number | null {
  const stdDate = parseSTDtoDate(timeStr);
  if (!stdDate) return null;
  return Math.floor((stdDate.getTime() - Date.now()) / 60_000);
}

function shouldAutoResetCheckIn(scheduledTime: string): boolean {
  if (!scheduledTime) return false;
  const mins = minutesUntilSTD(scheduledTime);
  return mins === null || (mins <= 30 && mins > -120);
}

// ── ZAMJENA za sve self-fetch funkcije ────────────────────────
// Umjesto HTTP poziva ka /api/flights, direktan poziv iste funkcije
// koju ta ruta koristi — nema round-trip-a, nema dodatne invokacije.
async function getFlightScheduleAndStatus(flightNumber: string): Promise<{ scheduledTime: string | null; status: string | null }> {
  try {
    const data = await getCurrentFlightData();
    const allFlights = [...(data.departures || []), ...(data.arrivals || [])];
    const flight = allFlights.find((f: any) => f.FlightNumber === flightNumber);
    return {
      scheduledTime: flight?.ScheduledDepartureTime || null,
      status: flight?.StatusEN || null,
    };
  } catch (error) {
    console.error(`Error fetching flight data for ${flightNumber}:`, error);
    return { scheduledTime: null, status: null };
  }
}

async function getFlightScheduledTime(flightNumber: string): Promise<string | null> {
  const { scheduledTime } = await getFlightScheduleAndStatus(flightNumber);
  return scheduledTime;
}

// ============================================================
// POST FUNKCIJA
// ============================================================
export async function POST(request: Request) {
  let client;
  try {
    const body = await request.json();

    if (body.action === 'resetExpired') {
      const resetCount = await resetExpiredCheckInOverrides();
      return NextResponse.json({
        success: true,
        resetCount,
        message: `Resetovano ${resetCount} override-ova`
      });
    }

    const { flightNumber, field, action, value } = body;

    if (!flightNumber || !field || !action) {
      return NextResponse.json({ message: 'Nedostaju parametri' }, { status: 400 });
    }

    if (!ALLOWED_FIELDS.includes(field)) {
      return NextResponse.json({
        message: `Zabranjeno polje: "${field}". Dozvoljena su samo: ${ALLOWED_FIELDS.join(', ')}`
      }, { status: 400 });
    }

    if (action !== 'assign' && action !== 'clear') {
      return NextResponse.json({ message: 'Nepoznata akcija. Koristite "assign" ili "clear".' }, { status: 400 });
    }

    if (action === 'assign' && value === undefined) {
      return NextResponse.json({ message: 'Vrijednost (value) je obavezna kod akcije "assign".' }, { status: 400 });
    }

    // CheckInDesk logika
    if (field === 'CheckInDesk' && action === 'assign') {
      const { scheduledTime, status: flightStatus } = await getFlightScheduleAndStatus(flightNumber);

      if (scheduledTime && shouldAutoResetCheckIn(scheduledTime)) {
        return NextResponse.json({
          message: `Ne možete otvoriti check-in za let ${flightNumber} manje od 30 minuta prije polijetanja (polijetanje u ${scheduledTime})`
        }, { status: 400 });
      }

      const statusLower = (flightStatus || '').toLowerCase();
      if (statusLower.includes('departed') || statusLower.includes('poletio')) {
        return NextResponse.json({ message: `Ne možete otvoriti check-in za let ${flightNumber} jer je već poletio` }, { status: 400 });
      }
      if (statusLower.includes('cancelled') || statusLower.includes('otkazan')) {
        return NextResponse.json({ message: `Ne možete otvoriti check-in za let ${flightNumber} jer je otkazan` }, { status: 400 });
      }
      if (statusLower.includes('diverted') || statusLower.includes('preusmjeren')) {
        return NextResponse.json({ message: `Ne možete otvoriti check-in za let ${flightNumber} jer je preusmjeren` }, { status: 400 });
      }
    }

    // GateNumber logika
    if (field === 'GateNumber' && action === 'assign') {
      const { status: flightStatus } = await getFlightScheduleAndStatus(flightNumber);
      const statusLower = (flightStatus || '').toLowerCase();
      const isTerminated =
        statusLower.includes('departed') || statusLower.includes('poletio') ||
        statusLower.includes('cancelled') || statusLower.includes('canceled') || statusLower.includes('otkazan') ||
        statusLower.includes('diverted') || statusLower.includes('preusmjeren');

      if (isTerminated) {
        return NextResponse.json({ message: `Ne možete promijeniti Gate za let ${flightNumber} jer je let ${flightStatus}` }, { status: 400 });
      }
    }

    client = getRedisClient();
    const redisKey = `override:${flightNumber}`;

    if (action === 'assign') {
      const cleanValue = value === '' ? '__EMPTY__' : value.toString().trim();
      await client.hset(redisKey, { [field]: cleanValue });

      if (field !== 'Terminal') {
        try {
          const { scheduledTime } = await getFlightScheduleAndStatus(flightNumber);
          if (scheduledTime) {
            const stdDate = parseSTDtoDate(scheduledTime);
            if (stdDate) {
              const secondsUntilSTD = Math.floor((stdDate.getTime() - Date.now()) / 1000);
              const ttl = Math.max(300, secondsUntilSTD + 7200);
              await client.expire(redisKey, ttl);
              console.log(`[flight-override] ${flightNumber} TTL: ${ttl}s (STD: ${scheduledTime}, istekne: ${new Date(Date.now() + ttl * 1000).toLocaleTimeString()})`);
            } else {
              await client.expire(redisKey, 300);
              console.warn(`[flight-override] ${flightNumber} zastarjeli STD "${scheduledTime}" — TTL=300s`);
            }
          } else {
            await client.expire(redisKey, 21600);
          }
        } catch {
          await client.expire(redisKey, 21600);
        }
      } else {
        await client.expire(redisKey, 86400);
      }

    } else if (action === 'clear') {
      await client.hdel(redisKey, field);
      const remaining = await client.hlen(redisKey);
      if (remaining === 0) {
        await client.del(redisKey);
      }
    }

    return NextResponse.json({
      success: true,
      message: `Uspješno: ${field} -> ${action === 'assign' ? value : 'Uklonjeno'}`
    });

  } catch (error) {
    console.error('Override API Error:', error);
    return NextResponse.json({ message: 'Serverska greška' }, { status: 500 });
  }
}

// ============================================================
// GET FUNKCIJA
// ============================================================
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action');

  if (action === 'getAllOverrides') {
    try {
      const client = getRedisClient();

      const keys: string[] = [];
      let cursor = '0';
      do {
        const [nextCursor, foundKeys] = await client.scan(cursor, 'MATCH', 'override:*', 'COUNT', 100);
        cursor = nextCursor;
        keys.push(...foundKeys);
      } while (cursor !== '0');

      const overrides: Record<string, any> = {};

      if (keys.length > 0) {
        const pipeline = client.pipeline();
        keys.forEach(key => pipeline.hgetall(key));
        const results = await pipeline.exec();

        let allFlights: any[] = [];
        try {
          const data = await getCurrentFlightData(); // ← direktan poziv, bez fetch-a
          allFlights = [...(data.departures || []), ...(data.arrivals || [])];
        } catch (e) {
          console.error('Could not fetch flights for auto-reset check:', e);
        }

        const keysToResetCheckIn: string[] = [];

        results?.forEach((result, i) => {
          const key = keys[i];
          const data = (result?.[1] as Record<string, string>) || {};
          if (!Object.keys(data).length) return;

          const flightNumber = key.replace('override:', '');

          if (data.CheckInDesk !== undefined && allFlights.length > 0) {
            const flight = allFlights.find((f: any) => f.FlightNumber === flightNumber);
            if (flight?.ScheduledDepartureTime) {
              const minsUntil = minutesUntilSTD(flight.ScheduledDepartureTime);
              const statusLower = (flight.StatusEN || '').toLowerCase();
              const isTerminated =
                statusLower.includes('departed') || statusLower.includes('poletio') ||
                statusLower.includes('cancelled') || statusLower.includes('otkazan') ||
                statusLower.includes('diverted') || statusLower.includes('preusmjeren');

              if ((minsUntil === null || minsUntil <= 30) && !isTerminated) {
                keysToResetCheckIn.push(key);
                delete data.CheckInDesk;
                console.log(`Auto-reset CheckInDesk za ${flightNumber} (STD: ${flight.ScheduledDepartureTime})`);
              }
            }
          }

          if (Object.keys(data).length > 0) overrides[flightNumber] = data;
        });

        if (keysToResetCheckIn.length > 0) {
          const resetPipeline = client.pipeline();
          keysToResetCheckIn.forEach(key => resetPipeline.hdel(key, 'CheckInDesk'));
          await resetPipeline.exec();

          const lenPipeline = client.pipeline();
          keysToResetCheckIn.forEach(key => lenPipeline.hlen(key));
          const lenResults = await lenPipeline.exec();

          const emptyKeys = keysToResetCheckIn.filter((_, i) => lenResults?.[i]?.[1] === 0);
          if (emptyKeys.length > 0) {
            const delPipeline = client.pipeline();
            emptyKeys.forEach(key => delPipeline.del(key));
            await delPipeline.exec();
          }
        }
      }

      return NextResponse.json(overrides);
    } catch (error) {
      console.error('Error getting overrides:', error);
      return NextResponse.json({ error: 'Failed to get overrides' }, { status: 500 });
    }
  }

  if (action === 'triggerReset') {
    const resetCount = await resetExpiredCheckInOverrides();
    return NextResponse.json({
      success: true,
      resetCount,
      message: `Resetovano ${resetCount} override-ova`
    });
  }

  const flightNumber = searchParams.get('flightNumber');

  if (!flightNumber) {
    return NextResponse.json({ message: 'Nedostaje flightNumber parametar' }, { status: 400 });
  }

  try {
    const scheduledTime = await getFlightScheduledTime(flightNumber);
    const shouldReset = scheduledTime ? shouldAutoResetCheckIn(scheduledTime) : false;

    return NextResponse.json({
      flightNumber,
      scheduledTime,
      shouldAutoReset: shouldReset,
      message: shouldReset ? `Check-in za let ${flightNumber} će biti automatski resetovan` : null
    });
  } catch (error) {
    console.error('Error checking auto-reset status:', error);
    return NextResponse.json({ message: 'Greška pri provjeri' }, { status: 500 });
  }
}