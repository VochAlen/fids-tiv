import { NextResponse } from 'next/server';
import { getRedisClient } from '@/lib/redis';

// ============================================================
// SIGURNOSNA LISTA: Dozvoljava samo ova polja za upis u Redis
// ============================================================
const ALLOWED_FIELDS = [
  'GateNumber',          // Izlaz (Gate)
  'CheckInDesk',         // Check-in šalteri
  'BaggageReclaim',      // Traka za prtljag (Dolasci)
  'StatusEN',            // Status leta (Quick buttons)
  'Note',                // Interne napomene
  'EstimatedDepartureTime', // Ručno izmijenjeno vrijeme
  'Terminal'             // Terminal
];

// ============================================================
// AUTO-RESET HELPER FUNKCIJE
// ============================================================

// Helper za parsiranje vremena
function parseTimeToMinutes(timeStr: string): number {
  if (!timeStr) return 0;
  const [hours, minutes] = timeStr.split(':').map(Number);
  if (isNaN(hours) || isNaN(minutes)) return 0;
  return hours * 60 + minutes;
}

// Helper za dobijanje trenutnog vremena u minutama
function getCurrentMinutes(): number {
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes();
}

// Provjera da li treba auto-resetovati check-in (30 minuta prije polijetanja)
function shouldAutoResetCheckIn(scheduledTime: string): boolean {
  if (!scheduledTime) return false;
  
  const currentMinutes = getCurrentMinutes();
  const scheduledMinutes = parseTimeToMinutes(scheduledTime);
  const minutesUntilDeparture = scheduledMinutes - currentMinutes;
  
  // Resetuj ako je manje od 30 minuta do polaska ILI više od 2 sata nakon polaska
  // (2 sata nakon je sigurnosna margina)
  return minutesUntilDeparture <= 30 && minutesUntilDeparture > -120;
}

// Helper za dohvatanje scheduled time-a leta
async function getFlightScheduledTime(flightNumber: string): Promise<string | null> {
  try {
    // Dohvati podatke o letovima
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
    const response = await fetch(`${baseUrl}/api/flights?flightNumber=${flightNumber}`, {
      cache: 'no-store',
      headers: { 'Cache-Control': 'no-cache' }
    });
    
    if (!response.ok) {
      console.error(`Failed to fetch flight data for ${flightNumber}`);
      return null;
    }
    
    const data = await response.json();
    const allFlights = [...(data.departures || []), ...(data.arrivals || [])];
    const flight = allFlights.find((f: any) => f.FlightNumber === flightNumber);
    
    return flight?.ScheduledDepartureTime || null;
    
  } catch (error) {
    console.error(`Error fetching scheduled time for ${flightNumber}:`, error);
    return null;
  }
}

// ============================================================
// FUNKCIJA ZA AUTO-RESET POSTOJEĆIH OVERRIDE-OVA
// ============================================================

// ============================================================
// FUNKCIJA ZA AUTO-RESET POSTOJEĆIH OVERRIDE-OVA
// ============================================================

export async function resetExpiredCheckInOverrides() {
  console.log('🔄 Provjeravam override-ove za auto-reset...');
  
  try {
    const client = getRedisClient();
    const keys = await client.keys('override:*');
    let resetCount = 0;
    
    for (const key of keys) {
      const overrides = await client.hgetall(key);
      const flightNumber = key.replace('override:', '');
      
      // Dohvati trenutni status leta
      const flightStatus = await getFlightStatus(flightNumber);
      const statusLower = (flightStatus || '').toLowerCase();
      
      // Provjeri da li je let završen (Departed, Cancelled, Diverted)
      const isTerminated = 
        statusLower.includes('departed') || 
        statusLower.includes('poletio') ||
        statusLower.includes('cancelled') || 
        statusLower.includes('canceled') || 
        statusLower.includes('otkazan') ||
        statusLower.includes('diverted') || 
        statusLower.includes('preusmjeren');
      
      // Ako je let završen, resetuj SVE override-ove (CheckInDesk i GateNumber)
      if (isTerminated) {
        let flightResetCount = 0;
        
        // Resetuj CheckInDesk ako postoji
        if (overrides.CheckInDesk) {
          await client.hdel(key, 'CheckInDesk');
          resetCount++;
          flightResetCount++;
          console.log(`✅ Auto-resetovan CheckInDesk za let ${flightNumber} (status: ${flightStatus})`);
        }
        
        // Resetuj GateNumber ako postoji
        if (overrides.GateNumber) {
          await client.hdel(key, 'GateNumber');
          resetCount++;
          flightResetCount++;
          console.log(`✅ Auto-resetovan GateNumber za let ${flightNumber} (status: ${flightStatus})`);
        }
        
        // Ako nema više polja, obriši cijeli ključ
        const remaining = await client.hlen(key);
        if (remaining === 0) {
          await client.del(key);
        }
        
        if (flightResetCount > 0) {
          console.log(`   Resetovano ${flightResetCount} override-ova za let ${flightNumber}`);
        }
        continue;
      }
      
      // Originalna logika za CheckInDesk (30 minuta prije polijetanja)
      if (overrides.CheckInDesk) {
        const scheduledTime = await getFlightScheduledTime(flightNumber);
        
        if (scheduledTime && shouldAutoResetCheckIn(scheduledTime)) {
          await client.hdel(key, 'CheckInDesk');
          resetCount++;
          console.log(`✅ Auto-resetovan CheckInDesk za let ${flightNumber} (polijetanje u ${scheduledTime})`);
          
          const remaining = await client.hlen(key);
          if (remaining === 0) {
            await client.del(key);
          }
        }
      }
    }
    
    if (resetCount > 0) {
      console.log(`✅ Auto-resetovano ukupno ${resetCount} override-ova`);
    }
    
    return resetCount;
  } catch (error) {
    console.error('Auto-reset error:', error);
    return 0;
  }
}

// Nova helper funkcija za dohvatanje statusa leta
async function getFlightStatus(flightNumber: string): Promise<string | null> {
  try {
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
    const response = await fetch(`${baseUrl}/api/flights?flightNumber=${flightNumber}`, {
      cache: 'no-store',
      headers: { 'Cache-Control': 'no-cache' }
    });
    
    if (!response.ok) {
      return null;
    }
    
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
// PERIODIČNI AUTO-RESET (svakih 5 minuta)
// ============================================================

let resetTimer: NodeJS.Timeout | null = null;

export function startAutoResetTimer() {
  if (resetTimer) clearInterval(resetTimer);
  
  resetTimer = setInterval(async () => {
    await resetExpiredCheckInOverrides();
  }, 5 * 60 * 1000); // svakih 5 minuta
  
  console.log('✅ Auto-reset timer pokrenut (provjera svakih 5 minuta)');
}

export function stopAutoResetTimer() {
  if (resetTimer) {
    clearInterval(resetTimer);
    resetTimer = null;
  }
}

// ============================================================
// GLAVNA POST FUNKCIJA
// ============================================================

// ============================================================
// GLAVNA POST FUNKCIJA
// ============================================================

export async function POST(request: Request) {
  let client;
  try {
    const body = await request.json();
    
    
    // ═══════════════════════════════════════════════════════════
    // SPECIJALNA AKCIJA ZA POKRETANJE AUTO-RESETA
    // ═══════════════════════════════════════════════════════════
    if (body.action === 'resetExpired') {
      const resetCount = await resetExpiredCheckInOverrides();
      return NextResponse.json({ 
        success: true, 
        resetCount,
        message: `Resetovano ${resetCount} override-ova` 
      });
    }
    
    const { flightNumber, field, action, value } = body;

    // 1. Osnovna provjera parametara
    if (!flightNumber || !field || !action) {
      return NextResponse.json({ message: 'Nedostaju parametri' }, { status: 400 });
    }

    // 2. SIGURNOSNA PROVJERA: Da li je polje uopšte dozvoljeno?
    if (!ALLOWED_FIELDS.includes(field)) {
      return NextResponse.json({ 
        message: `Zabranjeno polje: "${field}". Dozvoljena su samo: ${ALLOWED_FIELDS.join(', ')}` 
      }, { status: 400 });
    }

    // 3. Provjera ispravnosti akcije
    if (action !== 'assign' && action !== 'clear') {
      return NextResponse.json({ message: 'Nepoznata akcija. Koristite "assign" ili "clear".' }, { status: 400 });
    }

    // 4. Ako radimo "assign", mora biti i vrijednost
    if (action === 'assign' && (!value || value.toString().trim() === '')) {
      return NextResponse.json({ message: 'Vrijednost (value) je obavezna kod akcije "assign".' }, { status: 400 });
    }

    // ============================================================
    // 5. AUTO-RESET LOGIKA ZA CHECK-IN DESK
    // ============================================================
    if (field === 'CheckInDesk' && action === 'assign') {
      // Provjeri scheduled time leta
      const scheduledTime = await getFlightScheduledTime(flightNumber);
      
      if (scheduledTime && shouldAutoResetCheckIn(scheduledTime)) {
        return NextResponse.json({ 
          message: `Ne možete otvoriti check-in za let ${flightNumber} manje od 30 minuta prije polijetanja (polijetanje u ${scheduledTime})` 
        }, { status: 400 });
      }
      
      // Dodatna provjera: da li je let već poletio ili otkazan?
      try {
        const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
        const response = await fetch(`${baseUrl}/api/flights?flightNumber=${flightNumber}`, {
          cache: 'no-store'
        });
        const data = await response.json();
        const allFlights = [...(data.departures || []), ...(data.arrivals || [])];
        const flight = allFlights.find((f: any) => f.FlightNumber === flightNumber);
        
        if (flight) {
          const status = (flight.StatusEN || '').toLowerCase();
          if (status.includes('departed') || status.includes('poletio')) {
            return NextResponse.json({ 
              message: `Ne možete otvoriti check-in za let ${flightNumber} jer je već poletio` 
            }, { status: 400 });
          }
          if (status.includes('cancelled') || status.includes('otkazan')) {
            return NextResponse.json({ 
              message: `Ne možete otvoriti check-in za let ${flightNumber} jer je otkazan` 
            }, { status: 400 });
          }
          if (status.includes('diverted') || status.includes('preusmjeren')) {
            return NextResponse.json({ 
              message: `Ne možete otvoriti check-in za let ${flightNumber} jer je preusmjeren` 
            }, { status: 400 });
          }
        }
      } catch (error) {
        console.error('Error checking flight status:', error);
        // Nastavi sa izvršavanjem čak i ako ne možemo provjeriti status
      }
    }

    // ============================================================
    // 6. AUTO-RESET LOGIKA ZA GATE NUMBER
    // ============================================================
    if (field === 'GateNumber' && action === 'assign') {
      // Provjeri status leta
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
      
      // Dodatna provjera: da li je let već poletio (double-check)
      try {
        const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
        const response = await fetch(`${baseUrl}/api/flights?flightNumber=${flightNumber}`, {
          cache: 'no-store'
        });
        const data = await response.json();
        const allFlights = [...(data.departures || []), ...(data.arrivals || [])];
        const flight = allFlights.find((f: any) => f.FlightNumber === flightNumber);
        
        if (flight) {
          const status = (flight.StatusEN || '').toLowerCase();
          if (status.includes('departed') || status.includes('poletio')) {
            return NextResponse.json({ 
              message: `Ne možete promijeniti Gate za let ${flightNumber} jer je već poletio` 
            }, { status: 400 });
          }
          if (status.includes('cancelled') || status.includes('otkazan')) {
            return NextResponse.json({ 
              message: `Ne možete promijeniti Gate za let ${flightNumber} jer je otkazan` 
            }, { status: 400 });
          }
          if (status.includes('diverted') || status.includes('preusmjeren')) {
            return NextResponse.json({ 
              message: `Ne možete promijeniti Gate za let ${flightNumber} jer je preusmjeren` 
            }, { status: 400 });
          }
        }
      } catch (error) {
        console.error('Error checking flight status for Gate:', error);
      }
    }

    client = getRedisClient();
    const redisKey = `override:${flightNumber}`;

    if (action === 'assign') {
      // Čistimo unos od suvišnih razmaka i konvertujemo u string (sigurnost za Redis)
      const cleanValue = value.toString().trim();
      
      // Upisi vrijednost i postavi da se automatski briše za 6 sati (21600 sekundi)
      // Ovo je SPASAVANJE za memoriju na Redis Labs free planu!
      await client.hset(redisKey, { [field]: cleanValue });
      await client.expire(redisKey, 21600); 
      
    } else if (action === 'clear') {
      await client.hdel(redisKey, field);
      
      // Ako je ovo bio zadnji polje u hashu, obriši cijeli ključ (oslobađa memoriju)
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
// GET endpoint za provjeru auto-reset statusa
// ============================================================

// ============================================================
// GET endpoint za provjeru auto-reset statusa
// ============================================================

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action');
  
  // ═══════════════════════════════════════════════════════════
  // SPECIJALNA AKCIJA ZA DOHVAT SVIH OVERRIDE-OVA
  // ═══════════════════════════════════════════════════════════
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
  
  // Specijalna akcija za status timer-a
  if (action === 'timerStatus') {
    return NextResponse.json({
      timerRunning: resetTimer !== null,
      intervalMinutes: 5,
      thresholdMinutes: 30
    });
  }
  
  // Specijalna akcija za ručno pokretanje reset-a
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
  // ============================================================
// AUTO-START TIMERA PRI UČITAVANJU MODULA
// ============================================================

// Ovo se izvršava JEDNOM kada se modul učita na serveru
if (typeof window === 'undefined') {
  // Mali delay da se osigura da je Redis spreman
  setTimeout(() => {
    console.log('🚀 Auto-startovanje auto-reset timer-a...');
    startAutoResetTimer();
  }, 2000);
}

