import { NextResponse } from 'next/server';
import { getRedisClient } from '@/lib/redis';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const deskNumber = searchParams.get('deskNumber');
  const client = getRedisClient();

  // Ako je specificiran deskNumber – vrati samo njega
  if (deskNumber) {
    const redisKey = `test:desk-status:${deskNumber}`;
    const value = await client.get(redisKey);
    if (!value) {
      return NextResponse.json({ status: null, flightNumber: null });
    }
    const data = JSON.parse(value);
    return NextResponse.json({
      status: data.status,
      flightNumber: data.flightNumber,
      setAt: data.setAt,
    });
  }

  // Inače – vrati SVE testne dodjele (kao objekat { deskNumber: { status, flightNumber, setAt } })
  const all: Record<string, any> = {};
  let cursor = '0';
  do {
    const [nextCursor, keys] = await client.scan(cursor, 'MATCH', 'test:desk-status:*', 'COUNT', 100);
    cursor = nextCursor;
    for (const key of keys) {
      const desk = key.replace('test:desk-status:', '');
      const value = await client.get(key);
      if (value) {
        const data = JSON.parse(value);
        all[desk] = {
          status: data.status,
          flightNumber: data.flightNumber,
          setAt: data.setAt,
        };
      }
    }
  } while (cursor !== '0');

  return NextResponse.json(all);
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