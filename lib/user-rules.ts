// lib/user-rules.ts
//
// ČISTA pravila za korisnike admin panela (bez Redis-a i bez Node API-ja) —
// zato se lako testiraju, a koriste ih i API rute i stranica.

import type { Role } from '@/lib/roles';

export type PublicUser = {
  username: string;
  role: Role;
  active: boolean;
  created: number;
  lastLogin: number | null;
  /** Mora promijeniti lozinku pri sljedećoj prijavi (uvezeno iz ADMIN_USERS ili resetovano). */
  mustChange: boolean;
};

export const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{2,31}$/;
export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 128;

export function normalizeUsername(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim().toLowerCase() : '';
}

export function validateUsername(name: string): string | null {
  if (!USERNAME_RE.test(name)) return 'Korisničko ime: 3–32 znaka, mala slova, brojevi, tačka, crtica ili donja crta';
  return null;
}

export function validatePassword(password: unknown, username: string): string | null {
  if (typeof password !== 'string') return 'Lozinka nedostaje';
  if (password.length < PASSWORD_MIN) return `Lozinka mora imati najmanje ${PASSWORD_MIN} znakova`;
  if (password.length > PASSWORD_MAX) return `Lozinka može imati najviše ${PASSWORD_MAX} znakova`;
  if (/^(.)\1+$/.test(password)) return 'Lozinka ne smije biti jedan isti znak';
  const lower = password.toLowerCase();
  if (username && (lower === username || lower.includes(username))) return 'Lozinka ne smije sadržavati korisničko ime';
  return null;
}

export type ChangePlan = { ok: true } | { ok: false; error: string };

/**
 * Da li smije da se primijeni izmjena uloge/aktivnosti: ne smiješ deaktivirati ni
 * degradirati sebe, a mora ostati bar jedan aktivan admin.
 */
export function planUserChange(
  users: PublicUser[],
  actor: string,
  target: string,
  patch: { role?: Role; active?: boolean },
): ChangePlan {
  const t = users.find((u) => u.username === target);
  if (!t) return { ok: false, error: 'Korisnik ne postoji' };
  const nextRole = patch.role ?? t.role;
  const nextActive = patch.active ?? t.active;
  if (target === actor && (nextActive === false || nextRole !== 'admin')) {
    return { ok: false, error: 'Ne možeš deaktivirati niti degradirati sebe' };
  }
  const admins = users.filter((u) => (u.username === target ? nextRole === 'admin' && nextActive : u.role === 'admin' && u.active));
  if (admins.length === 0) return { ok: false, error: 'Mora ostati bar jedan aktivan admin' };
  return { ok: true };
}
