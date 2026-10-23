// lib/kiosk-beacon.ts
//
// "Zadnji put viđen" za svaki kiosk BEZ dodatnih zahtjeva: monitor već svakih ~5 min radi reconcile fetch
// (/api/test/assignments) — ovdje mu se u HEADER x-kiosk dodaju kratki parametri (URL ostaje isti, da CDN keš ostane zajednički) (ko je, šta prikazuje, koja verzija,
// zadnja greška), a server ih upiše u Redis hash (lib/kiosk-beacon-server.ts). /admin/health to prikazuje.
//
// Ovaj fajl: zajednički tipovi + validacija parametara (server) + stanje i sastavljanje upita (klijent).

export const KIOSK_HASH_KEY = 'fids:kiosks';

export type KioskView = 'loading' | 'idle' | 'open' | 'closed' | 'other';
export type KioskClient = 'electron' | 'chrome';

const VIEWS: readonly KioskView[] = ['loading', 'idle', 'open', 'closed', 'other'];
// Dozvoljeni prefiksi i oblik id-a: ograničava prostor ključeva (endpoint je javan, neautentifikovan).
const ID_RE = /^(checkin|gate|board|combined|departures|split)(-[a-z0-9]{1,6})?$/;
const FLIGHT_RE = /^[A-Z0-9]{0,8}$/;

export interface KioskReport {
  id: string;
  view: KioskView;
  flight: string;
  build: string;
  client: KioskClient;
  /** Starost stranice (s) u trenutku izvještaja. */
  pageAgeSec: number;
  /** Zadnja klijentska greška (kratko), '' ako nema. */
  err: string;
}

export interface StoredKiosk extends KioskReport {
  /** Serverski sat (ms) kad je izvještaj primljen. */
  seen: number;
}

function clean(s: string | null, max: number): string {
  return (s ?? '').replace(/[^\x20-\x7E]/g, '').replace(/[<>"'`\\]/g, '').slice(0, max);
}

/** Server: iz query parametara pravi izvještaj ili null ako nije valjan. */
export function parseBeacon(sp: URLSearchParams): KioskReport | null {
  const id = (sp.get('k') ?? '').toLowerCase();
  if (!ID_RE.test(id)) return null;
  const viewRaw = sp.get('s') as KioskView | null;
  const view: KioskView = viewRaw && VIEWS.includes(viewRaw) ? viewRaw : 'other';
  const flight = (sp.get('f') ?? '').toUpperCase();
  if (!FLIGHT_RE.test(flight)) return null;
  const age = Number(sp.get('a'));
  return {
    id,
    view,
    flight,
    build: clean(sp.get('b'), 24),
    client: sp.get('u') === 'e' ? 'electron' : 'chrome',
    pageAgeSec: Number.isFinite(age) && age >= 0 ? Math.min(Math.round(age), 30 * 86_400) : 0,
    err: clean(sp.get('e'), 80),
  };
}

// ───────────────────────── klijent ─────────────────────────

let info: { id: string; view: KioskView; flight: string } = { id: '', view: 'loading', flight: '' };
let serverBuild = '';

export function setKioskInfo(p: Partial<typeof info>): void {
  info = { ...info, ...p };
  info.flight = info.flight.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 8);
}

export function getClientBuild(): string {
  try { return String((window as unknown as { __BUILD_ID__?: string }).__BUILD_ID__ || ''); } catch { return ''; }
}

/** Zadnja klijentska greška iz dijagnostike (sessionStorage, upisuje inline skripta u layout.tsx) — samo ako je svježa (30 min). */
function lastClientError(): string {
  try {
    const raw = sessionStorage.getItem('__checkin_diag__');
    if (!raw) return '';
    const arr = JSON.parse(raw) as Array<{ t?: number; s?: string }>;
    const last = Array.isArray(arr) ? arr[arr.length - 1] : null;
    if (!last || typeof last.t !== 'number' || Date.now() - last.t > 30 * 60_000) return '';
    return String(last.s ?? '').replace(/^\d{2}:\d{2}:\d{2}\s+/, '').slice(0, 80);
  } catch { return ''; }
}

/** Vrijednost headera x-kiosk ('k=...&s=...') za /api/test/assignments; '' ako ova stranica nije prijavila id. */
export function beaconQuery(): string {
  if (!info.id) return '';
  try {
    const q = new URLSearchParams();
    q.set('k', info.id);
    q.set('s', info.view);
    if (info.flight) q.set('f', info.flight);
    q.set('b', getClientBuild());
    q.set('u', /Electron\//i.test(navigator.userAgent) ? 'e' : 'c');
    q.set('a', String(Math.round(performance.now() / 1000)));
    const e = lastClientError();
    if (e) q.set('e', e);
    return q.toString();
  } catch { return ''; }
}

export function noteServerBuild(b: unknown): void {
  if (typeof b === 'string') serverBuild = b;
}

/** true = server je na drugom deployu od ove stranice (oba poznata i različita). */
export function isBuildStale(): boolean {
  const mine = getClientBuild();
  return !!serverBuild && !!mine && mine !== 'dev' && serverBuild !== 'dev' && mine !== serverBuild;
}
