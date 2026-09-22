// app/api/checkin-config/route.ts
import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import ini from 'ini';

// ── FIX: jedna, statička, cwd-relativna putanja umjesto liste
// kandidata (uključujući '..' i apsolutni '/settings.ini').
// Next-ov file tracer (NFT/Turbopack) ne može statički da odredi
// koja od više dinamičkih putanja će stvarno biti pročitana, pa je
// bailovao na "traced unintentionally" i pakovao CIJELI projekat u
// bundle ove rute (veći cold start). path.join(process.cwd(), '<literal>')
// je dokumentovano bezbjedan/traceable pattern za Vercel deployment. ──
const SETTINGS_PATH = path.join(process.cwd(), 'settings.ini');

export async function GET() {
  try {
    let config = { default: 120 };

    if (fs.existsSync(SETTINGS_PATH)) {
      const parsed = ini.parse(fs.readFileSync(SETTINGS_PATH, 'utf-8'));

      if (parsed.checkin) {
        // Konvertuj sve vrijednosti u brojeve
        Object.keys(parsed.checkin).forEach(key => {
          parsed.checkin[key] = parseInt(parsed.checkin[key]) || 120;
        });
        config = parsed.checkin;
      }
    }

    return NextResponse.json(config);
  } catch (error) {
    console.error('❌ Error loading check-in config:', error);
    return NextResponse.json({ default: 120 }, { status: 500 });
  }
}