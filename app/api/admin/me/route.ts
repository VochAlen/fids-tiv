// app/api/admin/me/route.ts — ko je prijavljen i koja mu je uloga (za prikaz/sakrivanje stavki u UI-u).
import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const { session, error } = await requireAdmin(request);
  if (error || !session) return error!;
  return NextResponse.json({ username: session.username, role: session.role }, { headers: { 'Cache-Control': 'no-store' } });
}
