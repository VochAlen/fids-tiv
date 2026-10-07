// lib/assignment-learning.ts
//
// NOVO (2026-10-08, po zahtjevu — "sistem uči iz dodjela"): ČISTA logika
// (bez Redis-a, bez React-a) za učenje šablona dodjele šaltera/gate-ova.
// Dijele je server (upis brojača, lib/assignment-learning-server.ts) i
// klijent/algoritam sugestija (čitanje, lib/assignment-suggestions.ts).
//
// KAKO RADI — običan BROJAČ, bez AI-ja i bez dodatnih poziva:
//   • Kad osoblje RUČNO otvori šalter/gate za let, server uveća brojače:
//       - "kompanija X je bila na resursu R" (po kompaniji),
//       - "let X123 je bio na resursu R" (po broju leta),
//       - za šaltere i "let je sad imao N otvorenih šaltera" (za broj šaltera).
//   • Sve se čuva u JEDNOM Redis hash-u (jedan HGETALL za čitanje).
//   • Brojači su odvojeni po SEZONI (S = 1.6.–1.10., W = ostalo), jer se
//     navike mijenjaju (npr. Sundor ljeti u T2, zimi u T1).
//   • Šablon se koristi tek kad ima dovoljno uzoraka (prag), prvo po broju
//     leta, pa po kompaniji; inače važi ručni profil.
//   • Prijedlozi koje je sistem sam napravio ("Primijeni") se NE uče — da ne
//     uči iz vlastitih prijedloga i ne učvrsti greške.
//   • DAN U SEDMICI (dow, 0=nedjelja…6=subota): uz opšte brojače čuvaju se i
//     brojači po danu; koriste se kad imaju dovoljno uzoraka (let+dan → let →
//     kompanija+dan → kompanija).
//   • NAUČENA ZAMJENA: kad je uobičajeni resurs X bio zauzet pa je osoblje
//     RUČNO izabralo Y, bilježi se par "X>Y"; sljedeći put algoritam prvo
//     nudi Y.
//   • TAČNOST: za svaku ručnu dodjelu bilježi se da li je prijedlog pogodio
//     (hit), promašio (miss) ili ga nije bilo (none); primijenjeni prijedlozi
//     (applied) se broje zasebno — po izvoru prijedloga i ISO sedmici.
//   • Stari podaci slabe: kad brojač jednog resursa pređe DECAY_LIMIT, svi
//     brojači tog opsega se prepolove (rijetko, jeftino).

export type Season = 'S' | 'W';
export type LearnKind = 'desk' | 'gate';

/** Redis hash u kojem su svi brojači. */
export const LEARN_HASH_KEY = 'ably-fids:learn:v1';

/** Minimalan broj uzoraka (dodjela) prije nego što se šablon po letu koristi. */
export const MIN_FLIGHT_SAMPLES = 3;
/** Minimalan broj uzoraka prije nego što se šablon po kompaniji koristi. */
export const MIN_AIRLINE_SAMPLES = 6;
/** Minimalan broj letova (brojač n=1) prije nego što se broj šaltera uči. */
export const MIN_COUNT_FLIGHTS = 4;
/** Resurs ulazi u šablon ako ima bar ovaj udio uzoraka. */
export const MIN_SHARE = 0.15;
/** Kad jedan brojač pređe ovo, opseg se prepolovi (slabljenje starih podataka). */
export const DECAY_LIMIT = 60;

// ── Sezona ──────────────────────────────────────────────────────────────
/** Ljetni period: 1. jun – 1. oktobar (uključivo). `dateISO` = "YYYY-MM-DD". */
export function seasonFromDate(dateISO: string): Season {
  const m = dateISO.match(/^\d{4}-(\d{2})-(\d{2})$/);
  if (!m) return 'W';
  const mm = +m[1], dd = +m[2];
  if (mm >= 6 && mm <= 9) return 'S';
  if (mm === 10 && dd <= 1) return 'S';
  return 'W';
}

/** Dan u sedmici za "YYYY-MM-DD": 0 = nedjelja … 6 = subota. */
export function dowFromDate(dateISO: string): number {
  const m = dateISO.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return 0;
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).getUTCDay();
}

/** ISO sedmica "YYYY-Www" za "YYYY-MM-DD". */
export function isoWeekKey(dateISO: string): string {
  const m = dateISO.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return '0000-W00';
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  const day = d.getUTCDay() || 7;           // pon=1 … ned=7
  d.setUTCDate(d.getUTCDate() + 4 - day);   // četvrtak te sedmice
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((d.getTime() - yearStart) / 86_400_000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/** Ključevi zadnjih `n` sedmica (uključujući tekuću) računato od datuma. */
export function recentWeekKeys(dateISO: string, n: number): string[] {
  const m = dateISO.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return [];
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3] - 7 * i));
    out.push(isoWeekKey(d.toISOString().slice(0, 10)));
  }
  return out;
}

// ── Ključevi ────────────────────────────────────────────────────────────
/** Šifra kompanije iz broja leta: "U28812" → "U2", "JU681" → "JU", "4O123" → "4O". */
export function airlineKeyFromFlightNumber(flightNumber: string): string | null {
  const m = (flightNumber || '').toUpperCase().trim().match(/^([A-Z0-9]{2})\d/);
  return m ? m[1] : null;
}

const SEP = '|';
export const scopeResource = (kind: LearnKind, level: 'A' | 'F', key: string, season: Season, dow?: number) =>
  `${kind}:${level}:${key}:${season}${dow === undefined ? '' : `:d${dow}`}`;
export const scopeCount = (level: 'A' | 'F', key: string, season: Season) =>
  `deskcount:${level}:${key}:${season}`;
/** Naučena zamjena: polja "X>Y" (X = zauzeti uobičajeni resurs, Y = ono što je osoblje izabralo). */
export const scopeFallback = (kind: LearnKind, iata: string, season: Season) => `fb:${kind}:A:${iata}:${season}`;
/** Tačnost prijedloga: polja hit | miss | none | applied. */
export type AccuracySource = 'learned' | 'profile' | 'default' | 'note' | 'none';
export type AccuracyOutcome = 'hit' | 'miss' | 'none' | 'applied';
export const scopeAccuracy = (kind: LearnKind, source: AccuracySource, weekKey: string) => `acc:${kind}:${source}:${weekKey}`;
export const fieldOf = (scope: string, id: string | number) => `${scope}${SEP}${id}`;

// ── Upis: koja polja povećati za jednu RUČNU dodjelu ───────────────────
export interface LearnIncrement { field: string; scope: string }

export function incrementsForAssignment(args: {
  kind: LearnKind;
  resourceId: string;
  flightNumber: string;
  season: Season;
  /** Dan u sedmici (0–6) — za brojače po danu. */
  dow?: number;
  /** Samo za šaltere: koliko šaltera tog leta je otvoreno NAKON ove dodjele. */
  openCountForFlight?: number;
  /** Uobičajeni resursi koji su bili ZAUZETI kad je osoblje izabralo `resourceId` (naučena zamjena). */
  fallbackBusy?: string[];
}): LearnIncrement[] {
  const { kind, resourceId, season, dow } = args;
  const flight = args.flightNumber.toUpperCase().trim();
  const iata = airlineKeyFromFlightNumber(flight);
  if (!flight || !resourceId) return [];

  const out: LearnIncrement[] = [];
  const push = (scope: string, id: string | number) => out.push({ scope, field: fieldOf(scope, id) });

  push(scopeResource(kind, 'F', flight, season), resourceId);
  if (iata) push(scopeResource(kind, 'A', iata, season), resourceId);
  if (dow !== undefined && dow >= 0 && dow <= 6) {
    push(scopeResource(kind, 'F', flight, season, dow), resourceId);
    if (iata) push(scopeResource(kind, 'A', iata, season, dow), resourceId);
  }

  if (kind === 'desk' && args.openCountForFlight && args.openCountForFlight >= 1 && args.openCountForFlight <= 8) {
    push(scopeCount('F', flight, season), args.openCountForFlight);
    if (iata) push(scopeCount('A', iata, season), args.openCountForFlight);
  }

  if (iata && args.fallbackBusy?.length) {
    const sc = scopeFallback(kind, iata, season);
    for (const x of args.fallbackBusy.slice(0, 12)) {
      if (x && x !== resourceId) push(sc, `${x}>${resourceId}`);
    }
  }
  return out;
}

/** Jedno polje brojača tačnosti. */
export function accuracyIncrement(args: {
  kind: LearnKind; source: AccuracySource; outcome: AccuracyOutcome; weekKey: string;
}): LearnIncrement {
  const scope = scopeAccuracy(args.kind, args.source, args.weekKey);
  return { scope, field: fieldOf(scope, args.outcome) };
}

// ── Čitanje: parsiranje hash-a u indeks ────────────────────────────────
export type LearnedIndex = Map<string, Record<string, number>>;

export function parseLearned(raw: Record<string, string> | null | undefined): LearnedIndex {
  const idx: LearnedIndex = new Map();
  if (!raw) return idx;
  for (const [field, val] of Object.entries(raw)) {
    const cut = field.lastIndexOf(SEP);
    if (cut < 0) continue;
    const scope = field.slice(0, cut);
    const id = field.slice(cut + 1);
    const n = Number(val);
    if (!Number.isFinite(n) || n <= 0) continue;
    const rec = idx.get(scope) ?? {};
    rec[id] = n;
    idx.set(scope, rec);
  }
  return idx;
}

// ── Izvođenje šablona ──────────────────────────────────────────────────
export interface LearnedPool {
  pool: string[];      // resursi po učestalosti (opadajuće)
  samples: number;     // ukupno uzoraka u opsegu
  level: 'flight-dow' | 'flight' | 'airline-dow' | 'airline';
}

function poolFromCounts(counts: Record<string, number> | undefined, minSamples: number): { pool: string[]; samples: number } | null {
  if (!counts) return null;
  const entries = Object.entries(counts);
  const total = entries.reduce((s, [, n]) => s + n, 0);
  if (total < minSamples) return null;
  const pool = entries
    .filter(([, n]) => n / total >= MIN_SHARE)
    .sort((a, b) => b[1] - a[1] || Number(a[0]) - Number(b[0]))
    .map(([id]) => id);
  return pool.length ? { pool, samples: total } : null;
}

/**
 * Šablon resursa. Redoslijed (najspecifičniji prvi, svaki traži svoj prag):
 * let+dan → let → kompanija+dan → kompanija. `dow` izostavljen = bez dnevnih nivoa.
 */
export function learnedPool(
  idx: LearnedIndex | undefined,
  kind: LearnKind,
  flightNumber: string,
  season: Season,
  dow?: number,
): LearnedPool | null {
  if (!idx || idx.size === 0) return null;
  const flight = flightNumber.toUpperCase().trim();
  const iata = airlineKeyFromFlightNumber(flight);

  const tiers: Array<[LearnedPool['level'], string | null, number]> = [
    ['flight-dow', dow === undefined ? null : scopeResource(kind, 'F', flight, season, dow), MIN_FLIGHT_SAMPLES],
    ['flight', scopeResource(kind, 'F', flight, season), MIN_FLIGHT_SAMPLES],
    ['airline-dow', dow === undefined || !iata ? null : scopeResource(kind, 'A', iata, season, dow), MIN_AIRLINE_SAMPLES],
    ['airline', iata ? scopeResource(kind, 'A', iata, season) : null, MIN_AIRLINE_SAMPLES],
  ];
  for (const [level, scope, min] of tiers) {
    if (!scope) continue;
    const got = poolFromCounts(idx.get(scope), min);
    if (got) return { ...got, level };
  }
  return null;
}

/** Minimalan broj viđenih zamjena X>Y prije nego što se koristi. */
export const MIN_FALLBACK_SAMPLES = 2;

/**
 * Naučene zamjene za kompaniju leta: { X: { Y: broj } } — "kad je X bio zauzet,
 * osoblje je izabralo Y". Zamjene za X sa manje od MIN_FALLBACK_SAMPLES se ignorišu.
 */
export function learnedFallback(
  idx: LearnedIndex | undefined,
  kind: LearnKind,
  flightNumber: string,
  season: Season,
): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  const iata = airlineKeyFromFlightNumber(flightNumber);
  if (!idx || !iata) return out;
  const counts = idx.get(scopeFallback(kind, iata, season));
  if (!counts) return out;
  const totals: Record<string, number> = {};
  for (const [pair, n] of Object.entries(counts)) {
    const [x, y] = pair.split('>');
    if (!x || !y) continue;
    (out[x] ??= {})[y] = n;
    totals[x] = (totals[x] ?? 0) + n;
  }
  for (const x of Object.keys(out)) if (totals[x] < MIN_FALLBACK_SAMPLES) delete out[x];
  return out;
}

// ── Tačnost ─────────────────────────────────────────────────────────────
export interface AccuracyBucket { hit: number; miss: number; none: number; applied: number }
export interface AccuracySummary {
  bySource: Partial<Record<AccuracySource, AccuracyBucket>>;
  total: AccuracyBucket;
  /** hit / (hit + miss) u 0..1, ili null ako nema uzoraka. */
  hitRate: number | null;
  /** Ručne dodjele sa prijedlogom (hit + miss). */
  evaluated: number;
}

const emptyBucket = (): AccuracyBucket => ({ hit: 0, miss: 0, none: 0, applied: 0 });
const rate = (b: AccuracyBucket) => (b.hit + b.miss > 0 ? b.hit / (b.hit + b.miss) : null);

/** Zbir tačnosti za `kind` u zadanim sedmicama (npr. zadnje 4) iz sirovog hash-a. */
export function summarizeAccuracy(
  raw: Record<string, string> | null | undefined,
  kind: LearnKind,
  weekKeys: string[],
): AccuracySummary {
  const weeks = new Set(weekKeys);
  const total = emptyBucket();
  const bySource: AccuracySummary['bySource'] = {};
  for (const [field, val] of Object.entries(raw ?? {})) {
    if (!field.startsWith(`acc:${kind}:`)) continue;
    const cut = field.lastIndexOf(SEP);
    if (cut < 0) continue;
    const [, , source, week] = field.slice(0, cut).split(':');
    const outcome = field.slice(cut + 1) as AccuracyOutcome;
    const n = Number(val);
    if (!weeks.has(week) || !(outcome in total) || !Number.isFinite(n)) continue;
    const b = (bySource[source as AccuracySource] ??= emptyBucket());
    b[outcome] += n;
    total[outcome] += n;
  }
  return { bySource, total, hitRate: rate(total), evaluated: total.hit + total.miss };
}

export const accuracyRate = rate;

/**
 * Najčešći broj šaltera. Događaji n=1,2,3… bilježe se pri svakoj dodjeli, pa je
 * broj letova sa TAČNO k šaltera = f(k) − f(k+1). Vraća mod te raspodjele.
 */
export function learnedDeskCount(
  idx: LearnedIndex | undefined,
  flightNumber: string,
  season: Season,
): { count: number; flights: number; level: 'flight' | 'airline' } | null {
  if (!idx || idx.size === 0) return null;
  const flight = flightNumber.toUpperCase().trim();
  const iata = airlineKeyFromFlightNumber(flight);

  const derive = (counts: Record<string, number> | undefined, minFlights: number) => {
    if (!counts) return null;
    const f = (n: number) => counts[String(n)] ?? 0;
    const flights = f(1);
    if (flights < minFlights) return null;
    let best = 0, bestN = 0;
    for (let k = 1; k <= 8; k++) {
      const exact = f(k) - f(k + 1);
      if (exact > best) { best = exact; bestN = k; }
    }
    return bestN ? { count: bestN, flights } : null;
  };

  const byFlight = derive(idx.get(scopeCount('F', flight, season)), MIN_FLIGHT_SAMPLES);
  if (byFlight) return { ...byFlight, level: 'flight' };
  if (iata) {
    const byAirline = derive(idx.get(scopeCount('A', iata, season)), MIN_COUNT_FLIGHTS);
    if (byAirline) return { ...byAirline, level: 'airline' };
  }
  return null;
}

// ── Slabljenje (decay) ─────────────────────────────────────────────────
/** Vraća novi (prepolovljen) brojač; ≤0 znači "obriši polje". */
export function halve(n: number): number {
  return Math.floor(n / 2);
}

/** Polja istog opsega kao `scope` — za prepolovljavanje. */
export function fieldsOfScope(raw: Record<string, string>, scope: string): string[] {
  const prefix = scope + SEP;
  return Object.keys(raw).filter(f => f.startsWith(prefix));
}

// ── Kontekst ručne dodjele (šalje ga klijent uz POST) ───────────────────
export interface LearningContext {
  /** Uobičajeni bazen koji je prijedlog/profil imao za ovaj let (za naučenu zamjenu). */
  preferredPool?: string[];
  /** Šta je prijedlog nudio za ovaj let (za mjerenje tačnosti). */
  suggested?: string[];
  suggestionSource?: AccuracySource;
}

const ACC_SOURCES: AccuracySource[] = ['learned', 'profile', 'default', 'note', 'none'];
const idList = (v: unknown): string[] | undefined =>
  Array.isArray(v)
    ? [...new Set(v.filter((x): x is string => typeof x === 'string' && /^\d{1,2}$/.test(x)))].slice(0, 12)
    : undefined;

/** Čisti ulaz iz tijela zahtjeva — sve što nije oblika "1–2 cifre" ili poznati izvor se odbacuje. */
export function sanitizeLearningContext(raw: unknown): LearningContext {
  if (!raw || typeof raw !== 'object') return {};
  const r = raw as Record<string, unknown>;
  const src = ACC_SOURCES.includes(r.suggestionSource as AccuracySource) ? (r.suggestionSource as AccuracySource) : undefined;
  return { preferredPool: idList(r.preferredPool), suggested: idList(r.suggested), suggestionSource: src };
}

/** Ishod jedne RUČNE dodjele u odnosu na prijedlog. */
export function accuracyOutcomeFor(resourceId: string, suggested: string[] | undefined): AccuracyOutcome {
  if (!suggested || suggested.length === 0) return 'none';
  return suggested.includes(resourceId) ? 'hit' : 'miss';
}
