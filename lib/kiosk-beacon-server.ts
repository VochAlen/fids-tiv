// lib/kiosk-beacon-server.ts
//
// Server strana beacon-a: upis zadnjeg izvještaja kioska u Redis hash. Poziva se iz next/server `after()`, tj. POSLIJE
// slanja odgovora — nikad ne usporava ni ne kvari /api/test/assignments. Jedna HSET komanda po izvještaju.
import { getRedisClient, isCircuitOpen } from '@/lib/redis';
import { KIOSK_HASH_KEY, parseBeacon, type StoredKiosk } from '@/lib/kiosk-beacon';

export async function recordKioskBeacon(sp: URLSearchParams): Promise<void> {
  try {
    const r = parseBeacon(sp);
    if (!r || isCircuitOpen()) return;
    const stored: StoredKiosk = { ...r, seen: Date.now() };
    await getRedisClient().hset(KIOSK_HASH_KEY, r.id, JSON.stringify(stored));
  } catch {
    // best-effort: beacon nikad ne smije praviti probleme
  }
}
