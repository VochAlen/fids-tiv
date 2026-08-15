// app/lib/backup/flight-backup-service.ts
import type { Flight } from '@/types/flight';
import { getRedisClient } from '@/lib/redis';
import { getPodgoricaDateString } from '@/lib/night-hours';

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
  private isInitialized = true;
  private lastBackupHash: string | null = null;

  private constructor() {
    // ── UKLONJENO: ranije je ovdje pozivan this.initialize(), koji je na
    // SVAKI cold start gađao STARI, napušteni
    // montenegroairports.com/aerodromixs/cache-flights.php endpoint i
    // bezuslovno prepisivao backup:flights:latest u Redisu — potpuno
    // mimo NAIS proxy toka i bez ikakve provere svežine/kvaliteta u
    // odnosu na postojeći backup (saveBackupInternal se pozivala
    // direktno, zaobilazeći dedup/provere u saveBackup()).
    //
    // Posljedica: u zavisnosti od toga kad je taj stari PHP keš skript
    // zadnji put interno osvježen na montenegroairports.com strani,
    // dobar (svjež, NAIS-based) backup bi znao biti prepisan zastarelim
    // podatkom (npr. jutarnjim) — tačno simptom koji se javljao kad
    // NAIS proxy padne i sistem posegne za getLatestBackup().
    //
    // Backup se sad isključivo puni iz getCurrentFlightData() u
    // flight-data-service.ts, preko saveBackup() poziva nakon uspješnog
    // live fetch-a sa NAIS proxy-ja — to je jedini pouzdan izvor i jedino
    // mjesto koje smije pisati u backup:flights:latest.
  }

  public static getInstance(): FlightBackupService {
    if (!FlightBackupService.instance) {
      FlightBackupService.instance = new FlightBackupService();
    }
    return FlightBackupService.instance;
  }

  /**
   * Format time string from HHMM to HH:MM
   * (zadržano jer se koristi eventualno drugdje / za kompatibilnost tipova)
   */
  private formatTime(time: string): string {
    if (!time || time.length !== 4) return '';
    return `${time.substring(0, 2)}:${time.substring(2, 4)}`;
  }

  /**
   * Save flight data to backup — jedina ulazna tačka koju treba koristiti
   * iz flight-data-service.ts (NAIS proxy tok).
   */
  public async saveBackup(flights: Flight[]): Promise<string> {
    const hash = this.computeHash(flights);
    if (hash === this.lastBackupHash) {
      return 'skipped-unchanged';
    }
    this.lastBackupHash = hash;
    return this.saveBackupInternal(flights);
  }

  private computeHash(flights: Flight[]): string {
    return Buffer.from(JSON.stringify(
      flights.map(f => `${f.FlightNumber}|${f.GateNumber}|${f.CheckInDesk}|${f.StatusEN}|${f.EstimatedDepartureTime}`)
    )).toString('base64');
  }

  /**
   * Save flight data to backup (internal method)
   */
  private async saveBackupInternal(flights: Flight[]): Promise<string> {
    const now = new Date();
    const timestamp = now.toISOString();
    const backupId = `backup_${Date.now()}`;

    const backupData: BackupData = {
      id: backupId,
      flights: flights.map(f => ({ ...f, IsBackupData: true, BackupTimestamp: timestamp })),
      date: getPodgoricaDateString(now),
      timestamp,
      metadata: {
        totalFlights: flights.length,
        departures: flights.filter(f => f.FlightType === 'departure').length,
        arrivals: flights.filter(f => f.FlightType === 'arrival').length,
      },
    };

    try {
      const client = getRedisClient();
      await client.setex('backup:flights:latest', 172800, JSON.stringify(backupData)); // 48h
    } catch (e) {
      console.error('⚠️ Redis backup save failed:', e);
    }

    return backupId;
  }

  public async getLatestBackup(): Promise<BackupData> {
    try {
      const client = getRedisClient();
      const raw = await client.get('backup:flights:latest');
      if (raw) return JSON.parse(raw) as BackupData;
    } catch (e) {
      console.error('⚠️ Redis backup read failed:', e);
    }

    const now = new Date();
    return {
      id: 'empty',
      flights: [],
      date: now.toISOString().split('T')[0],
      timestamp: now.toISOString(),
      metadata: { totalFlights: 0, departures: 0, arrivals: 0 },
    };
  }

  /**
   * Get all backups (for dashboard)
   */
  public getAllBackups(): BackupData[] {
    try {
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
  public async clearAllBackups(): Promise<number> {
    const backupCount = this.backupStorage.size;
    this.backupStorage.clear();
    this.lastBackupHash = null;

    try {
      const client = getRedisClient();
      await client.del('backup:flights:latest');
    } catch (e) {
      console.error('Failed to clear Redis backup key:', e);
    }

    return backupCount;
  }
}