// app/api/checkin-config/route.ts
import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import ini from 'ini';

// FIX (po zahtjevu — "najviše jednom dnevno", bez žrtvovanja tačnosti):
// settings.ini se mijenja RIJETKO (samo kad ga neko ručno uredi i
// redeploy-uje aplikaciju — na Vercel-u nema "žive" izmjene fajla bez
// novog deploy-a, pošto je serverless fajl-sistem samo-za-čitanje
// nakon build-a). Zato dug CDN keš ovdje NE nosi rizik "vidim staru
// vrijednost satima nakon što sam je promijenio" — svaki novi deploy
// prirodno dobija svježe keš stanje. s-maxage=86400 (24h) znači: samo
// PRVI poziv u tom periodu (sa BILO KOG ekrana, ne po ekranu) stvarno
// čita i parsira fajl sa diska — svi ostali pogode jeftin CDN keš, bez
// izvršavanja funkcije. stale-while-revalidate dodatno spriječava da
// bilo koji poziv ikad "čeka" na osvježavanje.
const CACHE_CONTROL = 'public, s-maxage=86400, stale-while-revalidate=3600';

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

    return NextResponse.json(config, {
      headers: { 'Cache-Control': CACHE_CONTROL },
    });
  } catch (error) {
    console.error('❌ Error loading check-in config:', error);
    // FIX: greška se NE kešira (nema Cache-Control header-a na ovoj
    // grani) — ako čitanje fajla jednom padne (npr. prolazan disk
    // glitch), sledeći poziv (bilo sa kog ekrana) treba odmah ponovo
    // da pokuša, ne da 24h servira "default 120 za sve" iz keša.
    return NextResponse.json({ default: 120 }, { status: 500 });
  }
}