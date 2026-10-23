// lib/kiosk-health.ts
//
// Čista logika (bez Redis-a/Next-a, pa testirana): iz zadnjih izvještaja kioska + stvarnog stanja dodjela
// izvodi status svakog monitora za /admin/health.
import type { StoredKiosk, KioskView, KioskClient } from '@/lib/kiosk-beacon';

export const KIOSK_SILENT_AFTER_MIN = 17;   // reconcile je svakih ~5 min; ~1 od 4 beacona CDN odgovori iz keša (funkcija se ne izvrši) — 17 min = 3 uzastopna promašaja
export const KIOSK_DAY_GRACE_MIN = 15;      // poslije kraja noći kiosci se javljaju čim se Ably ponovo otvori
export const KIOSK_FORGET_AFTER_DAYS = 14;  // unosi starije od ovoga se brišu iz hash-a

export type KioskStatus = 'ok' | 'silent' | 'mismatch' | 'night';

export interface KioskInfo {
  id: string;
  status: KioskStatus;
  view: KioskView;
  flight: string;
  client: KioskClient;
  build: string;
  buildCurrent: boolean;
  /** Sekundi od zadnjeg izvještaja. */
  ageSec: number;
  /** Starost stranice (min) u trenutku izvještaja. */
  pageAgeMin: number;
  err: string;
  /** Za 'mismatch': šta piše u bazi. */
  expected?: string;
}

export interface OpenTruth {
  type: 'desk' | 'gate';
  resourceId: string;
  flightNumber: string;
  openSinceMinutesAgo: number;
}

const norm = (s: string) => s.replace(/[^A-Za-z0-9]/g, '').toUpperCase();

export function classifyKiosks(
  stored: StoredKiosk[],
  open: OpenTruth[],
  opts: { now: number; night: boolean; minutesSinceDayStart: number | null; currentBuild: string },
): KioskInfo[] {
  const { now, night, minutesSinceDayStart, currentBuild } = opts;
  const out: KioskInfo[] = stored.map((k) => {
    const ageSec = Math.max(0, Math.round((now - k.seen) / 1000));
    const buildCurrent = !k.build || !currentBuild || currentBuild === 'dev' || k.build === currentBuild;

    let status: KioskStatus = 'ok';
    let expected: string | undefined;

    const dayGraceOver = minutesSinceDayStart === null || minutesSinceDayStart >= KIOSK_DAY_GRACE_MIN;
    if (night) {
      status = 'night';
    } else if (ageSec > KIOSK_SILENT_AFTER_MIN * 60 && dayGraceOver) {
      status = 'silent';
    } else {
      const m = /^(checkin|gate)-(.+)$/.exec(k.id);
      if (m && k.view !== 'loading') {
        const type = m[1] === 'checkin' ? 'desk' : 'gate';
        const truth = open.find((o) => o.type === type && o.resourceId.toLowerCase() === m[2]);
        // dodjela mora biti ZNATNO starija od izvještaja — inače je to samo trka (promjena tek stigla)
        if (truth && (truth.openSinceMinutesAgo - 1) * 60 > ageSec + 60) {
          const want = norm(truth.flightNumber);
          if (k.view !== 'open' || norm(k.flight) !== want) {
            status = 'mismatch';
            expected = truth.flightNumber;
          }
        }
      }
    }

    return {
      id: k.id, status, view: k.view, flight: k.flight, client: k.client, build: k.build, buildCurrent,
      ageSec, pageAgeMin: Math.round(k.pageAgeSec / 60), err: k.err, ...(expected ? { expected } : {}),
    };
  });

  const rank: Record<KioskStatus, number> = { silent: 0, mismatch: 1, ok: 2, night: 3 };
  return out.sort((a, b) => rank[a.status] - rank[b.status] || a.id.localeCompare(b.id, undefined, { numeric: true }));
}

export function parseStoredKiosks(hash: Record<string, string>): StoredKiosk[] {
  const out: StoredKiosk[] = [];
  for (const raw of Object.values(hash)) {
    try {
      const k = JSON.parse(raw) as StoredKiosk;
      if (k && typeof k.id === 'string' && typeof k.seen === 'number') out.push(k);
    } catch { /* oštećen unos se preskače */ }
  }
  return out;
}
