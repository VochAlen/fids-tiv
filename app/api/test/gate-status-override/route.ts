// app/api/test/gate-status-override/route.ts
import { NextResponse } from 'next/server';
import { getRedisClient } from '@/lib/redis';

// Ključevi stariji od ovoga se smatraju zastarjelim (bezbjednosna mreža,
// pored Redis EX TTL-a koji već automatski čisti nakon 6h)
const MAX_AGE_MS = 6 * 60 * 60 * 1000; // 6 sati — isto kao Redis TTL

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const gateNumber = searchParams.get('gateNumber');
  const client = getRedisClient();
  const now = Date.now();

  if (gateNumber) {
    const redisKey = `test:gate-status:${gateNumber}`;
    const value = await client.get(redisKey);
    if (!value) {
      return NextResponse.json(
        { status: null, flightNumber: null, setAt: null },
        { headers: { 'Cache-Control': 'no-store' } }
      );
    }

    const data = JSON.parse(value);
    if (data.setAt && (now - data.setAt > MAX_AGE_MS)) {
      await client.del(redisKey);
      return NextResponse.json(
        { status: null, flightNumber: null, setAt: null },
        { headers: { 'Cache-Control': 'no-store' } }
      );
    }

    return NextResponse.json(data, { headers: { 'Cache-Control': 'no-store' } });
  }

  // Vrati sve gate-ove (uz čišćenje starih, bez internih HTTP poziva)
  const all: Record<string, any> = {};
  let cursor = '0';
  let cleanedCount = 0;

  do {
    const [nextCursor, keys] = await client.scan(cursor, 'MATCH', 'test:gate-status:*', 'COUNT', 100);
    cursor = nextCursor;

    if (keys.length > 0) {
      // Pipeline umjesto sekvencijalnih GET poziva
      const pipeline = client.pipeline();
      keys.forEach(key => pipeline.get(key));
      const results = await pipeline.exec();

      results?.forEach((result, i) => {
        const key = keys[i];
        const gate = key.replace('test:gate-status:', '');
        const value = result?.[1] as string | null;
        if (!value) return;

        try {
          const data = JSON.parse(value);
          if (data.setAt && (now - data.setAt > MAX_AGE_MS)) {
            client.del(key).catch(() => {});
            cleanedCount++;
            return;
          }
          all[gate] = data;
        } catch {
          client.del(key).catch(() => {});
          cleanedCount++;
        }
      });
    }
  } while (cursor !== '0');

  if (cleanedCount > 0) {
    console.log(`[gate-cleanup] Total cleaned: ${cleanedCount} old gate-status keys`);
  }

  return NextResponse.json(all, {
    headers: { 'Cache-Control': 'public, s-maxage=5, stale-while-revalidate=15' },
  });
}

export async function POST(request: Request) {
  const { gateNumber, action, flightNumber } = await request.json();
  const client = getRedisClient();
  const redisKey = `test:gate-status:${gateNumber}`;

  if (!gateNumber) {
    return NextResponse.json({ error: 'gateNumber required' }, { status: 400 });
  }

  if (action === 'open' && flightNumber) {
    const value = JSON.stringify({ status: 'open', flightNumber, setAt: Date.now() });
    await client.set(redisKey, value, 'EX', 21600);
    return NextResponse.json({ success: true, ttl: 21600 });
  }

  if (action === 'closed') {
    const value = JSON.stringify({ status: 'closed', flightNumber: flightNumber || '', setAt: Date.now() });
    await client.set(redisKey, value, 'EX', 21600);
    return NextResponse.json({ success: true, ttl: 21600 });
  }

  if (action === 'clear') {
    await client.del(redisKey);
    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
}