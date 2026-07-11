// lib/night-hours.ts
// Aerodrom nema letove između 21:00 i 04:00 — u tom periodu
// preskačemo polling u potpunosti, bez ikakvog HTTP zahtjeva.
export function isNightHours(): boolean {
  const h = new Date().getHours();
  return h >= 21 || h < 4;
}