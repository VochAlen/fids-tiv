import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword } from '@/lib/password';

describe('password (scrypt)', () => {
  it('ispravna lozinka prolazi, pogrešna ne', async () => {
    const h = await hashPassword('Tivat-2026-ok!');
    expect(h.startsWith('scrypt$')).toBe(true);
    expect(await verifyPassword('Tivat-2026-ok!', h)).toBe(true);
    expect(await verifyPassword('Tivat-2026-ok', h)).toBe(false);
  });
  it('isti unos daje različit hash (so)', async () => {
    expect(await hashPassword('abcdefghij')).not.toBe(await hashPassword('abcdefghij'));
  });
  it('oštećen zapis → false, bez izuzetka', async () => {
    expect(await verifyPassword('x', 'nije-hash')).toBe(false);
    expect(await verifyPassword('x', 'scrypt$1$1$1$AA$AA')).toBe(false);
    expect(await verifyPassword('x', '')).toBe(false);
  });
  it('hash ne sadrži čistu lozinku', async () => {
    expect(await hashPassword('SuperTajna123')).not.toContain('SuperTajna123');
  });
});
