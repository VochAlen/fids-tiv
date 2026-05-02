// app/api/gate-status/[gate]/route.ts
import { NextResponse } from 'next/server';
import { safeRedisGet } from '@/lib/redis';

export async function GET(
  _request: Request,
  { params }: { params: { gate: string } }
) {
  const status = await safeRedisGet(`gate-status:${params.gate}`);
  // Uvijek vraća 200 — null znači "nema overridea", page.tsx to razumije
  return NextResponse.json({ status });
}