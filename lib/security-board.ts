// lib/security-board.ts
//
// Čista logika (testirana) za monitor na security checkpointu: iz liste polazaka bira najbliža 4 leta i za svaki računa
// početak boardinga (30 min prije polaska) i nivo upozorenja (15 min i 10 min prije polaska = prioritet).
// Vrijeme polaska = procijenjeno (ETD) ako postoji, inače planirano (STD): kasneći let ne smije lažno alarmirati.
import type { Flight } from '@/types/flight';
import { airportTimeToMs } from '@/lib/night-hours';
import { parseFlightTimeToDate } from '@/lib/disruption-index';

export const BOARDING_LEAD_MIN = 30;
export const HURRY_MIN = 15;
export const URGENT_MIN = 10;
export const SECURITY_ROWS = 4;

export type SecurityLevel = 'scheduled' | 'boarding' | 'hurry' | 'urgent';

export interface SecurityRow {
  key: string;
  flightNumber: string;
  destination: string;
  std: string;
  /** Prikazuje se samo ako se razlikuje od STD. */
  etd: string | null;
  boarding: string;
  gate: string;
  minutesLeft: number;
  level: SecurityLevel;
  /** true = ≤15 min do polaska: ide u prioritet (ističe se). */
  priority: boolean;
}

const DEPARTED_RE = /(departed|poletio)/i;
const GONE_RE = /(cancelled|canceled|otkazan|diverted|preusmjeren)/i;
const HHMM_RE = /^(\d{1,2})[:.](\d{2})$/;

const timeFmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Podgorica', hour: '2-digit', minute: '2-digit', hour12: false });
export const formatAirportTime = (ms: number): string => timeFmt.format(new Date(ms));

/** "HH:MM" (vrijeme na aerodromu) ili ISO → ms; null ako se ne može pročitati. */
function toMs(s: string | null | undefined, now: number): number | null {
  const v = (s ?? '').trim();
  if (!v || v === '-' || v === '--:--') return null;
  const m = HHMM_RE.exec(v);
  if (m) {
    const h = Number(m[1]), mm = Number(m[2]);
    return h > 23 || mm > 59 ? null : airportTimeToMs(h, mm, now);
  }
  const d = parseFlightTimeToDate(v);
  return d ? d.getTime() : null;
}

export function levelFor(minutesLeft: number): SecurityLevel {
  if (minutesLeft <= URGENT_MIN) return 'urgent';
  if (minutesLeft <= HURRY_MIN) return 'hurry';
  if (minutesLeft <= BOARDING_LEAD_MIN) return 'boarding';
  return 'scheduled';
}

export function pickSecurityRows(
  departures: readonly Flight[],
  /** let -> gate iz dodjela (ima prednost nad gate-om iz izvora). */
  gatesByFlight: Readonly<Record<string, string>>,
  now: number,
  max: number = SECURITY_ROWS,
): SecurityRow[] {
  const seen = new Set<string>();
  const rows: Array<SecurityRow & { at: number }> = [];

  for (const f of departures) {
    const fn = (f.FlightNumber ?? '').trim();
    if (!fn || seen.has(fn)) continue;
    const status = f.StatusEN ?? '';
    if (DEPARTED_RE.test(status) || GONE_RE.test(status)) continue;

    const stdMs = toMs(f.ScheduledDepartureTime, now);
    const etdMs = toMs(f.EstimatedDepartureTime, now);
    const at = etdMs ?? stdMs;
    if (at === null) continue;
    const minutesLeft = Math.ceil((at - now) / 60_000);
    if (minutesLeft < -5) continue; // već je trebao otići (status još nije stigao) — ne prikazuj

    seen.add(fn);
    const std = stdMs !== null ? formatAirportTime(stdMs) : formatAirportTime(at);
    const eta = etdMs !== null ? formatAirportTime(etdMs) : null;
    const gate = (gatesByFlight[fn] ?? '') || (f.GateNumbers?.length ? f.GateNumbers.join(', ') : (f.GateNumber ?? '')).trim();
    const level = levelFor(minutesLeft);
    rows.push({
      key: `${fn}-${std}`,
      flightNumber: fn,
      destination: (f.DestinationCityName || f.DestinationAirportName || f.DestinationAirportCode || '').trim(),
      std,
      etd: eta && eta !== std ? eta : null,
      boarding: formatAirportTime(at - BOARDING_LEAD_MIN * 60_000),
      gate: gate && gate !== '-' ? gate : '',
      minutesLeft,
      level,
      priority: level === 'hurry' || level === 'urgent',
      at,
    });
  }

  rows.sort((a, b) => a.at - b.at);
  return rows.slice(0, max).map((r) => { const { at, ...row } = r; void at; return row; });
}
