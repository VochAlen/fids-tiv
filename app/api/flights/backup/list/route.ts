// app/api/flights/backup/list/route.ts
import { NextResponse } from 'next/server';
import { FlightBackupService } from '@/lib/backup/flight-backup-service';

export async function GET(): Promise<NextResponse> {
  try {
    const backupService = FlightBackupService.getInstance();
    const allBackups = backupService.getAllBackups();

    return NextResponse.json({
      success: true,
      backups: allBackups.map(backup => ({
        id: backup.id,
        timestamp: backup.timestamp,
        date: backup.date,
        metadata: backup.metadata
      }))
    });
  } catch (error) {
    console.error('Error getting backup list:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: 'Failed to get backup list',
        message: 'Backup system may not be initialized'
      },
      { status: 500 }
    );
  }
}