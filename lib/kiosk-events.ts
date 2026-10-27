// lib/kiosk-events.ts
//
// Zapisnik događaja (istorija problema i ručnih komandi) — čista logika bez Redis-a (I/O je u lib/kiosk-events-server.ts).
// Piše se SAMO pri promjeni (problem počeo/završio, poslata komanda), nikad periodično — zanemarljiv trošak.

export type EventKind = 'silent' | 'stale' | 'flights' | 'cmd';

export interface KioskEvent {
  /** Vrijeme događaja (ms). */
  t: number;
  k: EventKind;
  /** 'checkin-5', 'gate-3' ili 'flights'. */
  id: string;
  e: 'start' | 'end' | 'cmd';
  /** Trajanje u minutama (samo za 'end'). */
  d?: number;
  /** Kratak opis. */
  m?: string;
}

export const EVENTS_KEY = 'fids:events';
export const EVENTS_MAX = 500;

export interface EventSummary {
  id: string;
  /** Broj problema (silent/stale) u prozoru. */
  incidents: number;
  /** Minuta bez veze (silent) u prozoru — samo završeni problemi. */
  downMin: number;
  /** Minuta sa zastarjelim podacima (stale) u prozoru — samo završeni problemi. */
  staleMin: number;
  lastAt: number;
}

export function summarizeEvents(events: readonly KioskEvent[], now: number, days = 7): EventSummary[] {
  const from = now - days * 86_400_000;
  const map = new Map<string, EventSummary>();
  for (const ev of events) {
    if (ev.t < from || (ev.k !== 'silent' && ev.k !== 'stale')) continue;
    let s = map.get(ev.id);
    if (!s) { s = { id: ev.id, incidents: 0, downMin: 0, staleMin: 0, lastAt: 0 }; map.set(ev.id, s); }
    if (ev.e === 'start') s.incidents++;
    if (ev.e === 'end' && typeof ev.d === 'number') {
      if (ev.k === 'silent') s.downMin += ev.d; else s.staleMin += ev.d;
    }
    if (ev.t > s.lastAt) s.lastAt = ev.t;
  }
  return [...map.values()].sort((a, b) => (b.downMin + b.staleMin) - (a.downMin + a.staleMin) || b.incidents - a.incidents || a.id.localeCompare(b.id, undefined, { numeric: true }));
}

export function parseEvents(raw: readonly string[]): KioskEvent[] {
  const out: KioskEvent[] = [];
  for (const s of raw) {
    try {
      const e = JSON.parse(s) as KioskEvent;
      if (e && typeof e.t === 'number' && typeof e.id === 'string' && typeof e.k === 'string' && typeof e.e === 'string') out.push(e);
    } catch { /* oštećen unos se preskače */ }
  }
  return out;
}
