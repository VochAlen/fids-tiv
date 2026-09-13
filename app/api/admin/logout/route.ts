// app/api/admin/logout/route.ts
import { NextResponse } from 'next/server';

// Edge runtime — isti razlog kao u login/route.ts: nema Node.js
// zavisnosti, i logout se poziva i automatski (idle-timeout) pa cold
// start ovdje direktno utiče na to koliko brzo se sesija stvarno zatvori.
export const runtime = 'edge';

export async function POST() {
  const res = NextResponse.json({ success: true });
  // Isto ime i putanja kao u login/route.ts — mora se poklapati da bi
  // brisanje cookie-a stvarno "pogodilo" isti onaj koji je httpOnly
  // postavljen pri prijavi.
  res.cookies.set('admin-authenticated', '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    maxAge: 0,
  });
  return res;
}
