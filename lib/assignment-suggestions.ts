// lib/assignment-suggestions.ts
//
// NOVO (2026-10-07, po zahtjevu — "AI sugestija" card na assign-checkin
// stranici, FAZA 1): ČISTA funkcija (bez React-a, bez mreže, bez Date.now)
// koja iz današnjih letova i trenutnih dodjela predlaže koje šaltere/gate-ove
// otvoriti za koji let i u kojem vremenskom intervalu.
//
// NAMJERNO BEZ LLM-a: raspoređivanje je problem preklapanja vremenskih
// intervala — običan algoritam ga rješava tačno, trenutno, besplatno i uz
// automatske testove (lib/assignment-suggestions.test.ts). Naslov card-a
// ipak kaže "AI sugestija" (po zahtjevu); AI sloj (slobodan tekst → pravila)
// se može dodati kasnije bez promjene ovog modula.
//
// POSTUPAK (greedy po vremenu otvaranja):
//   1. Svaki let dobija "profil" kompanije (koliko šaltera, koji šalteri i
//      gate-ovi su uobičajeni) — vidi AIRLINE_PROFILES ispod (JEDINO mjesto
//      koje treba mijenjati kad se navike promijene).
//   2. Letovi se obrađuju redom po vremenu otvaranja check-in-a.
//   3. Za svaki let: prvo uobičajeni šalteri te kompanije koji su SLOBODNI u
//      tom intervalu (uz pauzu), pa najbliži slobodni susjedi, pa bilo koji.
//   4. Ručne/postojeće dodjele se NIKAD ne mijenjaju — samo zauzimaju svoj
//      interval. Let koji već ima dodjelu se preskače.
//
// SEZONA I UČENJE (2026-10-08):
//   - Ljeti (1.6.–1.10.) Sundor/El Al i Israir su uobičajeno u Terminalu 2
//     (šalteri 21–26, gate-ovi 21–31); van sezone ostaju T1 profili.
//   - British Airways: uvijek 3 šaltera iz opsega 7–12.
//   - Ako postoji NAUČEN šablon (lib/assignment-learning.ts) sa dovoljno
//     uzoraka, on ima prednost nad ručnim profilom: prvo po broju leta, pa po
//     kompaniji. Bez dovoljno uzoraka važi ručni profil.
//
// PRETPOSTAVKE (ispravljive konstantama ispod — provjeriti sa osobljem):
//   - gate je zauzet od GATE_OPEN_BEFORE_MIN prije polaska do polaska;
//   - check-in se zatvara CHECKIN_CLOSE_BEFORE_MIN prije polaska
//     (isto kao minCloseBeforeDeparture u lib/check-in-service.ts);
//   - jedan gate po letu.

import {
  learnedPool, learnedDeskCount, learnedFallback,
  type LearnedIndex, type LearnedPool, type Season, type AccuracySource,
} from '@/lib/assignment-learning';
import type { SuggestionConstraints } from '@/lib/suggestion-constraints';

export const DESKS = [
  ...Array.from({ length: 12 }, (_, i) => String(i + 1)),
  '21', '22', '23', '24', '25', '26',
];
export const GATES = ['2', '3', '4', '5', '6', '21', '22', '23', '24', '25', '26', '27', '28', '29', '30', '31'];

/** Zadana pauza (min) između dva leta na istom šalteru/gate-u. Do 5 min. */
export const DEFAULT_TURNOVER_MIN = 5;
/** Check-in se zatvara ovoliko minuta prije polaska. */
export const CHECKIN_CLOSE_BEFORE_MIN = 30;
/** Gate je zauzet ovoliko minuta prije polaska (boarding prozor). */
export const GATE_OPEN_BEFORE_MIN = 30;
/** Zadano otvaranje check-in-a ako kompanija nije u settings.ini. */
export const DEFAULT_CHECKIN_OPEN_MIN = 120;

// ── Profili kompanija ───────────────────────────────────────────────────
export interface AirlineProfile {
  id: string;
  label: string;
  /** Koliko šaltera tražiti za let. */
  deskCount: number;
  /** Uobičajeni šalteri (redoslijed = prioritet). */
  deskPool: string[];
  /** Uobičajeni gate-ovi (redoslijed = prioritet). */
  gatePool: string[];
}

export const AIRLINE_PROFILES: AirlineProfile[] = [
  { id: 'sundor-elal', label: 'Sundor / El Al', deskCount: 3, deskPool: ['10', '11', '12'], gatePool: ['5', '6'] },
  { id: 'turkish',     label: 'Turkish',        deskCount: 3, deskPool: ['10', '11', '12'], gatePool: ['5', '6'] },
  // ISRAIR: 3 šaltera; uobičajeni šalteri nisu navedeni → isti kao Sundor/El Al.
  // Gate: nije navedeno → opšti raspored.
  { id: 'israir',      label: 'Israir',         deskCount: 3, deskPool: ['10', '11', '12'], gatePool: [] },
  { id: 'easyjet',     label: 'easyJet',        deskCount: 3, deskPool: ['1', '2', '3', '4'], gatePool: ['5', '6'] },
  // British Airways: UVIJEK 3 šaltera u rasponu 7–12.
  { id: 'british-airways', label: 'British Airways', deskCount: 3, deskPool: ['7', '8', '9', '10', '11', '12'], gatePool: [] },
  { id: 'norwegian',   label: 'Norwegian',      deskCount: 2, deskPool: [], gatePool: ['5', '6'] },
  { id: 'air-serbia',  label: 'Air Serbia',     deskCount: 2, deskPool: ['4', '5', '6'], gatePool: ['2', '3', '4'] },
  // Air Montenegro: uobičajeni 4,5,6,7; broj šaltera po letu = 2 (generalno 2).
  { id: 'air-montenegro', label: 'Air Montenegro', deskCount: 2, deskPool: ['4', '5', '6', '7'], gatePool: ['2', '3', '4'] },
];

/** Ljeti (1.6.–1.10.) ove kompanije su uobičajeno u Terminalu 2. */
const SUMMER_T2_PROFILE_IDS = ['sundor-elal', 'israir'];
const T2_DESKS = ['21', '22', '23', '24', '25', '26'];
const T2_GATES = ['21', '22', '23', '24', '25', '26', '27', '28', '29', '30', '31'];

/** Opšti profil — kompanije koje nemaju poseban profil. */
export const DEFAULT_PROFILE: AirlineProfile = {
  id: 'default', label: 'Opšti raspored', deskCount: 2, deskPool: [], gatePool: [],
};

/** Odredišta koja uvijek idu na JEDAN šalter (Air Serbia → Kraljevo). */
const SINGLE_DESK_DESTINATIONS: Record<string, string[]> = {
  'air-serbia': ['KVO'],
};

// ── Tipovi ──────────────────────────────────────────────────────────────
export interface SuggestionFlight {
  FlightNumber: string;
  AirlineCode?: string;
  AirlineICAO?: string;
  AirlineName?: string;
  DestinationAirportCode?: string;
  DestinationCityName?: string;
  ScheduledDepartureTime?: string;
  EstimatedDepartureTime?: string;
  StatusEN?: string;
}

export interface SuggestionInput {
  flights: SuggestionFlight[];
  /** Trenutne dodjele: id resursa → broj leta (samo status 'open'). */
  currentDesks: Record<string, string>;
  currentGates: Record<string, string>;
  /** Trenutno vrijeme, minuta od ponoći (lokalno, Podgorica). */
  nowMin: number;
  /** Minuta prije polaska kad se check-in otvara, po IATA kodu kompanije; 'default' = zadano. */
  openLeadByIata?: Record<string, number>;
  turnoverMin?: number;
  /** Ljetni period (1.6.–1.10.) — utiče na profile (Sundor/El Al/Israir → T2) i na sezonu učenja. */
  summer?: boolean;
  /** Naučeni brojači iz prošlih ručnih dodjela (lib/assignment-learning.ts → parseLearned). */
  learned?: LearnedIndex;
  /** Dan u sedmici (0=nedjelja…6=subota) — uključuje brojače po danu. */
  dow?: number;
  /** Ograničenja iz slobodnog teksta (LLM sloj, već sanitizirana). */
  constraints?: SuggestionConstraints;
}

export interface Suggestion {
  type: 'desk' | 'gate';
  flightNumber: string;
  airlineLabel: string;
  destination: string;
  /** Planirano vrijeme polaska "HH:MM". */
  std: string;
  /** Predloženi resursi (id-jevi). */
  resources: string[];
  /** Predloženo vrijeme otvaranja / zatvaranja (minuta od ponoći; može biti >= 1440 za poslije ponoći). */
  openAt: number;
  closeAt: number;
  /** Odakle prijedlog: naučeno / ručni profil / opšti raspored / napomena osoblja. */
  source: AccuracySource;
  /** Uobičajeni bazen koji je korišćen (za učenje zamjena: šta je bilo "prvi izbor"). */
  pool: string[];
  /** Kratko objašnjenje (zašto baš ti resursi). */
  reason: string;
  /** Upozorenja za osoblje (npr. nema dovoljno slobodnih šaltera). */
  warnings: string[];
}

export interface SuggestionResult {
  desks: Suggestion[];
  gates: Suggestion[];
}

// ── Vrijeme ─────────────────────────────────────────────────────────────
export function parseClockMinutes(str: string | null | undefined): number | null {
  if (!str) return null;
  const m = str.trim().match(/^(\d{1,2})[:.](\d{2})/);
  if (!m) return null;
  const h = +m[1], min = +m[2];
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

export function formatClockMinutes(totalMin: number): string {
  const m = ((Math.round(totalMin) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** Let poslije ponoći dok je sad prije ponoći → +1440 (isti obrazac kao isUrgentFlight). */
function toAbsolute(minOfDay: number, nowMin: number): number {
  return minOfDay - nowMin < -720 ? minOfDay + 1440 : minOfDay;
}

// ── Profil kompanije ────────────────────────────────────────────────────
function norm(s: string | undefined): string {
  return (s || '').toLowerCase().replace(/[\s\-']+/g, '');
}

function prefixIs(fn: string, codes: string[]): boolean {
  const f = fn.toUpperCase();
  return codes.some(c => f.startsWith(c) && /\d/.test(f.charAt(c.length)));
}

export function getAirlineProfile(f: SuggestionFlight, summer = false): AirlineProfile {
  const name = norm(f.AirlineName);
  const code = (f.AirlineCode || '').toUpperCase();
  const icao = (f.AirlineICAO || '').toUpperCase();
  const fn = f.FlightNumber || '';
  const is = (names: string[], codes: string[], icaos: string[] = []) =>
    names.some(n => name.includes(n)) ||
    codes.includes(code) || icaos.includes(icao) || prefixIs(fn, codes);

  const id =
    is(['sundor', 'elal'], ['LY'], ['ELY', 'SDR']) ? 'sundor-elal'
    : is(['turkish'], ['TK'], ['THY']) ? 'turkish'
    : is(['israir'], ['6H'], ['ISR']) ? 'israir'
    : is(['easyjet'], ['U2', 'EC', 'DS'], ['EZY', 'EJU', 'EZS']) ? 'easyjet'
    : is(['britishairways'], ['BA'], ['BAW']) ? 'british-airways'
    : is(['norwegian'], ['DY', 'D8'], ['NAX', 'NOZ', 'IBK']) ? 'norwegian'
    : is(['airserbia'], ['JU'], ['ASL']) ? 'air-serbia'
    : is(['airmontenegro'], ['4O'], ['MNE']) ? 'air-montenegro'
    : null;

  const profile = AIRLINE_PROFILES.find(p => p.id === id) ?? DEFAULT_PROFILE;
  if (summer && SUMMER_T2_PROFILE_IDS.includes(profile.id)) {
    return { ...profile, deskPool: T2_DESKS, gatePool: T2_GATES };
  }
  return profile;
}

// ── Zauzetost ───────────────────────────────────────────────────────────
interface Interval { start: number; end: number }

function conflicts(a: Interval, b: Interval, buf: number): boolean {
  return a.start < b.end + buf && b.start < a.end + buf;
}

function isFree(busy: Interval[] | undefined, iv: Interval, buf: number): boolean {
  return !busy || !busy.some(b => conflicts(iv, b, buf));
}

function pickResources(
  count: number,
  pool: string[],
  universe: string[],
  busy: Map<string, Interval[]>,
  iv: Interval,
  buf: number,
  fallback: Record<string, Record<string, number>> = {},
): { picked: string[]; fromPool: number; fromFallback: number } {
  const free = (id: string) => isFree(busy.get(id), iv, buf);
  const poolIds = pool.filter(id => universe.includes(id));
  let picked: string[] = [];

  // 1) Najbolji SUSJEDNI blok od `count` slobodnih iz bazena (npr. 10,11,12 umjesto 10,12,21).
  //    Ocjena bloka = zbir prioriteta (raniji u bazenu = veći prioritet).
  if (count > 1 && poolIds.length >= count) {
    const nums = [...poolIds].sort((a, b) => Number(a) - Number(b));
    let bestScore = -1;
    for (let i = 0; i + count <= nums.length; i++) {
      const block = nums.slice(i, i + count);
      const consecutive = block.every((id, k) => k === 0 || Number(id) === Number(block[k - 1]) + 1);
      if (!consecutive || !block.every(free)) continue;
      const score = block.reduce((s, id) => s + (poolIds.length - poolIds.indexOf(id)), 0);
      if (score > bestScore) { bestScore = score; picked = block; }
    }
  }
  // 2) Inače prvih `count` slobodnih iz bazena po prioritetu.
  if (picked.length === 0) picked = poolIds.filter(free).slice(0, count);
  const fromPool = picked.length;

  // 2b) NAUČENA ZAMJENA: za zauzet uobičajeni X nudi Y koji je osoblje do sad najčešće biralo.
  let fromFallback = 0;
  if (picked.length < count) {
    for (const x of poolIds) {
      if (picked.length >= count) break;
      if (free(x) || !fallback[x]) continue;
      const ys = Object.entries(fallback[x])
        .sort((a, b) => b[1] - a[1] || Number(a[0]) - Number(b[0]))
        .map(([y]) => y)
        .filter(y => universe.includes(y) && !picked.includes(y) && free(y));
      if (ys.length) { picked = [...picked, ys[0]]; fromFallback++; }
    }
  }

  // 3) Ako i dalje fali: najbliži slobodni susjedi (po broju — 12 i 21 nisu susjedi, različiti terminali).
  if (picked.length < count) {
    const rest = universe.filter(id => !picked.includes(id) && free(id));
    const anchors = (picked.length ? picked : poolIds).map(Number);
    const dist = (id: string) =>
      anchors.length ? Math.min(...anchors.map(a => Math.abs(Number(id) - a))) : universe.indexOf(id);
    rest.sort((a, b) => dist(a) - dist(b) || universe.indexOf(a) - universe.indexOf(b));
    picked = [...picked, ...rest.slice(0, count - picked.length)];
  }
  picked.sort((a, b) => universe.indexOf(a) - universe.indexOf(b));
  return { picked, fromPool, fromFallback };
}

// ── Glavna funkcija ─────────────────────────────────────────────────────
export function computeAssignmentSuggestions(input: SuggestionInput): SuggestionResult {
  const { flights, currentDesks, currentGates, nowMin } = input;
  const buf = input.turnoverMin ?? DEFAULT_TURNOVER_MIN;
  const lead = input.openLeadByIata ?? {};
  const summer = !!input.summer;
  const season: Season = summer ? 'S' : 'W';
  const learned = input.learned;

  // Pripremi izvedene vrijednosti po letu.
  interface Prep {
    f: SuggestionFlight;
    profile: AirlineProfile;
    stdAbs: number;
    effAbs: number; // kasnije od STD ako je procijenjeno vrijeme kasnije
    deskIv: Interval;
    gateIv: Interval;
    deskCount: number;
    deskPool: string[];
    gatePool: string[];
    deskSource: string; // opis izvora (profil / naučeno)
    gateSource: string;
    deskKind: AccuracySource;
    gateKind: AccuracySource;
    deskFallback: Record<string, Record<string, number>>;
    gateFallback: Record<string, Record<string, number>>;
  }
  const cons = input.constraints;
  const countOverride = new Map((cons?.counts ?? []).map(c => [c.flight.toUpperCase(), c.count]));
  const preps: Prep[] = [];
  for (const f of flights) {
    const status = (f.StatusEN || '').toLowerCase();
    if (status.includes('cancel') || status.includes('otkaz') || status.includes('departed') || status.includes('poletio')) continue;
    const stdDay = parseClockMinutes(f.ScheduledDepartureTime);
    if (stdDay === null) continue;
    const stdAbs = toAbsolute(stdDay, nowMin);
    const etdDay = parseClockMinutes(f.EstimatedDepartureTime);
    const etdAbs = etdDay === null ? stdAbs : toAbsolute(etdDay, nowMin);
    // Procjena prije planiranog (npr. -1 dan) se ignoriše; kašnjenje produžava zauzeće.
    const effAbs = etdAbs > stdAbs && etdAbs - stdAbs < 720 ? etdAbs : stdAbs;

    const profile = getAirlineProfile(f, summer);
    const iata = (f.AirlineCode || f.FlightNumber.slice(0, 2)).toUpperCase();
    const openLead = lead[iata] ?? lead['default'] ?? DEFAULT_CHECKIN_OPEN_MIN;

    // ── Broj šaltera: naučeno (let) → jedno odredište (KVO) → naučeno (kompanija) → profil.
    const single = SINGLE_DESK_DESTINATIONS[profile.id]?.includes((f.DestinationAirportCode || '').toUpperCase());
    const lc = learnedDeskCount(learned, f.FlightNumber, season);
    let deskCount = profile.deskCount;
    if (lc?.level === 'flight') deskCount = lc.count;
    else if (single) deskCount = 1;
    else if (lc) deskCount = lc.count;
    const forced = countOverride.get(f.FlightNumber.toUpperCase());
    if (forced) deskCount = forced;

    // ── Bazeni: naučeno (let ili kompanija) ima prednost nad ručnim profilom.
    const ld = learnedPool(learned, 'desk', f.FlightNumber, season, input.dow);
    const lg = learnedPool(learned, 'gate', f.FlightNumber, season, input.dow);
    const lvl = (l: LearnedPool['level']) =>
      l === 'flight-dow' ? 'po letu i danu'
      : l === 'flight' ? 'po letu'
      : l === 'airline-dow' ? 'po kompaniji i danu'
      : 'po kompaniji';

    preps.push({
      f, profile, stdAbs, effAbs,
      deskIv: { start: stdAbs - openLead, end: effAbs - CHECKIN_CLOSE_BEFORE_MIN },
      gateIv: { start: effAbs - GATE_OPEN_BEFORE_MIN, end: effAbs },
      deskCount,
      deskPool: ld ? ld.pool : profile.deskPool,
      gatePool: lg ? lg.pool : profile.gatePool,
      deskSource: ld ? `naučeno ${lvl(ld.level)}, ${ld.samples} dodjela` : profile.label,
      gateSource: lg ? `naučeno ${lvl(lg.level)}, ${lg.samples} dodjela` : profile.label,
      deskKind: ld ? 'learned' : profile.deskPool.length ? 'profile' : 'default',
      gateKind: lg ? 'learned' : profile.gatePool.length ? 'profile' : 'default',
      deskFallback: learnedFallback(learned, 'desk', f.FlightNumber, season),
      gateFallback: learnedFallback(learned, 'gate', f.FlightNumber, season),
    });
  }

  const byFlight = new Map(preps.map(p => [p.f.FlightNumber, p]));

  // Zauzetost iz POSTOJEĆIH dodjela (nikad se ne mijenjaju).
  const busyDesks = new Map<string, Interval[]>();
  const busyGates = new Map<string, Interval[]>();
  const hasDesk = new Set<string>();
  const hasGate = new Set<string>();
  const addBusy = (m: Map<string, Interval[]>, id: string, iv: Interval) => {
    const arr = m.get(id) ?? [];
    arr.push(iv);
    m.set(id, arr);
  };
  for (const [id, fn] of Object.entries(currentDesks)) {
    hasDesk.add(fn);
    const p = byFlight.get(fn);
    // Let nije poznat → zauzmi kratko od sad (ne blokiramo resurs predugo).
    addBusy(busyDesks, id, p ? { start: Math.min(p.deskIv.start, nowMin), end: p.deskIv.end } : { start: nowMin, end: nowMin + 30 });
  }
  for (const [id, fn] of Object.entries(currentGates)) {
    hasGate.add(fn);
    const p = byFlight.get(fn);
    addBusy(busyGates, id, p ? { start: Math.min(p.gateIv.start, nowMin), end: p.gateIv.end } : { start: nowMin, end: nowMin + 30 });
  }

  // Ograničenja iz teksta: resurs "ne radi" = zauzet u zadanom intervalu.
  for (const b of cons?.blocked ?? []) {
    const from = b.fromMin !== undefined ? toAbsolute(b.fromMin, nowMin) : -1e9;
    let to = b.toMin !== undefined ? toAbsolute(b.toMin, nowMin) : 1e9;
    if (b.toMin !== undefined && b.fromMin !== undefined && to <= from) to += 1440;
    addBusy(b.type === 'desk' ? busyDesks : busyGates, b.id, { start: from, end: to });
  }
  const pinFor = (type: 'desk' | 'gate', flight: string) =>
    (cons?.pins ?? []).find(p => p.type === type && p.flight.toUpperCase() === flight.toUpperCase())?.resources ?? [];

  const desks: Suggestion[] = [];
  const gates: Suggestion[] = [];
  const plural = (n: number) => `${n} šalter${n === 1 ? '' : 'a'}`;

  // ── Šalteri ────────────────────────────────────────────────────────
  const deskOrder = preps
    .filter(p => !hasDesk.has(p.f.FlightNumber))
    .sort((a, b) => a.deskIv.start - b.deskIv.start || b.deskCount - a.deskCount);

  for (const p of deskOrder) {
    // Pin iz napomene: traženi šalteri idu prvi (ako su slobodni), ostatak običnim postupkom.
    const pinned = pinFor('desk', p.f.FlightNumber)
      .filter(id => isFree(busyDesks.get(id), p.deskIv, buf)).slice(0, Math.max(p.deskCount, 1));
    const pinRequested = pinFor('desk', p.f.FlightNumber);
    for (const id of pinned) addBusy(busyDesks, id, p.deskIv);
    const need = Math.max(p.deskCount - pinned.length, 0);
    const rest = need > 0
      ? pickResources(need, p.deskPool, DESKS, busyDesks, p.deskIv, buf, p.deskFallback)
      : { picked: [] as string[], fromPool: 0, fromFallback: 0 };
    const picked = [...pinned, ...rest.picked].sort((a, b) => DESKS.indexOf(a) - DESKS.indexOf(b));
    const fromPool = rest.fromPool + pinned.length;
    const fromFallback = rest.fromFallback;
    const warnings: string[] = [];
    if (pinRequested.length && pinned.length < pinRequested.length) {
      warnings.push(`Traženi šalteri (${pinRequested.join(', ')}) nisu svi slobodni u tom intervalu.`);
    }
    if (picked.length < p.deskCount) {
      warnings.push(`Nema dovoljno slobodnih šaltera (${picked.length} od ${p.deskCount}).`);
    }
    if (p.deskPool.length && picked.length && fromPool + fromFallback < picked.length) {
      warnings.push(`Uobičajeni šalteri (${p.deskPool.join(', ')}) su zauzeti — predloženi najbliži slobodni.`);
    }
    for (const id of rest.picked) addBusy(busyDesks, id, p.deskIv);
    desks.push({
      type: 'desk',
      flightNumber: p.f.FlightNumber,
      airlineLabel: p.profile.label,
      destination: p.f.DestinationCityName || p.f.DestinationAirportCode || '',
      std: formatClockMinutes(p.stdAbs),
      resources: picked,
      source: pinned.length ? 'note' : p.deskKind,
      pool: p.deskPool,
      openAt: p.deskIv.start,
      closeAt: p.deskIv.end,
      reason: (pinned.length ? 'Po napomeni osoblja; ' : '') + (p.deskPool.length
        ? `${p.deskSource}: uobičajeno ${p.deskPool.join(', ')}; ${plural(p.deskCount)}`
        : `Opšti raspored: ${plural(p.deskCount)}`) + (fromFallback ? '; zamjena po naučenom' : ''),
      warnings,
    });
  }

  // ── Gate-ovi ───────────────────────────────────────────────────────
  const gateOrder = preps
    .filter(p => !hasGate.has(p.f.FlightNumber))
    .sort((a, b) => a.gateIv.start - b.gateIv.start);

  for (const p of gateOrder) {
    const gatePin = pinFor('gate', p.f.FlightNumber);
    const pinnedGate = gatePin.find(id => isFree(busyGates.get(id), p.gateIv, buf));
    const gr = pinnedGate
      ? { picked: [pinnedGate], fromPool: 1, fromFallback: 0 }
      : pickResources(1, p.gatePool, GATES, busyGates, p.gateIv, buf, p.gateFallback);
    const { picked, fromPool, fromFallback } = gr;
    const warnings: string[] = [];
    if (gatePin.length && !pinnedGate) warnings.push(`Traženi gate (${gatePin.join(', ')}) nije slobodan u tom intervalu.`);
    if (!picked.length) warnings.push('Nema slobodnog gate-a u tom intervalu.');
    if (p.gatePool.length && picked.length && fromPool === 0 && fromFallback === 0) {
      warnings.push(`Uobičajeni gate-ovi (${p.gatePool.join(', ')}) su zauzeti.`);
    }
    for (const id of picked) addBusy(busyGates, id, p.gateIv);
    gates.push({
      type: 'gate',
      flightNumber: p.f.FlightNumber,
      airlineLabel: p.profile.label,
      destination: p.f.DestinationCityName || p.f.DestinationAirportCode || '',
      std: formatClockMinutes(p.stdAbs),
      resources: picked,
      source: pinnedGate ? 'note' : p.gateKind,
      pool: p.gatePool,
      openAt: p.gateIv.start,
      closeAt: p.gateIv.end,
      reason: (pinnedGate ? 'Po napomeni osoblja; ' : '') + (p.gatePool.length
        ? `${p.gateSource}: uobičajeno gate ${p.gatePool.slice(0, 6).join(', ')}`
        : 'Opšti raspored') + (fromFallback ? '; zamjena po naučenom' : ''),
      warnings,
    });
  }

  return { desks, gates };
}
