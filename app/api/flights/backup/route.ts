// app/api/flights/backup/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { FlightBackupService } from '@/lib/backup/flight-backup-service';

export async function GET(): Promise<NextResponse> {
  try {
    const backupService = FlightBackupService.getInstance();
    
    const allBackups = backupService.getAllBackups();
    const stats = backupService.getBackupStats();

    return NextResponse.json({
      success: true,
      stats,
      backups: allBackups.map(backup => ({
        id: backup.id,
        timestamp: backup.timestamp,
        date: backup.date,
        metadata: backup.metadata
      }))
    });
  } catch (error) {
    console.error('Error getting backup info:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: 'Failed to get backup information',
        message: 'Backup system may not be initialized'
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const backupService = FlightBackupService.getInstance();
    const body = await request.json();
    const { action, backupId } = body;

    switch (action) {
      case 'create':
        // Ovdje trebate fetch-ati live podatke i kreirati backup
        // Za sada ćemo kreirati prazan backup
        const flights: any[] = []; // Ovdje treba fetch-ati realne podatke
        const backupIdCreated = backupService.saveBackup(flights);
        
        return NextResponse.json({
          success: true,
          backupId: backupIdCreated,
          message: 'Backup created successfully'
        });

      case 'delete':
        if (!backupId) {
          return NextResponse.json({
            success: false,
            message: 'Backup ID is required for delete action'
          }, { status: 400 });
        }

        const deleted = backupService.deleteBackup(backupId);
        return NextResponse.json({
          success: deleted,
          message: deleted ? 'Backup deleted successfully' : 'Failed to delete backup'
        });

      case 'deleteAll':
        const deletedCount = backupService.clearAllBackups();
        return NextResponse.json({
          success: true,
          deletedCount,
          message: `All backups deleted (${deletedCount} backups)`
        });

      default:
        return NextResponse.json({
          success: false,
          message: 'Invalid action'
        }, { status: 400 });
    }
  } catch (error) {
    console.error('Error in backup manage API:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: 'Failed to process request',
        message: 'An error occurred while processing the backup action'
      },
      { status: 500 }
    );
  }
}