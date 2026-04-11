 
// ─────────────────────────────────────────────────────────────
// app/api/desk-status/[deskNumber]/route.ts
// ─────────────────────────────────────────────────────────────
// import { NextResponse } from 'next/server';
// import { safeRedisGet } from '@/lib/redis';

import { safeRedisGet } from "@/lib/redis";
import { NextResponse } from "next/server";

 
export async function GET_deskStatus(
  _request: Request,
  { params }: { params: { deskNumber: string } }
) {
  const status = await safeRedisGet(`desk-status:${params.deskNumber}`);
  return NextResponse.json({ status });
}
 