// lib/assignment-model.ts
//
// NOVO (2026-10-10): mali MODEL koji UČI iz ručnih dodjela šaltera/gate-ova i
// predviđa "koji resurs će osoblje sljedeći izabrati". Čista logika (bez Redis-a,
// bez React-a, bez mreže). 2026-10-17: treniranje je CENTRALIZOVANO na serveru
// (lib/assignment-model-server.ts) — trenira se najviše jednom po novom primjeru / danu, unutar
// POSTOJEĆEG zahtjeva admin stranice (nema cron-a, nema novih funkcija), a rezultat (težine + status)
// se čuva u Redis-u i isti je na svakom računaru. Preglednik samo rekonstruiše istoriju (bez treniranja).
//
// POSTUPAK (isti koraci kao što je traženo):
//   1. Model dobije kontekst (let, dan, šta je već zauzeto/odabrano) i za svaki
//      mogući resurs izračuna ocjenu = težine · osobine; softmax daje vjerovatnoće.
//   2. Greška = unakrsna entropija između vjerovatnoća i onoga što je osoblje
//      STVARNO izabralo.
//   3. Gradijentno spuštanje: gradijent softmax-a (to je ujedno i povratna
//      propagacija greške za jednoslojni model) ažurira težine.
//   4. Prolaz kroz sve primjere se ponavlja EPOCHS = 10 puta.
//   5. Prvih TRAIN_DAYS = 7 dana model SAMO UČI. Poslije toga se mjeri na
//      novijim primjerima koje nije vidio ("walk-forward"); u prijedloge ulazi
//      tek ako pogađa bolje od običnih brojača (+MARGIN). Inače ostaje u sjeni.
//
// Primjeri se čuvaju u jednom Redis hash-u (EXAMPLES_HASH_KEY), najviše
// MAX_EXAMPLES (~35 KB) — ostaje u besplatnom Redis nivou.

import { DESKS, GATES } from '@/lib/assignment-suggestions';
import { airlineKeyFromFlightNumber, type LearnKind, type Season } from '@/lib/assignment-learning';

export const EXAMPLES_HASH_KEY = 'ably-fids:learn:ex:v1';
/** Trajni zapis "kad je počelo učenje" po vrsti (SET NX pri prvoj ručnoj dodjeli). Odvojen od primjera jer se oni
 *  skraćuju na MAX_EXAMPLES (≈3–4 dana rada) — bez ovoga bi "dan od 7" nikad stigao do 7. */
export const SINCE_KEY_PREFIX = 'ably-fids:learn:since:';
export const sinceKey = (kind: LearnKind) => `${SINCE_KEY_PREFIX}${kind}`;
export const MAX_EXAMPLES = 400;
export const TRAIN_DAYS = 7;
export const MIN_EXAMPLES = 40;
export const MIN_TEST = 20;
export const MARGIN = 0.03;
export const EPOCHS = 10;
export const LEARNING_RATE = 0.3;
export const L2 = 0.002;
const SAME_FLIGHT_WINDOW_MS = 8 * 3_600_000;

// ── Primjer = jedna RUČNA dodjela ───────────────────────────────────────
export interface Example {
  ts: number;
  kind: LearnKind;
  flight: string;
  dow: number;
  minute: number;
  chosen: string;
  /** Resursi zauzeti DRUGIM letovima u trenutku dodjele. */
  busy: string[];
  season: Season;
}

export function exampleField(ts: number, nonce: string): string {
  return ts.toString(36).padStart(9, '0') + nonce.slice(0, 2).padEnd(2, '0');
}

export function encodeExample(e: Omit<Example, 'ts'>): string {
  return [e.kind === 'desk' ? 'd' : 'g', e.flight, e.dow, e.minute, e.chosen, e.busy.join(','), e.season].join('|');
}

export function parseExamples(raw: Record<string, string> | null | undefined): Example[] {
  const out: Example[] = [];
  for (const [field, val] of Object.entries(raw ?? {})) {
    const ts = parseInt(field.slice(0, 9), 36);
    const p = val.split('|');
    if (!Number.isFinite(ts) || p.length < 7) continue;
    const kind = p[0] === 'd' ? 'desk' : p[0] === 'g' ? 'gate' : null;
    const dow = Number(p[2]), minute = Number(p[3]);
    if (!kind || !p[1] || !p[4] || !Number.isFinite(dow) || !Number.isFinite(minute)) continue;
    out.push({
      ts, kind, flight: p[1], dow, minute, chosen: p[4],
      busy: p[5] ? p[5].split(',').filter(Boolean) : [],
      season: p[6] === 'S' ? 'S' : 'W',
    });
  }
  return out.sort((a, b) => a.ts - b.ts);
}

// ── Osobine ─────────────────────────────────────────────────────────────
const universeOf = (k: LearnKind) => (k === 'desk' ? DESKS : GATES);
const term = (id: string) => (Number(id) >= 20 ? 'T2' : 'T1');

interface Bucket { n: number; c: Record<string, number> }
const bump = (m: Map<string, Bucket>, key: string, id: string) => {
  const b = m.get(key) ?? { n: 0, c: {} };
  b.n++; b.c[id] = (b.c[id] ?? 0) + 1;
  m.set(key, b);
};
const share = (m: Map<string, Bucket>, key: string, id: string) => {
  const b = m.get(key);
  return b ? (b.c[id] ?? 0) / (b.n + 1) : 0;
};

export interface PredictCtx {
  flight: string;
  dow: number;
  chosenSoFar: string[];
  /** Minut dana kad se resurs otvara (doba dana). */
  minute?: number;
  /** Koliko je resursa u tom trenutku zauzeto DRUGIM letovima (gužva). */
  busyCount?: number;
  /** Sezona konteksta; omogućava provjeru sezonskih pravila. */
  season?: Season;
}

/** Zadnjih nekoliko izbora kompanije — za osobinu "nedavno korišćen". */
const RECENT_PER_AIRLINE = 4;
const TIME_BUCKET_MIN = 180; // 8 doba dana po 3 sata

/** Broj osnovnih osobina; poslije njih slijedi po jedna "pristrasnost" (one-hot) za svaki resurs. */
export const BASE_FEATURES = 11;

/** Historija — brojači iz PRETHODNIH primjera (nikad iz budućih, da nema curenja). */
class History {
  air = new Map<string, Bucket>();
  flight = new Map<string, Bucket>();
  airDow = new Map<string, Bucket>();
  glob = new Map<string, Bucket>();
  airTerm = new Map<string, Bucket>();
  timeB = new Map<string, Bucket>();
  lastAir = new Map<string, string[]>();

  add(e: { flight: string; dow: number; chosen: string; minute?: number }) {
    const a = airlineKeyFromFlightNumber(e.flight) ?? '?';
    bump(this.air, a, e.chosen);
    bump(this.flight, e.flight, e.chosen);
    bump(this.airDow, `${a}:${e.dow}`, e.chosen);
    bump(this.glob, '*', e.chosen);
    bump(this.airTerm, a, term(e.chosen));
    if (e.minute !== undefined) bump(this.timeB, String(Math.floor(e.minute / TIME_BUCKET_MIN)), e.chosen);
    const last = this.lastAir.get(a) ?? [];
    this.lastAir.set(a, [e.chosen, ...last.filter(x => x !== e.chosen)].slice(0, RECENT_PER_AIRLINE));
  }

  /** Osobine po kandidatu (BASE_FEATURES + jedan one-hot po resursu). */
  features(ctx: PredictCtx, ids: string[]): number[][] {
    const a = airlineKeyFromFlightNumber(ctx.flight) ?? '?';
    const tb = this.airTerm.get(a);
    const last = this.lastAir.get(a) ?? [];
    const tBucket = ctx.minute !== undefined ? this.timeB.get(String(Math.floor(ctx.minute / TIME_BUCKET_MIN))) : undefined;
    const load = Math.min((ctx.busyCount ?? 0) / Math.max(ids.length, 1), 1);
    return ids.map((id, idx) => {
      let adj = 0, same = 0;
      if (ctx.chosenSoFar.length) {
        let best = Infinity;
        for (const s of ctx.chosenSoFar) {
          if (s !== id && term(s) === term(id)) best = Math.min(best, Math.abs(Number(id) - Number(s)));
        }
        adj = best === Infinity ? 0 : 1 / best;
        same = ctx.chosenSoFar.some(s => term(s) === term(id)) ? 1 : -1;
      }
      const low = 1 - idx / ids.length;
      const rec = last.indexOf(id);
      return [
        share(this.air, a, id),
        share(this.flight, ctx.flight, id),
        share(this.airDow, `${a}:${ctx.dow}`, id),
        share(this.glob, '*', id),
        adj,
        same,
        tb ? (tb.c[term(id)] ?? 0) / (tb.n + 1) : 0,
        low,
        tBucket ? (tBucket.c[id] ?? 0) / (tBucket.n + 1) : 0,
        rec >= 0 ? 1 - rec / RECENT_PER_AIRLINE : 0,
        load * low,
        ...ids.map((_, k) => (k === idx ? 1 : 0)), // pristrasnost po resursu
      ];
    });
  }
}

// ── Redovi za treniranje ────────────────────────────────────────────────
export interface Row { feats: number[][]; chosen: number; mask: boolean[] }

function buildRows(examples: Example[], kind: LearnKind): { rows: Row[]; history: History } {
  const ids = universeOf(kind);
  const hist = new History();
  const recent = new Map<string, Array<{ ts: number; chosen: string }>>();
  const rows: Row[] = [];
  for (const e of examples) {
    const chosen = ids.indexOf(e.chosen);
    if (chosen < 0) continue;
    const sofar = (recent.get(e.flight) ?? []).filter(r => e.ts - r.ts < SAME_FLIGHT_WINDOW_MS).map(r => r.chosen);
    const feats = hist.features({ flight: e.flight, dow: e.dow, chosenSoFar: sofar, minute: e.minute, busyCount: e.busy.length }, ids);
    const mask = ids.map(id => e.busy.includes(id) || sofar.includes(id));
    mask[chosen] = false;
    rows.push({ feats, chosen, mask });
    hist.add(e);
    const list = recent.get(e.flight) ?? [];
    list.push({ ts: e.ts, chosen: e.chosen });
    recent.set(e.flight, list.slice(-8));
  }
  return { rows, history: hist };
}

/** Početne težine — razumna pretpostavka (slično brojačima), pa ih gradijent doteruje. */
export const INITIAL_WEIGHTS = [1.0, 3.0, 1.0, 0.5, 1.0, 0.5, 1.0, 0.0, 0.5, 0.5, 0.0];
/** "Obični brojači" kao fiksne težine — mjerilo s kojim se model poredi. */
export const BASELINE_WEIGHTS = [2, 3, 1, 0, 0, 0, 0, 0, 0, 0, 0];

const dot = (w: number[], f: number[]) => w.reduce((s, wi, i) => s + wi * f[i], 0);

function softmax(logits: number[], mask?: boolean[]): number[] {
  let max = -Infinity;
  logits.forEach((l, i) => { if (!mask?.[i] && l > max) max = l; });
  const ex = logits.map((l, i) => (mask?.[i] ? 0 : Math.exp(l - max)));
  const sum = ex.reduce((a, b) => a + b, 0) || 1;
  return ex.map(x => x / sum);
}

/** Gradijentno spuštanje (softmax + unakrsna entropija), EPOCHS prolaza kroz primjere. */
export function trainWeights(rows: Row[], w0: number[] = INITIAL_WEIGHTS, epochs = EPOCHS): number[] {
  const nF = rows[0]?.feats[0]?.length ?? w0.length;
  const w = [...w0];
  while (w.length < nF) w.push(0); // pristrasnosti po resursu kreću od nule
  for (let ep = 0; ep < epochs; ep++) {
    for (const row of rows) {
      const p = softmax(row.feats.map(f => dot(w, f)), row.mask);
      const grad = new Array<number>(w.length).fill(0);
      row.feats.forEach((f, c) => {
        const err = p[c] - (c === row.chosen ? 1 : 0); // greška izlaza
        if (err !== 0) for (let k = 0; k < w.length; k++) grad[k] += err * f[k]; // propagacija unazad do težina
      });
      for (let k = 0; k < w.length; k++) w[k] -= LEARNING_RATE * (grad[k] + L2 * w[k]);
    }
  }
  return w;
}

function hits(rows: Row[], w: number[]): number {
  let h = 0;
  for (const row of rows) {
    let best = -1, bestScore = -Infinity;
    row.feats.forEach((f, c) => {
      if (row.mask[c]) return;
      const s = dot(w, f);
      if (s > bestScore) { bestScore = s; best = c; }
    });
    if (best === row.chosen) h++;
  }
  return h;
}

// ── Javni API: treniranje + status ──────────────────────────────────────
export type ModelPhase = 'learning' | 'shadow' | 'active';
export interface ModelInfo {
  phase: ModelPhase;
  examples: number;
  day: number;
  modelRate: number | null;
  baselineRate: number | null;
  tested: number;
  text: string;
}
/** Vjerovatnoće po resursu (zbir 1) za zadati kontekst. */
export type Predictor = ((ctx: PredictCtx) => Record<string, number>) & {
  /** Kratko objašnjenje zašto su baš ti resursi predloženi ("kompanija ga najčešće koristi, ..."). */
  explain?: (ctx: PredictCtx, picked: string[]) => string;
};

const FEATURE_TEXT = [
  'kompanija ga najčešće koristi',
  'isti let ga je ranije dobijao',
  'kompanija ga koristi ovog dana',
  'osoblje ga često bira',
  'uz već otvorene resurse tog leta',
  'isti terminal kao već otvoreni',
  'terminal koji kompanija koristi',
  'niži broj',
  'često se bira u ovo doba dana',
  'kompanija ga je nedavno koristila',
  'pri većoj gužvi biraju niže brojeve',
  'osoblje ga rado bira',
];
export interface TrainedModel { info: ModelInfo; predictor: Predictor | null }

function daysSince(firstTs: number, todayISO: string): number {
  const m = todayISO.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return 1;
  const first = new Date(firstTs).toISOString().slice(0, 10);
  const a = Date.parse(first + 'T00:00:00Z');
  const b = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  return Math.max(1, Math.round((b - a) / 86_400_000) + 1);
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

/**
 * SERIJALIZABILNO stanje istreniranog modela — to je ono što server čuva u Redis-u i šalje svim adminima
 * (lib/assignment-model-server.ts). Težine + status; istorija (brojači) se na klijentu rekonstruiše iz
 * primjera, pa nema treniranja u pregledniku.
 */
export interface ModelState {
  info: ModelInfo;
  /** Konačne težine; null dok model ne smije da utiče na prijedloge (učenje / sjena). */
  weights: number[] | null;
}

/** Treniranje (gradijentno spuštanje) — čista funkcija; poziva je SERVER (vidi assignment-model-server.ts). */
export function trainModelState(all: Example[], kind: LearnKind, todayISO: string, sinceTs?: number | null): ModelState {
  const ex = all.filter(e => e.kind === kind);
  const n = ex.length;
  // Početak učenja = raniji od (najstariji sačuvani primjer, trajni zapis "since").
  const firstTs = n ? Math.min(ex[0].ts, sinceTs && Number.isFinite(sinceTs) && sinceTs > 0 ? sinceTs : Infinity) : 0;
  const day = n ? daysSince(firstTs, todayISO) : 0;
  const learning = (text: string): ModelState => ({
    info: { phase: 'learning', examples: n, day, modelRate: null, baselineRate: null, tested: 0, text },
    weights: null,
  });

  if (n === 0) return learning('Model trenutno uči — još nema ručnih dodjela za učenje.');

  const testN = Math.max(MIN_TEST, Math.floor(n * 0.25));
  const trainN = n - testN;
  if (day < TRAIN_DAYS) {
    return learning(`Model trenutno uči · dan ${day} od ${TRAIN_DAYS} · ${n} ručnih dodjela. Još ne utiče na prijedloge.`);
  }
  if (n < MIN_EXAMPLES || trainN < 20) {
    return learning(`Model trenutno uči · skupljeno ${n} od ${MIN_EXAMPLES} potrebnih ručnih dodjela. Još ne utiče na prijedloge.`);
  }

  const { rows } = buildRows(ex, kind);
  const split = Math.max(rows.length - testN, 0);
  const wTrain = trainWeights(rows.slice(0, split));
  const test = rows.slice(split);
  const mRate = hits(test, wTrain) / (test.length || 1);
  const bRate = hits(test, BASELINE_WEIGHTS) / (test.length || 1);
  const better = test.length >= MIN_TEST && mRate >= bRate + MARGIN;

  const info: ModelInfo = {
    phase: better ? 'active' : 'shadow',
    examples: n, day, modelRate: mRate, baselineRate: bRate, tested: test.length,
    text: better
      ? `Model aktivan: pogađa ${pct(mRate)} naspram ${pct(bRate)} kod brojača (test na ${test.length} dodjela).`
      : `Model još ne utiče na prijedloge: pogađa ${pct(mRate)} naspram ${pct(bRate)} kod brojača (test na ${test.length} dodjela). Nastavlja da uči.`,
  };
  if (!better) return { info, weights: null };
  return { info, weights: trainWeights(rows) }; // konačni model: svi primjeri, 10 prolaza
}

/**
 * ── EvoMind: Knowledge & Rules layer ─────────────────────────────────────
 *
 * Ovaj sloj ne mijenja postojeće neuronske težine niti utiče na Predictor.
 * Iz istorije ručnih dodjela izvodi provjerljive KANDIDATE rules, sa podrškom,
 * pouzdanošću, osnovnom učestalošću i izuzecima. Rezultat je namjerno odvojen
 * od aktivnog prediktora kako bi se prvo mjerio u shadow režimu.
 */
export type KnowledgeScope =
  | 'flight'
  | 'airline'
  | 'airline-day'
  | 'airline-season'
  | 'airline-day-season'
  | 'airline-time';

export interface KnowledgeConditions {
  flight?: string;
  airline?: string;
  dow?: number;
  season?: Season;
  timeBucket?: number;
}

export interface KnowledgeRule {
  id: string;
  kind: LearnKind;
  scope: KnowledgeScope;
  when: KnowledgeConditions;
  prefer: string;
  support: number;
  confidence: number;
  baseline: number;
  /** Razlika confidence - baseline, izražena kao apsolutni udio. */
  lift: number;
  /** Specifičniji obrasci koji poništavaju ovo opšte pravilo. */
  exceptions: KnowledgeConditions[];
}

export interface KnowledgeState {
  version: 1;
  kind: LearnKind;
  examples: number;
  rules: KnowledgeRule[];
  /** Test unazad (walk-forward): da li pravila pogađaju bolje od brojača na novijim dodjelama. Samo prikaz, ne utiče na prijedloge. */
  backtest?: KnowledgeBacktest;
}

export interface KnowledgeBacktest {
  /** Broj novijih dodjela na kojima je mjereno. */
  tested: number;
  /** Na koliko od njih je bar jedno pravilo (bez izuzetka) davalo prijedlog. */
  covered: number;
  ruleHits: number;
  /** Pogodci brojača (BASELINE_WEIGHTS) na ISTIM dodjelama koje pravila pokrivaju. */
  baselineHitsCovered: number;
  /** Pogodci brojača na svim testiranim dodjelama. */
  baselineHits: number;
  text: string;
}

export interface KnowledgeEvaluation {
  /** Savjetodavni bodovi po resursu; nijesu vjerovatnoće. */
  scores: Record<string, number>;
  matchedRules: KnowledgeRule[];
  suppressedRules: KnowledgeRule[];
}

const KNOWLEDGE_MIN_SUPPORT = 5;
const KNOWLEDGE_MIN_CONFIDENCE = 0.65;
const KNOWLEDGE_MIN_LIFT = 0.10;

const knowledgeScopes: Array<{ scope: KnowledgeScope; fields: Array<keyof KnowledgeConditions> }> = [
  { scope: 'flight', fields: ['airline', 'flight'] },
  { scope: 'airline', fields: ['airline'] },
  { scope: 'airline-day', fields: ['airline', 'dow'] },
  { scope: 'airline-season', fields: ['airline', 'season'] },
  { scope: 'airline-day-season', fields: ['airline', 'dow', 'season'] },
  { scope: 'airline-time', fields: ['airline', 'timeBucket'] },
];

const conditionsForExample = (e: Example, fields: Array<keyof KnowledgeConditions>): KnowledgeConditions => {
  const airline = airlineKeyFromFlightNumber(e.flight) ?? '?';
  const all: KnowledgeConditions = {
    flight: e.flight,
    airline,
    dow: e.dow,
    season: e.season,
    timeBucket: Math.floor(e.minute / TIME_BUCKET_MIN),
  };
  const out: KnowledgeConditions = {};
  for (const field of fields) {
    const value = all[field];
    if (value !== undefined) Object.assign(out, { [field]: value });
  }
  return out;
};

const conditionKey = (conditions: KnowledgeConditions) => JSON.stringify(conditions);
const specificity = (conditions: KnowledgeConditions) => Object.keys(conditions).length;

function conditionsMatch(ctx: PredictCtx, conditions: KnowledgeConditions): boolean {
  if (conditions.flight !== undefined && ctx.flight !== conditions.flight) return false;
  if (conditions.airline !== undefined && (airlineKeyFromFlightNumber(ctx.flight) ?? '?') !== conditions.airline) return false;
  if (conditions.dow !== undefined && ctx.dow !== conditions.dow) return false;
  if (conditions.season !== undefined && ctx.season !== conditions.season) return false;
  if (conditions.timeBucket !== undefined) {
    if (ctx.minute === undefined || Math.floor(ctx.minute / TIME_BUCKET_MIN) !== conditions.timeBucket) return false;
  }
  return true;
}

function isMoreSpecificCompatible(broad: KnowledgeConditions, specific: KnowledgeConditions): boolean {
  const broadEntries = Object.entries(broad) as Array<[keyof KnowledgeConditions, string | number]>;
  if (specificity(specific) <= broadEntries.length) return false;
  return broadEntries.every(([key, value]) => specific[key] === value);
}

/**
 * Iz primjera izvodi kandidate za pravila. Pravilo se predlaže samo kada ima
 * dovoljno primjera, pouzdanost i poboljšanje u odnosu na globalnu učestalost.
 * Nema automatskog pretvaranja pravila u tvrda ograničenja.
 */
export function buildKnowledgeState(
  all: Example[],
  kind: LearnKind,
  options: { minSupport?: number; minConfidence?: number; minLift?: number } = {},
): KnowledgeState {
  const examples = all.filter(e => e.kind === kind);
  const minSupport = options.minSupport ?? KNOWLEDGE_MIN_SUPPORT;
  const minConfidence = options.minConfidence ?? KNOWLEDGE_MIN_CONFIDENCE;
  const minLift = options.minLift ?? KNOWLEDGE_MIN_LIFT;
  const globalCounts: Record<string, number> = {};
  for (const e of examples) globalCounts[e.chosen] = (globalCounts[e.chosen] ?? 0) + 1;

  const groups = new Map<string, {
    scope: KnowledgeScope;
    when: KnowledgeConditions;
    counts: Record<string, number>;
    support: number;
  }>();

  for (const e of examples) {
    for (const definition of knowledgeScopes) {
      const when = conditionsForExample(e, definition.fields);
      const key = `${definition.scope}:${conditionKey(when)}`;
      const group = groups.get(key) ?? {
        scope: definition.scope,
        when,
        counts: {},
        support: 0,
      };
      group.support++;
      group.counts[e.chosen] = (group.counts[e.chosen] ?? 0) + 1;
      groups.set(key, group);
    }
  }

  const rules: KnowledgeRule[] = [];
  const total = examples.length || 1;
  for (const [key, group] of groups) {
    if (group.support < minSupport) continue;
    const ranked = Object.entries(group.counts).sort((a, b) => b[1] - a[1]);
    const [prefer, wins] = ranked[0] ?? ['', 0];
    if (!prefer) continue;
    const confidence = wins / group.support;
    const baseline = (globalCounts[prefer] ?? 0) / total;
    const lift = confidence - baseline;
    if (confidence < minConfidence || lift < minLift) continue;
    rules.push({
      id: `${kind}:${group.scope}:${key}`,
      kind,
      scope: group.scope,
      when: group.when,
      prefer,
      support: group.support,
      confidence,
      baseline,
      lift,
      exceptions: [],
    });
  }

  // Specifičnije pravilo za isti kontekst postaje izuzetak opštijem pravilu
  // ako preporučuje drugi resurs. Time se čuva kontekst umjesto slijepog pravila.
  for (const broad of rules) {
    for (const specific of rules) {
      if (broad === specific || broad.prefer === specific.prefer) continue;
      if (isMoreSpecificCompatible(broad.when, specific.when)) {
        broad.exceptions.push(specific.when);
      }
    }
  }

  rules.sort((a, b) => specificity(b.when) - specificity(a.when) || b.support - a.support);
  return { version: 1, kind, examples: examples.length, rules };
}

/**
 * Dodaje eksplicitni izuzetak bez mijenjanja izvornog stanja. Korisno za
 * kasniju administratorsku potvrdu/izmjenu pravila.
 */
export function addKnowledgeException(
  state: KnowledgeState,
  ruleId: string,
  exception: KnowledgeConditions,
): KnowledgeState {
  return {
    ...state,
    rules: state.rules.map(rule => rule.id !== ruleId || rule.exceptions.some(x => conditionKey(x) === conditionKey(exception))
      ? rule
      : { ...rule, exceptions: [...rule.exceptions, exception] }),
  };
}

/** Evaluira pravila za postojeći kontekst. Bodovi su odvojeni od softmax vjerovatnoća. */
export function evaluateKnowledge(
  state: KnowledgeState,
  ctx: PredictCtx,
  ids: string[] = universeOf(state.kind),
): KnowledgeEvaluation {
  const scores: Record<string, number> = Object.fromEntries(ids.map(id => [id, 0]));
  const matchedRules: KnowledgeRule[] = [];
  const suppressedRules: KnowledgeRule[] = [];

  for (const rule of state.rules) {
    if (!conditionsMatch(ctx, rule.when)) continue;
    if (rule.exceptions.some(exception => conditionsMatch(ctx, exception))) {
      suppressedRules.push(rule);
      continue;
    }
    if (!(rule.prefer in scores)) continue;
    const strength = rule.lift * Math.log2(rule.support + 1);
    scores[rule.prefer] += strength;
    matchedRules.push(rule);
  }

  return { scores, matchedRules, suppressedRules };
}

/** Kratko, ljudski objašnjenje pravila koja podržavaju izabrani resurs. */
export function explainKnowledge(
  state: KnowledgeState,
  ctx: PredictCtx,
  picked: string[],
): string {
  const evaluation = evaluateKnowledge(state, ctx);
  const selected = evaluation.matchedRules
    .filter(rule => picked.includes(rule.prefer))
    .sort((a, b) => b.lift - a.lift || b.support - a.support)
    .slice(0, 3);
  if (!selected.length) return 'Nema dovoljno potvrđenih obrazaca za objašnjenje.';
  return selected.map(rule => {
    const conditions = Object.entries(rule.when)
      .map(([key, value]) => `${key}=${value}`)
      .join(', ');
    return `${rule.prefer}: ${conditions} · ${Math.round(rule.confidence * 100)}% uspješnosti na ${rule.support} primjera`;
  }).join('; ');
}

/**
 * Test unazad za Knowledge pravila: pravila se grade SAMO iz starijih ~75% primjera, a mjere na
 * novijih ~25% koje nisu vidjela (isti omjer kao kod modela). Poredi se sa običnim brojačima
 * na ISTIM dodjelama koje pravila pokrivaju. Brojači nastavljaju da uče kroz test dio, pa je
 * poređenje blago nepovoljno za pravila (konzervativno). Zauzeti resursi se ne predlažu.
 */
export function evaluateKnowledgeBacktest(all: Example[], kind: LearnKind): KnowledgeBacktest {
  const ids = universeOf(kind);
  const valid = all.filter(e => e.kind === kind && ids.indexOf(e.chosen) >= 0);
  const n = valid.length;
  const empty = (text: string): KnowledgeBacktest => ({ tested: 0, covered: 0, ruleHits: 0, baselineHitsCovered: 0, baselineHits: 0, text });
  if (n < MIN_EXAMPLES) return empty(`Pravila: još nema dovoljno primjera za test (${n} od ${MIN_EXAMPLES}).`);
  const testN = Math.max(MIN_TEST, Math.floor(n * 0.25));
  const split = n - testN;
  if (split < 20) return empty(`Pravila: još nema dovoljno primjera za test (${n} od ${MIN_EXAMPLES}).`);

  const state = buildKnowledgeState(valid.slice(0, split), kind);
  const rows = buildRows(valid, kind).rows; // jedan red po primjeru (svi su u `ids`)
  let covered = 0, ruleHits = 0, baselineHitsCovered = 0;
  for (let i = split; i < n; i++) {
    const e = valid[i];
    const ev = evaluateKnowledge(state, {
      flight: e.flight, dow: e.dow, chosenSoFar: [], minute: e.minute, busyCount: e.busy.length, season: e.season,
    }, ids);
    let top: string | null = null;
    let best = 0;
    for (const id of ids) {
      if (e.busy.includes(id)) continue;
      if (ev.scores[id] > best) { best = ev.scores[id]; top = id; }
    }
    if (!top) continue;
    covered++;
    if (top === e.chosen) ruleHits++;
    if (hits([rows[i]], BASELINE_WEIGHTS) === 1) baselineHitsCovered++;
  }
  const baselineHits = hits(rows.slice(split), BASELINE_WEIGHTS);
  const text = covered === 0
    ? `Pravila (test na ${testN} novijih dodjela): nijedno pravilo nije pokrilo te dodjele.`
    : `Pravila (test na ${testN} novijih dodjela): pokrivaju ${covered}, pogađaju ${ruleHits}/${covered} (${pct(ruleHits / covered)}) naspram brojača ${baselineHitsCovered}/${covered} (${pct(baselineHitsCovered / covered)}) na istim dodjelama.${covered < 10 ? ' Premalo pokrivenih dodjela za zaključak.' : ''}`;
  return { tested: testN, covered, ruleHits, baselineHitsCovered, baselineHits, text };
}

/** Predictor iz gotovih težina — BEZ treniranja (samo rekonstrukcija istorije iz primjera). */
export function predictorFromState(state: ModelState, all: Example[], kind: LearnKind): TrainedModel {
  const wFinal = state.weights;
  if (!wFinal) return { info: state.info, predictor: null };
  const ex = all.filter(e => e.kind === kind);
  const ids = universeOf(kind);
  const history = new History();
  for (const e of ex) if (ids.indexOf(e.chosen) >= 0) history.add(e); // isto kao buildRows
  const info = state.info;
  const predict = (ctx: PredictCtx) => {
    const logits = history.features(ctx, ids).map(f => dot(wFinal, f));
    const p = softmax(logits);
    return Object.fromEntries(ids.map((id, i) => [id, p[i]])) as Record<string, number>;
  };
  const explain = (ctx: PredictCtx, picked: string[]): string => {
    const feats = history.features(ctx, ids);
    const idxs = picked.map(id => ids.indexOf(id)).filter(i => i >= 0);
    if (!idxs.length) return '';
    // Doprinos osobine = težina · vrijednost, u odnosu na PROSJEK svih kandidata (važi samo ono što razlikuje).
    const contrib = (f: number[], k: number) => (k < BASE_FEATURES ? wFinal[k] * f[k] : 0);
    const out: Array<{ text: string; v: number }> = [];
    for (let k = 0; k < BASE_FEATURES; k++) {
      const mean = feats.reduce((s, f) => s + contrib(f, k), 0) / feats.length;
      const mine = idxs.reduce((s, i) => s + contrib(feats[i], k), 0) / idxs.length;
      out.push({ text: FEATURE_TEXT[k], v: mine - mean });
    }
    // Pristrasnost po resursu (zbirno).
    const bias = (i: number) => (wFinal[BASE_FEATURES + i] ?? 0);
    const meanB = ids.reduce((s, _, i) => s + bias(i), 0) / ids.length;
    out.push({ text: FEATURE_TEXT[BASE_FEATURES], v: idxs.reduce((s, i) => s + bias(i), 0) / idxs.length - meanB });
    const top = out.filter(o => o.v > 0.15 && o.text !== 'niži broj').sort((a, b) => b.v - a.v).slice(0, 2);
    return top.map(t => t.text).join(', ');
  };
  const predictor: Predictor = Object.assign(predict, { explain });
  return { info, predictor };
}

/** Zadržano radi kompatibilnosti: trenira i odmah pravi predictor (koristi se u testovima / kao rezervni put). */
export function trainModel(all: Example[], kind: LearnKind, todayISO: string, sinceTs?: number | null): TrainedModel {
  return predictorFromState(trainModelState(all, kind, todayISO, sinceTs), all, kind);
}

/** Otisak skupa primjera — mijenja se kad stigne novi primjer ili se skrate stari. */
export function examplesSignature(raw: Record<string, string> | null | undefined): string {
  const keys = Object.keys(raw ?? {});
  let max = '';
  for (const k of keys) if (k > max) max = k;
  return `${keys.length}:${max}`;
}
