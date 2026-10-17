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
export function trainModelState(all: Example[], kind: LearnKind, todayISO: string): ModelState {
  const ex = all.filter(e => e.kind === kind);
  const n = ex.length;
  const day = n ? daysSince(ex[0].ts, todayISO) : 0;
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
export function trainModel(all: Example[], kind: LearnKind, todayISO: string): TrainedModel {
  return predictorFromState(trainModelState(all, kind, todayISO), all, kind);
}

/** Otisak skupa primjera — mijenja se kad stigne novi primjer ili se skrate stari. */
export function examplesSignature(raw: Record<string, string> | null | undefined): string {
  const keys = Object.keys(raw ?? {});
  let max = '';
  for (const k of keys) if (k > max) max = k;
  return `${keys.length}:${max}`;
}
