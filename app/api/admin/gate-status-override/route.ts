// app/api/admin/gate-status-override/route.ts
import { NextResponse } from 'next/server';
import { getRedisClient } from '@/lib/redis';

export async function POST(request: Request) {
  try {
    const { gateNumber, action } = await request.json();
    if (!gateNumber) {
      return NextResponse.json({ message: 'Nedostaje broj gata' }, { status: 400 });
    }

    const client = getRedisClient();
    const redisKey = `gate-status:${gateNumber}`;

    if (action === 'open' || action === 'closed') {
      await client.set(redisKey, action, 'EX', 21600);
    } else if (action === 'clear') {
      await client.del(redisKey);
    } else {
      return NextResponse.json({ message: 'Nepoznata akcija' }, { status: 400 });
    }

    return NextResponse.json({ success: true, message: `Status gata ${gateNumber} ažuriran` });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[gate-status-override] Redis error:', msg);
    return NextResponse.json(
      { message: 'Redis nedostupan, pokušajte ponovo za nekoliko sekundi' },
      { status: 503 }
    );
  }
}