// lib/access-log-server.ts — Redis I/O za istoriju pristupa (vidi lib/access-log.ts).
// Upis: jedna pipeline (LPUSH + LTRIM + EXPIRE), poziva se iz after() poslije odgovora; greška se guta (ne smije srušiti prijavu).
import { getRedisClient } from '@/lib/redis';
import { ACCESS_LOG_KEY, ACCESS_LOG_MAX, ACCESS_LOG_TTL_SEC, parseAccessEvents, type AccessEvent } from '@/lib/access-log';

export async function logAccessEvent(ev: AccessEvent): Promise<void> {
  try {
    const p = getRedisClient().pipeline();
    p.lpush(ACCESS_LOG_KEY, JSON.stringify(ev));
    p.ltrim(ACCESS_LOG_KEY, 0, ACCESS_LOG_MAX - 1);
    p.expire(ACCESS_LOG_KEY, ACCESS_LOG_TTL_SEC);
    await p.exec();
  } catch (err) {
    console.error('[access-log] upis nije uspio:', err instanceof Error ? err.message : err);
  }
}

export async function readAccessEvents(limit = ACCESS_LOG_MAX): Promise<AccessEvent[]> {
  try {
    return parseAccessEvents(await getRedisClient().lrange(ACCESS_LOG_KEY, 0, Math.max(0, limit - 1)));
  } catch (err) {
    console.error('[access-log] čitanje nije uspjelo:', err instanceof Error ? err.message : err);
    return [];
  }
}
