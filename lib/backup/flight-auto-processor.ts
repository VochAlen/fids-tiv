// app/lib/backup/flight-auto-processor.ts
import type { Flight } from '@/types/flight';

export interface AutoProcessedFlight extends Flight {
  OriginalStatus: string;
  AutoProcessed: boolean;
  ProcessingStage: 'none' | 'checkin' | 'boarding' | 'closed' | 'departed' | 'arrived';
  LastStatusUpdate: string;
  StatusMN?: string;
}

export class FlightAutoProcessor {
  private backupData: Flight[];
  private currentTime: Date;

  constructor(backupFlights: Flight[]) {
    this.backupData = backupFlights;
    this.currentTime = new Date();
  }

  /**
   * Process all flights with auto-status logic
   */
  public processFlights(): AutoProcessedFlight[] {
    if (!this.backupData || this.backupData.length === 0) {
      return [];
    }

    return this.backupData.map(flight => 
      this.processSingleFlight(flight)
    );
  }

  /**
   * Process a single flight with auto-status logic
   */
  private processSingleFlight(flight: Flight): AutoProcessedFlight {
    const processedFlight: AutoProcessedFlight = {
      ...flight,
      OriginalStatus: flight.StatusEN || '',
      AutoProcessed: false,
      ProcessingStage: 'none',
      LastStatusUpdate: new Date().toISOString(),
      IsOfflineMode: true
    };

    // If flight already has a specific status, keep it
    if (flight.StatusEN && flight.StatusEN.trim() !== '' && 
        !this.isGenericStatus(flight.StatusEN)) {
      return processedFlight;
    }

    // Only auto-process departures
    if (flight.FlightType === 'departure') {
      const result = this.calculateFlightStatus(flight);
      
      processedFlight.StatusEN = result.status;
      processedFlight.StatusMN = this.translateToMontenegrin(result.status);
      processedFlight.ProcessingStage = result.stage;
      processedFlight.AutoProcessed = true;
      processedFlight.LastStatusUpdate = new Date().toISOString();
    } else if (flight.FlightType === 'arrival') {
      // For arrivals, check if flight should have arrived
      const arrivedResult = this.calculateArrivalStatus(flight);
      if (arrivedResult.shouldBeArrived) {
        processedFlight.StatusEN = 'Arrived';
        processedFlight.StatusMN = 'Sletio';
        processedFlight.ProcessingStage = 'arrived';
        processedFlight.AutoProcessed = true;
        processedFlight.LastStatusUpdate = new Date().toISOString();
      }
    }

    return processedFlight;
  }

  /**
   * Calculate flight status based on scheduled time
   */
  private calculateFlightStatus(flight: Flight): {
    status: string;
    stage: AutoProcessedFlight['ProcessingStage'];
  } {
    const scheduledTime = this.parseTime(flight.ScheduledDepartureTime);
    if (!scheduledTime) {
      return { status: 'Scheduled', stage: 'none' };
    }

    const timeDiffMinutes = this.getTimeDifferenceInMinutes(scheduledTime);

    // Auto-processing logic
    if (timeDiffMinutes < 0) {
      // Flight is past scheduled time
      if (timeDiffMinutes <= -10) {
        return { status: 'Departed', stage: 'departed' };
      }
      return { status: 'Gate Closing', stage: 'closed' };
    }

    // Before scheduled time
    if (timeDiffMinutes <= 10) {
      return { status: 'Gate Closing', stage: 'closed' };
    } else if (timeDiffMinutes <= 30) {
      return { status: 'Boarding', stage: 'boarding' };
    } else if (timeDiffMinutes <= 120) {
      return { status: 'Check-in Open', stage: 'checkin' };
    }

    return { status: 'Scheduled', stage: 'none' };
  }

  /**
   * Calculate arrival status
   */
  private calculateArrivalStatus(flight: Flight): {
    shouldBeArrived: boolean;
  } {
    const scheduledTime = this.parseTime(flight.ScheduledDepartureTime);
    if (!scheduledTime) {
      return { shouldBeArrived: false };
    }

    const timeDiffMinutes = this.getTimeDifferenceInMinutes(scheduledTime);
    
    // If flight was scheduled more than 30 minutes ago, mark as arrived
    return { shouldBeArrived: timeDiffMinutes <= -30 };
  }

  /**
   * Parse time string to Date object
   */
  private parseTime(timeStr: string): Date | null {
    if (!timeStr || timeStr.length < 5) return null;
    
    try {
      const [hours, minutes] = timeStr.split(':').map(Number);
      const date = new Date(this.currentTime);
      date.setHours(hours, minutes, 0, 0);
      return date;
    } catch {
      return null;
    }
  }

  /**
   * Get time difference in minutes
   */
  private getTimeDifferenceInMinutes(scheduledTime: Date): number {
    const diffMs = scheduledTime.getTime() - this.currentTime.getTime();
    return Math.floor(diffMs / (1000 * 60));
  }

  /**
   * Check if status is generic (can be auto-processed)
   */
  private isGenericStatus(status: string): boolean {
    const genericStatuses = [
      'Scheduled',
      'Check-in',
      'Check-in Open',
      'Boarding',
      'Gate Closing',
      'Departed',
      'Arrived',
      ''
    ];
    
    return genericStatuses.includes(status.trim());
  }

  /**
   * Translate status to Montenegrin
   */
  private translateToMontenegrin(status: string): string {
    const translations: Record<string, string> = {
      'Scheduled': 'Planiran',
      'Check-in Open': 'Check-in otvoren',
      'Check-in': 'Check-in',
      'Boarding': 'Ukrcavanje',
      'Gate Closing': 'Zatvaranje izlaza',
      'Departed': 'Poletio',
      'Arrived': 'Sletio',
      'Delayed': 'Kasni',
      'Cancelled': 'Otkazan',
      'On Time': 'Na vrijeme',
      'Diverted': 'Preusmjeren',
      'Processing': 'U obradi'
    };

    return translations[status] || status;
  }

  /**
   * Simulate real-time progress for auto-processed flights
   */
  public static simulateRealTimeProgress(flights: AutoProcessedFlight[]): AutoProcessedFlight[] {
    const now = new Date();
    
    return flights.map(flight => {
      // Only update auto-processed flights
      if (!flight.AutoProcessed) {
        return flight;
      }

      const scheduledTime = new FlightAutoProcessor([]).parseTime(flight.ScheduledDepartureTime);
      if (!scheduledTime) return flight;

      const timeDiffMinutes = Math.floor(
        (scheduledTime.getTime() - now.getTime()) / (1000 * 60)
      );

      // Real-time status progression logic
      let newStatus = flight.StatusEN;
      let newStage = flight.ProcessingStage;
      let needsUpdate = false;

      if (flight.FlightType === 'departure') {
        if (timeDiffMinutes < 0) {
          // After scheduled time
          if (flight.ProcessingStage === 'closed' && timeDiffMinutes <= -5) {
            newStatus = 'Departed';
            newStage = 'departed';
            needsUpdate = true;
          }
        } else {
          // Before scheduled time
          if (flight.ProcessingStage === 'checkin' && timeDiffMinutes <= 30) {
            newStatus = 'Boarding';
            newStage = 'boarding';
            needsUpdate = true;
          } else if (flight.ProcessingStage === 'boarding' && timeDiffMinutes <= 10) {
            newStatus = 'Gate Closing';
            newStage = 'closed';
            needsUpdate = true;
          }
        }
      } else if (flight.FlightType === 'arrival') {
        if (timeDiffMinutes <= -30 && flight.ProcessingStage !== 'arrived') {
          newStatus = 'Arrived';
          newStage = 'arrived';
          needsUpdate = true;
        }
      }

      if (needsUpdate) {
        return {
          ...flight,
          StatusEN: newStatus,
          StatusMN: new FlightAutoProcessor([]).translateToMontenegrin(newStatus),
          ProcessingStage: newStage,
          LastStatusUpdate: now.toISOString()
        };
      }

      return flight;
    });
  }

  /**
   * Get statistics about processed flights
   */
  public getProcessingStats(processedFlights: AutoProcessedFlight[]): {
    total: number;
    autoProcessed: number;
    byStage: Record<string, number>;
  } {
    const stats = {
      total: processedFlights.length,
      autoProcessed: processedFlights.filter(f => f.AutoProcessed).length,
      byStage: {
        none: 0,
        checkin: 0,
        boarding: 0,
        closed: 0,
        departed: 0,
        arrived: 0
      }
    };

    processedFlights.forEach(flight => {
      const stage = flight.ProcessingStage || 'none';
      stats.byStage[stage] = (stats.byStage[stage] || 0) + 1;
    });

    return stats;
  }
}