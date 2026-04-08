// app/api/flights/route.ts
import { NextResponse } from 'next/server';
import { getRedisClient } from '@/lib/redis';
import { FlightBackupService } from '@/lib/backup/flight-backup-service';
import { FlightAutoProcessor, type AutoProcessedFlight } from '@/lib/backup/flight-auto-processor';
import type { Flight, FlightData, RawFlightData } from '@/types/flight';
import {
  mapRawFlight,
  expandFlightForMultipleGates,
  sortFlightsByTime,
  filterTodayFlights
} from '@/lib/flight-api-helpers';
import Redis from 'ioredis';

// KORISTIMO PRAVI URL ZA MONTENEGRO AIRPORTS
const FLIGHT_API_URL = 'https://montenegroairports.com/aerodromixs/cache-flights.php?airport=tv';

// Retry konfiguracija
const MAX_RETRIES = 2;
const RETRY_DELAY = 1000;

const userAgents = {
  chrome: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.5938.132 Safari/537.36',
  firefox: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:117.0) Gecko/20100101 Firefox/117.0',
  safari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 13_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15'
};

// ============================================================
// POMOĆNA FUNKCIJA: Učitavanje admin override-a iz Redis Labs
// ============================================================
  // ============================================================
  // POMOĆNA FUNKCIJA: Učitavanje admin override-a iz Redis Labs
  // Koristi SCAN umjesto KEYS kako ne bi zamrzao RAM na free planu
  // ============================================================
  async function applyKvOverrides(flights: Flight[]): Promise<Flight[]> {
    let client: Redis;
    try {
      client = getRedisClient();
      
      // 1. Pronađi sve ključeve koji počinju sa "override:" (koristi SCAN umjesto KEYS)
      const keys: string[] = [];
      let cursor = '0';
      
      do {
        // SCAN je siguran za memoriju - vraća po 100 ključeva po pozivu umjesto svih odjednom
        const scanResult = await client.scan(cursor, 'MATCH', 'override:*', 'COUNT', 100);
        cursor = scanResult[0];
        keys.push(...scanResult[1]);
        
        // Sigurnosno prekidanje ako ih previše očekivano (zaštita od beskonačne petlje ili bagova)
        if (keys.length > 200) break; 
      } while (cursor !== '0');

      if (keys.length === 0) {
        return flights; 
      }

      // 2. Uzmi sve podatke paralelno koristeći ioredis pipeline (veoma brzo)
      const pipeline = client.pipeline();
      keys.forEach(key => pipeline.hgetall(key));
      
      // ioredis pipeline.exec() vraća niz u formatu: [ [greska, rezultat], [greska, rezultat] ]
      const results = await pipeline.exec();

      // SIGURNOSNA PROVJERA: Ako pipeline vrati null (npr. pukla konekcija), prekini dalje
      if (!results || results.length === 0) {
        return flights; 
      }

      const overridesMap: Record<string, Record<string, string>> = {};
      
      keys.forEach((key, index) => {
        const result = results[index];
        
        // Provjera da nema greške i da rezultat postoji
        if (result && !result[0] && result[1]) {
          const flightNumber = key.replace('override:', '');
          
          // ioredis hgetall vraća čisti JS objekat: { GateNumber: '3', CheckInDesk: '1' }
          // (Mnogo lakše od Vercel KV-a koji vraća niz!)
          const parsedData = result[1] as Record<string, string>;
          
          if (Object.keys(parsedData).length > 0) {
            overridesMap[flightNumber] = parsedData;
          }
        }
      });

      // 3. Prepiši spoljne podatke sa lokalnim admin podacima + AUTO-CLEANUP
      return flights.map(flight => {
        const localOverride = overridesMap[flight.FlightNumber];
        if (localOverride) {
          // 🧹 AUTO-CLEANUP LOGIKA
          const statusLower = (flight.StatusEN || '').toLowerCase();
          
          // Ako je let POLETIO, OTKAZAN ili PREUSMJEREN, obriši override iz Redis-a
          // da ne bi "zagadio" budući let koji dobije isti broj leta (npr. YM101 sutra)
          if (
            statusLower.includes('departed') || 
            statusLower.includes('cancelled') || 
            statusLower.includes('diverted')
          ) {
            // Brišemo asinhrono (fire-and-forget) da ne usporava API odgovor FIDS-u
            client.del(`override:${flight.FlightNumber}`).catch(() => {});
            
            // Vraćamo ORIGINALAN podatak sa API-ja, potpuno ignorišemo stare override podatke
            return flight; 
          }

          // Ako let AKTIVAN (nije poletio/otkazan), primijeni override podataka
          return {
            ...flight,
            GateNumber: localOverride.GateNumber || flight.GateNumber,
            CheckInDesk: localOverride.CheckInDesk || flight.CheckInDesk,
            BaggageReclaim: localOverride.BaggageReclaim || flight.BaggageReclaim,
            StatusEN: localOverride.StatusEN || flight.StatusEN,
            Terminal: localOverride.Terminal || flight.Terminal,
          };
        }
        return flight;
      });

    } catch (error) {
      // KRITIČNO: Ako Redis padne, FIDS nastavlja raditi sa originalnim podacima
      console.error('⚠️ Redis Override read failed (FIDS continues normally):', error);
      return flights; 
    }
  }

async function fetchWithQuickRetry(url: string, options: RequestInit, retries = MAX_RETRIES): Promise<Response> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);
      
      const response = await fetch(url, {
        ...options,
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
      if (response.ok) {
        return response;
      }
      
      if (attempt < retries) {
        console.log(`Quick retry ${attempt}/${retries}...`);
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
      }
    } catch (error) {
      if (attempt === retries) {
        throw error;
      }
      console.log(`Quick retry after error ${attempt}/${retries}...`);
      await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
    }
  }
  
  throw new Error(`Live API fetch failed after ${retries} attempts`);
}

async function performEmergencyFetch(): Promise<Flight[] | null> {
  try {
    const emergencyResponse = await fetch(FLIGHT_API_URL, {
      method: 'GET',
      headers: {
        'User-Agent': userAgents.chrome,
        'Accept': 'application/json, text/javascript, */*; q=0.01',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': 'https://montenegroairports.com/',
        'Origin': 'https://montenegroairports.com',
      },
      signal: AbortSignal.timeout(10000)
    });

    if (!emergencyResponse.ok) {
      return null;
    }

    const rawData: RawFlightData[] = await emergencyResponse.json();
    
    if (!Array.isArray(rawData) || rawData.length === 0) {
      return null;
    }

    const emergencyMappedFlights = await Promise.all(
      rawData.slice(0, 5).map(raw => mapRawFlight(raw))
    );
    
    const emergencyFlights: Flight[] = [];
    
    emergencyMappedFlights.forEach((flight: Flight) => {
      emergencyFlights.push(flight);
    });
    
    return emergencyFlights;
  } catch (error) {
    console.error('❌ Emergency fetch failed:', error);
    return null;
  }
}

function removeDuplicateFlights(flights: Flight[]): Flight[] {
  const seen = new Map<string, Flight>();
  
  flights.forEach(flight => {
    const key = `${flight.FlightNumber}-${flight.ScheduledDepartureTime}-${flight.FlightType}`;
    
    if (seen.has(key)) {
      const existing = seen.get(key)!;
      
      if ((flight.GateNumber && !existing.GateNumber) || 
          (flight.CheckInDesk && !existing.CheckInDesk)) {
        seen.set(key, flight);
      }
    } else {
      seen.set(key, flight);
    }
  });
  
  return Array.from(seen.values());
}
// ============================================================
// SANITIZACIJA: Ukloni lažne "Arrived" statuse
// Ako je Aktuelno="0000" ili scheduled još u budućnosti (>10 min),
// API greškom šalje Arrived — ignorišemo taj status
// ============================================================
function sanitizeArrivedStatus(flights: Flight[]): Flight[] {
  const now = new Date();
  return flights.map(flight => {
    if (flight.FlightType !== 'arrival') return flight;

    const isArrivedStatus = /(arrived|sletio|landed)/i.test(flight.StatusEN || '');
    if (!isArrivedStatus) return flight;

    // Signal 1: Aktuelno je "0000" — let definitivno nije stigao
    const actualDigits = (flight.ActualDepartureTime || '').replace(/\D/g, '');
    if (actualDigits === '0000' || actualDigits === '') {
      console.log(`🧹 sanitize: clearing false Arrived for ${flight.FlightNumber} (Aktuelno=0000)`);
      return { ...flight, StatusEN: '', StatusMN: '' };
    }

    // Signal 2: Scheduled/Estimated još >10 minuta u budućnosti
    const timeStr = flight.ScheduledDepartureTime;
    if (timeStr) {
      const match = timeStr.match(/^(\d{2}):(\d{2})$/);
      if (match) {
        const scheduled = new Date();
        scheduled.setHours(parseInt(match[1]), parseInt(match[2]), 0, 0);
        const diffMinutes = (scheduled.getTime() - now.getTime()) / 60_000;
        if (diffMinutes > 10) {
          console.log(`🧹 sanitize: clearing false Arrived for ${flight.FlightNumber} (scheduled in ${diffMinutes.toFixed(0)} min)`);
          return { ...flight, StatusEN: '', StatusMN: '' };
        }
      }
    }

    return flight;
  });
}



export async function GET(): Promise<NextResponse> {
  const backupService = FlightBackupService.getInstance();
  let source: 'live' | 'backup' | 'auto-processed' | 'emergency' = 'live';
  let backupTimestamp: string | undefined;
  let autoProcessedCount = 0;
  let isOfflineMode = false;

  try {
    console.log('🔄 Attempting LIVE API fetch from Montenegro Airports...');
    
    const response = await fetchWithQuickRetry(FLIGHT_API_URL, {
      method: 'GET',
      headers: {
        'User-Agent': userAgents.chrome,
        'Accept': 'application/json, text/javascript, */*; q=0.01',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': 'https://montenegroairports.com/',
        'Origin': 'https://montenegroairports.com',
        'Connection': 'keep-alive',
        'DNT': '1'
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const rawData: RawFlightData[] = await response.json();

    if (!Array.isArray(rawData)) {
      throw new Error('Invalid data format received');
    }

    console.log(`✅ Montenegro Airports fetch successful: ${rawData.length} flights`);
    
    // Log raw data statistics
    const departuresRaw = rawData.filter(f => f.TipLeta === 'O');
    const arrivalsRaw = rawData.filter(f => f.TipLeta === 'I');
    console.log(`📊 RAW DATA: ${departuresRaw.length} departures (TipLeta=O), ${arrivalsRaw.length} arrivals (TipLeta=I)`);
    
    // Sample raw data
    console.log('📊 Sample raw data (first 3 flights):', 
      rawData.slice(0, 3).map(f => ({
        flight: `${f.Kompanija}${f.BrojLeta}`,
        type: f.TipLeta === 'O' ? 'DEPARTURE' : 'ARRIVAL',
        destination: f.Aerodrom,
        scheduled: f.Planirano
      }))
    );

    // Process live data - map to Flight objects
const mappedFlights = await Promise.all(
  rawData.map((raw: RawFlightData) => mapRawFlight(raw))
)

// Dodaj HasOperatorEstimate na osnovu SIROVOG Aktuelno polja
rawData.forEach((raw, i) => {
  if (mappedFlights[i]) {
    (mappedFlights[i] as any).HasOperatorEstimate = raw.Aktuelno === "0000"
  }
})

    console.log(`📊 AFTER MAPPING: ${mappedFlights.length} total flights`);
    console.log(`📊 Mapped: ${mappedFlights.filter(f => f.FlightType === 'departure').length} departures, ${mappedFlights.filter(f => f.FlightType === 'arrival').length} arrivals`);
    
    // Sample mapped flights
    console.log('📊 Sample mapped flights (first 3):', 
      mappedFlights.slice(0, 3).map(f => ({
        id: f.id,
        flight: f.FlightNumber,
        type: f.FlightType,
        destination: f.DestinationAirportCode,
        time: f.ScheduledDepartureTime
      }))
    );

    // Filter today flights
    let todayFlights = filterTodayFlights(mappedFlights);
    
    console.log(`📊 AFTER TODAY FILTER: ${todayFlights.length} flights`);
    console.log(`📊 Today: ${todayFlights.filter(f => f.FlightType === 'departure').length} departures, ${todayFlights.filter(f => f.FlightType === 'arrival').length} arrivals`);
    
    // Remove duplicates
    todayFlights = removeDuplicateFlights(todayFlights);
    
    console.log(`📊 AFTER DEDUPLICATION: ${todayFlights.length} flights`);
    console.log(`📊 Dedup: ${todayFlights.filter(f => f.FlightType === 'departure').length} departures, ${todayFlights.filter(f => f.FlightType === 'arrival').length} arrivals`);

    // Expand flights with multiple gates/desks
    const expandedFlights: Flight[] = [];
    
    todayFlights.forEach((flight: Flight) => {
      if ((flight.GateNumber && flight.GateNumber.includes(',')) || 
          (flight.CheckInDesk && flight.CheckInDesk.includes(','))) {
        const expanded = expandFlightForMultipleGates(flight);
        expandedFlights.push(...expanded);
      } else {
        expandedFlights.push(flight);
      }
    });

    // Remove duplicates after expansion
    const finalFlights = removeDuplicateFlights(expandedFlights);

    console.log(`📊 FINAL FLIGHTS: ${finalFlights.length} total`);
    console.log(`📊 Final: ${finalFlights.filter(f => f.FlightType === 'departure').length} departures, ${finalFlights.filter(f => f.FlightType === 'arrival').length} arrivals`);

    // Save backup
    try {
      const backupId = backupService.saveBackup(finalFlights);
      console.log(`💾 Backup saved from live data: ${backupId} (${finalFlights.length} flights)`);
    } catch (backupError: unknown) {
      const errorMsg = backupError instanceof Error ? backupError.message : 'Unknown backup error';
      console.error('⚠️ Backup save failed:', errorMsg);
    }

    // SEPARATE DEPARTURES AND ARRIVALS - CRITICAL PART
       let departures = sortFlightsByTime(
      finalFlights.filter((f: Flight) => f.FlightType === 'departure')
    );

    let arrivals = sortFlightsByTime(
      finalFlights.filter((f: Flight) => f.FlightType === 'arrival')
    );

    // ADMIN OVERRIDES: Učitaj iz Vercel KV i nadjacči spoljne podatke
    // ADMIN OVERRIDES: Učitaj iz Vercel KV i nadjacči spoljne podatke
    [departures, arrivals] = await Promise.all([
      applyKvOverrides(departures),
      applyKvOverrides(arrivals)
    ]);

    // SANITIZACIJA: Ukloni lažne Arrived statuse (Aktuelno=0000 ili let još u budućnosti)
    arrivals = sanitizeArrivedStatus(arrivals);



    // DEFAULT BAGGAGE BELT LOGIKA:
    // Za sve dolaske koji JOŠ NISU stigli i nemaju traku, automatski dodijeli "2"
    arrivals = arrivals.map((flight: Flight) => {
      const statusLower = (flight.StatusEN || "").toLowerCase();
      const isArrived = statusLower.includes("arrived") || statusLower.includes("sletio") || statusLower.includes("landed");
      
      // Ako let nije stigao i nema trake (niti admin ručno nije dodijelio), stavi "2"
      if (!isArrived && !flight.BaggageReclaim) {
        return {
          ...flight,
          BaggageReclaim: "2"
        };
      }
      return flight;
    });



    const totalFlights = departures.length + arrivals.length;
    
    console.log(`📊 FINAL SORTED DATA: ${departures.length} departures, ${arrivals.length} arrivals, total: ${totalFlights}`);
    
    // Log departure details
    if (departures.length > 0) {
      console.log('🛫 DEPARTURES (first 5):', departures.slice(0, 5).map(f => ({
        id: f.id,
        flight: f.FlightNumber,
        dest: f.DestinationAirportCode,
        time: f.ScheduledDepartureTime,
        type: f.FlightType,
        status: f.StatusEN
      })));
    }
    
    // Log arrival details
    if (arrivals.length > 0) {
      console.log('🛬 ARRIVALS (first 5):', arrivals.slice(0, 5).map(f => ({
        id: f.id,
        flight: f.FlightNumber,
        origin: f.DestinationAirportCode,
        time: f.ScheduledDepartureTime,
        type: f.FlightType,
        status: f.StatusEN
      })));
    }
    
    // Verify that no flight is misclassified
    const misclassified = finalFlights.filter(f => 
      (f.FlightType === 'departure' && f.DestinationAirportCode === 'TIV') ||
      (f.FlightType === 'arrival' && f.DestinationAirportCode !== 'TIV')
    );
    
    if (misclassified.length > 0) {
      console.warn('⚠️ WARNING: Found potentially misclassified flights:', misclassified.slice(0, 3));
    } else {
      console.log('✅ All flights correctly classified as departure or arrival');
    }
    
    const flightData: FlightData = {
      departures,
      arrivals,
      lastUpdated: new Date().toISOString(),
      source: 'live',
      totalFlights,
      isOfflineMode: false
    };

    return NextResponse.json(flightData, {
      headers: {
        'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=60',
        'X-Data-Source': 'live',
        'X-Backup-Available': 'true',
        'X-Total-Flights': flightData.totalFlights.toString(),
        'X-Departures': departures.length.toString(),
        'X-Arrivals': arrivals.length.toString()
      }
    });

  } catch (liveError: unknown) {
    const errorMessage = liveError instanceof Error ? liveError.message : 'Unknown live API error';
    console.error('❌ Montenegro Airports API fetch failed:', errorMessage);
    console.log('🔄 Switching to BACKUP + AUTO-PROCESSING mode...');
    
    isOfflineMode = true;
    source = 'auto-processed';

    try {
      const latestBackup = backupService.getLatestBackup();
      
      if (latestBackup.flights.length > 0) {
        console.log(`✅ Using BACKUP data from ${latestBackup.timestamp} (${latestBackup.flights.length} flights)`);
        console.log(`📊 Backup: ${latestBackup.flights.filter(f => f.FlightType === 'departure').length} departures, ${latestBackup.flights.filter(f => f.FlightType === 'arrival').length} arrivals`);
        
        const processor = new FlightAutoProcessor(latestBackup.flights);
        const processedFlights = processor.processFlights();
        const simulatedFlights = FlightAutoProcessor.simulateRealTimeProgress(processedFlights);
        
        let autoProcessedDepartures = sortFlightsByTime(
          simulatedFlights.filter((f: AutoProcessedFlight) => f.FlightType === 'departure')
        );
        
        let autoProcessedArrivals = sortFlightsByTime(
          simulatedFlights.filter((f: AutoProcessedFlight) => f.FlightType === 'arrival')
        );

        // ADMIN OVERRIDES: Učitaj iz Vercel KV i nadjacči spoljne podatke
        // ADMIN OVERRIDES: Učitaj iz Vercel KV i nadjacči spoljne podatke
        [autoProcessedDepartures, autoProcessedArrivals] = await Promise.all([
          applyKvOverrides(autoProcessedDepartures),
          applyKvOverrides(autoProcessedArrivals)
        ]);
   autoProcessedArrivals = sanitizeArrivedStatus(autoProcessedArrivals);
        // DEFAULT BAGGAGE BELT LOGIKA (Backup mode)
        autoProcessedArrivals = autoProcessedArrivals.map((flight: Flight) => {
          const statusLower = (flight.StatusEN || "").toLowerCase();
          const isArrived = statusLower.includes("arrived") || statusLower.includes("sletio") || statusLower.includes("landed");
          
          if (!isArrived && !flight.BaggageReclaim) {
            return { ...flight, BaggageReclaim: "2" };
          }
          return flight;
        });

        autoProcessedCount = simulatedFlights.filter((f: AutoProcessedFlight) => f.AutoProcessed).length;
        source = autoProcessedCount > 0 ? 'auto-processed' : 'backup';
        
        const totalFlights = autoProcessedDepartures.length + autoProcessedArrivals.length;
        
        const flightData: FlightData = {
          departures: autoProcessedDepartures,
          arrivals: autoProcessedArrivals,
          lastUpdated: latestBackup.timestamp,
          source,
          backupTimestamp: latestBackup.timestamp,
          autoProcessedCount,
          isOfflineMode: true,
          totalFlights,
          warning: 'Using backup data. Live API temporarily unavailable.'
        };

        console.log(`📊 BACKUP data ready: ${autoProcessedDepartures.length} departures, ${autoProcessedArrivals.length} arrivals, total: ${flightData.totalFlights}`);

        return NextResponse.json(flightData, {
          headers: {
            'Cache-Control': 'public, s-maxage=10, stale-while-revalidate=30',
            'X-Data-Source': source,
            'X-Offline-Mode': 'true',
            'X-Backup-Timestamp': latestBackup.timestamp,
            'X-Total-Flights': flightData.totalFlights.toString()
          }
        });
      } else {
        console.log('⚠️ Backup is empty, attempting emergency fetch...');
        
        const emergencyFlights = await performEmergencyFetch();
        
        if (emergencyFlights && emergencyFlights.length > 0) {
          backupService.saveBackup(emergencyFlights);
          
          const processor = new FlightAutoProcessor(emergencyFlights);
          const processedFlights = processor.processFlights();
          
             let departures = sortFlightsByTime(
            processedFlights.filter((f: AutoProcessedFlight) => f.FlightType === 'departure')
          );
          
          let arrivals = sortFlightsByTime(
            processedFlights.filter((f: AutoProcessedFlight) => f.FlightType === 'arrival')
          );

          // ADMIN OVERRIDES: Učitaj iz Vercel KV i nadjacči spoljne podatke
          [departures, arrivals] = await Promise.all([
            applyKvOverrides(departures),
            applyKvOverrides(arrivals)
          ]);
          const totalFlights = departures.length + arrivals.length;
          
          const flightData: FlightData = {
            departures,
            arrivals,
            lastUpdated: new Date().toISOString(),
            source: 'emergency',
            isOfflineMode: true,
            totalFlights,
            warning: 'Emergency mode: Using directly fetched data with auto-processing.'
          };
          
          console.log(`🚨 EMERGENCY data ready: ${departures.length} departures, ${arrivals.length} arrivals, total: ${flightData.totalFlights}`);
          
          return NextResponse.json(flightData, {
            headers: {
              'Cache-Control': 'public, s-maxage=5, stale-while-revalidate=15',
              'X-Data-Source': 'emergency',
              'X-Offline-Mode': 'true',
              'X-Emergency': 'true',
              'X-Total-Flights': flightData.totalFlights.toString()
            }
          });
        }
        
        const emptyData: FlightData = {
          departures: [],
          arrivals: [],
          lastUpdated: new Date().toISOString(),
          source: 'emergency',
          isOfflineMode: true,
          totalFlights: 0,
          error: 'All data sources unavailable. Please check your connection.',
          warning: 'System will recover when connection is restored.'
        };
        
        return NextResponse.json(emptyData, {
          status: 200,
          headers: {
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'X-Data-Source': 'critical-emergency',
            'X-Offline-Mode': 'true',
            'X-Emergency': 'true',
            'X-Total-Flights': '0'
          }
        });
      }
      
    } catch (backupError: unknown) {
      const backupErrorMessage = backupError instanceof Error ? backupError.message : 'Unknown backup system error';
      console.error('❌ CRITICAL: Backup system failed:', backupErrorMessage);
      
      const emergencyData: FlightData = {
        departures: [],
        arrivals: [],
        lastUpdated: new Date().toISOString(),
        source: 'emergency',
        isOfflineMode: true,
        totalFlights: 0,
        error: 'CRITICAL: All data systems failed',
        warning: 'System in emergency recovery mode. Please refresh.'
      };

      return NextResponse.json(emergencyData, {
        status: 200,
        headers: {
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'X-Data-Source': 'critical-emergency',
          'X-Offline-Mode': 'true',
          'X-Emergency': 'true',
          'X-Total-Flights': '0'
        }
      });
    }
  }
}

export const dynamic = 'force-dynamic';
export const revalidate = 0;