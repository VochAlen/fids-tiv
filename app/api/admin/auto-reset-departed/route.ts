import { NextResponse } from 'next/server';
import { getRedisClient } from '@/lib/redis';

const DESK_ALL_KEY = 'test:desk-status:all';

export async function POST(request: Request) {
  try {
    const { flightNumber, deskNumber } = await request.json();
    const redis = getRedisClient();

    const overrideKey = `override:${flightNumber}`;
    const overrideData = await redis.hgetall(overrideKey);

    if (!overrideData || Object.keys(overrideData).length === 0) {
      return NextResponse.json({
        success: true,
        message: `Nema aktivnih override-ova za let ${flightNumber}`
      });
    }

    const resetActions = [];

    if (overrideData.CheckInDesk) {
      await redis.hdel(overrideKey, 'CheckInDesk');
      resetActions.push('CheckInDesk');

      if (deskNumber) {
        // ✅ Čita/piše u novi blob, ne u nepostojeći pojedinačni ključ
        const raw = await redis.get(DESK_ALL_KEY);
        if (raw) {
          const all = JSON.parse(raw);
          if (all[deskNumber]) {
            delete all[deskNumber];
            await redis.set(DESK_ALL_KEY, JSON.stringify(all), 'EX', 4 * 60 * 60);
            resetActions.push(`test:desk-status:all[${deskNumber}]`);
          }
        }
      }
    }

    const remaining = await redis.hlen(overrideKey);
    if (remaining === 0) {
      await redis.del(overrideKey);
    }

    console.log(`🔄 Auto-reset for departed flight ${flightNumber}: ${resetActions.join(', ')}`);

    return NextResponse.json({
      success: true,
      message: `Auto-resetovan let ${flightNumber}`,
      resetActions
    });

  } catch (error) {
    console.error('Auto-reset error:', error);
    return NextResponse.json({ error: 'Greška pri auto-resetu' }, { status: 500 });
  }
}