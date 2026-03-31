import { NextResponse } from 'next/server';
import { getRedisClient } from '@/lib/redis';

export async function POST(request: Request) {
  try {
    const { deskNumber, action } = await request.json();

    if (!deskNumber) {
      return NextResponse.json({ message: 'Nedostaje broj saltera' }, { status: 400 });
    }

    const client = getRedisClient();
    const redisKey = `desk-status:${deskNumber}`;

    if (action === 'open' || action === 'closed') {
      await client.set(redisKey, action, 'EX', 21600); // Čuva 6 sati
    } else if (action === 'clear') {
      await client.del(redisKey);
    }

    return NextResponse.json({ success: true, message: `Status saltera ${deskNumber} ažuriran` });
  } catch (error) {
    console.error('Desk Status API Error:', error);
    return NextResponse.json({ message: 'Serverska greška' }, { status: 500 });
  }
}