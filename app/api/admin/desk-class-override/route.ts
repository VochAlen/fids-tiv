// app/api/admin/desk-class-override/route.ts
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
      await client.set(redisKey, classType, 'EX', 21600);
    } else if (action === 'clear') {
      await client.del(redisKey);
    } else {
      return NextResponse.json({ message: 'Nepoznata akcija ili nedostaje classType' }, { status: 400 });
    }

    return NextResponse.json({ success: true, message: `Klasa saltera ${deskNumber} ažurirana` });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[desk-class-override] Redis error:', msg);
    return NextResponse.json(
      { message: 'Redis nedostupan, pokušajte ponovo za nekoliko sekundi' },
      { status: 503 }
    );
  }
}