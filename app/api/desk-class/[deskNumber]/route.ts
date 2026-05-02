// app/api/desk-class/[deskNumber]/route.ts
import { NextResponse } from 'next/server';
import { safeRedisGet } from '@/lib/redis';
 
export async function GET(
  _request: Request,
  { params }: { params: { deskNumber: string } }
) {
  const classType = await safeRedisGet(`desk-class:${params.deskNumber}`);
  return NextResponse.json({ classType });
}
 