// app/api/pa/logout/route.ts
// Odvojen od app/api/admin/logout/route.ts — briše SAMO pa-authenticated
// cookie, ne dira opštu admin sesiju (dvije potpuno nezavisne sesije).
import { NextResponse } from 'next/server';

export const runtime = 'edge';

export async function POST() {
  const res = NextResponse.json({ success: true });
  res.cookies.set('pa-authenticated', '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    maxAge: 0,
  });
  return res;
}
