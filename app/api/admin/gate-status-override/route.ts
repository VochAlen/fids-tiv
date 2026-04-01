import { NextResponse } from 'next/server';
import { getRedisClient } from '@/lib/redis';

export async function POST(request: Request) {
  try {
    const { gateNumber, action } = await request.json();
    if (!gateNumber) return NextResponse.json({ message: 'Nedostaje broj gata' }, { status: 400 });
    
    const client = getRedisClient();
    const redisKey = `gate-status:${gateNumber}`;

    if (action === 'open' || action === 'closed') {
      await client.set(redisKey, action, 'EX', 21600); // Cuva 6 sati
    } else if (action === 'clear') {
      await client.del(redisKey);
    }

    return NextResponse.json({ success: true, message: `Status gata ${gateNumber} ažuriran` });
  } catch (error) {
    console.error('Gate Status API Error:', error);
    return NextResponse.json({ message: 'Serverska greška' }, { status: 500 });
  }
}