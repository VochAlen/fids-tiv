// lib/server-clock.ts
//
// NOVO (2026-10-16): sat SERVERA kao jedini izvor istine za vrijeme na kiosku.
//
// Prijavljeno: gate ekrani povremeno ne prikazuju let — uzrok je bio POGREŠAN SAT računara (kiosk
// poredi vrijeme polaska sa Date.now(), a isNightHours() odlučuje o gašenju Ably veze po
// lokalnom satu). Pogrešan sat zato tiho kvari više stvari odjednom: let nestane sa gate-a,
// kiosk pomisli da je noć (zatvori realtime vezu), itd.
//
// Rješenje: svaki REST odgovor nosi `Date` zaglavlje servera. Iz njega računamo odstupanje
// (offset) lokalnog sata i svuda gdje je bitno koristimo `nowMs()` umjesto `Date.now()`.
// Na serveru (Node) offset je uvijek 0, pa je `nowMs()` identičan `Date.now()`.

const MAX_SAMPLES = 5;
/** Odstupanje iznad kojeg se na ekranu prikazuje upozorenje "pogrešan sat". */
export const CLOCK_SKEW_WARN_MS = 2 * 60_000;

interface Sample { offsetMs: number; rttMs: number }
let samples: Sample[] = [];
let offsetMs = 0;
let hasSample = false;
const listeners = new Set<() => void>();

const best = (): Sample => samples.reduce((a, b) => (b.rttMs < a.rttMs ? b : a));

/** Trenutno vrijeme (ms) ispravljeno prema satu servera. */
export function nowMs(): number {
  return Date.now() + offsetMs;
}

/** Odstupanje: (sat servera − sat računara) u ms. Pozitivno = računar kasni. */
export function getClockOffsetMs(): number {
  return offsetMs;
}

export function hasServerClockSample(): boolean {
  return hasSample;
}

export function subscribeClock(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/**
 * Upiši uzorak iz odgovora servera. `sentAt`/`receivedAt` su LOKALNI trenuci slanja i prijema
 * (Date.now()). Uzorak sa najmanjim RTT-om je najtačniji, pa se za offset uzima on.
 * `Date` zaglavlje ima preciznost od 1 s — dovoljno za otkrivanje pogrešnog sata (minute/sati).
 */
export function noteServerDate(dateHeader: string | null | undefined, sentAt: number, receivedAt: number): void {
  if (!dateHeader) return;
  const serverMs = Date.parse(dateHeader);
  if (!Number.isFinite(serverMs)) return;
  const rtt = receivedAt - sentAt;
  if (rtt < 0 || rtt > 8_000) return; // sumnjiv uzorak (sat skočio ili spora mreža)
  const sample: Sample = { offsetMs: serverMs - (sentAt + rtt / 2), rttMs: rtt };
  samples = [...samples.slice(-(MAX_SAMPLES - 1)), sample];
  const next = Math.round(best().offsetMs);
  const changed = Math.abs(next - offsetMs) > 500 || !hasSample;
  hasSample = true;
  offsetMs = next;
  if (changed) listeners.forEach(fn => fn());
}

/** Samo za testove. */
export function __resetServerClock(): void {
  samples = [];
  offsetMs = 0;
  hasSample = false;
  listeners.clear();
}
