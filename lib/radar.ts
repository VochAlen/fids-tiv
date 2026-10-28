// lib/radar.ts
//
// Čista logika za /admin/radar (testirana): geometrija, uparivanje callsign-a sa NAŠIM rasporedom,
// ETA i plan osvježavanja. Bez I/O — sav pristup mrežom/Redisom je u app/api/admin/radar/route.ts.
import type { Flight } from '@/types/flight';
import { airportTimeToMs } from '@/lib/night-hours';

export const TIV = { lat: 42.4047, lon: 18.7233 } as const;
export const RADIUS_NM = 200;

/** Interval osvježavanja (s). Zimski red letenja: rijetki letovi → rijetko; blizu leta → često. */
export const FAST_SEC = 210;            // 3,5 min
export const SLOW_SEC = 720;            // 12 min
export const LEAD_MIN = 30;             // brzi režim počinje 30 min prije planiranog vremena leta
export const DEPARTED_TAIL_MIN = 20;    // i traje još toliko nakon polaska (dok je avion još u dometu)
export const ARRIVAL_TAIL_MIN = 90;     // kasni dolasci: brzi režim do slijetanja ili najviše toliko nakon planiranog

const R_NM = 3440.065;
const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

/** Udaljenost (NM) po velikom krugu. */
export function distanceNm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = rad(lat2 - lat1), dLon = rad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R_NM * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Početni kurs (0–359°) od tačke 1 ka tački 2. */
export function bearingDeg(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const y = Math.sin(rad(lon2 - lon1)) * Math.cos(rad(lat2));
  const x = Math.cos(rad(lat1)) * Math.sin(rad(lat2)) - Math.sin(rad(lat1)) * Math.cos(rad(lat2)) * Math.cos(rad(lon2 - lon1));
  return (deg(Math.atan2(y, x)) + 360) % 360;
}

/** Pozicija nakon `sec` sekundi leta ravno brzinom gs (kt) kursom track (°) — "dead reckoning" između osvježavanja. */
export function extrapolate(lat: number, lon: number, gsKt: number, trackDeg: number, sec: number): { lat: number; lon: number } {
  const distNm = (gsKt * sec) / 3600;
  const dLat = (distNm * Math.cos(rad(trackDeg))) / 60;
  const dLon = (distNm * Math.sin(rad(trackDeg))) / (60 * Math.max(0.05, Math.cos(rad(lat))));
  return { lat: lat + dLat, lon: lon + dLon };
}

// ─────────────────────────── uparivanje sa rasporedom ───────────────────────────

const norm = (s: string | null | undefined) => (s ?? '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
const digitsOf = (s: string) => s.replace(/^[A-Z]+/, '').replace(/^0+(?=\d)/, '');

export interface ScheduledFlight {
  flightNumber: string;
  type: 'arrival' | 'departure';
  city: string;
  /** Planirano "HH:MM". */
  std: string;
  /** Procijenjeno "HH:MM" ili ''. */
  etd: string;
  status: string;
  /** Apsolutno vrijeme (ms) — ETD ako postoji, inače STD. */
  atMs: number;
}

const DONE_RE = /(landed|arrived|departed|poletio|sletio|cancel|otkaz)/i;
export const isDone = (f: Pick<Flight, 'StatusEN' | 'ProcessingStage'>) =>
  DONE_RE.test(f.StatusEN ?? '') || f.ProcessingStage === 'departed' || f.ProcessingStage === 'arrived';

const HM_RE = /^(\d{1,2}):(\d{2})/;
function toMs(hm: string, now: number): number | null {
  const m = HM_RE.exec(hm ?? '');
  if (!m) return null;
  return airportTimeToMs(+m[1], +m[2], now);
}

export function toScheduled(f: Flight, now: number): ScheduledFlight | null {
  const std = f.ScheduledDepartureTime ?? '';
  const etd = f.EstimatedDepartureTime ?? '';
  const atMs = toMs(etd, now) ?? toMs(std, now);
  if (atMs == null) return null;
  return {
    flightNumber: f.FlightNumber, type: f.FlightType === 'departure' ? 'departure' : 'arrival',
    city: f.DestinationCityName || f.DestinationAirportName || f.DestinationAirportCode || '',
    std: HM_RE.test(std) ? std.slice(0, 5) : '', etd: HM_RE.test(etd) ? etd.slice(0, 5) : '', status: f.StatusEN ?? '', atMs,
  };
}

/** Mogući ključevi za let: ICAO+broj (EXS1234), IATA+broj (LS1234) i sve code-share varijante. */
function keysFor(f: Flight): string[] {
  const fn = norm(f.FlightNumber);
  const num = digitsOf(fn);
  if (!num) return [];
  const out = new Set<string>([fn]);
  const icao = norm(f.AirlineICAO), iata = norm(f.AirlineCode);
  if (icao) out.add(icao + num);
  if (iata) out.add(iata + num);
  for (const c of f.CodeShareFlights ?? []) { const n = norm(c); if (n) out.add(n); }
  return [...out];
}

export type ScheduleIndex = Map<string, { flight: Flight; sched: ScheduledFlight }>;

/** Indeks cijelog rasporeda (dolasci + odlasci). Za isti ključ pobjeđuje let najbliži sada. */
export function buildScheduleIndex(arrivals: readonly Flight[], departures: readonly Flight[], now: number): ScheduleIndex {
  const idx: ScheduleIndex = new Map();
  for (const f of [...arrivals, ...departures]) {
    const sched = toScheduled(f, now);
    if (!sched) continue;
    for (const k of keysFor(f)) {
      const cur = idx.get(k);
      if (!cur || Math.abs(sched.atMs - now) < Math.abs(cur.sched.atMs - now)) idx.set(k, { flight: f, sched });
    }
  }
  return idx;
}

/** Callsign sa ADS-B-a (npr. "EXS1234 ") → zapis iz rasporeda ili null. */
export function matchCallsign(callsign: string, idx: ScheduleIndex) {
  const cs = norm(callsign);
  if (!cs) return null;
  const direct = idx.get(cs);
  if (direct) return direct;
  const num = digitsOf(cs);
  if (!num) return null;
  // Isti broj + isto slovno-brojčano prefiksno "ime" (npr. callsign sa vodećim nulama).
  const prefix = cs.slice(0, cs.length - (cs.replace(/^[A-Z]+/, '').length));
  return prefix ? idx.get(prefix + num) ?? null : null;
}

/** Zapis iz rasporeda po broju leta (npr. 'JU686') — za ručnu tabelu callsign-ova. */
export function matchFlightNumber(fn: string, idx: ScheduleIndex) {
  return idx.get(norm(fn)) ?? null;
}

export interface HeurAc { cs: string; lat: number; lon: number; gs: number; trk: number; gnd: boolean }
export type Entry = { flight: Flight; sched: ScheduledFlight };
const angDiff = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);

/**
 * Procjena za callsign-ove koji ne sadrže broj leta (ASL80X): isti ICAO prefiks aviokompanije +
 * odgovara vremenu. Dolazak: leti ka TIV-u, a ETA je u ±30 min od plana. Odlazak: blizu TIV-a, odlazi,
 * plan u prozoru [−40, +15] min. Bira se vrijeme najbliže planu; `candidates` su još neuparene stavke.
 */
export function heuristicMatch(a: HeurAc, candidates: readonly Entry[], now: number): Entry | null {
  const prefix = norm(a.cs).slice(0, 3);
  if (prefix.length < 3 || a.gnd) return null;
  const dist = distanceNm(TIV.lat, TIV.lon, a.lat, a.lon);
  const toTiv = bearingDeg(a.lat, a.lon, TIV.lat, TIV.lon);
  const fromTiv = (toTiv + 180) % 360;
  let best: Entry | null = null, bestDiff = Infinity;
  for (const c of candidates) {
    if (norm(c.flight.AirlineICAO) !== prefix) continue;
    let diff: number;
    if (c.sched.type === 'arrival') {
      if (dist < 4 || (dist > 25 && angDiff(a.trk, toTiv) > 50)) continue;
      const eta = etaMinutes(dist, a.gs);
      if (eta == null) continue;
      diff = Math.abs(now + eta * 60_000 - c.sched.atMs);
      if (diff > 30 * 60_000) continue;
    } else {
      if (dist > 60 || angDiff(a.trk, fromTiv) > 70) continue;
      const d = now - c.sched.atMs;
      if (d < -15 * 60_000 || d > 40 * 60_000) continue;
      diff = Math.abs(d);
    }
    if (diff < bestDiff) { bestDiff = diff; best = c; }
  }
  return best;
}

// ─────────────────────────── ETA ───────────────────────────

/**
 * Minuta do slijetanja iz udaljenosti i brzine. Blizu aerodroma avion usporava (prilaz), pa se brzina
 * ograničava; ispod 140 kt se računa 140 (izbjegava beskonačne ETA kod "gs≈0").
 */
export function etaMinutes(distNm: number, gsKt: number): number | null {
  if (!isFinite(distNm) || !isFinite(gsKt) || gsKt < 30) return null;
  let v = gsKt;
  if (distNm < 15) v = Math.min(v, 150);
  else if (distNm < 40) v = Math.min(v, 220);
  v = Math.max(v, 140);
  return (distNm / v) * 60;
}

export const hhmm = (ms: number) => {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Podgorica', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(ms));
  return p === '24:00' ? '00:00' : p;
};

// ─────────────────────────── plan osvježavanja ───────────────────────────

export type RadarMode = 'fast' | 'slow' | 'night';
export interface RadarPlan {
  mode: RadarMode;
  /** Za koliko sekundi klijent sljedeći put pita server (null = ne pitati; noć). */
  intervalSec: number | null;
  /** Sljedeći relevantan let (za prikaz "sljedeći let u HH:MM"). */
  next: { flightNumber: string; hm: string; type: 'arrival' | 'departure' } | null;
}

/**
 * Brzi režim (FAST_SEC) = postoji let koji nije obrađen, a planirano vrijeme mu je u prozoru
 * [sad − rep, sad + LEAD_MIN]. Inače spori (SLOW_SEC), ali nikad duži od vremena do početka sljedećeg
 * brzog prozora (da se ne "prespava" prvi avion).
 */
export function planRefresh(arrivals: readonly Flight[], departures: readonly Flight[], now: number, night: boolean): RadarPlan {
  const items: Array<{ s: ScheduledFlight; done: boolean }> = [];
  for (const f of arrivals) { const s = toScheduled({ ...f, FlightType: 'arrival' }, now); if (s) items.push({ s, done: isDone(f) }); }
  for (const f of departures) { const s = toScheduled({ ...f, FlightType: 'departure' }, now); if (s) items.push({ s, done: isDone(f) }); }

  const upcoming = items.filter((i) => !i.done).sort((a, b) => a.s.atMs - b.s.atMs);
  const nextItem = upcoming.find((i) => i.s.atMs >= now - 5 * 60_000) ?? upcoming[0] ?? null;
  const next = nextItem ? { flightNumber: nextItem.s.flightNumber, hm: nextItem.s.etd || nextItem.s.std, type: nextItem.s.type } : null;
  if (night) return { mode: 'night', intervalSec: null, next };

  const lead = LEAD_MIN * 60_000;
  const tail = (t: 'arrival' | 'departure') => (t === 'arrival' ? ARRIVAL_TAIL_MIN : DEPARTED_TAIL_MIN) * 60_000;
  for (const i of upcoming) {
    if (i.s.atMs - now <= lead && now - i.s.atMs <= tail(i.s.type)) return { mode: 'fast', intervalSec: FAST_SEC, next };
  }
  // Sljedeći početak brzog prozora
  let untilFast = Infinity;
  for (const i of upcoming) {
    const start = i.s.atMs - lead;
    if (start > now) untilFast = Math.min(untilFast, start - now);
  }
  const sec = Math.max(30, Math.min(SLOW_SEC, Math.ceil(untilFast / 1000)));
  return { mode: 'slow', intervalSec: sec, next };
}

// ─────────────────────────── tipovi odgovora API-ja ───────────────────────────

export interface RadarAircraft {
  via: 'cs' | 'map' | 'est'; hex: string; cs: string; r: string; t: string; alt: number; gnd: boolean; gs: number; trk: number;
  lat: number; lon: number; vr: number; age: number; dist: number; brg: number; etaMin: number | null;
  sched: { fn: string; type: 'arrival' | 'departure'; city: string; std: string; etd: string; status: string; atMs: number };
}
export interface RadarOther { hex: string; cs: string; r: string; t: string; alt: number; gnd: boolean; gs: number; trk: number; lat: number; lon: number; vr: number; age: number; dist: number; brg: number }
export interface RadarPending { fn: string; type: 'arrival' | 'departure'; city: string; std: string; etd: string; status: string; atMs: number }
export interface RadarResponse {
  now: number; fetchedAt: number | null; mode: RadarMode; intervalSec: number | null;
  next: RadarPlan['next']; aircraft: RadarAircraft[]; pending: RadarPending[]; ground: Record<string, RadarGround>; others: number; /** Samo uz ?all=1: ostali avioni u dometu (nisu naš raspored). */ allOthers?: RadarOther[]; stale: boolean; note: string | null;
}

/** Letovi iz rasporeda (nisu obrađeni) u prozoru [−30, +120] min koji nemaju avion na radaru. */
export function pendingFlights(arrivals: readonly Flight[], departures: readonly Flight[], matched: ReadonlySet<string>, now: number): RadarPending[] {
  const out: RadarPending[] = [];
  const add = (f: Flight, type: 'arrival' | 'departure') => {
    if (isDone(f)) return;
    const s = toScheduled({ ...f, FlightType: type }, now);
    if (!s || matched.has(norm(s.flightNumber))) return;
    if (s.atMs < now - 30 * 60_000 || s.atMs > now + 120 * 60_000) return;
    out.push({ fn: s.flightNumber, type, city: s.city, std: s.std, etd: s.etd, status: s.status, atMs: s.atMs });
  };
  for (const f of arrivals) add(f, 'arrival');
  for (const f of departures) add(f, 'departure');
  return out.sort((a, b) => a.atMs - b.atMs);
}

// ─────────────────────────── zemlja: gate / šalter / traka ───────────────────────────

export interface RadarGround {
  gates: Array<{ id: string; open: boolean }>;
  desks: Array<{ id: string; open: boolean }>;
  /** Traka za prtljag (dolasci), iz rasporeda. */
  belt: string;
  /** true = nema ručne dodjele; prikazane vrijednosti su samo planirane iz rasporeda. */
  planned: boolean;
}
type AssignEntry = { status: 'open' | 'closed' | null; flightNumber: string | null };

const splitIds = (s: string | null | undefined) => (s ?? '').split(/[,;/\s]+/).map((x) => x.trim()).filter(Boolean);

/** Dodjele (ručne, iz Redisa) po letu; ako ih nema, planirane vrijednosti iz rasporeda. */
export function groundFor(f: Flight, desks: Record<string, AssignEntry>, gates: Record<string, AssignEntry>): RadarGround {
  const keys = new Set(keysFor(f));
  const mine = (e: AssignEntry) => !!e.flightNumber && keys.has(norm(e.flightNumber)) && (e.status === 'open' || e.status === 'closed');
  const pick = (src: Record<string, AssignEntry>) =>
    Object.entries(src).filter(([, e]) => mine(e)).map(([id, e]) => ({ id, open: e.status === 'open' }))
      .sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
  let g = pick(gates);
  let d = pick(desks);
  let planned = false;
  if (!g.length && !d.length) {
    planned = true;
    const pg = f.GateNumbers?.length ? f.GateNumbers : splitIds(f.GateNumber);
    const pd = f.CheckInDesks?.length ? f.CheckInDesks : splitIds(f.CheckInDesk);
    g = pg.map((id) => ({ id: String(id), open: false }));
    d = pd.map((id) => ({ id: String(id), open: false }));
  }
  return { gates: g, desks: d, belt: (f.BaggageReclaim ?? '').trim(), planned };
}

/** Mapa normalizovan broj leta → zemlja, za sve neobrađene letove. */
export function buildGroundMap(arrivals: readonly Flight[], departures: readonly Flight[], desks: Record<string, AssignEntry>, gates: Record<string, AssignEntry>): Record<string, RadarGround> {
  const out: Record<string, RadarGround> = {};
  for (const f of [...arrivals, ...departures]) {
    if (isDone(f)) continue;
    const k = norm(f.FlightNumber);
    if (k && !out[k]) out[k] = groundFor(f, desks, gates);
  }
  return out;
}
