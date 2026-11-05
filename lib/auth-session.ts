// lib/auth-session.ts
import { SignJWT, jwtVerify } from 'jose';
import { isRole, type Role } from '@/lib/roles';

const SESSION_COOKIE_NAME = 'admin-session';
const SESSION_DURATION_SECONDS = 24 * 60 * 60; // 24h

function getSecretKey(): Uint8Array {
  const secret = process.env.ADMIN_SESSION_SECRET;
  if (!secret) throw new Error('ADMIN_SESSION_SECRET nije postavljen u .env.local');
  return new TextEncoder().encode(secret);
}

// role/ver: uloga i verzija korisnika u trenutku prijave. `ver` se povećava pri resetu lozinke
// i deaktivaciji, pa stari tokeni prestaju da važe (provjerava requireAdmin, vidi lib/admin-auth.ts).
export async function createSessionToken(username: string, role: Role = 'admin', ver = 0): Promise<string> {
  return await new SignJWT({ username, role, ver })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DURATION_SECONDS}s`)
    .sign(getSecretKey());
}

export async function verifySessionToken(token: string): Promise<{ username: string; role: Role; ver: number } | null> {
  try {
    const { payload } = await jwtVerify(token, getSecretKey());
    if (typeof payload.username !== 'string') return null;
    // Tokeni izdati prije uvođenja uloga nemaju `role` → admin (do tada su svi bili admini).
    return {
      username: payload.username,
      role: isRole(payload.role) ? payload.role : 'admin',
      ver: typeof payload.ver === 'number' ? payload.ver : 0,
    };
  } catch {
    return null; // istekao, falsifikovan, ili nevažeći
  }
}

export { SESSION_COOKIE_NAME, SESSION_DURATION_SECONDS };