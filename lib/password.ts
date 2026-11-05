// lib/password.ts
//
// Hash lozinki za korisnike admin panela (lib/users.ts). Samo Node `crypto`
// (scrypt) — nema novih paketa i nema troška. Čista lozinka se nigdje ne čuva
// ni ne loguje; u Redis ide samo zapis oblika
//   scrypt$<N>$<r>$<p>$<sol base64>$<hash base64>
// pa se parametri kasnije mogu pojačati bez prekida postojećih prijava.
//
// Ovo se koristi SAMO u Node rutama (login/users/account) — ne u middleware-u (Edge).

import { randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from 'crypto';

const N = 16384;      // ~16 MB, desetak–nekoliko desetina ms po provjeri
const R = 8;
const P = 1;
const KEYLEN = 64;
const SALT_BYTES = 16;

function scrypt(password: string, salt: Buffer, keylen: number, opts: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCb(password, salt, keylen, opts, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const key = await scrypt(password.normalize('NFKC'), salt, KEYLEN, { N, r: R, p: P, maxmem: 64 * 1024 * 1024 });
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${key.toString('base64')}`;
}

/** Konstantno-vremenska provjera; nevažeći/oštećen zapis → false (nikad izuzetak). */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  try {
    const parts = stored.split('$');
    if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
    const n = Number(parts[1]); const r = Number(parts[2]); const p = Number(parts[3]);
    if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p) || n < 1024 || n > 1 << 20) return false;
    const salt = Buffer.from(parts[4], 'base64');
    const expected = Buffer.from(parts[5], 'base64');
    if (salt.length < 8 || expected.length < 16) return false;
    const key = await scrypt(password.normalize('NFKC'), salt, expected.length, { N: n, r, p, maxmem: 128 * 1024 * 1024 });
    return key.length === expected.length && timingSafeEqual(key, expected);
  } catch {
    return false;
  }
}

// Zapis koji nijedna lozinka ne može da pogodi — služi da prijava nepoznatog
// korisnika troši isto vrijeme kao prijava poznatog (nema "user enumeration" po vremenu).
let dummy: Promise<string> | null = null;
export function dummyHash(): Promise<string> {
  if (!dummy) dummy = hashPassword(randomBytes(12).toString('hex'));
  return dummy;
}
