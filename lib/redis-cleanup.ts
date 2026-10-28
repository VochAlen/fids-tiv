// lib/redis-cleanup.ts
import { getRedisClient } from '@/lib/redis';

const TTL_RULES: Record<string, number> = {
  'cache:flights': 180,
  'override:':     21_600,
  'gate-status:':  21_600,
  'desk-status:':  21_600,
  'desk-class:':   21_600,
};

// Ključevi koji MORAJU ostati trajni (bez TTL-a) — cleanup im nikad ne smije dodijeliti rok:
//  • 'ably-fids:seq:' — INCR brojači (desk/gate). Kad im istekne TTL (ranije fallback 3600 s), brojač se vrati na 1,
//    pa kiosci koji imaju viši lokalni seq (npr. 46) odbijaju nove dodjele sa nižim seq (npr. 4) → "idle, a treba let".
//  • 'fids:kiosks' — hash sa prijavama monitora (health stranica); istek je brisao SVE monitore jednom na sat.
//  • 'ably-fids:learn:v1' / ':ex:v1' / ':since:' — naučeni brojači, primjeri za model i datum početka učenja. Ranije su (kao hash-evi bez TTL-a)
//    dobijali fallback 3600 s, pa je sve naučeno nestajalo svaki sat i model je UVIJEK pisao "dan 1 od 7".
//    (Model-stanje 'ably-fids:learn:model:v1' ima vlastiti TTL od 30 dana i namjerno NIJE ovdje.)
export const PERSISTENT_KEY_PREFIXES = ['ably-fids:seq:', 'fids:kiosks', 'fids:events', 'ably-fids:learn:v1', 'ably-fids:learn:ex:v1', 'ably-fids:learn:since:'];   // 'fids:events' = zapisnik događaja (lista, ograničena sa LTRIM)
export const isPersistentKey = (key: string): boolean => PERSISTENT_KEY_PREFIXES.some(p => key.startsWith(p));

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
      const keysToPersist: string[] = [];   // trajni ključevi koji su (ranijim cleanup-om) dobili TTL → skini ga (PERSIST)
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
            if (result[0]) return;
            if (isPersistentKey(keys[i])) { if (typeof result[1] === 'number' && result[1] >= 0) keysToPersist.push(keys[i]); }
            else if (result[1] === -1) keysToFix.push(keys[i]);
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

      if (keysToPersist.length > 0) {
        const pp = client.pipeline();
        keysToPersist.forEach(key => pp.persist(key));
        await pp.exec();
        console.log(`🧹 Redis cleanup: TTL skinut sa ${keysToPersist.length} trajnih ključeva (${keysToPersist.join(', ')})`);
      }

      return { scanned, fixed: keysToFix.length, timedOut: false };
    })(),
    new Promise<RedisCleanupResult>(resolve =>
      setTimeout(() => resolve({ scanned: 0, fixed: 0, timedOut: true }), timeoutMs)
    ),
  ]);
}