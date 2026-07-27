// lib/redis.ts
import Redis from 'ioredis';

// ─────────────────────────────────────────────────────────────
// Singleton instance — nikad se ne nullira na error,
// ioredis interno reconnektuje
// ─────────────────────────────────────────────────────────────
let redis: Redis | null = null;

// Circuit breaker — ako Redis pada, ne šaljemo nove komande
// dok se ne stabilizuje
let circuitOpen = false;
let circuitOpenedAt = 0;
const CIRCUIT_COOLDOWN_MS = 10_000; // 10s pauza nakon pada

export function getRedisClient(): Redis {
  if (!redis) {
    const redisUrl = process.env.FIDS_REDIS_URL;
    if (!redisUrl) {
      throw new Error('FIDS_REDIS_URL environment variable is not defined');
    }

    redis = new Redis(redisUrl, {
      // ── Timeouts ──────────────────────────────────────────
      connectTimeout: 4_000,      // Maks 4s za uspostavljanje konekcije
      commandTimeout: 3_000,      // Maks 3s čekanja na odgovor komande — ovo je bio problem!

      // ── Retry logika ──────────────────────────────────────
      maxRetriesPerRequest: 1,    // Samo 1 retry (ne 2) — smanjuje ukupno čekanje
      enableReadyCheck: true,
      lazyConnect: true,

      retryStrategy(times) {
        // Eksponencijalni backoff, maks 8s između pokušaja
        // Vraća null nakon 5 pokušaja — ioredis tada emituje error i staje
        if (times > 5) return null;
        return Math.min(times * 500, 8_000);
      },
    });
redis.on('error', (err: Error) => {
  console.error(`[Redis] Error: ${err.message} — circuit breaker OPEN for ${CIRCUIT_COOLDOWN_MS}ms`);
  circuitOpen = true;
  circuitOpenedAt = Date.now();
});

    redis.on('connect', () => {
      console.log('[Redis] Connected');
      // Zatvori circuit breaker čim se konekcija uspostavi
      circuitOpen = false;
    });

    redis.on('ready', () => {
      console.log('[Redis] Ready');
      circuitOpen = false;
    });

    redis.on('reconnecting', (delay: number) => {
      console.log(`[Redis] Reconnecting in ${delay}ms...`);
    });
  }

  return redis;
}

// ─────────────────────────────────────────────────────────────
// safeRedisGet — koristi se u svim GET API rutama umjesto
// direktnog client.get(). Vraća null na svaki problem.
// ─────────────────────────────────────────────────────────────
export async function safeRedisGet(key: string): Promise<string | null> {
  // Provjeri circuit breaker
  if (circuitOpen) {
    const elapsed = Date.now() - circuitOpenedAt;
    if (elapsed < CIRCUIT_COOLDOWN_MS) {
      // Circuit je otvoren i cooldown nije prošao — odmah vrati null
      return null;
    }
    // Cooldown je prošao — pokušaj ponovo (circuit se zatvara na 'ready')
    circuitOpen = false;
  }

  try {
    const client = getRedisClient();
    return await client.get(key);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[Redis] safeRedisGet("${key}") failed: ${msg}`);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────
// safeRedisHGetAll — za hash komande (override:* ključevi)
// ─────────────────────────────────────────────────────────────
export async function safeRedisHGetAll(key: string): Promise<Record<string, string> | null> {
  if (circuitOpen && Date.now() - circuitOpenedAt < CIRCUIT_COOLDOWN_MS) {
    return null;
  }
  circuitOpen = false;

  try {
    const client = getRedisClient();
    const result = await client.hgetall(key);
    // ioredis vraća {} kad ključ ne postoji — normalizuj u null
    return Object.keys(result).length > 0 ? result : null;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[Redis] safeRedisHGetAll("${key}") failed: ${msg}`);
    return null;
  }
}

// lib/redis.ts – dodati nakon safeRedisHGetAll

export async function safeRedisSet(key: string, value: string, ttlSeconds?: number): Promise<boolean> {
  if (circuitOpen && Date.now() - circuitOpenedAt < CIRCUIT_COOLDOWN_MS) {
    return false;
  }
  circuitOpen = false;

  try {
    const client = getRedisClient();
    if (ttlSeconds) {
      await client.setex(key, ttlSeconds, value);
    } else {
      await client.set(key, value);
    }
    return true;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[Redis] safeRedisSet("${key}") failed: ${msg}`);
    return false;
  }
}

export async function safeRedisDel(key: string): Promise<boolean> {
  if (circuitOpen && Date.now() - circuitOpenedAt < CIRCUIT_COOLDOWN_MS) {
    return false;
  }
  circuitOpen = false;

  try {
    const client = getRedisClient();
    await client.del(key);
    return true;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[Redis] safeRedisDel("${key}") failed: ${msg}`);
    return false;
  }
}