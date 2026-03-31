import { NextResponse } from 'next/server';
import { getRedisClient } from '@/lib/redis';

export async function GET(
  request: Request,
  { params }: { params: { deskNumber: string } }
) {
  try {
    const client = getRedisClient();
    const status = await client.get(`desk-status:${params.deskNumber}`);
    
    return NextResponse.json({ status: status || null });
  } catch (error) {
    return NextResponse.json({ status: null });
  }
}