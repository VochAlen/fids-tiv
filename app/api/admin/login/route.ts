// app/api/admin/login/route.ts
import { NextResponse, after } from 'next/server';
import { createSessionToken, SESSION_COOKIE_NAME, SESSION_DURATION_SECONDS } from '@/lib/auth-session';
import { getClientIp } from '@/lib/get-client-ip';
import { getRedisClient, isCircuitOpen } from '@/lib/redis';
import { buildAccessEvent } from '@/lib/access-log';
import { logAccessEvent } from '@/lib/access-log-server';
import { createHash, timingSafeEqual } from 'crypto';
import { verifyPassword, dummyHash } from '@/lib/password';
import { getUser, listUsers, saveUser } from '@/lib/users';
import { normalizeUsername } from '@/lib/user-rules';
import type { Role } from '@/lib/roles';

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

// ── Rezerva: ADMIN_USERS iz env varijable ───────────────────────────────
// Glavni izvor korisnika je Redis (lib/users.ts, stranica /admin/users). Env lista važi
// SAMO kad (a) Redis ne odgovara ili (b) u Redis-u nema nijednog aktivnog admina
// (prvo pokretanje / hitni pristup). Čim postoji aktivan admin u Redis-u, env lozinke
// se ignorišu — pa ih poslije uvoza treba ukloniti iz Vercel Environment Variables.
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

const digest = (x: string) => createHash('sha256').update(x).digest();
function safeEqual(a: string, b: string): boolean {
  return timingSafeEqual(digest(a), digest(b));
}

type LoginResult =
  | { ok: true; username: string; role: Role; ver: number; mustChange: boolean; source: 'redis' | 'env' }
  | { ok: false; knownUser: boolean };

async function authenticate(username: unknown, password: unknown, envUsers: AdminUser[]): Promise<LoginResult> {
  const uname = normalizeUsername(username);
  const pw = typeof password === 'string' ? password : '';

  // 1) Redis
  const found = uname ? await getUser(uname) : ({ ok: true, user: null } as const);
  if (found.ok && found.user) {
    const good = await verifyPassword(pw, found.user.hash);
    if (good && found.user.active) {
      // zadnja prijava: najviše jedan HSET, ne smije blokirati prijavu
      await saveUser({ ...found.user, lastLogin: Date.now() });
      return { ok: true, username: found.user.username, role: found.user.role, ver: found.user.ver, mustChange: found.user.mustChange, source: 'redis' };
    }
    return { ok: false, knownUser: true };
  }

  // nepoznat korisnik: potroši isto vrijeme kao provjera pravog (nema razlike po vremenu)
  if (found.ok) await verifyPassword(pw, await dummyHash());

  // 2) env rezerva
  const envMatch = envUsers.find((u) => u.username === (typeof username === 'string' ? username : '') && safeEqual(u.password, pw));
  const knownUser = envUsers.some((u) => u.username === username);
  if (!envMatch) return { ok: false, knownUser };

  if (found.ok) {
    // Redis radi: env važi samo dok nema nijednog aktivnog admina u njemu.
    const all = await listUsers();
    if (all && all.some((u) => u.role === 'admin' && u.active)) {
      console.warn('[admin/login] ADMIN_USERS korisnik odbijen: u Redis-u već postoji aktivan admin (ukloni ADMIN_USERS iz env-a)');
      return { ok: false, knownUser: true };
    }
  }
  return { ok: true, username: envMatch.username, role: 'admin', ver: 0, mustChange: false, source: 'env' };
}

export async function POST(request: Request) {
  try {
    const users = getAdminUsers();

    // NOVO — provjera rate limita PRIJE bilo kakve obrade lozinke.
    const ip = getClientIp(request.headers) ?? 'unknown';
    const rateLimit = await checkRateLimit(ip);
    if (!rateLimit.allowed) {
      console.warn(`[admin/login] Rate limit dostignut za IP: ${ip}`);
      { const ev = buildAccessEvent(request.headers, 'login_blocked'); after(() => logAccessEvent(ev)); }
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

    const result = await authenticate(username, password, users);

    if (!result.ok) {
      // Logujemo samo neuspjeli pokušaj bez lozinke i bez ukucanog imena (moglo bi biti pogrešno
      // ukucana lozinka u polju za ime) — korisno za audit, bez curenja credentials.
      console.warn('[admin/login] Neuspjela prijava');
      await recordFailedAttempt(ip);
      // istorija pristupa: bez upisanog korisničkog imena — samo da li je ime poznato
      { const ev = buildAccessEvent(request.headers, 'login_fail', result.knownUser && typeof username === 'string' ? { u: normalizeUsername(username) } : {}); after(() => logAccessEvent(ev)); }
      return NextResponse.json(
        { success: false, message: 'Pogrešno korisničko ime ili lozinka' },
        { status: 401 }
      );
    }
    const match = result;

    // NOVO — uspješna prijava odmah briše brojač za ovaj IP (ne čeka
    // istek prozora), da legitimno osoblje ne ostane privremeno
    // zaključano zbog par ranijih tipfelera prije nego se sjeti
    // tačne lozinke.
    await clearFailedAttempts(ip);

    const token = await createSessionToken(match.username, match.role, match.ver);

    const response = NextResponse.json(
      { success: true, message: 'Uspešna prijava', role: match.role, mustChange: match.mustChange },
      { headers: { 'Cache-Control': 'no-store, max-age=0' } }
    );

    response.cookies.set(SESSION_COOKIE_NAME, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/',
      maxAge: SESSION_DURATION_SECONDS,
    });

    { const ev = buildAccessEvent(request.headers, 'login_ok', { u: match.username }); after(() => logAccessEvent(ev)); }
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
