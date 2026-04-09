// lib/override-utils.ts
import { getRedisClient } from '@/lib/redis';

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
  
  return minutesUntilDeparture <= 30 && minutesUntilDeparture > -120;
}

// Helper za dohvatanje scheduled time-a leta
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

// Helper za dohvatanje statusa leta
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

// Funkcija za auto-reset override-ova
export async function resetExpiredCheckInOverrides() {
  console.log('🔄 Provjeravam override-ove za auto-reset...');
  
  try {
    const client = getRedisClient();
    const keys = await client.keys('override:*');
    let resetCount = 0;
    
    for (const key of keys) {
      const overrides = await client.hgetall(key);
      const flightNumber = key.replace('override:', '');
      
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
      
      let flightResetCount = 0;
      
      if (isTerminated) {
        if (overrides.CheckInDesk) {
          await client.hdel(key, 'CheckInDesk');
          resetCount++;
          flightResetCount++;
          console.log(`✅ Auto-resetovan CheckInDesk za let ${flightNumber} (status: ${flightStatus})`);
        }
        
        if (overrides.GateNumber) {
          await client.hdel(key, 'GateNumber');
          resetCount++;
          flightResetCount++;
          console.log(`✅ Auto-resetovan GateNumber za let ${flightNumber} (status: ${flightStatus})`);
        }
        
        if (overrides.Terminal) {
          await client.hdel(key, 'Terminal');
          resetCount++;
          flightResetCount++;
          console.log(`✅ Auto-resetovan Terminal za let ${flightNumber} (status: ${flightStatus})`);
        }
        
        if (overrides.StatusEN) {
          await client.hdel(key, 'StatusEN');
          resetCount++;
          flightResetCount++;
          console.log(`✅ Auto-resetovan StatusEN za let ${flightNumber} (status: ${flightStatus})`);
        }
        
        if (overrides.BaggageReclaim) {
          await client.hdel(key, 'BaggageReclaim');
          resetCount++;
          flightResetCount++;
          console.log(`✅ Auto-resetovan BaggageReclaim za let ${flightNumber} (status: ${flightStatus})`);
        }
        
        if (flightResetCount > 0) {
          console.log(`   Resetovano ${flightResetCount} override-ova za let ${flightNumber}`);
        }
        
        const remaining = await client.hlen(key);
        if (remaining === 0) {
          await client.del(key);
        }
        continue;
      }
      
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

// Timer varijable
let resetTimer: NodeJS.Timeout | null = null;

export function startAutoResetTimer() {
  if (resetTimer) clearInterval(resetTimer);
  
  resetTimer = setInterval(async () => {
    await resetExpiredCheckInOverrides();
  }, 5 * 60 * 1000);
  
  console.log('✅ Auto-reset timer pokrenut (provjera svakih 5 minuta)');
}

export function stopAutoResetTimer() {
  if (resetTimer) {
    clearInterval(resetTimer);
    resetTimer = null;
  }
}

export function isTimerRunning() {
  return resetTimer !== null;
}