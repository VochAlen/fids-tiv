// app/api/desk-status/[deskNumber]/route.ts
import { NextResponse } from 'next/server';
import { getRedisClient } from '@/lib/redis';

export async function GET(
  request: Request,
  { params }: { params: { deskNumber: string } }
) {
  try {
    const { deskNumber } = params;
    const client = getRedisClient();
    const redisKey = `desk-status:${deskNumber}`;
    
    const value = await client.get(redisKey);
    
    if (!value) {
      return NextResponse.json({ status: null });
    }
    
    // Pokušaj parsirati JSON (novi format)
    try {
      const data = JSON.parse(value);
      return NextResponse.json({ 
        status: data.status,
        flightNumber: data.flightNumber,
        setAt: data.setAt
      });
    } catch {
      // Stari format (samo string)
      return NextResponse.json({ status: value });
    }
    
  } catch (error) {
    console.error('[desk-status] Redis error:', error);
    return NextResponse.json({ status: null });
  }
}