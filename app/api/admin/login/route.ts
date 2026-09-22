// app/api/admin/login/route.ts
import { NextResponse } from 'next/server';
import { createSessionToken, SESSION_COOKIE_NAME, SESSION_DURATION_SECONDS } from '@/lib/auth-session';

type AdminUser = { username: string; password: string };

function getAdminUsers(): AdminUser[] {
  const raw = process.env.ADMIN_USERS;
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (u): u is AdminUser => typeof u?.username === 'string' && typeof u?.password === 'string'
    );
  } catch {
    console.error('[admin/login] ADMIN_USERS nije validan JSON');
    return [];
  }
}

export async function POST(request: Request) {
  try {
    const users = getAdminUsers();

    if (users.length === 0) {
      console.error('[admin/login] ADMIN_USERS nije postavljen ili je prazan');
      return NextResponse.json(
        { success: false, message: 'Server nije konfigurisan' },
        { status: 500 }
      );
    }

    // ── v4 FIX (Grupa A): uklonjen console.log('RAW BODY:', raw) ──
    // Ranije se password logovao u Vercel logs u plaintextu.
    const raw = await request.text();
    let parsed: { username?: string; password?: string };
    try {
      parsed = JSON.parse(raw);
    } catch {
      return NextResponse.json(
        { success: false, message: 'Invalid JSON u zahtjevu' },
        { status: 400 }
      );
    }

    const { username, password } = parsed;

    const match = users.find(u => u.username === username && u.password === password);

    if (!match) {
      // Logujemo samo neuspjeli pokušaj sa username (ne i password) —
      // korisno za security audit, bez curenja credentials.
      console.warn(`[admin/login] Neuspjela prijava za username: ${username || '(prazan)'}`);
      return NextResponse.json(
        { success: false, message: 'Pogrešno korisničko ime ili lozinka' },
        { status: 401 }
      );
    }

    const token = await createSessionToken(match.username);

    const response = NextResponse.json(
      { success: true, message: 'Uspešna prijava' },
      { headers: { 'Cache-Control': 'no-store, max-age=0' } }
    );

    response.cookies.set(SESSION_COOKIE_NAME, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/',
      maxAge: SESSION_DURATION_SECONDS,
    });

    console.log(`[admin/login] Uspešna prijava za username: ${match.username}`);
    return response;
  } catch (error) {
    console.error('[admin/login] error:', error);
    return NextResponse.json(
      { success: false, message: 'Greška pri prijavljivanju' },
      { status: 500 }
    );
  }
}
