// lib/users.ts
//
// Korisnici admin panela u Redis-u (jedan hash, ~desetine zapisa). Zamjenjuje
// ADMIN_USERS iz env varijable kao glavni izvor; env ostaje samo kao rezerva
// (vidi app/api/admin/login/route.ts).
//
// TROŠAK: prijava = 1 HGET (+ 1 HSET zadnja prijava). Provjera sesije u
// requireAdmin() koristi keš u memoriji (AUTH_CACHE_MS) pa je to najviše jedan
// HGET po korisniku u minuti po instanci funkcije. Nema novog servisa.
//
// Zapisi se NE brišu (samo deaktiviraju), da token izdat deaktiviranom korisniku
// ne bi ponovo prošao kao "nepoznat korisnik iz env rezerve".

import { getRedisClient, isCircuitOpen } from '@/lib/redis';
import { isRole, type Role } from '@/lib/roles';
import type { PublicUser } from '@/lib/user-rules';

export const USERS_KEY = 'ably-fids:users';
export const AUTH_CACHE_MS = 60_000;

export type UserRecord = PublicUser & { hash: string; ver: number };

export function toPublic(r: UserRecord): PublicUser {
  return { username: r.username, role: r.role, active: r.active, created: r.created, lastLogin: r.lastLogin, mustChange: r.mustChange };
}

function parseRecord(username: string, raw: string): UserRecord | null {
  try {
    const o = JSON.parse(raw) as Partial<UserRecord>;
    if (typeof o.hash !== 'string' || !isRole(o.role)) return null;
    return {
      username,
      role: o.role,
      active: o.active !== false,
      created: typeof o.created === 'number' ? o.created : 0,
      lastLogin: typeof o.lastLogin === 'number' ? o.lastLogin : null,
      mustChange: o.mustChange === true,
      hash: o.hash,
      ver: typeof o.ver === 'number' ? o.ver : 0,
    };
  } catch {
    return null;
  }
}

function serialize(r: UserRecord): string {
  const { username: _u, ...rest } = r;
  void _u;
  return JSON.stringify(rest);
}

/** null = Redis nedostupan (ne znači "nema korisnika"). */
export async function listUsers(): Promise<UserRecord[] | null> {
  if (isCircuitOpen()) return null;
  try {
    const all = await getRedisClient().hgetall(USERS_KEY);
    const out: UserRecord[] = [];
    for (const [name, raw] of Object.entries(all)) {
      const rec = parseRecord(name, raw);
      if (rec) out.push(rec);
    }
    return out.sort((a, b) => a.username.localeCompare(b.username));
  } catch {
    return null;
  }
}

/** { ok:false } = Redis nedostupan; { ok:true, user:null } = korisnik ne postoji. */
export async function getUser(username: string): Promise<{ ok: true; user: UserRecord | null } | { ok: false }> {
  if (isCircuitOpen()) return { ok: false };
  try {
    const raw = await getRedisClient().hget(USERS_KEY, username);
    return { ok: true, user: raw ? parseRecord(username, raw) : null };
  } catch {
    return { ok: false };
  }
}

export async function saveUser(rec: UserRecord): Promise<boolean> {
  if (isCircuitOpen()) return false;
  try {
    await getRedisClient().hset(USERS_KEY, rec.username, serialize(rec));
    authCache.delete(rec.username);
    return true;
  } catch {
    return false;
  }
}

/** Upis samo ako ključ ne postoji (sprečava prepisivanje pri istovremenom kreiranju). */
export async function createUserIfAbsent(rec: UserRecord): Promise<'created' | 'exists' | 'error'> {
  if (isCircuitOpen()) return 'error';
  try {
    const n = await getRedisClient().hsetnx(USERS_KEY, rec.username, serialize(rec));
    authCache.delete(rec.username);
    return n === 1 ? 'created' : 'exists';
  } catch {
    return 'error';
  }
}

// ── provjera sesije (keš u memoriji instance) ────────────────────────────
export type AuthState =
  | { kind: 'record'; role: Role; active: boolean; ver: number }
  | { kind: 'unknown' }      // nema zapisa (npr. korisnik iz env rezerve)
  | { kind: 'unavailable' }; // Redis ne odgovara

const authCache = new Map<string, { at: number; state: AuthState }>();

export async function getAuthState(username: string, now: number = Date.now()): Promise<AuthState> {
  const hit = authCache.get(username);
  if (hit && now - hit.at < AUTH_CACHE_MS) return hit.state;
  const r = await getUser(username);
  let state: AuthState;
  if (!r.ok) state = { kind: 'unavailable' };
  else if (!r.user) state = { kind: 'unknown' };
  else state = { kind: 'record', role: r.user.role, active: r.user.active, ver: r.user.ver };
  // "nedostupan" se ne kešira — sljedeći zahtjev odmah proba ponovo
  if (state.kind !== 'unavailable') authCache.set(username, { at: now, state });
  return state;
}

export function clearAuthCache(): void {
  authCache.clear();
}
