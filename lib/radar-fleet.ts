// lib/radar-fleet.ts
//
// Prepoznavanje flote Air Montenegro i Air Serbia na radaru (ICAO hex i/ili registracija; callsign kao rezerva).
// Logo se uzima iz postojećeg /airlines/<ICAO>.jpg (isti fajlovi kao na FIDS-u).
export interface Operator { icao: 'MNE' | 'ASL'; name: string }

const norm = (s: string | null | undefined) => (s ?? '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();

const MNE_HEX = new Set(['516091', '516097', '51603F', '516042']);
const MNE_REG = new Set(['4OAOA', '4OAOB', '4OAOE', '4OAOI']);

const ASL_REG = new Set([
  // Embraer 195LR
  'YUATA', 'YUATB', 'YUATC', 'YUATD',
  // ATR 72-600
  'YUALZ', 'YUASA', 'YUASB', 'YUASD', 'YUASF', 'YUALY', 'YUASC', 'YUASE', 'YUALX', 'YUALW',
  // Airbus A320
  'YUAPH', 'YUAPU', 'YUAPV', 'YUAPS', 'YUAPT', 'YUAPO',
  // Airbus A319
  'YUAPA', 'YUAPC', 'YUAPE', 'YUAPF', 'YUAPN', 'YUAPL', 'YUAPM',
]);

export function operatorOf(hex: string | null | undefined, reg: string | null | undefined, callsign?: string | null): Operator | null {
  const h = norm(hex);
  const r = norm(reg);
  if ((h && MNE_HEX.has(h)) || (r && MNE_REG.has(r))) return { icao: 'MNE', name: 'Air Montenegro' };
  if (r && ASL_REG.has(r)) return { icao: 'ASL', name: 'Air Serbia' };
  const cs = norm(callsign);
  if (cs.startsWith('ASL') && cs.length > 3) return { icao: 'ASL', name: 'Air Serbia' };
  if (cs.startsWith('MNE') && cs.length > 3) return { icao: 'MNE', name: 'Air Montenegro' };
  return null;
}
