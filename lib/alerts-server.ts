// lib/alerts-server.ts
//
// Provjera problema i slanje obavještenja. Poziva se iz POSTOJEĆEG cron-a (flight-sync, svaka 3 min) — nema novih poziva funkcija.
// Trošak u Redisu: 2 čitanja po provjeri (HGETALL monitora + stanje obavještenja); upis samo kad se nešto promijeni
// (ili najviše svakih STATE_REFRESH_MS). Noću (cron preskače noćni režim) ne radi ništa.
import { getRedisClient } from '@/lib/redis';
import { loadKiosks } from '@/lib/kiosk-status-server';
import { getPodgoricaMinutesOfDay } from '@/lib/night-hours';
import { sendTelegram, getTelegramConfig } from '@/lib/telegram';
import { pushKioskEvents } from '@/lib/kiosk-events-server';
import { decideAlerts, formatAlertMessage, markSendFailed, type AlertState, type Problem } from '@/lib/alerts';

const STATE_KEY = 'fids:alerts:state';
const STATE_TTL_SEC = 2 * 24 * 3600;   // eksplicitan TTL (cleanup dira samo ključeve bez TTL-a)
const STATE_REFRESH_MS = 30 * 60_000;  // ako se ništa ne mijenja, osvježi "zadnju provjeru" najviše svakih 30 min
export const FLIGHTS_ALERT_MIN = 20;   // podaci o letovima stariji od ovoga (ili offline režim) = problem

export interface FlightMeta { isOfflineMode?: boolean; lastUpdated?: string | null }

export function buildProblems(
  kiosks: ReadonlyArray<{ id: string; status: string; ageSec: number; dataAgeMin: number | null }>,
  flight: FlightMeta,
  now: number,
): Problem[] {
  const out: Problem[] = [];
  for (const k of kiosks) {
    if (k.status === 'silent') out.push({ key: `silent:${k.id}`, kind: 'silent', id: k.id, since: now - k.ageSec * 1000 });
    else if (k.status === 'stale') out.push({ key: `stale:${k.id}`, kind: 'stale', id: k.id, detail: k.dataAgeMin !== null ? `podaci stari ${k.dataAgeMin} min` : undefined });
  }
  const t = flight.lastUpdated ? Date.parse(flight.lastUpdated) : NaN;
  const ageMin = Number.isFinite(t) ? Math.max(0, Math.round((now - t) / 60_000)) : null;
  if (flight.isOfflineMode || (ageMin !== null && ageMin >= FLIGHTS_ALERT_MIN)) {
    out.push({
      key: 'flights:flights', kind: 'flights', id: 'flights',
      since: ageMin !== null ? now - ageMin * 60_000 : undefined,
      detail: flight.isOfflineMode ? 'izvor nedostupan (offline režim)' : undefined,
    });
  }
  return out;
}

const parseState = (raw: string | null): AlertState | null => {
  if (!raw) return null;
  try {
    const s = JSON.parse(raw) as AlertState;
    return s && typeof s.at === 'number' && s.items && typeof s.items === 'object' ? s : null;
  } catch { return null; }
};

export async function runAlerts(flight: FlightMeta): Promise<{ problems: number; sent: boolean }> {
  const client = getRedisClient();
  const now = Date.now();
  const [rawState, kiosks] = await Promise.all([client.get(STATE_KEY), loadKiosks([])]);
  const prev = parseState(rawState);
  const problems = buildProblems(kiosks, flight, now);

  const { messages, events, next: decided } = decideAlerts(prev, problems, now);
  let next = decided;
  let sent = false;

  if (events.length) await pushKioskEvents(events);

  if (messages.length && getTelegramConfig()) {
    const mins = getPodgoricaMinutesOfDay();
    const label = `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
    sent = await sendTelegram(formatAlertMessage(messages, label));
    if (!sent) next = markSendFailed(next, messages);   // pokušaj ponovo pri sljedećoj provjeri
  }

  const prevItems = prev && now - prev.at <= 90 * 60_000 ? JSON.stringify(prev.items) : '{}';
  const changed = JSON.stringify(next.items) !== prevItems;
  if (changed || !prev || now - prev.at >= STATE_REFRESH_MS) {
    await client.set(STATE_KEY, JSON.stringify(next), 'EX', STATE_TTL_SEC);
  }
  return { problems: problems.length, sent };
}
