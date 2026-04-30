// app/api/test/gate-status-override/route.ts
import { NextResponse } from 'next/server';
import { getRedisClient } from '@/lib/redis';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const gateNumber = searchParams.get('gateNumber');
  const client = getRedisClient();

  if (gateNumber) {
    const redisKey = `test:gate-status:${gateNumber}`;
    const value = await client.get(redisKey);
    if (!value) {
      return NextResponse.json({ status: null, flightNumber: null, setAt: null });
    }
    return NextResponse.json(JSON.parse(value));
  }

  // Vrati sve gate-ove
  const all: Record<string, any> = {};
  let cursor = '0';
  do {
    const [nextCursor, keys] = await client.scan(cursor, 'MATCH', 'test:gate-status:*', 'COUNT', 100);
    cursor = nextCursor;
    for (const key of keys) {
      const gate = key.replace('test:gate-status:', '');
      const value = await client.get(key);
      if (value) all[gate] = JSON.parse(value);
    }
  } while (cursor !== '0');

  return NextResponse.json(all);
}

export async function POST(request: Request) {
  const { gateNumber, action, flightNumber } = await request.json();
  const client = getRedisClient();
  const redisKey = `test:gate-status:${gateNumber}`;

  if (!gateNumber) return NextResponse.json({ error: 'gateNumber required' }, { status: 400 });

  if (action === 'open' && flightNumber) {
    const value = JSON.stringify({ status: 'open', flightNumber, setAt: Date.now() });
    await client.set(redisKey, value, 'EX', 3600);
    return NextResponse.json({ success: true });
  }
  if (action === 'closed') {
    const value = JSON.stringify({ status: 'closed', flightNumber: flightNumber || '', setAt: Date.now() });
    await client.set(redisKey, value, 'EX', 3600);
    return NextResponse.json({ success: true });
  }
  if (action === 'clear') {
    await client.del(redisKey);
    return NextResponse.json({ success: true });
  }
  return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
}