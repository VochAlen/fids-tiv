// app/api/flights/backup/stats/route.ts
import { NextResponse } from 'next/server';
import { FlightBackupService } from '@/lib/backup/flight-backup-service';

export async function GET(): Promise<NextResponse> {
  try {
    const backupService = FlightBackupService.getInstance();
    const stats = backupService.getBackupStats();

    return NextResponse.json({
      success: true,
      stats
    });
  } catch (error) {
    console.error('Error getting backup stats:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: 'Failed to get backup statistics',
        message: 'Backup system may not be initialized'
      },
      { status: 500 }
    );
  }
}