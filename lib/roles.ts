// lib/roles.ts
//
// Uloge korisnika admin panela. ČISTE funkcije bez Node/Redis uvoza, pa se
// smiju koristiti i u middleware-u (Edge) i u klijentskim stranicama.
//
//  - admin    : sve, uključujući korisnike, podešavanja, razglas i kiosk komande
//  - operator : dnevni rad smjene — dodjela šaltera/gate-ova (assign-checkin) i radar
//
// Stare sesije (izdate prije uvođenja uloga) nemaju polje `role` i tretiraju se
// kao admin — do sada su svi korisnici bili admini, pa se ništa ne mijenja dok
// se ne odluči drugačije.

export type Role = 'admin' | 'operator';
export const ROLES: readonly Role[] = ['admin', 'operator'];

export function isRole(x: unknown): x is Role {
  return x === 'admin' || x === 'operator';
}

export function roleAtLeast(have: Role, need: Role): boolean {
  return need === 'operator' ? true : have === 'admin';
}

// Stranice dostupne ulozi "operator" (tačno podudaranje ili podstranica).
// Sve ostalo pod /admin traži ulogu "admin".
const OPERATOR_PAGES = ['/admin', '/admin/assign-checkin', '/admin/radar', '/admin/account'];

export function pageAllowedForRole(role: Role, path: string): boolean {
  if (role === 'admin') return true;
  const p = path.length > 1 ? path.replace(/\/+$/, '') : path;
  return OPERATOR_PAGES.some((allowed) => p === allowed || (allowed !== '/admin' && p.startsWith(`${allowed}/`)));
}
