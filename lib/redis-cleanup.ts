// lib/redis-cleanup.ts
import { getRedisClient } from '@/lib/redis';

const TTL_RULES: Record<string, number> = {
  'cache:flights': 180,
  'override:':     21_600,
  'gate-status:':  21_600,
  'desk-status:':  21_600,
  'desk-class:':   21_600,
};

export interface RedisCleanupResult {
  scanned: number;
  fixed: number;
  timedOut: boolean;
}

/**
 * Skenira Redis ključeve bez TTL-a (perzistentne) i dodjeljuje im
 * ispravan TTL na osnovu prefiksa (TTL_RULES), ili fallback 3600s.
 * Ima interni timeout da ne visi predugo (default 5s — cron poziva sa duzim).
 */
export async function cleanupRedisTTLs(timeoutMs = 5_000): Promise<RedisCleanupResult> {
  return Promise.race([
    (async (): Promise<RedisCleanupResult> => {
      const client = getRedisClient();
      const keysToFix: string[] = [];
      let cursor = '0';
      let scanned = 0;

      do {
        const [nextCursor, keys] = await client.scan(cursor, 'COUNT', 100);
        cursor = nextCursor;
        scanned += keys.length;

        if (keys.length > 0) {
          const pipeline = client.pipeline();
          keys.forEach(key => pipeline.ttl(key));
          const results = await pipeline.exec();
          results?.forEach((result, i) => {
            if (!result[0] && result[1] === -1) keysToFix.push(keys[i]);
          });
        }

        if (keysToFix.length > 200) break;
      } while (cursor !== '0');

      if (keysToFix.length > 0) {
        const fixPipeline = client.pipeline();
        keysToFix.forEach(key => {
          const rule = Object.entries(TTL_RULES).find(([p]) => key.startsWith(p));
          fixPipeline.expire(key, rule ? rule[1] : 3_600);
        });
        await fixPipeline.exec();
        console.log(`🧹 Redis cleanup: ${keysToFix.length} keys fixed`);
      }

      return { scanned, fixed: keysToFix.length, timedOut: false };
    })(),
    new Promise<RedisCleanupResult>(resolve =>
      setTimeout(() => resolve({ scanned: 0, fixed: 0, timedOut: true }), timeoutMs)
    ),
  ]);
}