// app/api/gate-status/[gateNumber]/route.ts
import { NextResponse } from 'next/server';
import { safeRedisGet, safeRedisSet, safeRedisDel } from '@/lib/redis';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ gateNumber: string }> }
) {
  const { gateNumber } = await params;
  const status = await safeRedisGet(`gate-status:${gateNumber}`);
  // Uvijek vraća 200 — null znači "nema overridea", page.tsx to razumije
  return NextResponse.json({ status });
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ gateNumber: string }> }
) {
  try {
    const { gateNumber } = await params;
    const { status } = await request.json();
    const key = `gate-status:${gateNumber}`;

    if (status === null || status === undefined) {
      // Briši ključ – gate se vraća na automatski način rada
      await safeRedisDel(key);
    } else {
      // status može biti "open" ili "closed"
      await safeRedisSet(key, status);
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('PUT gate-status error:', error);
    return NextResponse.json(
      { success: false, error: 'Invalid request' },
      { status: 400 }
    );
  }
}