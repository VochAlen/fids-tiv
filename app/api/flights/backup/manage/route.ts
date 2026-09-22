// app/api/flights/backup/manage/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { FlightBackupService } from '@/lib/backup/flight-backup-service';
import type { Flight } from '@/types/flight';

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const backupService = FlightBackupService.getInstance();
    const body = await request.json();
    const { action, backupId } = body;

    switch (action) {
      case 'create':
        // Kreiraj manualni backup sa trenutnim podacima
        // Možda ćete morati importovati funkciju za fetch podataka
        // Za sada ćemo kreirati prazan backup
        try {
          // Pokušaj da fetch-uješ live podatke
          const response = await fetch('https://montenegroairports.com/aerodromixs/cache-flights.php?airport=tv', {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
          });
          
          if (response.ok) {
            const rawData = await response.json();
            // Konvertuj raw podatke u Flight format (koristi logiku iz flight-backup-service)
            // Ovdje treba dodati logiku za konverziju
            // FIX (po zahtjevu — zamjena "any" pravim tipom): NAPOMENA,
            // van obima ovog zahtjeva — niz je i dalje uvijek prazan
            // (komentar "Ovo treba popuniti" ispod je pre-postojeći,
            // znači konverzija rawData → Flight[] nikad nije
            // implementirana). Ruta izgleda neiskorišćena (nema poziva
            // iz klijentskog koda) — popravljam tip radi tražene
            // dosljednosti, ne diram funkcionalnu nepotpunost.
            const flights: Flight[] = []; // Ovo treba popuniti
            const backupIdCreated = backupService.saveBackup(flights);
            
            return NextResponse.json({
              success: true,
              backupId: backupIdCreated,
              message: 'Manual backup created successfully'
            });
          } else {
            throw new Error('Failed to fetch live data');
          }
        } catch (error) {
          console.error('Error creating manual backup:', error);
          // Kreiraj emergency backup ako live data ne radi
          const emptyFlights: Flight[] = [];
          const emergencyBackupId = backupService.saveBackup(emptyFlights);
          
          return NextResponse.json({
            success: true,
            backupId: emergencyBackupId,
            message: 'Emergency backup created (live data unavailable)'
          });
        }

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