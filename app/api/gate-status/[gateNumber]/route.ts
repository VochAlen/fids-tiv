import { NextResponse } from 'next/server';
import { getRedisClient } from '@/lib/redis';

export async function GET(
  request: Request,
  { params }: { params: { gateNumber: string } }
) {
  try {
    const client = getRedisClient();
    const status = await client.get(`gate-status:${params.gateNumber}`);
    return NextResponse.json({ status: status || null });
  } catch (error) {
    return NextResponse.json({ status: null });
  }
}