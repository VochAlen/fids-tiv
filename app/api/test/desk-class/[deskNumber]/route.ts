import { NextRequest, NextResponse } from 'next/server';
import { getRedisClient } from '@/lib/redis';

const REDIS_KEY = (deskNumber: string) => `desk-class:${deskNumber}`;

export async function GET(
  _req: NextRequest,
  { params }: { params: { deskNumber: string } }
) {
  const { deskNumber } = params;
  try {
    const client = getRedisClient();
    const classType = await client.get(REDIS_KEY(deskNumber));
    return NextResponse.json({ classType: classType ?? null });
  } catch (err) {
    console.error('[desk-class] GET error:', err);
    return NextResponse.json({ classType: null });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: { deskNumber: string } }
) {
  const { deskNumber } = params;
  const body = await req.json();
  const classType: string | null = body.classType ?? null;

  try {
    const client = getRedisClient();
    if (classType === null) {
      await client.del(REDIS_KEY(deskNumber));
    } else {
      // TTL 24h — automatski se čisti
      await client.set(REDIS_KEY(deskNumber), String(classType), 'EX', 86400);
    }
    return NextResponse.json({ ok: true, deskNumber, classType });
  } catch (err) {
    console.error('[desk-class] POST error:', err);
    return NextResponse.json({ ok: false, error: 'Redis error' }, { status: 500 });
  }
}