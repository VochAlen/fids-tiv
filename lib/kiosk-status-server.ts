// lib/kiosk-status-server.ts
//
// Zajedničko učitavanje i klasifikacija monitora (kiosaka) iz Redisa — koristi ga health ruta, pregled (overview) i
// obavještenja (cron). Jedno mjesto, isti rezultat svuda.
import { getRedisClient } from '@/lib/redis';
import { isNightHours } from '@/lib/night-hours';
import { BUILD_ID } from '@/lib/build-id';
import { KIOSK_HASH_KEY } from '@/lib/kiosk-beacon';
import { classifyKiosks, parseStoredKiosks, KIOSK_FORGET_AFTER_DAYS, type KioskInfo, type OpenTruth } from '@/lib/kiosk-health';

/** Minuta od kraja noćnog režima (null = noć je). Traži unazad u koracima od 5 min (max 12 h). */
export function minutesSinceDayStart(now: number): number | null {
  if (isNightHours(new Date(now))) return null;
  for (let m = 5; m <= 12 * 60; m += 5) {
    if (isNightHours(new Date(now - m * 60_000))) return m;
  }
  return 12 * 60;
}

/**
 * Učitava prijave monitora (1 Redis komanda: HGETALL) i klasifikuje ih. `open` = stvarno otvorene dodjele iz baze
 * (za otkrivanje razlike između baze i prikaza); prazno = bez provjere razlike (npr. obavještenja ne reaguju na nju).
 */
export async function loadKiosks(open: readonly OpenTruth[]): Promise<KioskInfo[]> {
  const client = getRedisClient();
  const hash = await client.hgetall(KIOSK_HASH_KEY);
  const stored = parseStoredKiosks(hash);
  const now = Date.now();
  // zaboravi monitore koji se nisu javili 14 dana (ugašeni/preimenovani) — da lista ne raste
  const old = stored.filter((k) => now - k.seen > KIOSK_FORGET_AFTER_DAYS * 86_400_000).map((k) => k.id);
  if (old.length) client.hdel(KIOSK_HASH_KEY, ...old).catch(() => {});
  return classifyKiosks(
    stored.filter((k) => !old.includes(k.id)),
    [...open],
    { now, night: isNightHours(), minutesSinceDayStart: minutesSinceDayStart(now), currentBuild: BUILD_ID },
  );
}
