import { NextRequest, NextResponse } from 'next/server';
import { getRedisClient } from '@/lib/redis';

const REDIS_KEY = (gateNumber: string) => `gate-class:${gateNumber}`;

export async function GET(
  _req: NextRequest,
  { params }: { params: { gateNumber: string } }
) {
  const { gateNumber } = params;
  try {
    const client = getRedisClient();
  const classType = await client.get(REDIS_KEY(gateNumber)); // ili deskNumber
    return NextResponse.json(
      { classType: classType ?? null },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (err) {
    console.error('[gate-class] GET error:', err);
    return NextResponse.json({ classType: null });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: { gateNumber: string } }
) {
  const { gateNumber } = params;
  const body = await req.json();
  const classType: string | null = body.classType ?? null;

  try {
    const client = getRedisClient();
    if (classType === null) {
      await client.del(REDIS_KEY(gateNumber));
    } else {
      await client.set(REDIS_KEY(gateNumber), String(classType), 'EX', 86400);
    }
    return NextResponse.json({ ok: true, gateNumber, classType });
  } catch (err) {
    console.error('[gate-class] POST error:', err);
    return NextResponse.json({ ok: false, error: 'Redis error' }, { status: 500 });
  }
}