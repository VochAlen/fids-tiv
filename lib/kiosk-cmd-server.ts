// lib/kiosk-cmd-server.ts
//
// Rezervni (HTTP) put daljinske komande: pisanje pri kliku na dugme (admin) i čitanje u /api/test/assignments.
// Čitanje je keširano u memoriji instance 30 s — u normalnom radu (nema aktivnih komandi) to je najviše jedna HGETALL
// komanda na 30 s po toploj instanci, a odgovor ostaje IDENTIČAN (polje `cmds` se dodaje samo kad komanda postoji).
import { getRedisClient, isCircuitOpen } from '@/lib/redis';
import { KIOSK_CMD_HASH_KEY, KIOSK_CMD_TTL_SEC } from '@/lib/kiosk-beacon';

export type KioskCmdMap = Record<string, { ts: number; nonce: string }>;

let cache: { at: number; map: KioskCmdMap } = { at: 0, map: {} };
const CACHE_MS = 30_000;

export async function writeKioskCmd(id: string, ts: number, nonce: string): Promise<boolean> {
  try {
    if (isCircuitOpen()) return false;
    const r = getRedisClient();
    await r.hset(KIOSK_CMD_HASH_KEY, id, JSON.stringify({ ts, nonce }));
    await r.expire(KIOSK_CMD_HASH_KEY, KIOSK_CMD_TTL_SEC);
    cache = { at: 0, map: cache.map }; // sljedeće čitanje ide u Redis
    return true;
  } catch {
    return false;
  }
}

/** Aktivne komande (mlađe od TTL-a). Nikad ne baca — greška = prazna mapa. */
export async function readKioskCmds(now = Date.now()): Promise<KioskCmdMap> {
  if (now - cache.at < CACHE_MS) return cache.map;
  try {
    if (isCircuitOpen()) return cache.map;
    const raw = await getRedisClient().hgetall(KIOSK_CMD_HASH_KEY);
    const map: KioskCmdMap = {};
    for (const [id, v] of Object.entries(raw ?? {})) {
      try {
        const c = JSON.parse(v) as { ts?: number; nonce?: string };
        if (typeof c.ts === 'number' && typeof c.nonce === 'string' && now - c.ts < KIOSK_CMD_TTL_SEC * 1000) map[id] = { ts: c.ts, nonce: c.nonce };
      } catch { /* oštećen unos */ }
    }
    cache = { at: now, map };
    return map;
  } catch {
    return cache.map;
  }
}
