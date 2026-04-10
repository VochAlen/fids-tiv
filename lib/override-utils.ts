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

// Provjera da li je let u "aktivnom" prozoru (nije još poletio više od 2h)
function isFlightActive(scheduledTime: string): boolean {
  if (!scheduledTime) return false;
  const currentMinutes = getCurrentMinutes();
  const scheduledMinutes = parseTimeToMinutes(scheduledTime);
  const minutesSinceDeparture = currentMinutes - scheduledMinutes;
  return minutesSinceDeparture < 120; // aktivan do 2h nakon STD
}

// Helper za dohvatanje SVIH aktivnih letova iz API-ja (jedan poziv za sve)
async function getAllActiveFlights(): Promise<Array<{
  FlightNumber: string;
  ScheduledDepartureTime: string;
  CheckInDesk?: string;
  GateNumber?: string;
  StatusEN?: string;
}>> {
  try {
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
    const response = await fetch(`${baseUrl}/api/flights`, {
      cache: 'no-store',
      headers: { 'Cache-Control': 'no-cache' }
    });
    if (!response.ok) return [];
    const data = await response.json();
    return [...(data.departures || []), ...(data.arrivals || [])];
  } catch (error) {
    console.error('Error fetching all flights:', error);
    return [];
  }
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

// ============================================================
// HELPER: Odluči šta uraditi sa CheckInDesk za dati let
//
// Logika:
//   1. Ako API već ima novi let sa DRUGAČIJIM STD i check-in brojem
//      → obriši override potpuno (novi let odmah dobija šalter)
//   2. Ako nema novog leta ili API nema check-in za taj broj leta
//      → postavi __EMPTY__ (šalter prazan dok novi let ne dođe)
// ============================================================
async function resolveCheckInReset(
  client: ReturnType<typeof getRedisClient>,
  key: string,
  flightNumber: string,
  currentSTD: string | null,
  allFlights: Array<{ FlightNumber: string; ScheduledDepartureTime: string; CheckInDesk?: string }>
): Promise<'deleted' | 'emptied' | 'skipped'> {

  // Pronađi sve letove sa istim brojem leta u API-ju
  const sameFlight = allFlights.filter(f => f.FlightNumber === flightNumber);

  if (sameFlight.length > 1 && currentSTD) {
    // Postoji više letova sa istim brojem — vjerovatno reciklirani broj leta
    // Pronađi "novi" let — onaj sa DRUGAČIJIM STD od trenutnog
    const newFlight = sameFlight.find(f =>
      f.ScheduledDepartureTime !== currentSTD &&
      f.CheckInDesk &&                          // ima check-in u API-ju
      isFlightActive(f.ScheduledDepartureTime)  // još nije završio
    );

    if (newFlight) {
      // Novi let ima šalter u API-ju → obriši override potpuno
      // resolveField(undefined, "3") = "3" → novi let odmah vidljiv
      await client.del(key);
      console.log(`🔄 Override OBRISAN za ${flightNumber} — novi let (STD: ${newFlight.ScheduledDepartureTime}) ima šalter ${newFlight.CheckInDesk} iz API-ja`);
      return 'deleted';
    }
  }

  // Nema novog leta sa šalterom → postavi __EMPTY__
  // Šalter ostaje prazan dok novi let ne dođe ili admin ne dodijeli
  await client.hset(key, { CheckInDesk: '__EMPTY__' });
  await client.expire(key, 21600);
  console.log(`✅ CheckInDesk → __EMPTY__ za let ${flightNumber} (STD: ${currentSTD ?? 'N/A'})`);
  return 'emptied';
}

// ============================================================
// GLAVNA FUNKCIJA: Auto-reset override-ova
// ============================================================
export async function resetExpiredCheckInOverrides() {
  console.log('🔄 Provjeravam override-ove za auto-reset...');

  try {
    const client = getRedisClient();
    const keys = await client.keys('override:*');
    let resetCount = 0;

    // Dohvati sve letove jednom (koristi se u oba prolaza)
    const allFlights = await getAllActiveFlights();

    // ============================================================
    // PROLAZ 1: Postojeći Redis override ključevi
    // ============================================================
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
        // Let završio — CheckInDesk i GateNumber → __EMPTY__ ili obriši key ako ima novi let
        if (overrides.CheckInDesk !== '__EMPTY__') {
          const currentSTD = await getFlightScheduledTime(flightNumber);
          const result = await resolveCheckInReset(client, key, flightNumber, currentSTD, allFlights);

          if (result !== 'skipped') {
            resetCount++;
            flightResetCount++;
          }

          // Ako je key obrisan, preskoči dalje procesiranje ovog leta
          if (result === 'deleted') continue;
        }

        if (overrides.GateNumber && overrides.GateNumber !== '__EMPTY__') {
          await client.hset(key, { GateNumber: '__EMPTY__' });
          await client.expire(key, 21600);
          resetCount++;
          flightResetCount++;
          console.log(`✅ GateNumber → __EMPTY__ za let ${flightNumber} (status: ${flightStatus})`);
        }

        // Terminal, StatusEN, BaggageReclaim → hdel (ne trebaju __EMPTY__)
        for (const field of ['Terminal', 'StatusEN', 'BaggageReclaim'] as const) {
          if (overrides[field]) {
            await client.hdel(key, field);
            resetCount++;
            flightResetCount++;
            console.log(`✅ Auto-resetovan ${field} za let ${flightNumber} (status: ${flightStatus})`);
          }
        }

        if (flightResetCount > 0) {
          console.log(`   Resetovano ${flightResetCount} polja za let ${flightNumber}`);
        }

        continue;
      }

      // T-30min za letove koji imaju override (nisu terminated)
      if (overrides.CheckInDesk !== '__EMPTY__') {
        const scheduledTime = await getFlightScheduledTime(flightNumber);

        if (scheduledTime && shouldAutoResetCheckIn(scheduledTime)) {
          const result = await resolveCheckInReset(client, key, flightNumber, scheduledTime, allFlights);
          if (result !== 'skipped') {
            resetCount++;
            console.log(`   T-30min: ${result === 'deleted' ? 'Override obrisan' : '__EMPTY__ postavljen'} za let ${flightNumber}`);
          }
        }
      }
    }

    // ============================================================
    // PROLAZ 2: Letovi iz API-ja koji NEMAJU Redis override key
    // Pokriva letove koji koriste API podatak direktno
    // ============================================================
    console.log('🔄 Prolaz 2: Letovi bez override-a za T-30min...');

    try {
      for (const flight of allFlights) {
        if (!flight.ScheduledDepartureTime) continue;
        if (!shouldAutoResetCheckIn(flight.ScheduledDepartureTime)) continue;

        const key = `override:${flight.FlightNumber}`;

        // Dohvati postojeći override ako postoji
        const existing = await client.hgetall(key).catch(() => ({} as Record<string, string>));

        // Preskoči ako je Prolaz 1 već obradio ovaj key
        if (existing.CheckInDesk === '__EMPTY__') continue;

        // Preskoči ako key već postoji sa nekim overrideom (Prolaz 1 je nadležan)
        if (Object.keys(existing).length > 0) continue;

        // Let nema override key → provjeri ima li recikliranog broja leta
        const result = await resolveCheckInReset(
          client,
          key,
          flight.FlightNumber,
          flight.ScheduledDepartureTime,
          allFlights
        );

        if (result !== 'skipped') {
          resetCount++;
        }
      }
    } catch (err) {
      console.error('⚠️ Prolaz 2 nije uspio (non-critical):', err);
    }

    if (resetCount > 0) {
      console.log(`✅ Auto-resetovano ukupno ${resetCount} override-ova`);
    } else {
      console.log('ℹ️ Nema override-ova za resetovanje');
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