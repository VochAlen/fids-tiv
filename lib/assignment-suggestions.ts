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
import type { Predictor, PredictCtx } from '@/lib/assignment-model';

export const DESKS = [
  ...Array.from({ length: 12 }, (_, i) => String(i + 1)),
  '21', '22', '23', '24', '25', '26',
];
export const GATES = ['2', '3', '4', '5', '6', '21', '22', '23', '24', '25', '26', '27', '28', '29', '30', '31'];

/** Terminal šaltera: 1–12 = T1, 21–26 = T2 (isto kao getTerminalForCombinedCheckInDesk). */
export function deskTerminal(id: string): 'T1' | 'T2' {
  return Number(id) >= 20 ? 'T2' : 'T1';
}

/** Zadana pauza (min) između dva leta na istom šalteru/gate-u. Podrazumijevano 1 min (u praksi, naročito ljeti, šalter se predaje odmah). */
export const DEFAULT_TURNOVER_MIN = 1;
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
  { id: 'easyjet',     label: 'easyJet',        deskCount: 2, deskPool: ['1', '2', '3', '4'], gatePool: ['5', '6'] },
  // British Airways: UVIJEK 3 šaltera u rasponu 7–12.
  { id: 'british-airways', label: 'British Airways', deskCount: 3, deskPool: ['7', '8', '9', '10', '11', '12'], gatePool: [] },
  { id: 'norwegian',   label: 'Norwegian',      deskCount: 2, deskPool: [], gatePool: ['5', '6'] },
  { id: 'air-serbia',  label: 'Air Serbia',     deskCount: 2, deskPool: ['4', '5', '6'], gatePool: ['2', '3', '4'] },
  // Air Montenegro: uobičajeni 4,5,6,7; broj šaltera po letu = 2 (generalno 2).
  { id: 'air-montenegro', label: 'Air Montenegro', deskCount: 2, deskPool: ['4', '5', '6', '7'], gatePool: ['2', '3', '4'] },
];

/** easyJet je obično na 2 šaltera; 3 samo kad ima dosta slobodnih (vidi EASYJET_EXTRA_*). */
export const EASYJET_EXTRA_DESK_MAX_DEMAND = 6;
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
  /** Naučeni model (lib/assignment-model.ts) — SAMO kad je aktivan (dokazano bolji od brojača). */
  model?: { desk?: Predictor | null; gate?: Predictor | null };
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
  /** Ako su neki od predloženih resursa još zauzeti: do kad (minuta od ponoći) — prijedlog se tek tada primjenjuje. */
  waitingUntil?: number;
  /** Poruke tipa "Kad se zatvori JU680 na 4, 5, 6 → otvori WK415 na 4, 5, 6 po zatvaranju JU680". */
  waitNotes: string[];
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
interface Interval { start: number; end: number; /** let koji drži resurs (za poruku "po zatvaranju X") */ flight?: string }

/** Najduže čekanje (min) da se zauzet šalter oslobodi da bi se još nudio ("po zatvaranju"). */
export const MAX_WAIT_MIN = 30;
/** Nakon čekanja check-in mora trajati bar ovoliko minuta, inače čekanje nema smisla. */
export const MIN_OPEN_WINDOW_MIN = 45;

/**
 * Dostupnost resursa za interval `iv`: slobodan odmah (wait 0), ILI zauzet drugim letom
 * koji se zatvara uskoro (wait > 0, `until` = kad se oslobađa, `by` = letovi), ILI nedostupan.
 */
function availability(
  busy: Interval[] | undefined, iv: Interval, buf: number,
): { ok: boolean; until: number; by: string[] } {
  const clash = (busy ?? []).filter(b => conflicts(iv, b, buf));
  if (clash.length === 0) return { ok: true, until: iv.start, by: [] };
  const until = Math.max(...clash.map(b => b.end + buf));
  const soon = clash.every(b => !!b.flight && b.start <= iv.start && b.end + buf <= iv.start + MAX_WAIT_MIN)
    && iv.end - until >= MIN_OPEN_WINDOW_MIN;
  return soon
    ? { ok: true, until: Math.max(until, iv.start), by: [...new Set(clash.map(b => b.flight!))] }
    : { ok: false, until: 0, by: [] };
}

function conflicts(a: Interval, b: Interval, buf: number): boolean {
  return a.start < b.end + buf && b.start < a.end + buf;
}

function isFree(busy: Interval[] | undefined, iv: Interval, buf: number): boolean {
  return !busy || !busy.some(b => conflicts(iv, b, buf));
}

/** Najduži niz uzastopnih brojeva među zadatim resursima (npr. 1,2,3,7,8 → 3). */
function longestRun(ids: string[]): number {
  const nums = ids.map(Number).sort((a, b) => a - b);
  let best = 0, cur = 0;
  nums.forEach((n, i) => { cur = i > 0 && n === nums[i - 1] + 1 ? cur + 1 : 1; best = Math.max(best, cur); });
  return best;
}

function pickResources(
  count: number,
  pool: string[],
  universe: string[],
  busy: Map<string, Interval[]>,
  iv: Interval,
  buf: number,
  fallback: Record<string, Record<string, number>> = {},
  allowWait = false,
  model?: Record<string, number>,
): { picked: string[]; fromPool: number; fromFallback: number } {
  const free = (id: string) => isFree(busy.get(id), iv, buf);
  // "Iskoristiv": slobodan odmah ili (ako je dozvoljeno) uskoro slobodan — vidi availability().
  const waitOf = (id: string) => {
    const a = availability(busy.get(id), iv, buf);
    return a.ok ? Math.max(a.until - iv.start, 0) : Infinity;
  };
  const usable = (id: string) => free(id) || (allowWait && waitOf(id) !== Infinity);
  const poolIds = pool.filter(id => universe.includes(id));
  let picked: string[] = [];

  // ── MODEL (ako je aktivan): jedan resurs = najvjerovatniji iskoristiv ──────────
  if (model && count === 1) {
    const cand = universe.filter(usable).sort((a, b) => (model[b] ?? 0) - (model[a] ?? 0));
    if (cand.length) return { picked: [cand[0]], fromPool: 1, fromFallback: 0 };
  }

  // ── VIŠE RESURSA: SAMO uzastopni brojevi (npr. 2,3,4 — nikad 1,4,12 ni 2,5) ───────
  // Traži se blok od `count` uzastopnih SLOBODNIH resursa; ako ga nema, traži se blok
  // od count−1, pa count−2 ... (makar 2 umjesto 3). Tek ako nema ni 2 uzastopna — jedan.
  // Redoslijed odluke među blokovima: model, najviše uobičajenih (bazen) / naučenih zamjena,
  // manje čekanja, bolji prioritet u bazenu, blizina uobičajenim, niži broj.
  if (count > 1) {
    const num = (id: string) => Number(id);
    const freeList = universe.filter(usable).sort((x, y) => num(x) - num(y));
    // Zamjene za ZAUZETE uobičajene: najčešće biran slobodan Y ima težinu kao uobičajeni.
    const fbTargets = new Set<string>();
    for (const x of poolIds) {
      if (free(x) || !fallback[x]) continue;
      const y = Object.entries(fallback[x])
        .sort((m, n) => n[1] - m[1] || num(m[0]) - num(n[0]))
        .map(([id]) => id)
        .find(id => universe.includes(id) && free(id));
      if (y) fbTargets.add(y);
    }
    const anchors = poolIds.map(num);
    for (let k = count; k >= 2; k--) {
      let best: { w: string[]; mp: number; pref: number; wait: number; prio: number; dist: number } | null = null;
      for (let i = 0; i + k <= freeList.length; i++) {
        const w = freeList.slice(i, i + k);
        if (!w.every((id, j) => j === 0 || num(id) === num(w[j - 1]) + 1)) continue; // samo uzastopni
        const pref = w.filter(id => poolIds.includes(id) || fbTargets.has(id)).length;
        const wait = w.reduce((sum, id) => sum + (free(id) ? 0 : waitOf(id)), 0);
        const mp = model ? w.reduce((sum, id) => sum + (model[id] ?? 0), 0) : 0;
        const prio = w.reduce((sum, id) => sum + (poolIds.includes(id) ? poolIds.indexOf(id) : poolIds.length + 1), 0);
        const dist = anchors.length ? w.reduce((sum, id) => sum + Math.min(...anchors.map(a => Math.abs(num(id) - a))), 0) : 0;
        const better = !best
          || mp > best.mp + 1e-9
          || (Math.abs(mp - best.mp) <= 1e-9 && (pref > best.pref
            || (pref === best.pref && (wait < best.wait
              || (wait === best.wait && (prio < best.prio
                || (prio === best.prio && dist < best.dist)))))));
        if (better) best = { w, mp, pref, wait, prio, dist };
      }
      if (best) {
        const w = best.w;
        return {
          picked: w,
          fromPool: model ? w.length : w.filter(id => poolIds.includes(id)).length,
          fromFallback: w.filter(id => !poolIds.includes(id) && fbTargets.has(id)).length,
        };
      }
    }
    // Nema ni 2 uzastopna slobodna → jedan resurs (običnim postupkom ispod).
    return pickResources(1, pool, universe, busy, iv, buf, fallback, allowWait, model);
  }

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
  // Nijedan uobičajeni nije slobodan odmah, ali neki se uskoro oslobađa → nudi njega ("po zatvaranju").
  if (picked.length === 0 && allowWait) {
    picked = poolIds.filter(usable).sort((a, b) => waitOf(a) - waitOf(b)).slice(0, count);
  }
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

// ── Planiranje cijelog rasporeda ────────────────────────────────────────
function cloneBusy(m: Map<string, Interval[]>): Map<string, Interval[]> {
  return new Map([...m].map(([k, v]) => [k, v.map(x => ({ ...x }))]));
}

/** Zašto uobičajeni resursi nisu slobodni: "10, 11 (TK1062); 12 (ne radi)". Prazno ako su svi slobodni. */
function busyReason(ids: string[], busy: Map<string, Interval[]>, iv: Interval, buf: number): string {
  const byHolder = new Map<string, string[]>();
  for (const id of ids) {
    const clash = (busy.get(id) ?? []).filter(b => conflicts(iv, b, buf));
    if (!clash.length) continue;
    const holder = [...new Set(clash.map(b => b.flight ?? 'ne radi / blokiran'))].join(', ');
    byHolder.set(holder, [...(byHolder.get(holder) ?? []), id]);
  }
  return [...byHolder].map(([h, list]) => `${list.join(', ')} (${h})`).join('; ');
}

/**
 * Ocjena jednog prijedloga (manje = bolje). Nedostajući resursi >> drugi terminal >> rupe u nizu
 * >> udaljenost od uobičajenih >> zamjene >> čekanje. (Bez ovoga bi pretraga redoslijeda mogla
 * "uštedjeti" na jednom letu tako što drugom pošalje šaltere iz drugog terminala ili sa rupom.)
 */
function planCost(s: Suggestion, wanted: number, winterT1 = false): number {
  const shortage = Math.max(wanted - s.resources.length, 0);
  const offPool = s.pool.length ? s.resources.filter(id => !s.pool.includes(id)).length : 0;
  // Manje šaltera od traženih je prihvatljivo (2 umjesto 3), ali bez ijednog je loše.
  let cost = shortage * 120 + (s.resources.length === 0 ? 1000 : 0) + offPool * 15 + (s.waitNotes.length ? 25 : 0) + s.warnings.length;
  if (s.type === 'desk' && s.resources.length) {
    const nums = s.resources.map(Number).sort((x, y) => x - y);
    cost += ((nums[nums.length - 1] - nums[0]) - (nums.length - 1)) * 30; // rupe u nizu
    const chosenT = deskTerminal(s.resources[0]);
    const poolT = s.pool.length ? deskTerminal(s.pool[0]) : 'T1';
    if (chosenT !== poolT) {
      // Zimi (oktobar–april) T2 obično ne radi: T2 samo kad T1 ne može (nijedan šalter = 1000 je skuplji).
      cost += winterT1 && chosenT === 'T2' ? 200 : s.pool.length ? 60 : 10;
    }
    if (s.pool.length) {
      const anchors = s.pool.map(Number);
      cost += nums.reduce((sum, n) => sum + Math.min(...anchors.map(a => Math.abs(n - a))), 0) * 2; // udaljenost
    }
  } else if (s.type === 'gate' && winterT1 && s.resources.length && deskTerminal(s.resources[0]) === 'T2') {
    cost += 50;
  }
  return cost;
}

/** Najveći broj probnih planova (svaki je jeftin — par stotina izbora resursa). */
const MAX_PLAN_EVALS = 80;
/** Koliko mjesta unaprijed se razmjenjuje redoslijed (letovi blizu u vremenu). */
const SWAP_REACH = 4;

/**
 * Pohlepni plan zavisi od REDOSLIJEDA letova. Počinje se redom po vremenu otvaranja, a zatim
 * se probaju zamjene susjednih letova; zadržava se samo ona koja strogo smanjuje ukupnu cijenu.
 * Rezultat se vraća u izvornom (vremenskom) redoslijedu da prikaz ostane stabilan.
 */
export function optimizeOrder<T>(
  base: T[],
  plan: (order: T[]) => { items: Suggestion[]; cost: number },
  keyOf: (t: T) => string,
): Suggestion[] {
  let order = [...base];
  let best = plan(order);
  let evals = 1;
  let improved = best.cost > 0;
  while (improved && evals < MAX_PLAN_EVALS) {
    improved = false;
    for (let i = 0; i < order.length && evals < MAX_PLAN_EVALS; i++) {
      for (let j = i + 1; j < Math.min(order.length, i + 1 + SWAP_REACH) && evals < MAX_PLAN_EVALS; j++) {
        const cand = [...order];
        [cand[i], cand[j]] = [cand[j], cand[i]];
        const r = plan(cand);
        evals++;
        if (r.cost < best.cost - 1e-9) { order = cand; best = r; improved = true; }
      }
    }
  }
  const idx = new Map(base.map((t, i) => [keyOf(t), i]));
  return [...best.items].sort((a, b) => (idx.get(a.flightNumber) ?? 0) - (idx.get(b.flightNumber) ?? 0));
}

function modelReason(model: Predictor, ctx: PredictCtx, picked: string[]): string {
  const why = model.explain?.(ctx, picked);
  return why ? `Model (jer: ${why}); ` : 'Model (naučen iz ručnih dodjela); ';
}

// ── Glavna funkcija ──
export function computeAssignmentSuggestions(input: SuggestionInput): SuggestionResult {
  const { flights, currentDesks, currentGates, nowMin } = input;
  const buf = input.turnoverMin ?? DEFAULT_TURNOVER_MIN;
  const lead = input.openLeadByIata ?? {};
  const summer = !!input.summer;
  const season: Season = summer ? 'S' : 'W';
  const learned = input.learned;
  /** Oktobar–april: T2 obično ne radi → prvenstveno T1 (osim kad T1 ne može ili osoblje napiše "T2 radi"). */
  const winterT1 = !summer && !input.constraints?.t2;

  // Pripremi izvedene vrijednosti po letu.
  interface Prep {
    f: SuggestionFlight;
    profile: AirlineProfile;
    stdAbs: number;
    effAbs: number; // kasnije od STD ako je procijenjeno vrijeme kasnije
    deskIv: Interval;
    gateIv: Interval;
    deskCount: number;
    /** Broj šaltera je određen naučeno/napomenom (ne mijenja se pravilom). */
    deskCountFixed: boolean;
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
    // settings.ini [checkin]: ključ je IATA kod. Prvo kod iz podatka o letu, pa prefiks broja leta
    // (AirlineCode može biti drugačiji, npr. troslovni), pa 'default', pa 120.
    const iata = (f.AirlineCode || f.FlightNumber.slice(0, 2)).toUpperCase();
    const prefix = f.FlightNumber.slice(0, 2).toUpperCase();
    const openLead = lead[iata] ?? lead[prefix] ?? lead['default'] ?? DEFAULT_CHECKIN_OPEN_MIN;

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
      deskCountFixed: !!lc || !!forced || !!single,
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

  // easyJet: standardno 2 šaltera; 3 samo kad je malo istovremenih letova (ima dosta slobodnih).
  // Naučen broj (iz ručnih dodjela) i napomena osoblja imaju prednost i ne diraju se.
  const baseCount = new Map(preps.map(p => [p.f.FlightNumber, p.deskCount]));
  for (const p of preps) {
    if (p.profile.id !== 'easyjet' || p.deskCountFixed) continue;
    const demand = preps
      .filter(o => o !== p && o.deskIv.start < p.deskIv.end && p.deskIv.start < o.deskIv.end)
      .reduce((sum, o) => sum + (baseCount.get(o.f.FlightNumber) ?? 2), 0);
    if (demand <= EASYJET_EXTRA_DESK_MAX_DEMAND) p.deskCount = 3;
  }

  const byFlight = new Map(preps.map(p => [p.f.FlightNumber, p]));
  const deskCountOf = new Map(preps.map(p => [p.f.FlightNumber, p.deskCount]));

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
    addBusy(busyDesks, id, p ? { start: Math.min(p.deskIv.start, nowMin), end: p.deskIv.end, flight: fn } : { start: nowMin, end: nowMin + 30, flight: fn });
  }
  for (const [id, fn] of Object.entries(currentGates)) {
    hasGate.add(fn);
    const p = byFlight.get(fn);
    addBusy(busyGates, id, p ? { start: Math.min(p.gateIv.start, nowMin), end: p.gateIv.end, flight: fn } : { start: nowMin, end: nowMin + 30, flight: fn });
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
    // Check-in je završen po RASPOREDU (STD − 30 min) → ne nudi se, čak ni ako let kasni u poletanju.
    .filter(p => p.stdAbs - CHECKIN_CLOSE_BEFORE_MIN > nowMin)
    .sort((a, b) => a.deskIv.start - b.deskIv.start || b.deskCount - a.deskCount);

  /** Jedan prolaz planiranja šaltera zadatim REDOSLIJEDOM letova (na kopiji zauzetosti). */
  const planDesks = (order: Prep[]): { items: Suggestion[]; cost: number } => {
    const bd = cloneBusy(busyDesks);
    const items: Suggestion[] = [];
    for (const p of order) {
      // Pin iz napomene: traženi šalteri idu prvi (ako su slobodni), ostatak običnim postupkom.
      const pinned = pinFor('desk', p.f.FlightNumber)
        .filter(id => isFree(bd.get(id), p.deskIv, buf)).slice(0, Math.max(p.deskCount, 1));
      const pinRequested = pinFor('desk', p.f.FlightNumber);
      for (const id of pinned) addBusy(bd, id, { ...p.deskIv, flight: p.f.FlightNumber });
      const need = Math.max(p.deskCount - pinned.length, 0);
      // ISTI TERMINAL: svi šalteri jednog leta moraju biti u istom terminalu (nikad 7 + 21).
      // Terminal bira: pin (ako ga ima) → inače onaj u kojem se može dobiti najviše traženih
      // slobodnih šaltera → pa onaj u kojem su uobičajeni šalteri leta.
      const freeDesk = (id: string) => availability(bd.get(id), p.deskIv, buf).ok;
      // Model (samo ako je aktivan): vjerovatnoće po šalteru za ovaj let, uz već otvorene šaltere tog leta.
      const deskCtx: PredictCtx | null = input.model?.desk && input.dow !== undefined
        ? {
            flight: p.f.FlightNumber, dow: input.dow,
            chosenSoFar: Object.entries(currentDesks).filter(([, fn]) => fn === p.f.FlightNumber).map(([id]) => id),
            minute: ((p.deskIv.start % 1440) + 1440) % 1440,
            busyCount: DESKS.filter(id => (bd.get(id) ?? []).some(b => b.start <= p.deskIv.start && p.deskIv.start < b.end)).length,
          }
        : null;
      const deskModel = deskCtx ? input.model!.desk!(deskCtx) : undefined;
      const terminals: Array<'T1' | 'T2'> = ['T1', 'T2'];
      const firstPoolTerminal = p.deskPool.length ? deskTerminal(p.deskPool[0]) : 'T1';
      const t1Run = longestRun(DESKS.filter(id => deskTerminal(id) === 'T1' && freeDesk(id)));
      const preferT1 = winterT1 && need > 0 && t1Run >= Math.min(need, 2) && (!p.deskPool.length || firstPoolTerminal === 'T1');
      const terminal: 'T1' | 'T2' = pinned.length
        ? deskTerminal(pinned[0])
        : preferT1 ? 'T1'
        : [...terminals].sort((a, b) => {
            const score = (t: 'T1' | 'T2') => ({
              fit: Math.min(need, longestRun(DESKS.filter(id => deskTerminal(id) === t && freeDesk(id)))),
              mass: deskModel ? DESKS.filter(id => deskTerminal(id) === t && freeDesk(id)).reduce((s, id) => s + (deskModel[id] ?? 0), 0) : 0,
              pool: p.deskPool.filter(id => deskTerminal(id) === t && freeDesk(id)).length,
              first: t === firstPoolTerminal ? 1 : 0,
            });
            const sa = score(a), sb = score(b);
            return sb.fit - sa.fit || sb.mass - sa.mass || sb.pool - sa.pool || sb.first - sa.first;
          })[0];
      const inTerminal = (id: string) => deskTerminal(id) === terminal;
      const termFallback: Record<string, Record<string, number>> = {};
      for (const [x, ys] of Object.entries(p.deskFallback)) {
        if (!inTerminal(x)) continue;
        const kept = Object.fromEntries(Object.entries(ys).filter(([y]) => inTerminal(y)));
        if (Object.keys(kept).length) termFallback[x] = kept;
      }
      const rest = need > 0
        ? pickResources(need, p.deskPool.filter(inTerminal), DESKS.filter(inTerminal), bd, p.deskIv, buf, termFallback, true, deskModel)
        : { picked: [] as string[], fromPool: 0, fromFallback: 0 };
      const picked = [...pinned, ...rest.picked].sort((a, b) => DESKS.indexOf(a) - DESKS.indexOf(b));
      const fromPool = rest.fromPool + pinned.length;
      const fromFallback = rest.fromFallback;
      const warnings: string[] = [];
      if (pinRequested.length && pinned.length < pinRequested.length) {
        warnings.push(`Traženi šalteri (${pinRequested.join(', ')}) nisu svi slobodni u tom intervalu.`);
      }
      if (picked.length < p.deskCount) {
        warnings.push(`Nema dovoljno uzastopnih slobodnih šaltera (${picked.length} od ${p.deskCount}) — predloženo koliko ih je moguće u nizu.`);
      }
      if (p.deskPool.length && picked.length && fromPool + fromFallback < picked.length) {
        // Samo ono što STVARNO nije slobodno (a ne cijeli bazen) i ko ga drži.
        const why = busyReason(p.deskPool.filter(id => !picked.includes(id)), bd, p.deskIv, buf);
        if (why) warnings.push(`Uobičajeni šalteri nisu slobodni: ${why} — predložen najbliži blok bez rupa.`);
      }
      // "Po zatvaranju": predloženi šalteri koji su još zauzeti letom što se uskoro zatvara.
      const waitGroups = new Map<string, { by: string[]; ids: string[]; until: number }>();
      let waitingUntil: number | undefined;
      for (const id of picked) {
        const a = availability(bd.get(id), p.deskIv, buf);
        if (!a.ok || a.by.length === 0) continue;
        const key = a.by.join('+');
        const g = waitGroups.get(key) ?? { by: a.by, ids: [], until: 0 };
        g.ids.push(id); g.until = Math.max(g.until, a.until);
        waitGroups.set(key, g);
        waitingUntil = Math.max(waitingUntil ?? 0, a.until);
      }
      const waitNotes = [...waitGroups.values()].map(g =>
        `Kad se zatvori ${g.by.join(', ')} na ${g.ids.join(', ')} (oko ${formatClockMinutes(g.until)}) → otvori ${p.f.FlightNumber} na ${g.ids.join(', ')} po zatvaranju ${g.by.join(', ')}.`);
      const openAt = Math.max(p.deskIv.start, waitingUntil ?? p.deskIv.start);
      for (const id of rest.picked) addBusy(bd, id, { start: openAt, end: p.deskIv.end, flight: p.f.FlightNumber });
      items.push({
        type: 'desk',
        flightNumber: p.f.FlightNumber,
        airlineLabel: p.profile.label,
        destination: p.f.DestinationCityName || p.f.DestinationAirportCode || '',
        std: formatClockMinutes(p.stdAbs),
        resources: picked,
        source: pinned.length ? 'note' : deskModel ? 'model' : p.deskKind,
        pool: p.deskPool,
        openAt,
        closeAt: p.deskIv.end,
        waitingUntil,
        waitNotes,
        reason: (pinned.length ? 'Po napomeni osoblja; ' : deskModel ? modelReason(input.model!.desk!, deskCtx!, picked) : '') + (p.deskPool.length
          ? `${p.deskSource}: uobičajeno ${p.deskPool.join(', ')}; ${plural(p.deskCount)}`
          : `Opšti raspored: ${plural(p.deskCount)}`) + (fromFallback ? '; zamjena po naučenom' : ''),
        warnings,
      });
    }
    return { items, cost: items.reduce((c, it) => c + planCost(it, deskCountOf.get(it.flightNumber) ?? 1, winterT1), 0) };
  };
  const deskPlan = optimizeOrder(deskOrder, planDesks, f => f.f.FlightNumber);
  desks.push(...deskPlan);

  // Gate ide u ISTI terminal kao šalteri tog leta (putnici se ne vode iz T2 u gate u T1).
  const deskTermOf = new Map<string, 'T1' | 'T2'>();
  for (const [id, fn] of Object.entries(currentDesks)) deskTermOf.set(fn, deskTerminal(id));
  for (const it of desks) if (it.resources.length) deskTermOf.set(it.flightNumber, deskTerminal(it.resources[0]));

  // ── Gate-ovi ───────────────────────────────────────────────────────
  const gateOrder = preps
    .filter(p => !hasGate.has(p.f.FlightNumber))
    // Let je (po rasporedu/procjeni) već otišao → gate se ne nudi.
    .filter(p => p.effAbs > nowMin)
    .sort((a, b) => a.gateIv.start - b.gateIv.start);

  const planGates = (order: Prep[]): { items: Suggestion[]; cost: number } => {
    const bg = cloneBusy(busyGates);
    const items: Suggestion[] = [];
    for (const p of order) {
      const gatePin = pinFor('gate', p.f.FlightNumber);
      const gateCtx: PredictCtx | null = input.model?.gate && input.dow !== undefined
        ? {
            flight: p.f.FlightNumber, dow: input.dow,
            chosenSoFar: Object.entries(currentGates).filter(([, fn]) => fn === p.f.FlightNumber).map(([id]) => id),
            minute: ((p.gateIv.start % 1440) + 1440) % 1440,
            busyCount: GATES.filter(id => (bg.get(id) ?? []).some(b => b.start <= p.gateIv.start && p.gateIv.start < b.end)).length,
          }
        : null;
      const gateModel = gateCtx ? input.model!.gate!(gateCtx) : undefined;
      const pinnedGate = gatePin.find(id => isFree(bg.get(id), p.gateIv, buf));
      const deskT = deskTermOf.get(p.f.FlightNumber);
      // Bez šaltera leta: zimi prvo T1 gate-ovi (osim kad je uobičajeni gate leta u T2).
      let wantT: 'T1' | 'T2' | undefined = deskT ?? (winterT1 ? 'T1' : undefined);
      // Uobičajeni (profil/naučeni) gate-ovi leta su u drugom terminalu → poštuj naviku osoblja.
      if (wantT && p.gatePool.length && deskTerminal(p.gatePool[0]) !== wantT) wantT = undefined;
      const inT = (id: string) => !wantT || deskTerminal(id) === wantT;
      let gr = pinnedGate
        ? { picked: [pinnedGate], fromPool: 1, fromFallback: 0 }
        : pickResources(1, p.gatePool.filter(inT), GATES.filter(inT), bg, p.gateIv, buf, p.gateFallback, false, gateModel);
      let otherTerminal = false;
      if (!pinnedGate && wantT && !gr.picked.length) {
        gr = pickResources(1, p.gatePool, GATES, bg, p.gateIv, buf, p.gateFallback, false, gateModel);
        otherTerminal = gr.picked.length > 0 && !!deskT;
      }
      const { picked, fromPool, fromFallback } = gr;
      const warnings: string[] = [];
      if (gatePin.length && !pinnedGate) warnings.push(`Traženi gate (${gatePin.join(', ')}) nije slobodan u tom intervalu.`);
      if (!picked.length) warnings.push('Nema slobodnog gate-a u tom intervalu.');
      if (otherTerminal) warnings.push(`Nema slobodnog gate-a u ${deskT} (gdje su šalteri) — predložen gate u drugom terminalu.`);
      if (p.gatePool.length && picked.length && fromPool === 0 && fromFallback === 0) {
        const why = busyReason(p.gatePool, bg, p.gateIv, buf);
        if (why) warnings.push(`Uobičajeni gate-ovi nisu slobodni: ${why}.`);
      }
      for (const id of picked) addBusy(bg, id, { ...p.gateIv, flight: p.f.FlightNumber });
      items.push({
        type: 'gate',
        flightNumber: p.f.FlightNumber,
        airlineLabel: p.profile.label,
        destination: p.f.DestinationCityName || p.f.DestinationAirportCode || '',
        std: formatClockMinutes(p.stdAbs),
        resources: picked,
        source: pinnedGate ? 'note' : gateModel ? 'model' : p.gateKind,
        pool: p.gatePool,
        waitNotes: [],
        openAt: p.gateIv.start,
        closeAt: p.gateIv.end,
        reason: (pinnedGate ? 'Po napomeni osoblja; ' : gateModel ? modelReason(input.model!.gate!, gateCtx!, picked) : '') + (p.gatePool.length
          ? `${p.gateSource}: uobičajeno gate ${p.gatePool.slice(0, 6).join(', ')}`
          : 'Opšti raspored') + (fromFallback ? '; zamjena po naučenom' : ''),
        warnings,
      });
    }
    return { items, cost: items.reduce((c, it) => c + planCost(it, 1, winterT1), 0) };
  };
  gates.push(...optimizeOrder(gateOrder, planGates, f => f.f.FlightNumber));

  return { desks, gates };
}
