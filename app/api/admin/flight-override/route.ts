import { NextResponse } from 'next/server';
import { getRedisClient } from '@/lib/redis';
import { resetExpiredCheckInOverrides, startAutoResetTimer, stopAutoResetTimer, isTimerRunning } from '@/lib/override-utils';

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

// Helper za parsiranje vremena (samo za provjeru u POST)
function parseTimeToMinutes(timeStr: string): number {
  if (!timeStr) return 0;
  const [hours, minutes] = timeStr.split(':').map(Number);
  if (isNaN(hours) || isNaN(minutes)) return 0;
  return hours * 60 + minutes;
}

function getCurrentMinutes(): number {
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes();
}

function shouldAutoResetCheckIn(scheduledTime: string): boolean {
  if (!scheduledTime) return false;
  const currentMinutes = getCurrentMinutes();
  const scheduledMinutes = parseTimeToMinutes(scheduledTime);
  const minutesUntilDeparture = scheduledMinutes - currentMinutes;
  return minutesUntilDeparture <= 30 && minutesUntilDeparture > -120;
}

async function getFlightScheduledTime(flightNumber: string): Promise<string | null> {
  try {
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
    const response = await fetch(`${baseUrl}/api/flights?flightNumber=${flightNumber}`, {
      cache: 'no-store',
      headers: { 'Cache-Control': 'no-cache' }
    });
    
    if (!response.ok) return null;
    
    const data = await response.json();
    const allFlights = [...(data.departures || []), ...(data.arrivals || [])];
    const flight = allFlights.find((f: any) => f.FlightNumber === flightNumber);
    
    return flight?.ScheduledDepartureTime || null;
  } catch (error) {
    console.error(`Error fetching scheduled time for ${flightNumber}:`, error);
    return null;
  }
}

async function getFlightStatus(flightNumber: string): Promise<string | null> {
  try {
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
    const response = await fetch(`${baseUrl}/api/flights?flightNumber=${flightNumber}`, {
      cache: 'no-store',
      headers: { 'Cache-Control': 'no-cache' }
    });
    
    if (!response.ok) return null;
    
    const data = await response.json();
    const allFlights = [...(data.departures || []), ...(data.arrivals || [])];
    const flight = allFlights.find((f: any) => f.FlightNumber === flightNumber);
    
    return flight?.StatusEN || null;
  } catch (error) {
    console.error(`Error fetching status for ${flightNumber}:`, error);
    return null;
  }
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
    
    if (body.action === 'startTimer') {
      startAutoResetTimer();
      return NextResponse.json({ 
        success: true, 
        message: 'Auto-reset timer pokrenut' 
      });
    }
    
    if (body.action === 'stopTimer') {
      stopAutoResetTimer();
      return NextResponse.json({ 
        success: true, 
        message: 'Auto-reset timer zaustavljen' 
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

    if (action === 'assign' && (!value || value.toString().trim() === '')) {
      return NextResponse.json({ message: 'Vrijednost (value) je obavezna kod akcije "assign".' }, { status: 400 });
    }

    // CheckInDesk logika
    if (field === 'CheckInDesk' && action === 'assign') {
      const scheduledTime = await getFlightScheduledTime(flightNumber);
      
      if (scheduledTime && shouldAutoResetCheckIn(scheduledTime)) {
        return NextResponse.json({ 
          message: `Ne možete otvoriti check-in za let ${flightNumber} manje od 30 minuta prije polijetanja (polijetanje u ${scheduledTime})` 
        }, { status: 400 });
      }
      
      const flightStatus = await getFlightStatus(flightNumber);
      const statusLower = (flightStatus || '').toLowerCase();
      
      if (statusLower.includes('departed') || statusLower.includes('poletio')) {
        return NextResponse.json({ 
          message: `Ne možete otvoriti check-in za let ${flightNumber} jer je već poletio` 
        }, { status: 400 });
      }
      if (statusLower.includes('cancelled') || statusLower.includes('otkazan')) {
        return NextResponse.json({ 
          message: `Ne možete otvoriti check-in za let ${flightNumber} jer je otkazan` 
        }, { status: 400 });
      }
      if (statusLower.includes('diverted') || statusLower.includes('preusmjeren')) {
        return NextResponse.json({ 
          message: `Ne možete otvoriti check-in za let ${flightNumber} jer je preusmjeren` 
        }, { status: 400 });
      }
    }

    // GateNumber logika
    if (field === 'GateNumber' && action === 'assign') {
      const flightStatus = await getFlightStatus(flightNumber);
      const statusLower = (flightStatus || '').toLowerCase();
      
      const isTerminated = 
        statusLower.includes('departed') || 
        statusLower.includes('poletio') ||
        statusLower.includes('cancelled') || 
        statusLower.includes('canceled') || 
        statusLower.includes('otkazan') ||
        statusLower.includes('diverted') || 
        statusLower.includes('preusmjeren');
      
      if (isTerminated) {
        return NextResponse.json({ 
          message: `Ne možete promijeniti Gate za let ${flightNumber} jer je let ${flightStatus}` 
        }, { status: 400 });
      }
    }

    client = getRedisClient();
    const redisKey = `override:${flightNumber}`;

    if (action === 'assign') {
      const cleanValue = value.toString().trim();
      await client.hset(redisKey, { [field]: cleanValue });
      await client.expire(redisKey, 21600); 
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
      const keys = await client.keys('override:*');
      const overrides: Record<string, any> = {};
      
      for (const key of keys) {
        const flightNumber = key.replace('override:', '');
        const data = await client.hgetall(key);
        if (Object.keys(data).length > 0) {
          overrides[flightNumber] = data;
        }
      }
      
      return NextResponse.json(overrides);
    } catch (error) {
      console.error('Error getting overrides:', error);
      return NextResponse.json({ error: 'Failed to get overrides' }, { status: 500 });
    }
  }
  
  if (action === 'timerStatus') {
    return NextResponse.json({
      timerRunning: isTimerRunning(),
      intervalMinutes: 5,
      thresholdMinutes: 30
    });
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