import { NextResponse } from 'next/server';
import { getRedisClient, safeRedisHGet, safeRedisHDel } from '@/lib/redis';

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
        // ── FIX (usklađeno sa Redis Hash prelaskom, vidi lib/redis.ts i
        // app/api/test/desk-status-override/route.ts): test:desk-status:all
        // više NIJE jedan JSON blob nego Redis HASH (jedno polje po desku).
        // HDEL je atomaran po polju — ne prijeti mu ista race condition koja
        // je postojala kod čitaj-cijelo/piši-cijelo pattern-a.
        //
        // FIX #2 (svježa analiza — WRONGTYPE gap): ranije se ovdje koristio
        // SIROVI redis klijent (redis.hexists/redis.hdel), zaobilazeći
        // safeRedisHGet/safeRedisHDel wrapper-e iz lib/redis.ts koji imaju
        // ugrađeno samoisceljujuće WRONGTYPE→migracija ponašanje (vidi
        // opširan komentar u lib/redis.ts). Da je test:desk-status:all i
        // dalje bio zaostali JSON string ključ (npr. svježe nakon deploy-a,
        // prije nego što ijedan drugi poziv stigne da ga migrira), ovaj
        // direktan redis.hexists() bi bacio WRONGTYPE, taj bi let bio
        // "auto-resetovan" po override-u, ali njegov CheckInDesk zapis bi
        // OSTAO ZAGLAVLJEN na monitoru i nakon poletanja. Sad koristi iste
        // safe wrapper funkcije kao ostatak aplikacije — automatski se
        // samo-migrira ako naiđe na stari ključ.
        const existingRaw = await safeRedisHGet(DESK_ALL_KEY, deskNumber);
        if (existingRaw !== null) {
          await safeRedisHDel(DESK_ALL_KEY, deskNumber);
          resetActions.push(`test:desk-status:all[${deskNumber}]`);
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