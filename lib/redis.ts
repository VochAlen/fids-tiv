// lib/redis.ts
import Redis from 'ioredis';

// ─────────────────────────────────────────────────────────────
// Singleton instance — nikad se ne nullira na error,
// ioredis interno reconnektuje
// ─────────────────────────────────────────────────────────────
let redis: Redis | null = null;

// ── Circuit breaker ──────────────────────────────────────────
// v4 FIX: ranije se `circuitOpen = false` postavljalo UNCONDITIONALNO
// prije nego što bi komanda stvarno uspjela — što je poništavalo
// zaštitu. Sad: circuit se otvara na error, zatvara SAMO kad
// komanda uspije (ili na ioredis 'ready' event).
//
// Takođe: eksponencijalni backoff na cooldown (15s → 30s → 60s → 120s)
// ako Redis pada više puta zaredom.
let circuitOpen = false;
let circuitOpenedAt = 0;
let circuitFailureCount = 0;
const CIRCUIT_BASE_COOLDOWN_MS = 15_000;
const CIRCUIT_MAX_COOLDOWN_MS = 120_000;

function getCircuitCooldown(): number {
  // Eksponencijalni backoff: 15s, 30s, 60s, 120s, 120s, ...
  const cooldown = CIRCUIT_BASE_COOLDOWN_MS * Math.pow(2, circuitFailureCount - 1);
  return Math.min(cooldown, CIRCUIT_MAX_COOLDOWN_MS);
}

function openCircuit(): void {
  circuitOpen = true;
  circuitOpenedAt = Date.now();
  circuitFailureCount++;
}

function closeCircuit(): void {
  if (circuitOpen) {
    console.log(`[Redis] Circuit breaker CLOSED after ${circuitFailureCount} failure(s)`);
  }
  circuitOpen = false;
  circuitFailureCount = 0;
}

// Provjeri da li je circuit otvoren i da li je cooldown prošao.
// Vraća true ako je otvoren (treba skip-ovati komandu).
function isCircuitBlocked(): boolean {
  if (!circuitOpen) return false;
  const elapsed = Date.now() - circuitOpenedAt;
  const cooldown = getCircuitCooldown();
  if (elapsed < cooldown) {
    return true; // još uvijek blokiran
  }
  // Cooldown je prošao — ali NE zatvaraj circuit ovdje!
  // Zatvoriće se tek kad komanda uspije (u try bloku safeRedis*).
  // Ostavljamo circuitOpen = true da signalizira "probni pokušaj".
  return false;
}

// FIX (KRITIČNO — pravi uzrok prijavljene greške u produkciji:
// "WRONGTYPE Operation against a key holding the wrong kind of value"
// na test:desk-status:all i test:gate-status:all, koje je zatim
// okinulo GLOBALNI circuit breaker i blokiralo SVE ostale, potpuno
// nepovezane Redis pozive na 15-120s — vidljivo u logu kao širi
// timeout/sporost na ably-token, /api/flights/snapshot, itd.):
// WRONGTYPE je problem sa PODATKOM na JEDNOM konkretnom ključu (neko
// je ranije upisao pogrešan tip — npr. HASH umjesto string), NE
// problem sa dostupnošću same Redis konekcije. Tretiranje ovoga
// identično kao "Redis je nedostupan" (openCircuit) je bilo pogrešno
// preširoko — blokiralo je čitanje/pisanje na SVIM DRUGIM, ispravnim
// ključevima dok cooldown ne prođe, iako je Redis servis sam po sebi
// bio potpuno zdrav.
function isWrongTypeError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes('WRONGTYPE');
}

export function getRedisClient(): Redis {
  if (!redis) {
    const redisUrl = process.env.FIDS_REDIS_URL;
    if (!redisUrl) {
      throw new Error('FIDS_REDIS_URL environment variable is not defined');
    }

    redis = new Redis(redisUrl, {
      // ── Timeouts ──────────────────────────────────────────
      connectTimeout: 4_000,      // Maks 4s za uspostavljanje konekcije
      commandTimeout: 3_000,      // Maks 3s čekanja na odgovor komande

      // ── Retry logika ──────────────────────────────────────
      maxRetriesPerRequest: 1,    // Samo 1 retry (ne 2) — smanjuje ukupno čekanje
      enableReadyCheck: true,
      lazyConnect: true,

      retryStrategy(times) {
        if (times > 5) return null;
        return Math.min(times * 500, 8_000);
      },
    });

    redis.on('error', (err: Error) => {
      console.error(`[Redis] Error: ${err.message}`);
      // Otvori circuit breaker — sljedeće komande odmah vraćaju null
      openCircuit();
    });

    redis.on('connect', () => {
      console.log('[Redis] Connected');
      // NE zatvaraj circuit ovdje — tek na 'ready' (kada komande mogu proći)
    });

    redis.on('ready', () => {
      console.log('[Redis] Ready');
      // 'ready' = konekcija je uspostavljena i spremna za komande
      // Tu tek zatvaramo circuit (ioredis je spreman da prima komande)
      closeCircuit();
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
  if (isCircuitBlocked()) {
    return null;
  }

  try {
    const client = getRedisClient();
    const result = await client.get(key);
    // Komanda uspjela — zatvori circuit ako je bio otvoren
    if (circuitOpen) closeCircuit();
    return result;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[Redis] safeRedisGet("${key}") failed: ${msg}`);

    if (isWrongTypeError(err)) {
      // NE otvaraj circuit — Redis konekcija je zdrava, samo je OVAJ
      // ključ pogrešnog tipa. Obriši ga (fire-and-forget — ne
      // blokiramo trenutni poziv čekajući to) da se sledeći SET na
      // ovaj ključ (npr. prva sledeća dodjela šaltera/gate-a) sigurno
      // uspije i trajno ispravi tip. Ako Redis konekcija zaista IMA
      // problem, ovaj DEL će i sam pasti — to je u redu, sledeći
      // pokušaj čitanja će opet vidjeti WRONGTYPE i ponovo probati.
      getRedisClient().del(key).catch(() => {});
      console.warn(`[Redis] "${key}" je bio pogrešnog tipa — obrisan radi samo-ispravke, circuit breaker NIJE okinut`);
      return null;
    }

    openCircuit();
    return null;
  }
}

// ─────────────────────────────────────────────────────────────
// safeRedisHGetAll — za hash komande (override:* ključevi)
// ─────────────────────────────────────────────────────────────
export async function safeRedisHGetAll(key: string): Promise<Record<string, string> | null> {
  if (isCircuitBlocked()) {
    return null;
  }

  try {
    const client = getRedisClient();
    const result = await client.hgetall(key);
    // ioredis vraća {} kad ključ ne postoji — normalizuj u null
    if (circuitOpen) closeCircuit();
    return Object.keys(result).length > 0 ? result : null;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[Redis] safeRedisHGetAll("${key}") failed: ${msg}`);

    // FIX (isti princip kao safeRedisGet iznad — vidi opširan
    // komentar tamo): WRONGTYPE je problem sa podatkom na OVOM
    // ključu, ne sa Redis konekcijom.
    if (isWrongTypeError(err)) {
      getRedisClient().del(key).catch(() => {});
      console.warn(`[Redis] "${key}" je bio pogrešnog tipa — obrisan radi samo-ispravke, circuit breaker NIJE okinut`);
      return null;
    }

    openCircuit();
    return null;
  }
}

export async function safeRedisSet(key: string, value: string, ttlSeconds?: number): Promise<boolean> {
  if (isCircuitBlocked()) {
    return false;
  }

  try {
    const client = getRedisClient();
    if (ttlSeconds) {
      await client.setex(key, ttlSeconds, value);
    } else {
      await client.set(key, value);
    }
    if (circuitOpen) closeCircuit();
    return true;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[Redis] safeRedisSet("${key}") failed: ${msg}`);
    openCircuit();
    return false;
  }
}

export async function safeRedisDel(key: string): Promise<boolean> {
  if (isCircuitBlocked()) {
    return false;
  }

  try {
    const client = getRedisClient();
    await client.del(key);
    if (circuitOpen) closeCircuit();
    return true;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[Redis] safeRedisDel("${key}") failed: ${msg}`);
    openCircuit();
    return false;
  }
}

// ── Export za testove/admin ──────────────────────────────────
export function isCircuitOpen(): boolean {
  return circuitOpen;
}

export function getCircuitFailureCount(): number {
  return circuitFailureCount;
}
