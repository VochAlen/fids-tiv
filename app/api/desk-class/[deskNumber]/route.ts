// app/api/desk-class/[deskNumber]/route.ts
import { NextResponse } from 'next/server';
import { safeRedisGet, getRedisClient } from '@/lib/redis';

// GET - dohvati klasu šaltera
export async function GET(
  _request: Request,
  { params }: { params: { deskNumber: string } }
) {
  const classType = await safeRedisGet(`desk-class:${params.deskNumber}`);
  return NextResponse.json({ classType });
}

// POST - postavi klasu šaltera
export async function POST(
  request: Request,
  { params }: { params: { deskNumber: string } }
) {
  try {
    const { classType } = await request.json();
    const client = getRedisClient();
    const key = `desk-class:${params.deskNumber}`;
    
    if (classType === 'business' || classType === 'economy') {
      // Sačuvaj klasu sa TTL od 24 sata (86400 sekundi)
      await client.setex(key, 86400, classType);
      console.log(`[desk-class] Desk ${params.deskNumber} set to ${classType}`);
      return NextResponse.json({ success: true, classType });
    } else if (classType === null || classType === 'clear') {
      // Obriši override
      await client.del(key);
      console.log(`[desk-class] Desk ${params.deskNumber} override cleared`);
      return NextResponse.json({ success: true, classType: null });
    } else {
      return NextResponse.json({ error: 'Invalid classType. Use "business" or "economy"' }, { status: 400 });
    }
  } catch (error) {
    console.error('[desk-class] POST error:', error);
    return NextResponse.json({ error: 'Failed to set desk class' }, { status: 500 });
  }
}

// DELETE - obriši klasu šaltera
export async function DELETE(
  _request: Request,
  { params }: { params: { deskNumber: string } }
) {
  try {
    const client = getRedisClient();
    await client.del(`desk-class:${params.deskNumber}`);
    return NextResponse.json({ success: true, message: 'Desk class override cleared' });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to clear desk class' }, { status: 500 });
  }
}