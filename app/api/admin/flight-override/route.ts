import { NextResponse } from 'next/server';
import { getRedisClient } from '@/lib/redis';

export async function POST(request: Request) {
  let client;
  try {
    const body = await request.json();
    const { flightNumber, field, action, value } = body;

    if (!flightNumber || !field || !action) {
      return NextResponse.json({ message: 'Nedostaju parametri' }, { status: 400 });
    }

    client = getRedisClient();
    const redisKey = `override:${flightNumber}`;

    if (action === 'assign') {
      // Upisi vrijednost i postavi da se automatski briše za 6 sati (21600 sekundi)
      // Ovo je SPASITELJAVO za memoriju na Redis Labs free planu!
      await client.hset(redisKey, { [field]: value });
      await client.expire(redisKey, 21600); 
    } else if (action === 'clear') {
      await client.hdel(redisKey, field);
      // Ako je ovo bio zadnji polje u hashu, obriši cijeli ključ
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