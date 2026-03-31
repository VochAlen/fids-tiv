import { NextResponse } from 'next/server';
import { getRedisClient } from '@/lib/redis';

// ============================================================
// SIGURNOSNA LISTA: Dozvoljava samo ova polja za upis u Redis
// ============================================================
const ALLOWED_FIELDS = [
  'GateNumber',          // Izlaz (Gate)
  'CheckInDesk',         // Check-in šalteri
  'BaggageReclaim',      // Traka za prtljag (Dolasci)
  'StatusEN',            // Status leta (Quick buttons)
  'Note',                // Interne napomene
  'EstimatedDepartureTime', // Ručno izmijenjeno vrijeme
  'Terminal'             // Terminal
];

export async function POST(request: Request) {
  let client;
  try {
    const body = await request.json();
    const { flightNumber, field, action, value } = body;

    // 1. Osnovna provjera parametara
    if (!flightNumber || !field || !action) {
      return NextResponse.json({ message: 'Nedostaju parametri' }, { status: 400 });
    }

    // 2. SIGURNOSNA PROVJERA: Da li je polje uopšte dozvoljeno?
    if (!ALLOWED_FIELDS.includes(field)) {
      return NextResponse.json({ 
        message: `Zabranjeno polje: "${field}". Dozvoljena su samo: ${ALLOWED_FIELDS.join(', ')}` 
      }, { status: 400 });
    }

    // 3. Provjera ispravnosti akcije
    if (action !== 'assign' && action !== 'clear') {
      return NextResponse.json({ message: 'Nepoznata akcija. Koristite "assign" ili "clear".' }, { status: 400 });
    }

    // 4. Ako radimo "assign", mora biti i vrijednost
    if (action === 'assign' && (!value || value.toString().trim() === '')) {
      return NextResponse.json({ message: 'Vrijednost (value) je obavezna kod akcije "assign".' }, { status: 400 });
    }

    client = getRedisClient();
    const redisKey = `override:${flightNumber}`;

    if (action === 'assign') {
      // Čistimo unos od suvišnih razmaka i konvertujemo u string (sigurnost za Redis)
      const cleanValue = value.toString().trim();
      
      // Upisi vrijednost i postavi da se automatski briše za 6 sati (21600 sekundi)
      // Ovo je SPASITELJAVO za memoriju na Redis Labs free planu!
      await client.hset(redisKey, { [field]: cleanValue });
      await client.expire(redisKey, 21600); 
      
    } else if (action === 'clear') {
      await client.hdel(redisKey, field);
      
      // Ako je ovo bio zadnji polje u hashu, obriši cijeli ključ (oslobađa memoriju)
      const remaining = await client.hlen(redisKey);
      if (remaining === 0) {
        await client.del(redisKey);
      }
    }

    return NextResponse.json({ 
      success: true, 
      message: `Uspješno: ${field} -> ${action === 'assign' ? value : 'Uklonjeno'}` 
    });

  } catch (error) {
    console.error('Override API Error:', error);
    return NextResponse.json({ message: 'Serverska greška' }, { status: 500 });
  }
}