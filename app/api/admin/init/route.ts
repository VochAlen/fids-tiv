// app/api/admin/init/route.ts
//
// FIX (migracija sa SQLite na Redis): ova ruta je pozivala
// initializeDatabase() iz lib/db (SQLite) da kreira tabele pri prvom
// pokretanju. Redis HASH-evi (lib/business-class-store.ts) se kreiraju
// IMPLICITNO na prvi HSET poziv — nema "kreiraj tabelu" korak, pa ova
// ruta više nema šta da radi. Potvrđeno prije brisanja lib/db: NIŠTA u
// aplikaciji ovu rutu nije pozivalo (nula uživo pozivalaca) — zadržana
// kao bezopasan no-op umjesto potpuno obrisana, za slučaj da negdje
// postoji stari bookmark/skripta koja je pogađa.
import { NextResponse } from 'next/server';

export async function POST() {
  return NextResponse.json({
    success: true,
    message: 'Nije potrebno — Redis HASH-evi se kreiraju automatski pri prvom upisu.',
  });
}