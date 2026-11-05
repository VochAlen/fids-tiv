// lib/assignment-model-server.ts
//
// CENTRALIZOVANO treniranje modela dodjela + EvoMind Knowledge sloj.
//
// TROSAK REDIS-A:
// - NEMA novih Redis kljuceva.
// - NEMA novih GET/MGET/SET komandi u odnosu na prethodnu verziju.
// - Koristi se isti MODEL_STATE_KEY, postojeci GET i postojeci SET.
// - Redis zapis ostaje ISTOG oblika i velicine: Knowledge se NE cuva u Redis-u.
// - Knowledge se gradi u memoriji iz istog examplesRaw koji ruta vec ucitava.
// - Nema novih Redis kljuceva, komandi, niti dodatnih bajtova u Redis-u.
//
// Kompatibilnost:
// - Postojeci desk/gate ModelState ostaju nepromijenjeni.
// - Knowledge polja postoje samo u povratnoj vrijednosti funkcije, ne u Redis zapisu.
// - Postojeci Redis zapis i njegov TTL ostaju nepromijenjeni.
// - Ako Redis ili izgradnja stanja ne uspiju, vraca se null kao i ranije.

import { safeRedisGet, safeRedisSet, getRedisClient } from '@/lib/redis';
import {
  parseExamples,
  trainModelState,
  buildKnowledgeState,
  evaluateKnowledgeBacktest,
  examplesSignature,
  sinceKey,
  type ModelState,
  type KnowledgeState,
  type KnowledgeRule,
} from '@/lib/assignment-model';

export const MODEL_STATE_KEY = 'ably-fids:learn:model:v1';
const MODEL_STATE_TTL_SECONDS = 30 * 24 * 60 * 60;
const STATE_VERSION = 1;

/** Ogranicenja cuvaju povratni Knowledge payload malim i predvidljivim. */
const MAX_STORED_RULES_PER_KIND = 60;
const MAX_STORED_EXCEPTIONS_PER_RULE = 8;

export interface PersistedModelStates {
  v: number;
  /** Otisak primjera + dan na koji je trenirano — razlicit otisak = zastarjelo. */
  sig: string;
  day: string;
  desk: ModelState;
  gate: ModelState;
}

export interface StoredModelStates extends PersistedModelStates {
  /** EvoMind kandidati; racunaju se u memoriji i nikad se ne upisuju u Redis. */
  knowledgeDesk: KnowledgeState;
  knowledgeGate: KnowledgeState;
}

export const stateSig = (
  examplesRaw: Record<string, string> | null | undefined,
  todayISO: string,
) => `${examplesSignature(examplesRaw)}@${todayISO}`;

/** Provjerava samo postojeci Redis cache; Knowledge nije dio cache zapisa. */
export function isFresh(
  stored: Pick<PersistedModelStates, 'v' | 'sig'> | null,
  examplesRaw: Record<string, string> | null | undefined,
  todayISO: string,
): boolean {
  return !!stored
    && stored.v === STATE_VERSION
    && stored.sig === stateSig(examplesRaw, todayISO);
}

/**
 * Ogranicava broj pravila i izuzetaka u povratnom Knowledge payload-u.
 * Prednost imaju pravila sa jacim lift-om i vecom podrskom.
 */
function compactKnowledgeState(state: KnowledgeState): KnowledgeState {
  const rules: KnowledgeRule[] = [...state.rules]
    .sort((a, b) => {
      const scoreA = a.lift * Math.log2(a.support + 1);
      const scoreB = b.lift * Math.log2(b.support + 1);
      return scoreB - scoreA || b.support - a.support;
    })
    .slice(0, MAX_STORED_RULES_PER_KIND)
    .map(rule => ({
      ...rule,
      exceptions: rule.exceptions.slice(0, MAX_STORED_EXCEPTIONS_PER_RULE),
    }));

  return { ...state, rules };
}

/** Pravila + test unazad, sve u memoriji iz vec ucitanih primjera (nista se ne upisuje u Redis). */
function knowledgeFor(examples: ReturnType<typeof parseExamples>, kind: 'desk' | 'gate'): KnowledgeState {
  return { ...compactKnowledgeState(buildKnowledgeState(examples, kind)), backtest: evaluateKnowledgeBacktest(examples, kind) };
}

/** Memo u memoriji procesa (ne u Redis-u): pravila + test se računaju jednom po otisku primjera/dana, ne na svaki zahtjev. */
let kCache: { sig: string; desk: KnowledgeState; gate: KnowledgeState } | null = null;
function knowledgePair(examplesRaw: Record<string, string>, todayISO: string) {
  const sig = stateSig(examplesRaw, todayISO);
  if (kCache?.sig === sig) return kCache;
  const examples = parseExamples(examplesRaw);
  kCache = { sig, desk: knowledgeFor(examples, 'desk'), gate: knowledgeFor(examples, 'gate') };
  return kCache;
}

/** Cista funkcija (testabilna): gradi model i KnowledgeState bez Redis zavisnosti. */
export interface LearnSince { desk: number | null; gate: number | null }

export function buildStates(
  examplesRaw: Record<string, string> | null | undefined,
  todayISO: string,
  since?: LearnSince,
): StoredModelStates {
  const examples = parseExamples(examplesRaw ?? {});

  return {
    v: STATE_VERSION,
    sig: stateSig(examplesRaw, todayISO),
    day: todayISO,
    desk: trainModelState(examples, 'desk', todayISO, since?.desk),
    gate: trainModelState(examples, 'gate', todayISO, since?.gate),
    knowledgeDesk: knowledgeFor(examples, 'desk'),
    knowledgeGate: knowledgeFor(examples, 'gate'),
  };
}

/**
 * Trajni "since" po vrsti: jedan MGET (+ SET NX samo kad zapisa jos nema,
 * iz najstarijeg sacuvanog primjera). Greska -> undefined.
 * Ova funkcija je ostavljena nepromijenjena po pitanju Redis operacija.
 */
export async function readLearnSince(
  examplesRaw: Record<string, string> | null | undefined,
): Promise<LearnSince | undefined> {
  try {
    const client = getRedisClient();
    const [d, g] = await client.mget(sinceKey('desk'), sinceKey('gate'));
    const out: LearnSince = {
      desk: d ? Number(d) || null : null,
      gate: g ? Number(g) || null : null,
    };

    if (examplesRaw && (out.desk === null || out.gate === null)) {
      const examples = parseExamples(examplesRaw);
      for (const kind of ['desk', 'gate'] as const) {
        if (out[kind] !== null) continue;
        const first = examples.find(example => example.kind === kind);
        if (!first) continue;
        out[kind] = first.ts;
        await client.set(sinceKey(kind), String(first.ts), 'NX').catch(() => null);
      }
    }
    return out;
  } catch {
    return undefined;
  }
}

/**
 * Vraca svjeze stanje: iz Redis-a ako je aktuelno, inace ga izgradi i sacuva.
 * `examplesRaw` je isti HGETALL koji ruta vec cita.
 * null = nesto nije u redu (klijent koristi postojeci rezervni put).
 *
 * BITNO: Redis se koristi potpuno kao ranije. Knowledge se racuna u memoriji
 * iz vec ucitanih primjera i ne ulazi u JSON koji se cuva u Redis-u.
 */
export async function getOrTrainModelStates(
  examplesRaw: Record<string, string> | null | undefined,
  todayISO: string,
  since?: LearnSince,
): Promise<StoredModelStates | null> {
  try {
    if (examplesRaw == null) return null; // Redis nije pouzdano procitan — ne diramo sacuvano stanje

    let stored: PersistedModelStates | null = null;
    try {
      const raw = await safeRedisGet(MODEL_STATE_KEY);
      stored = raw ? JSON.parse(raw) as PersistedModelStates : null;
    } catch {
      stored = null;
    }

    if (isFresh(stored, examplesRaw, todayISO)) {
      const k = knowledgePair(examplesRaw, todayISO);
      return { ...(stored as PersistedModelStates), knowledgeDesk: k.desk, knowledgeGate: k.gate };
    }

    const fresh = buildStates(examplesRaw, todayISO, since);
    // Sacuvaj iskljucivo stara polja. Redis payload ostaje kompatibilan i
    // iste velicine kao prije EvoMind dodatka.
    const redisState: PersistedModelStates = {
      v: fresh.v,
      sig: fresh.sig,
      day: fresh.day,
      desk: fresh.desk,
      gate: fresh.gate,
    };
    await safeRedisSet(
      MODEL_STATE_KEY,
      JSON.stringify(redisState),
      MODEL_STATE_TTL_SECONDS,
    ).catch(() => false);

    return fresh;
  } catch (err) {
    console.error(
      '[assignment-model] centralno treniranje nije uspjelo (klijent trenira lokalno):',
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}
