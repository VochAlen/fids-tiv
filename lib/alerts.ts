// lib/alerts.ts
//
// Čista logika obavještenja (bez Redis-a i mreže, pa testirana): iz trenutnog popisa problema i zapamćenog stanja
// odlučuje šta poslati na Telegram i šta upisati u zapisnik događaja.
//
// Pravila (protiv "buke"):
//  • problem mora biti viđen u CONFIRM_RUNS uzastopnih provjera (≈6 min) prije prve poruke — kratkotrajne smetnje se ignorišu;
//  • poruka "riješeno" se šalje samo za problem o kojem je poruka stvarno poslata;
//  • problem koji i dalje traje podsjeća se najviše jednom u REMIND_MS;
//  • ako je od zadnje provjere prošlo > GAP_RESET_MS (noć, pauza crona), staro stanje se odbacuje bez poruka.
import type { KioskEvent, EventKind } from '@/lib/kiosk-events';

export type ProblemKind = Exclude<EventKind, 'cmd'>;

export interface Problem {
  /** Jedinstven ključ, npr. 'silent:checkin-5'. */
  key: string;
  kind: ProblemKind;
  /** 'checkin-5' ili 'flights'. */
  id: string;
  /** Kada je problem stvarno počeo (ms), ako se zna (npr. zadnji signal monitora). */
  since?: number;
  /** Dodatni opis (npr. 'podaci stari 25 min'). */
  detail?: string;
}

export interface AlertItem {
  kind: ProblemKind;
  id: string;
  first: number;
  /** Broj uzastopnih provjera u kojima je viđen (ograničen na CONFIRM_RUNS). */
  n: number;
  confirmed: boolean;
  notified: boolean;
  lastNotified: number;
}

export interface AlertState {
  /** Vrijeme zadnje provjere. */
  at: number;
  items: Record<string, AlertItem>;
}

export const CONFIRM_RUNS = 2;
export const REMIND_MS = 2 * 60 * 60_000;
export const GAP_RESET_MS = 90 * 60_000;

export interface AlertMessage {
  kind: 'new' | 'reminder' | 'resolved';
  problemKind: ProblemKind;
  id: string;
  detail?: string;
  /** Trajanje u minutama (do sada za 'new'/'reminder', ukupno za 'resolved'). */
  durationMin: number;
}

export interface DecideResult {
  messages: AlertMessage[];
  events: KioskEvent[];
  next: AlertState;
}

const mins = (a: number, b: number) => Math.max(0, Math.round((b - a) / 60_000));

export function decideAlerts(prev: AlertState | null, current: readonly Problem[], now: number): DecideResult {
  const base: Record<string, AlertItem> = prev && now - prev.at <= GAP_RESET_MS ? prev.items : {};
  const items: Record<string, AlertItem> = {};
  const messages: AlertMessage[] = [];
  const events: KioskEvent[] = [];
  const seen = new Set<string>();

  for (const p of current) {
    if (seen.has(p.key)) continue;
    seen.add(p.key);
    const ex = base[p.key];
    const it: AlertItem = ex
      ? { ...ex, n: Math.min(CONFIRM_RUNS, ex.n + 1) }
      : { kind: p.kind, id: p.id, first: Math.min(now, p.since ?? now), n: 1, confirmed: false, notified: false, lastNotified: 0 };
    if (!it.confirmed && it.n >= CONFIRM_RUNS) {
      it.confirmed = true;
      events.push({ t: it.first, k: p.kind, id: p.id, e: 'start', ...(p.detail ? { m: p.detail } : {}) });
    }
    if (it.confirmed && !it.notified) {
      it.notified = true;
      it.lastNotified = now;
      messages.push({ kind: 'new', problemKind: p.kind, id: p.id, detail: p.detail, durationMin: mins(it.first, now) });
    } else if (it.notified && now - it.lastNotified >= REMIND_MS) {
      it.lastNotified = now;
      messages.push({ kind: 'reminder', problemKind: p.kind, id: p.id, detail: p.detail, durationMin: mins(it.first, now) });
    }
    items[p.key] = it;
  }

  for (const [key, it] of Object.entries(base)) {
    if (seen.has(key) || !it.confirmed) continue;
    const d = mins(it.first, now);
    events.push({ t: now, k: it.kind, id: it.id, e: 'end', d });
    if (it.notified) messages.push({ kind: 'resolved', problemKind: it.kind, id: it.id, durationMin: d });
  }

  return { messages, events, next: { at: now, items } };
}

/** Telegram nije prihvatio poruku → 'nove' (i podsjetnike) vrati u stanje "nije obaviješteno", da se pokušaju ponovo pri sljedećoj provjeri. */
export function markSendFailed(next: AlertState, messages: readonly AlertMessage[]): AlertState {
  const items = { ...next.items };
  for (const m of messages) {
    if (m.kind === 'resolved') continue;
    const key = `${m.problemKind}:${m.id}`;
    const it = items[key];
    if (it) items[key] = { ...it, notified: false, lastNotified: 0 };
  }
  return { at: next.at, items };
}

const fmtDur = (min: number) => (min < 90 ? `${min} min` : `${Math.floor(min / 60)} h ${min % 60} min`);

function groupLine(label: string, msgs: AlertMessage[]): string {
  const parts = msgs.map((m) => `${m.id}${m.durationMin > 0 ? ` (${fmtDur(m.durationMin)})` : ''}${m.detail ? ` — ${m.detail}` : ''}`);
  const shown = parts.length > 12 ? [...parts.slice(0, 12), `i još ${parts.length - 12}`] : parts;
  return `• ${label}: ${shown.join(', ')}`;
}

const LABEL: Record<ProblemKind, string> = {
  silent: 'monitori se ne javljaju',
  stale: 'monitori sa zastarjelim podacima',
  flights: 'podaci o letovima',
};

/** Jedna poruka po provjeri: grupisano po vrsti (npr. 8 monitora = jedna linija, ne 8 poruka). */
export function formatAlertMessage(messages: readonly AlertMessage[], timeLabel: string): string {
  if (messages.length === 0) return '';
  const blocks: string[] = [];
  const section = (kind: AlertMessage['kind'], title: string) => {
    const list = messages.filter((m) => m.kind === kind);
    if (list.length === 0) return;
    const lines: string[] = [];
    for (const pk of ['silent', 'stale', 'flights'] as const) {
      const g = list.filter((m) => m.problemKind === pk);
      if (g.length === 0) continue;
      if (kind === 'resolved') {
        lines.push(`• ${g.map((m) => `${m.id} (${fmtDur(m.durationMin)})`).join(', ')} — ${pk === 'flights' ? 'podaci su ponovo svježi' : 'ponovo u redu'}`);
      } else {
        lines.push(groupLine(LABEL[pk], g));
      }
    }
    blocks.push(`${title}\n${lines.join('\n')}`);
  };
  section('new', `🔴 FIDS — novi problemi (${timeLabel})`);
  section('reminder', `🔔 FIDS — još traje (${timeLabel})`);
  section('resolved', `✅ FIDS — riješeno (${timeLabel})`);
  return blocks.join('\n\n');
}
