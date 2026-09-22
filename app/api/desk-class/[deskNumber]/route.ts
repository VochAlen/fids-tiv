// app/api/desk-class/[deskNumber]/route.ts
import { NextResponse } from 'next/server';
import { safeRedisGet, getRedisClient } from '@/lib/redis';

// GET - dohvati klasu šaltera
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ deskNumber: string }> }
) {
  const { deskNumber } = await params;
  const classType = await safeRedisGet(`desk-class:${deskNumber}`);
  return NextResponse.json({ classType });
}

// POST - postavi klasu šaltera
export async function POST(
  request: Request,
  { params }: { params: Promise<{ deskNumber: string }> }
) {
  try {
    const { deskNumber } = await params;
    const { classType } = await request.json();
    const client = getRedisClient();
    const key = `desk-class:${deskNumber}`;

    if (classType === 'business' || classType === 'economy') {
      // Sačuvaj klasu sa TTL od 24 sata (86400 sekundi)
      await client.setex(key, 86400, classType);
      console.log(`[desk-class] Desk ${deskNumber} set to ${classType}`);
      return NextResponse.json({ success: true, classType });
    } else if (classType === null || classType === 'clear') {
      // Obriši override
      await client.del(key);
      console.log(`[desk-class] Desk ${deskNumber} override cleared`);
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
  { params }: { params: Promise<{ deskNumber: string }> }
) {
  try {
    const { deskNumber } = await params;
    const client = getRedisClient();
    await client.del(`desk-class:${deskNumber}`);
    return NextResponse.json({ success: true, message: 'Desk class override cleared' });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to clear desk class' }, { status: 500 });
  }
}