// app/api/admin/logout/route.ts
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

export async function POST() {
  // Obrišiauth cookie - koristi isto ime kao u middleware
  (await
    // Obrišiauth cookie - koristi isto ime kao u middleware
    cookies()).delete('admin-authenticated');
  
  return NextResponse.json({ success: true });
}