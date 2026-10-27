// lib/assign-log-server.ts — Redis I/O za istoriju dodjela (vidi lib/assign-log.ts).
// Upis: jedna pipeline (RPUSH + EXPIRE) po promjeni, poziva se iz after() poslije odgovora — nikad ne usporava ni ne kvari
// ručnu dodjelu. Čitanje: jedan LRANGE po danu, samo kad admin otvori stranicu/preuzme izvještaj.
import { getRedisClient } from '@/lib/redis';
import { getPodgoricaDateString } from '@/lib/night-hours';
import { ASSIGN_LOG_DAYS, ASSIGN_LOG_TTL_SEC, assignLogKey, parseAssignEvents, type AssignEvent } from '@/lib/assign-log';

export async function logAssignmentEvents(events: readonly AssignEvent[]): Promise<void> {
  if (events.length === 0) return;
  try {
    const client = getRedisClient();
    const byDay = new Map<string, string[]>();
    for (const e of events) {
      const day = getPodgoricaDateString(new Date(e.t));
      (byDay.get(day) ?? byDay.set(day, []).get(day)!).push(JSON.stringify(e));
    }
    const p = client.pipeline();
    for (const [day, list] of byDay) {
      const key = assignLogKey(day);
      p.rpush(key, ...list);
      p.expire(key, ASSIGN_LOG_TTL_SEC);
    }
    await p.exec();
  } catch (err) {
    console.error('[assign-log] upis nije uspio:', err instanceof Error ? err.message : err);
  }
}

export async function readAssignDay(date: string): Promise<AssignEvent[]> {
  try {
    return parseAssignEvents(await getRedisClient().lrange(assignLogKey(date), 0, -1));
  } catch (err) {
    console.error('[assign-log] čitanje nije uspjelo:', err instanceof Error ? err.message : err);
    return [];
  }
}

/** Datumi (YYYY-MM-DD, najnoviji prvi) za koje se čuva istorija. */
export function recentLogDates(now: number = Date.now()): string[] {
  const out: string[] = [];
  for (let i = 0; i < ASSIGN_LOG_DAYS; i++) out.push(getPodgoricaDateString(new Date(now - i * 86_400_000)));
  return out;
}
