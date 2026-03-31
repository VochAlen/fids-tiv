import { NextResponse } from 'next/server';
import { getRedisClient } from '@/lib/redis';

export async function POST(request: Request) {
  try {
    const { deskNumber, classType, action } = await request.json();

    if (!deskNumber) {
      return NextResponse.json({ message: 'Nedostaje broj saltera' }, { status: 400 });
    }

    const client = getRedisClient();
    const redisKey = `desk-class:${deskNumber}`;

    if (action === 'assign' && classType) {
      // Cuvamo 6 sati (kao i ostale overridee)
      await client.set(redisKey, classType, 'EX', 21600); 
    } else if (action === 'clear') {
      await client.del(redisKey);
    }

    return NextResponse.json({ success: true, message: `Klasa saltera ${deskNumber} azurirana` });
  } catch (error) {
    console.error('Desk Class API Error:', error);
    return NextResponse.json({ message: 'Serverska greška' }, { status: 500 });
  }
}