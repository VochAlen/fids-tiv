// lib/kiosk-events-server.ts — Redis I/O za zapisnik događaja (vidi lib/kiosk-events.ts).
import { getRedisClient } from '@/lib/redis';
import { EVENTS_KEY, EVENTS_MAX, parseEvents, type KioskEvent } from '@/lib/kiosk-events';

/** Dodaje događaje (hronološki redoslijed; najnoviji ostaje na vrhu) i drži zadnjih EVENTS_MAX. Greška se guta — zapisnik nikad ne smije srušiti pozivaoca. */
export async function pushKioskEvents(events: readonly KioskEvent[]): Promise<void> {
  if (events.length === 0) return;
  try {
    const r = getRedisClient();
    await r.lpush(EVENTS_KEY, ...events.map((e) => JSON.stringify(e)));
    await r.ltrim(EVENTS_KEY, 0, EVENTS_MAX - 1);
  } catch (err) {
    console.error('[kiosk-events] upis nije uspio:', err instanceof Error ? err.message : err);
  }
}

export async function readKioskEvents(limit = EVENTS_MAX): Promise<KioskEvent[]> {
  try {
    const raw = await getRedisClient().lrange(EVENTS_KEY, 0, Math.max(0, limit - 1));
    return parseEvents(raw);
  } catch (err) {
    console.error('[kiosk-events] čitanje nije uspjelo:', err instanceof Error ? err.message : err);
    return [];
  }
}
