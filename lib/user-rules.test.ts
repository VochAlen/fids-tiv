import { describe, it, expect } from 'vitest';
import { planUserChange, validatePassword, validateUsername, normalizeUsername, type PublicUser } from '@/lib/user-rules';
import { pageAllowedForRole, roleAtLeast } from '@/lib/roles';

const u = (username: string, role: 'admin' | 'operator', active = true): PublicUser =>
  ({ username, role, active, created: 0, lastLogin: null, mustChange: false });

describe('korisnička imena i lozinke', () => {
  it('normalizuje i validira ime', () => {
    expect(normalizeUsername('  Alen ')).toBe('alen');
    expect(validateUsername('alen')).toBeNull();
    expect(validateUsername('al')).not.toBeNull();
    expect(validateUsername('A b')).not.toBeNull();
  });
  it('lozinka: dužina, ime, isti znak', () => {
    expect(validatePassword('kratka', 'alen')).not.toBeNull();
    expect(validatePassword('alen-tivat-2026', 'alen')).not.toBeNull();
    expect(validatePassword('aaaaaaaaaaaa', 'alen')).not.toBeNull();
    expect(validatePassword('tivat-sigurno-357', 'alen')).toBeNull();
    expect(validatePassword(undefined, 'alen')).not.toBeNull();
  });
});

describe('planUserChange', () => {
  const list = [u('admin', 'admin'), u('alen', 'admin'), u('goran', 'operator')];
  it('ne smiješ deaktivirati ni degradirati sebe', () => {
    expect(planUserChange(list, 'admin', 'admin', { active: false }).ok).toBe(false);
    expect(planUserChange(list, 'admin', 'admin', { role: 'operator' }).ok).toBe(false);
  });
  it('drugog admina smiješ degradirati dok ostane jedan aktivan admin', () => {
    expect(planUserChange(list, 'admin', 'alen', { role: 'operator' }).ok).toBe(true);
  });
  it('ne može ostati bez aktivnog admina', () => {
    const only = [u('admin', 'admin'), u('alen', 'admin', false), u('goran', 'operator')];
    expect(planUserChange(only, 'goran', 'admin', { active: false }).ok).toBe(false);
    expect(planUserChange(only, 'goran', 'admin', { role: 'operator' }).ok).toBe(false);
  });
  it('nepostojeći korisnik', () => {
    expect(planUserChange(list, 'admin', 'nema', { active: false }).ok).toBe(false);
  });
  it('operatora smiješ deaktivirati', () => {
    expect(planUserChange(list, 'admin', 'goran', { active: false }).ok).toBe(true);
  });
});

describe('uloge i stranice', () => {
  it('admin ≥ operator, operator < admin', () => {
    expect(roleAtLeast('admin', 'admin')).toBe(true);
    expect(roleAtLeast('operator', 'operator')).toBe(true);
    expect(roleAtLeast('operator', 'admin')).toBe(false);
  });
  it('operator vidi samo dnevni rad', () => {
    for (const ok of ['/admin', '/admin/', '/admin/assign-checkin', '/admin/radar', '/admin/account']) {
      expect(pageAllowedForRole('operator', ok), ok).toBe(true);
    }
    for (const no of ['/admin/users', '/admin/pa', '/admin/health', '/admin/history', '/admin/access-log', '/admin/overview', '/admin/radarx', '/admin/assign-checkinx']) {
      expect(pageAllowedForRole('operator', no), no).toBe(false);
    }
    expect(pageAllowedForRole('admin', '/admin/users')).toBe(true);
  });
});
