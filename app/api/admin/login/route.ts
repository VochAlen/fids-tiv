// app/api/admin/login/route.ts
import { NextResponse } from 'next/server';
import { createSessionToken, SESSION_COOKIE_NAME, SESSION_DURATION_SECONDS } from '@/lib/auth-session';
import { getClientIp } from '@/lib/get-client-ip';
import { getRedisClient, isCircuitOpen } from '@/lib/redis';

// NOVO (po zahtjevu — prijavljen bezbjednosni gap: /api/admin/login
// NIJE imao rate limiting, iako je admin panel NAMJERNO dostupan sa
// bilo koje mreže, ne samo aerodromske — osoblje mora moći da mu
// pristupi sa mobilnog dok hoda terminalom. Bez ovoga, neko bi
// teorijski mogao da proba veliki broj lozinki uzastopno (brute-force).
// Redis-om praćeno, PO IP adresi: nakon MAX_FAILED_ATTEMPTS neuspjelih
// pokušaja unutar WINDOW_SECONDS, taj IP je privremeno zaključan.
// Uspješna prijava odmah briše brojač za taj IP (ne čeka istek prozora).
// Fail-OPEN ako je Redis nedostupan (isti princip kao IP allowlist u
// middleware.ts) — ne smijemo potpuno blokirati legitimno osoblje zbog
// infrastrukturnog problema koji nema veze sa njima.
const MAX_FAILED_ATTEMPTS = 5;
const WINDOW_SECONDS = 15 * 60; // 15 min

async function checkRateLimit(ip: string): Promise<{ allowed: boolean; retryAfterSec?: number }> {
  if (isCircuitOpen()) return { allowed: true }; // fail-open

  try {
    const client = getRedisClient();
    const key = `admin-login:attempts:${ip}`;
    const count = await client.get(key);
    const n = count ? parseInt(count, 10) : 0;

    if (n >= MAX_FAILED_ATTEMPTS) {
      const ttl = await client.ttl(key);
      return { allowed: false, retryAfterSec: ttl > 0 ? ttl : WINDOW_SECONDS };
    }
    return { allowed: true };
  } catch {
    return { allowed: true }; // fail-open
  }
}

async function recordFailedAttempt(ip: string): Promise<void> {
  if (isCircuitOpen()) return;
  try {
    const client = getRedisClient();
    const key = `admin-login:attempts:${ip}`;
    const n = await client.incr(key);
    if (n === 1) {
      await client.expire(key, WINDOW_SECONDS);
    }
  } catch {
    // Nema rate limitinga ako Redis padne — vidi fail-open napomenu iznad.
  }
}

async function clearFailedAttempts(ip: string): Promise<void> {
  if (isCircuitOpen()) return;
  try {
    const client = getRedisClient();
    await client.del(`admin-login:attempts:${ip}`);
  } catch {
    // Nije kritično — brojač će isteći sam nakon WINDOW_SECONDS.
  }
}

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

    // NOVO — provjera rate limita PRIJE bilo kakve obrade lozinke.
    const ip = getClientIp(request.headers) ?? 'unknown';
    const rateLimit = await checkRateLimit(ip);
    if (!rateLimit.allowed) {
      console.warn(`[admin/login] Rate limit dostignut za IP: ${ip}`);
      return NextResponse.json(
        { success: false, message: 'Previše neuspjelih pokušaja — pokušaj ponovo kasnije', retryAfterSec: rateLimit.retryAfterSec },
        { status: 429, headers: rateLimit.retryAfterSec ? { 'Retry-After': String(rateLimit.retryAfterSec) } : {} }
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
      await recordFailedAttempt(ip);
      return NextResponse.json(
        { success: false, message: 'Pogrešno korisničko ime ili lozinka' },
        { status: 401 }
      );
    }

    // NOVO — uspješna prijava odmah briše brojač za ovaj IP (ne čeka
    // istek prozora), da legitimno osoblje ne ostane privremeno
    // zaključano zbog par ranijih tipfelera prije nego se sjeti
    // tačne lozinke.
    await clearFailedAttempts(ip);

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
