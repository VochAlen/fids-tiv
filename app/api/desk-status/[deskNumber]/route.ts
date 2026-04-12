// app/api/desk-status/[deskNumber]/route.ts
import { NextResponse } from 'next/server';
import { safeRedisGet } from '@/lib/redis';

export async function GET(
  _request: Request,
  { params }: { params: { deskNumber: string } }
) {
  const status = await safeRedisGet(`desk-status:${params.deskNumber}`);
  return NextResponse.json({ status });
}