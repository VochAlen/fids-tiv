import { NextResponse } from 'next/server';
import { FlightBackupService } from '@/lib/backup/flight-backup-service';
import { FlightAutoProcessor } from '@/lib/backup/flight-auto-processor';
import type { Flight } from '@/types/flight';
import {
  mapRawFlight,
  expandFlightForMultipleGates,
  sortFlightsByTime,
  filterTodayFlights
} from '@/lib/flight-api-helpers';

const FLIGHT_API_URL = 'https://montenegroairports.com/aerodromixs/cache-flights.php?airport=tv';

export async function GET() {
  try {
    const backupService = FlightBackupService.getInstance();
    const latestBackup = backupService.getLatestBackup();
    
    // Uvek koristimo backup podatke za statistiku
    const flights = latestBackup.flights || [];
    
    // Procesujemo podatke
    const processedFlights = flights;
    const todayFlights = filterTodayFlights(processedFlights);
    
    const departures = sortFlightsByTime(
      todayFlights.filter((f: Flight) => f.FlightType === 'departure')
    );
    
    const arrivals = sortFlightsByTime(
      todayFlights.filter((f: Flight) => f.FlightType === 'arrival')
    );
    
    const allFlights = [...departures, ...arrivals];
    
    // Računanje statistike
    const uniqueAirlines = new Set(
      allFlights
        .map(flight => flight.AirlineName)
        .filter(Boolean) as string[]
    );
    
    const delayedFlights = allFlights.filter(flight => 
      flight.StatusEN && (
        flight.StatusEN.toLowerCase().includes('delay') || 
        flight.StatusEN.toLowerCase().includes('late') ||
        flight.StatusEN.toLowerCase().includes('odložen')
      )
    ).length;
    
    const stats = {
      totalFlights: allFlights.length,
      departures: departures.length,
      arrivals: arrivals.length,
      todayFlights: allFlights.length,
      activeAirlines: uniqueAirlines.size,
      delayedFlights,
      lastUpdated: latestBackup.timestamp,
      source: 'backup' as const,
      isOfflineMode: false
    };
    
    return NextResponse.json(stats, {
      headers: {
        'Cache-Control': 'public, s-maxage=60',
        'X-Data-Source': 'stats'
      }
    });
    
  } catch (error) {
    console.error('Error fetching stats:', error);
    
    // Fallback stats
    const fallbackStats = {
      totalFlights: 0,
      departures: 0,
      arrivals: 0,
      todayFlights: 0,
      activeAirlines: 0,
      delayedFlights: 0,
      lastUpdated: new Date().toISOString(),
      source: 'fallback' as const,
      isOfflineMode: true,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
    
    return NextResponse.json(fallbackStats, {
      status: 200,
      headers: {
        'Cache-Control': 'no-cache'
      }
    });
  }
}