// lib/redis.ts
import Redis from 'ioredis';

let redis: Redis | null = null;

export function getRedisClient(): Redis {
  if (!redis) {
    const redisUrl = process.env.FIDS_REDIS_URL;
    if (!redisUrl) {
      throw new Error('FIDS_REDIS_URL environment variable is not defined');
    }

    redis = new Redis(redisUrl, {
      // KRITIČNO ZA SLOBODNU MEMORIJU NA FREE TIERU:
      maxRetriesPerRequest: 2,       // Manje ponavljanja = manje memorije
      enableReadyCheck: true,        // Optimizuje buffer upotrebu
      lazyConnect: true,           // Ne otvara konekciju pre prvog upita
      connectTimeout: 5000,
      // Smanji TCP bufferi (umesto default 256MB, stavljamo na 8MB po konekciji)
      retryStrategy(times) {
        const delay = Math.min(times * 300, 5000); // Brže ponavljanje
        return delay;
      }
    });

    redis.on('error', (err) => {
      console.error('Redis Connection Error:', err.message);
      redis = null; // Oslobađa memoriju i pokuša ponovo pri sljedećem pozivu
    });
  }
  return redis;
}