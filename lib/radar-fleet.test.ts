import { describe, it, expect } from 'vitest';
import { operatorOf } from './radar-fleet';

describe('operatorOf', () => {
  it('Air Montenegro po hex-u (mala slova)', () => expect(operatorOf('51603f', '', '')?.icao).toBe('MNE'));
  it('Air Montenegro po registraciji', () => expect(operatorOf('', '4O-AOI', '')?.icao).toBe('MNE'));
  it('Air Serbia po registraciji (E195, ATR, A320, A319)', () => {
    for (const r of ['YU-ATB', 'YU-ALZ', 'YU-APH', 'yu-apm']) expect(operatorOf('', r, '')?.icao).toBe('ASL');
  });
  it('Air Serbia po callsign-u kad registracije nema', () => expect(operatorOf('', '', 'ASL80X')?.icao).toBe('ASL'));
  it('drugi avion → null', () => expect(operatorOf('abc123', 'G-GDFS', 'EXS1234')).toBeNull());
  it('prazno → null', () => expect(operatorOf('', '', '')).toBeNull());
});
