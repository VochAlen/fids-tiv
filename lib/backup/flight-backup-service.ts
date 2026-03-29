// app/lib/backup/flight-backup-service.ts
import type { Flight, RawFlightData } from '@/types/flight';

export interface BackupData {
  id: string;
  flights: Flight[];
  date: string;
  timestamp: string;
  metadata: {
    totalFlights: number;
    departures: number;
    arrivals: number;
  };
}

export interface BackupStats {
  totalBackups: number;
  todayBackups: number;
  latestBackupTime: string;
  systemStatus: 'healthy' | 'degraded' | 'empty';
  totalFlights: number;
  totalDepartures: number;
  totalArrivals: number;
}

export class FlightBackupService {
  private static instance: FlightBackupService;
  private backupStorage: Map<string, BackupData> = new Map();
  private maxBackups = 50;
  private initializationPromise: Promise<void> | null = null;
  private isInitialized = false;

  private constructor() {
    this.initialize();
  }

  public static getInstance(): FlightBackupService {
    if (!FlightBackupService.instance) {
      FlightBackupService.instance = new FlightBackupService();
    }
    return FlightBackupService.instance;
  }

  /**
   * Initialize backup system with real data from API
   */
  private async initialize(): Promise<void> {
    if (this.initializationPromise) {
      return this.initializationPromise;
    }

    this.initializationPromise = (async (): Promise<void> => {
      try {
        console.log('🚀 Initializing backup system...');
        
        const initialFlights = await this.fetchInitialBackupData();
        
        if (initialFlights.length > 0) {
          const backupId = this.saveBackupInternal(initialFlights);
          console.log(`✅ Initial backup created from API: ${backupId} (${initialFlights.length} flights)`);
        } else {
          console.log('⚠️ Initial API fetch returned no flights');
        }
        
        this.isInitialized = true;
        console.log('✅ Backup system initialized successfully');
      } catch (error) {
        console.error('❌ Backup system initialization failed:', error);
        this.isInitialized = true;
      }
    })();

    return this.initializationPromise;
  }

  /**
   * Fetch real data from API for initial backup
   */
/**
 * Fetch real data from API for initial backup
 */
private async fetchInitialBackupData(): Promise<Flight[]> {
  try {
    const API_URL = 'https://montenegroairports.com/aerodromixs/cache-flights.php?airport=tv';
    
    console.log('📡 Fetching initial backup data from API...');
    
    const response = await fetch(API_URL, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json, text/javascript, */*; q=0.01',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': 'https://montenegroairports.com/',
        'Origin': 'https://montenegroairports.com',
      },
      signal: AbortSignal.timeout(10000)
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const rawData: RawFlightData[] = await response.json();

    if (!Array.isArray(rawData)) {
      throw new Error('Invalid data format received');
    }

    console.log(`📦 Fetched ${rawData.length} flights for initial backup`);
    
    const flights: Flight[] = rawData.map((raw): Flight => ({
      // Deterministički ID: kombinacija koja garantuje isti ID za isti let
      // Kompanija + BrojLeta + Planirano vreme + Destinacija
      id: `${raw.Kompanija}${raw.BrojLeta}_${raw.Planirano}_${raw.IATA}`,
      FlightNumber: `${raw.Kompanija}${raw.BrojLeta}`,
      AirlineCode: raw.Kompanija,
      AirlineICAO: raw.KompanijaICAO,
      AirlineName: raw.KompanijaNaziv,
      DestinationAirportName: raw.Aerodrom,
      DestinationAirportCode: raw.IATA,
      ScheduledDepartureTime: this.formatTime(raw.Planirano),
      EstimatedDepartureTime: this.formatTime(raw.Predvidjeno),
      ActualDepartureTime: this.formatTime(raw.Aktuelno),
      StatusEN: raw.StatusEN || '',
      StatusMN: raw.StatusMN || '',
      Terminal: raw.Terminal || '',
      GateNumber: raw.Gate || '',
      CheckInDesk: raw.CheckIn || '',
      BaggageReclaim: raw.Karusel || '',
      CodeShareFlights: raw.CodeShare ? raw.CodeShare.split(',').map(f => f.trim()).filter(Boolean) : [],
      AirlineLogoURL: `/airlines/${raw.KompanijaICAO}.png`,
      FlightType: raw.TipLeta === 'O' ? 'departure' : 'arrival',
      DestinationCityName: raw.Grad,
      IsBackupData: true,
      BackupTimestamp: new Date().toISOString()
    }));

    return flights;
  } catch (error) {
    console.error('❌ Failed to fetch initial backup data:', error);
    return [];
  }
}

  /**
   * Format time string from HHMM to HH:MM
   */
  private formatTime(time: string): string {
    if (!time || time.length !== 4) return '';
    return `${time.substring(0, 2)}:${time.substring(2, 4)}`;
  }

  /**
   * Wait for initialization if needed
   */
  private async ensureInitialized(): Promise<void> {
    if (!this.isInitialized && this.initializationPromise) {
      await this.initializationPromise;
    }
  }

  /**
   * Save flight data to backup
   */
  public saveBackup(flights: Flight[]): string {
    return this.saveBackupInternal(flights);
  }

  /**
   * Save flight data to backup (internal method)
   */
  private saveBackupInternal(flights: Flight[]): string {
    try {
      const now = new Date();
      const dateStr = now.toISOString().split('T')[0];
      const timestamp = now.toISOString();
      const backupId = `backup_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;

      const departures = flights.filter(f => f.FlightType === 'departure');
      const arrivals = flights.filter(f => f.FlightType === 'arrival');

      const backupData: BackupData = {
        id: backupId,
        flights: flights.map(flight => ({
          ...flight,
          IsBackupData: true,
          BackupTimestamp: timestamp
        })),
        date: dateStr,
        timestamp,
        metadata: {
          totalFlights: flights.length,
          departures: departures.length,
          arrivals: arrivals.length
        }
      };

      this.backupStorage.set(backupId, backupData);
      this.cleanupOldBackups();
      
      return backupId;
    } catch (error) {
      console.error('Error saving backup:', error);
      return `emergency_backup_${Date.now()}`;
    }
  }

  /**
   * Get latest backup - UVJEK vraća nešto
   */
  public getLatestBackup(): BackupData {
    try {
      void this.ensureInitialized().catch(() => {
        console.warn('Initialization check failed, continuing anyway');
      });
      
      const backupSize = this.backupStorage.size;
      if (backupSize === 0) {
        console.log('⚠️ No backups found in storage');
        const now = new Date();
        return {
          id: 'empty',
          flights: [],
          date: now.toISOString().split('T')[0],
          timestamp: now.toISOString(),
          metadata: {
            totalFlights: 0,
            departures: 0,
            arrivals: 0
          }
        };
      }

      const backupEntries: Array<[string, BackupData]> = [];
      this.backupStorage.forEach((value, key) => {
        backupEntries.push([key, value]);
      });
      
      backupEntries.sort(([, a], [, b]) => 
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      );

      if (backupEntries.length === 0) {
        throw new Error('No backup data available after sort');
      }

      return backupEntries[0][1];
    } catch (error) {
      console.error('Error getting latest backup:', error);
      const now = new Date();
      return {
        id: 'error',
        flights: [],
        date: now.toISOString().split('T')[0],
        timestamp: now.toISOString(),
        metadata: {
          totalFlights: 0,
          departures: 0,
          arrivals: 0
        }
      };
    }
  }

  /**
   * Get all backups (for dashboard)
   */
  public getAllBackups(): BackupData[] {
    try {
      void this.ensureInitialized().catch(() => {
        console.warn('Initialization check failed during getAllBackups');
      });
      
      const allBackups: BackupData[] = [];
      this.backupStorage.forEach((backup) => {
        allBackups.push(backup);
      });

      return allBackups.sort((a, b) => 
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      );
    } catch (error) {
      console.error('Error getting all backups:', error);
      return [];
    }
  }

  /**
   * Get backups from today
   */
  public getTodayBackups(): BackupData[] {
    try {
      const today = new Date().toISOString().split('T')[0];
      const todayBackups: BackupData[] = [];
      
      this.backupStorage.forEach((backup) => {
        if (backup.date === today) {
          todayBackups.push(backup);
        }
      });

      return todayBackups.sort((a, b) => 
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      );
    } catch (error) {
      console.error('Error getting today backups:', error);
      return [];
    }
  }

  /**
   * Get backup by ID
   */
  public getBackupById(backupId: string): BackupData | null {
    try {
      const backup = this.backupStorage.get(backupId);
      return backup || null;
    } catch (error) {
      console.error('Error getting backup by ID:', error);
      return null;
    }
  }

  /**
   * Delete specific backup
   */
  public deleteBackup(backupId: string): boolean {
    try {
      const deleted = this.backupStorage.delete(backupId);
      if (deleted) {
        console.log(`🗑️ Backup deleted: ${backupId}`);
      }
      return deleted;
    } catch (error) {
      console.error('Error deleting backup:', error);
      return false;
    }
  }

  /**
   * Delete all backups except the latest N
   */
  public deleteAllBackupsExceptLatest(keepCount: number): number {
    try {
      const allBackups = this.getAllBackups();
      if (allBackups.length <= keepCount) {
        return 0;
      }

      const backupsToDelete = allBackups.slice(keepCount);
      let deletedCount = 0;

      backupsToDelete.forEach(backup => {
        if (this.deleteBackup(backup.id)) {
          deletedCount++;
        }
      });

      console.log(`🗑️ Deleted ${deletedCount} old backups, kept ${keepCount} latest`);
      return deletedCount;
    } catch (error) {
      console.error('Error deleting old backups:', error);
      return 0;
    }
  }

  /**
   * Cleanup old backups from memory
   */
  private cleanupOldBackups(): void {
    try {
      const backupSize = this.backupStorage.size;
      if (backupSize <= this.maxBackups) {
        return;
      }

      const backupEntries: Array<[string, BackupData]> = [];
      this.backupStorage.forEach((value, key) => {
        backupEntries.push([key, value]);
      });
      
      backupEntries.sort(([, a], [, b]) => 
        new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
      );

      const backupsToRemove = backupEntries.slice(0, backupSize - this.maxBackups);
      
      backupsToRemove.forEach(([backupId]) => {
        this.backupStorage.delete(backupId);
      });
      
      console.log(`🧹 Cleaned up ${backupsToRemove.length} old backups`);
    } catch (error) {
      console.error('Error during backup cleanup:', error);
    }
  }

  /**
   * Get backup statistics
   */
  public getBackupStats(): BackupStats {
    try {
      void this.ensureInitialized().catch(() => {
        console.warn('Initialization check failed during stats');
      });
      
      const today = new Date().toISOString().split('T')[0];
      let todayCount = 0;
      let latestTime = new Date().toISOString();
      let totalFlights = 0;
      let totalDepartures = 0;
      let totalArrivals = 0;

      this.backupStorage.forEach((backup) => {
        if (backup.date === today) {
          todayCount++;
        }
        if (backup.timestamp > latestTime) {
          latestTime = backup.timestamp;
        }
        
        totalFlights += backup.metadata.totalFlights;
        totalDepartures += backup.metadata.departures;
        totalArrivals += backup.metadata.arrivals;
      });

      const totalBackups = this.backupStorage.size;
      const systemStatus = totalBackups > 0 ? 'healthy' : 
                          todayCount > 0 ? 'degraded' : 'empty';

      return {
        totalBackups,
        todayBackups: todayCount,
        latestBackupTime: latestTime,
        systemStatus,
        totalFlights,
        totalDepartures,
        totalArrivals
      };
    } catch (error) {
      console.error('Error getting backup stats:', error);
      return {
        totalBackups: 0,
        todayBackups: 0,
        latestBackupTime: new Date().toISOString(),
        systemStatus: 'empty',
        totalFlights: 0,
        totalDepartures: 0,
        totalArrivals: 0
      };
    }
  }

  /**
   * Clear all backups (for testing/reset)
   */
  public clearAllBackups(): number {
    const backupCount = this.backupStorage.size;
    this.backupStorage.clear();
    console.log(`🧹 All ${backupCount} backups cleared`);
    
    void this.initialize().catch(error => {
      console.error('Failed to reinitialize after clear:', error);
    });
    
    return backupCount;
  }
}