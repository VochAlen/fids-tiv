import { NextResponse } from 'next/server';
import { getRedisClient } from '@/lib/redis';

// ⭐ NOVO: Konstanta za starost ključeva (20 sati)
const MAX_AGE_MS = 4 * 60 * 60 * 1000; // 4 sata

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const deskNumber = searchParams.get('deskNumber');
  const client = getRedisClient();

  // Ako je specificiran deskNumber – vrati samo njega (bez čišćenja)
  if (deskNumber) {
    const redisKey = `test:desk-status:${deskNumber}`;
    const value = await client.get(redisKey);
if (!value) {
      return NextResponse.json(
        { status: null, flightNumber: null },
        { headers: { 'Cache-Control': 'no-store' } }
      );
    }
    
    // ⭐ PROVJERI DA LI JE KLJUČ STAR
    const data = JSON.parse(value);
    if (data.setAt && (Date.now() - data.setAt > MAX_AGE_MS)) {
      // Ključ je star - obriši ga
      await client.del(redisKey);
      return NextResponse.json({ status: null, flightNumber: null });
    }
    
return NextResponse.json(
      {
        status: data.status,
        flightNumber: data.flightNumber,
        setAt: data.setAt,
      },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  }

  // Inače – vrati SVE testne dodjele (uz čišćenje starih)
  const all: Record<string, any> = {};
  let cursor = '0';
  const now = Date.now();
  let cleanedCount = 0;
  
  do {
    const [nextCursor, keys] = await client.scan(cursor, 'MATCH', 'test:desk-status:*', 'COUNT', 100);
    cursor = nextCursor;
    for (const key of keys) {
      const desk = key.replace('test:desk-status:', '');
      const value = await client.get(key);
      if (value) {
        try {
          const data = JSON.parse(value);
          
          // ⭐ PROVJERI DA LI JE KLJUČ STAR
          if (data.setAt && (now - data.setAt > MAX_AGE_MS)) {
            // Obriši stari ključ
            await client.del(key);
            cleanedCount++;
            console.log(`[cleanup] Deleted old desk-status key: ${key} (age: ${Math.round((now - data.setAt) / 3600000)}h)`);
            continue;
          }
          
          all[desk] = {
            status: data.status,
            flightNumber: data.flightNumber,
            setAt: data.setAt,
          };
        } catch (err) {
          // Ako ne može parsirati, vjerovatno je korumpiran - obriši
          console.warn(`[cleanup] Deleting invalid key: ${key}`);
          await client.del(key);
          cleanedCount++;
        }
      }
    }
  } while (cursor !== '0');

if (cleanedCount > 0) {
    console.log(`[cleanup] Total cleaned: ${cleanedCount} old desk-status keys`);
  }

  return NextResponse.json(all, {
    headers: { 'Cache-Control': 'public, s-maxage=5, stale-while-revalidate=15' },
  });
}
export async function POST(request: Request) {
  const { deskNumber, action, flightNumber } = await request.json();
  const client = getRedisClient();
  const redisKey = `test:desk-status:${deskNumber}`;

  if (!deskNumber) {
    return NextResponse.json({ error: 'deskNumber required' }, { status: 400 });
  }

  if (action === 'open' && flightNumber) {
    const value = JSON.stringify({ status: 'open', flightNumber, setAt: Date.now() });
    await client.set(redisKey, value, 'EX', 3600);
    return NextResponse.json({ success: true, ttl: 3600 });
  }

  if (action === 'closed') {
    const value = JSON.stringify({ status: 'closed', flightNumber: flightNumber || '', setAt: Date.now() });
    await client.set(redisKey, value, 'EX', 3600);
    return NextResponse.json({ success: true, ttl: 3600 });
  }

  if (action === 'clear') {
    await client.del(redisKey);
    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
}