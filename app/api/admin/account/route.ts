// app/api/admin/account/route.ts — promjena SOPSTVENE lozinke (svaka uloga).
import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';
import { hashPassword, verifyPassword } from '@/lib/password';
import { getUser, saveUser } from '@/lib/users';
import { validatePassword } from '@/lib/user-rules';
import { createSessionToken, SESSION_COOKIE_NAME, SESSION_DURATION_SECONDS } from '@/lib/auth-session';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const { session, error } = await requireAdmin(request);
  if (error || !session) return error!;

  let body: { current?: unknown; next?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Neispravan zahtjev' }, { status: 400 });
  }

  const g = await getUser(session.username);
  if (!g.ok) return NextResponse.json({ error: 'Redis nije dostupan' }, { status: 503 });
  if (!g.user) {
    return NextResponse.json({ error: 'Ovaj račun nije u bazi korisnika (prijava iz rezerve). Admin ga mora uvesti na stranici Korisnici.' }, { status: 409 });
  }
  if (typeof body.current !== 'string' || !(await verifyPassword(body.current, g.user.hash))) {
    return NextResponse.json({ error: 'Trenutna lozinka nije tačna' }, { status: 400 });
  }
  const bad = validatePassword(body.next, session.username);
  if (bad) return NextResponse.json({ error: bad }, { status: 400 });
  if (body.next === body.current) return NextResponse.json({ error: 'Nova lozinka mora biti drugačija' }, { status: 400 });

  const next = { ...g.user, hash: await hashPassword(body.next as string), mustChange: false, ver: g.user.ver + 1 };
  if (!(await saveUser(next))) return NextResponse.json({ error: 'Redis nije dostupan' }, { status: 503 });

  // Sve ostale sesije ovog korisnika prestaju da važe (ver+1); ova dobija novi token.
  const token = await createSessionToken(next.username, next.role, next.ver);
  const res = NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
  res.cookies.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', path: '/', maxAge: SESSION_DURATION_SECONDS,
  });
  return res;
}
