// app/api/checkin-config/route.ts
import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import ini from 'ini';

export async function GET() {
  try {
    // Pokušaj pronaći settings.ini
    const possiblePaths = [
      path.join(process.cwd(), 'settings.ini'),
      path.join(process.cwd(), '..', 'settings.ini'), // za development
      '/settings.ini', // za production (ako je tamo)
    ];

    let config = { default: 120 };
    
    for (const configPath of possiblePaths) {
      if (fs.existsSync(configPath)) {
        console.log('📁 Loading check-in config from:', configPath);
        const parsed = ini.parse(fs.readFileSync(configPath, 'utf-8'));
        
        if (parsed.checkin) {
          // Konvertuj sve vrijednosti u brojeve
          Object.keys(parsed.checkin).forEach(key => {
            parsed.checkin[key] = parseInt(parsed.checkin[key]) || 120;
          });
          config = parsed.checkin;
        }
        break;
      }
    }

    return NextResponse.json(config);
  } catch (error) {
    console.error('❌ Error loading check-in config:', error);
    return NextResponse.json({ default: 120 }, { status: 500 });
  }
}