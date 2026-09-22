// lib/auth-session.ts
import { SignJWT, jwtVerify } from 'jose';

const SESSION_COOKIE_NAME = 'admin-session';
const SESSION_DURATION_SECONDS = 24 * 60 * 60; // 24h

function getSecretKey(): Uint8Array {
  const secret = process.env.ADMIN_SESSION_SECRET;
  if (!secret) throw new Error('ADMIN_SESSION_SECRET nije postavljen u .env.local');
  return new TextEncoder().encode(secret);
}

export async function createSessionToken(username: string): Promise<string> {
  return await new SignJWT({ username })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DURATION_SECONDS}s`)
    .sign(getSecretKey());
}

export async function verifySessionToken(token: string): Promise<{ username: string } | null> {
  try {
    const { payload } = await jwtVerify(token, getSecretKey());
    return { username: payload.username as string };
  } catch {
    return null; // istekao, falsifikovan, ili nevažeći
  }
}

export { SESSION_COOKIE_NAME, SESSION_DURATION_SECONDS };