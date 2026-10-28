// lib/assign-log.ts
//
// Čista logika (testirana) za istoriju dodjela šaltera i gate-ova: oblik događaja, ključ po danu, slaganje događaja u
// intervale "od-do" i sažetak za izvještaj. Bez Redis-a i mreže.
export type AssignResType = 'd' | 'g';                          // d = check-in šalter, g = gate
export type AssignAction = 'open' | 'close' | 'clear' | 'auto'; // otvoreno / zatvoreno / uklonjeno / automatski istekao

export interface AssignEvent {
  t: number;            // ms
  y: AssignResType;
  id: string;           // broj šaltera/gate-a
  a: AssignAction;
  f: string;            // broj leta (prazno ako nije poznat)
  u?: string;           // ko je uradio (admin korisnik), ako je poznat
}

export const ASSIGN_LOG_PREFIX = 'fids:assignlog:';
export const ASSIGN_LOG_TTL_SEC = 8 * 24 * 3600;   // čuva se 7 dana (+1 dan rezerve zbog zone/ponoći)
export const ASSIGN_LOG_DAYS = 7;

export const assignLogKey = (date: string) => `${ASSIGN_LOG_PREFIX}${date}`;
export const isValidLogDate = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);

export function parseAssignEvents(raw: readonly string[]): AssignEvent[] {
  const out: AssignEvent[] = [];
  for (const r of raw) {
    try {
      const e = JSON.parse(r) as AssignEvent;
      if (e && typeof e.t === 'number' && (e.y === 'd' || e.y === 'g') && typeof e.id === 'string' && typeof e.a === 'string') out.push(e);
    } catch { /* oštećen unos se preskače */ }
  }
  return out.sort((a, b) => a.t - b.t);
}

export interface AssignInterval {
  y: AssignResType;
  id: string;
  flight: string;
  start: number;
  /** null = još otvoreno (ili nije zabilježen kraj). */
  end: number | null;
  /** Kako je završeno. */
  endReason: 'closed' | 'cleared' | 'auto' | 'replaced' | null;
  openedBy?: string;
}

/** Slaže događaje u intervale po resursu. Ponovno 'open' istog leta se ignoriše; drugi let zatvara prethodni ('replaced'). */
export function buildIntervals(events: readonly AssignEvent[]): AssignInterval[] {
  const sorted = [...events].sort((a, b) => a.t - b.t);
  const cur = new Map<string, AssignInterval>();
  const done: AssignInterval[] = [];
  for (const e of sorted) {
    const key = `${e.y}:${e.id}`;
    const open = cur.get(key);
    if (e.a === 'open') {
      if (open && open.flight === e.f) continue;
      if (open) { open.end = e.t; open.endReason = 'replaced'; done.push(open); }
      cur.set(key, { y: e.y, id: e.id, flight: e.f, start: e.t, end: null, endReason: null, ...(e.u ? { openedBy: e.u } : {}) });
    } else if (open) {
      open.end = e.t;
      open.endReason = e.a === 'close' ? 'closed' : e.a === 'auto' ? 'auto' : 'cleared';
      done.push(open);
      cur.delete(key);
    }
  }
  const all = [...done, ...cur.values()];
  const idNum = (s: string) => parseInt(s.replace(/\D/g, ''), 10) || 0;
  return all.sort((a, b) => a.y.localeCompare(b.y) || idNum(a.id) - idNum(b.id) || a.start - b.start);
}

const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Podgorica', year: 'numeric', month: '2-digit', day: '2-digit' });
const OPEN_MAX_MS = 12 * 3600_000; // isto kao ASSIGNMENT_TTL_SECONDS: duže od ovoga unos u Redisu više ne može biti otvoren

/**
 * Stanje intervala bez kraja: 'open' = realno još otvoreno (isti dan po aerodromskom satu i < 12 h), 'unknown' = kraj nije
 * zabilježen (stari zapis, ili je dodjela istekla/uklonjena mimo evidencije) — ne smije se prikazivati kao "još otvoreno".
 */
export function openState(i: Pick<AssignInterval, 'start' | 'end'>, now: number): 'closed' | 'open' | 'unknown' {
  if (i.end !== null) return 'closed';
  if (now - i.start >= OPEN_MAX_MS || dayFmt.format(new Date(i.start)) !== dayFmt.format(new Date(now))) return 'unknown';
  return 'open';
}

const tf = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Podgorica', hour: '2-digit', minute: '2-digit', hour12: false });
export const fmtClock = (ms: number | null): string => (ms === null ? '—' : tf.format(new Date(ms)));

export function fmtDuration(min: number): string {
  if (min < 1) return '<1 min';
  const h = Math.floor(min / 60), m = Math.round(min % 60);
  return h === 0 ? `${m} min` : `${h} h ${String(m).padStart(2, '0')} min`;
}

export const END_REASON_LABEL: Record<NonNullable<AssignInterval['endReason']>, string> = {
  closed: 'zatvoreno', cleared: 'uklonjeno', auto: 'automatski (let poletio)', replaced: 'zamijenjen drugim letom',
};

export interface AssignSummary { desks: number; gates: number; flights: number; events: number }

export function summarize(intervals: readonly AssignInterval[], events: readonly AssignEvent[]): AssignSummary {
  const flights = new Set(intervals.map((i) => i.flight).filter(Boolean));
  return {
    desks: intervals.filter((i) => i.y === 'd').length,
    gates: intervals.filter((i) => i.y === 'g').length,
    flights: flights.size,
    events: events.length,
  };
}
