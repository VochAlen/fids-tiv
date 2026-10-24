// lib/kiosk-beacon.ts
//
// "Zadnji put viđen" za svaki kiosk BEZ dodatnih zahtjeva: monitor već svakih ~5 min radi reconcile fetch
// (/api/test/assignments) — ovdje mu se u HEADER x-kiosk dodaju kratki parametri (URL ostaje isti, da CDN keš ostane zajednički) (ko je, šta prikazuje, koja verzija,
// zadnja greška), a server ih upiše u Redis hash (lib/kiosk-beacon-server.ts). /admin/health to prikazuje.
//
// Ovaj fajl: zajednički tipovi + validacija parametara (server) + stanje i sastavljanje upita (klijent).

export const KIOSK_HASH_KEY = 'fids:kiosks';
/**
 * Daljinske komande idu na POSTOJEĆI Ably kanal 'flights:combined' pod VLASTITIM nazivom događaja. Svi kiosk klijenti već
 * slušaju taj kanal samo za događaj 'update' (filter po nazivu), pa komandu ignorišu — bez novog kanala, bez promjene
 * Ably capability-ja i bez ikakvog periodičnog troška: trošak nastaje samo pri kliku (jedna poruka).
 */
export const KIOSK_CMD_CHANNEL = 'flights:combined';
export const KIOSK_CMD_EVENT = 'kiosk-cmd';

export interface KioskCommand {
  /** Id ciljanog monitora (npr. 'checkin-4'). */
  id: string;
  cmd: 'restart';
  /** Serverski sat (ms) u trenutku slanja — kiosk ignoriše komande starije od 2 min. */
  ts: number;
  nonce: string;
}
export type KioskView = 'loading' | 'idle' | 'open' | 'closed' | 'other';
export type KioskClient = 'electron' | 'chrome';

const VIEWS: readonly KioskView[] = ['loading', 'idle', 'open', 'closed', 'other'];
// Dozvoljeni prefiksi i oblik id-a: ograničava prostor ključeva (endpoint je javan, neautentifikovan).
const ID_RE = /^(checkin|gate|board|combined|departures|split)(-[a-z0-9]{1,6})?$/;
const FLIGHT_RE = /^[A-Z0-9]{0,8}$/;

export function isValidKioskId(id: string): boolean {
  return ID_RE.test(id);
}

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
  /** Sekundi od zadnjeg uspješnog učitavanja podataka o letovima; -1 = stranica to ne mjeri. */
  dataAgeSec: number;
  /** Šta KLIJENT zna o svom šalteru: 'open' = primio otvorenu dodjelu, 'closed', 'none' = nema dodjele; '' = stranica to ne javlja. */
  entry?: 'open' | 'closed' | 'none' | '';
  /** true = klijent zna da se restartuje cijela aplikacija (Electron sa novim main.js/preload.js); inače se samo reloaduje stranica. */
  canRestart: boolean;
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
    dataAgeSec: Number.isFinite(Number(sp.get('d'))) && sp.get('d') !== null && sp.get('d') !== '' ? Math.max(-1, Math.min(Math.round(Number(sp.get('d'))), 30 * 86_400)) : -1,
    entry: ((v) => (v === 'o' ? 'open' : v === 'c' ? 'closed' : v === 'n' ? 'none' : ''))(sp.get('g')),
    canRestart: sp.get('r') === '1',
  };
}

// ───────────────────────── klijent ─────────────────────────

let info: { id: string; view: KioskView; flight: string; entry: 'open' | 'closed' | 'none' | '' } = { id: '', view: 'loading', flight: '', entry: '' };
let serverBuild = '';

export function setKioskInfo(p: Partial<typeof info>): void {
  info = { ...info, ...p };
  info.flight = info.flight.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 8);
}

/**
 * true = provjere (reconcile/poll) smiju ići i kad preglednik javi document.hidden.
 * Samo za kiosk u običnom Chrome-u: tamo je jedini prozor, pa "hidden" znači da ga je nešto prekrilo/minimiziralo (Chrome
 * tada usporava tajmere), a monitor ipak mora ostati sinhronizovan. U Electronu NE: tamo je skriven prozor rezervna
 * stranica (standby) iza aktivne — ona ne smije dupliti zahtjeve (trošak na Vercelu), a aktivni prozor nikad nije hidden.
 */
export function pollWhileHidden(): boolean {
  try { return !!info.id && !/Electron\//i.test(navigator.userAgent); } catch { return false; }
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
    // stare lažne linije (resursni događaji bez poruke, npr. slika) se ne prijavljuju
    const real = Array.isArray(arr) ? arr.filter((l) => !/ERR: undefined/.test(String(l?.s ?? ''))) : [];
    const last = real.length ? real[real.length - 1] : null;
    if (!last || typeof last.t !== 'number' || Date.now() - last.t > 30 * 60_000) return '';
    // starost greške na kraju ('[3m]'), da se vidi je li stara (sessionStorage preživi reload) ili se ponavlja
    const ageMin = Math.max(0, Math.round((Date.now() - last.t) / 60_000));
    return (String(last.s ?? '').replace(/^\d{2}:\d{2}:\d{2}\s+/, '').slice(0, 72) + ' [' + ageMin + 'm]').slice(0, 80);
  } catch { return ''; }
}

/** Vrijednost headera x-kiosk ('k=...&s=...') za /api/test/assignments; '' ako ova stranica nije prijavila id. */
export function beaconQuery(): string {
  if (!info.id) return '';
  try {
    const q = new URLSearchParams();
    q.set('k', info.id);
    q.set('s', info.view);
    if (info.entry) q.set('g', info.entry === 'open' ? 'o' : info.entry === 'closed' ? 'c' : 'n');
    if (info.flight) q.set('f', info.flight);
    q.set('b', getClientBuild());
    q.set('u', /Electron\//i.test(navigator.userAgent) ? 'e' : 'c');
    q.set('a', String(Math.round(performance.now() / 1000)));
    const lastData = (window as unknown as { __fidsLastDataAt?: number }).__fidsLastDataAt;
    if (typeof lastData === 'number') q.set('d', String(Math.max(0, Math.round((Date.now() - lastData) / 1000))));
    if (typeof (window as unknown as { electronAPI?: { restartApp?: unknown } }).electronAPI?.restartApp === 'function') q.set('r', '1');
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
