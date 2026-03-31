import { NextResponse } from 'next/server';
import { getRedisClient } from '@/lib/redis';

export async function GET(
  request: Request,
  { params }: { params: { deskNumber: string } }
) {
  try {
    const client = getRedisClient();
    const classType = await client.get(`desk-class:${params.deskNumber}`);
    
    return NextResponse.json({ classType: classType || null });
  } catch (error) {
    return NextResponse.json({ classType: null });
  }
}