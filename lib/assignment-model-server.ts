// lib/assignment-model-server.ts
//
// NOVO (2026-10-17): CENTRALIZOVANO treniranje modela dodjela.
//
// Ranije je svaki admin preglednik sam trenirao model pri otvaranju stranice, po SVOM satu (todayISO) —
// pa dva računara mogu imati različit status ("uči"/"aktivan"), a pogrešan sat računara pomjera "dan od 7".
// Sad server drži JEDNO stanje (težine + status) u Redis-u i svi admini dobiju isto.
//
// TROŠAK (nula): nema novih ruta, nema cron-a, nema Ably-ja. Poziva se iz POSTOJEĆE rute
// /api/admin/learned-assignments (koja već čita primjere jednim HGETALL-om):
//   • +1 Redis GET po otvaranju admin stranice (stanje modela),
//   • trening + 1 SET SAMO kad je stanje zastarjelo (stigao novi primjer ili je počeo novi dan) —
//     u praksi desetak puta dnevno, ~desetak ms CPU unutar već pokrenute funkcije.
// SIGURNOST: bilo koja greška vraća null → admin stranica trenira lokalno kao i prije (rezervni put).
import { safeRedisGet, safeRedisSet, getRedisClient } from '@/lib/redis';
import {
  parseExamples, trainModelState, examplesSignature, sinceKey, type ModelState,
} from '@/lib/assignment-model';

export const MODEL_STATE_KEY = 'ably-fids:learn:model:v1';
const MODEL_STATE_TTL_SECONDS = 30 * 24 * 60 * 60;
const STATE_VERSION = 1;

export interface StoredModelStates {
  v: number;
  /** Otisak primjera + dan na koji je treniran — različit otisak = zastarjelo. */
  sig: string;
  day: string;
  desk: ModelState;
  gate: ModelState;
}

export const stateSig = (examplesRaw: Record<string, string> | null | undefined, todayISO: string) =>
  `${examplesSignature(examplesRaw)}@${todayISO}`;

export function isFresh(stored: StoredModelStates | null, examplesRaw: Record<string, string> | null | undefined, todayISO: string): boolean {
  return !!stored && stored.v === STATE_VERSION && stored.sig === stateSig(examplesRaw, todayISO);
}

/** Čista funkcija (testabilna): trenira oba modela iz sirovih primjera. */
export interface LearnSince { desk: number | null; gate: number | null }

export function buildStates(examplesRaw: Record<string, string> | null | undefined, todayISO: string, since?: LearnSince): StoredModelStates {
  const ex = parseExamples(examplesRaw ?? {});
  return {
    v: STATE_VERSION,
    sig: stateSig(examplesRaw, todayISO),
    day: todayISO,
    desk: trainModelState(ex, 'desk', todayISO, since?.desk),
    gate: trainModelState(ex, 'gate', todayISO, since?.gate),
  };
}

/**
 * Vrati svježe stanje modela: iz Redis-a ako je aktuelno, inače istreniraj i sačuvaj.
 * `examplesRaw` je isti HGETALL koji ruta ionako čita. null = nešto nije u redu (klijent trenira lokalno).
 */
/**
 * Trajni "since" po vrsti: jedan MGET (+ SET NX samo kad zapisa još nema, iz najstarijeg sačuvanog primjera).
 * Greška → null (dan se onda računa iz najstarijeg primjera, kao prije).
 */
export async function readLearnSince(examplesRaw: Record<string, string> | null | undefined): Promise<LearnSince | undefined> {
  try {
    const client = getRedisClient();
    const [d, g] = await client.mget(sinceKey('desk'), sinceKey('gate'));
    const out: LearnSince = { desk: d ? Number(d) || null : null, gate: g ? Number(g) || null : null };
    if (examplesRaw && (out.desk === null || out.gate === null)) {
      const ex = parseExamples(examplesRaw);
      for (const kind of ['desk', 'gate'] as const) {
        if (out[kind] !== null) continue;
        const first = ex.find(e => e.kind === kind);
        if (!first) continue;
        out[kind] = first.ts;
        await client.set(sinceKey(kind), String(first.ts), 'NX').catch(() => null);
      }
    }
    return out;
  } catch { return undefined; }
}

export async function getOrTrainModelStates(
  examplesRaw: Record<string, string> | null | undefined,
  todayISO: string,
  since?: LearnSince,
): Promise<StoredModelStates | null> {
  try {
    if (examplesRaw == null) return null; // Redis nije pročitan pouzdano — ne diramo sačuvano stanje
    let stored: StoredModelStates | null = null;
    try {
      const raw = await safeRedisGet(MODEL_STATE_KEY);
      stored = raw ? (JSON.parse(raw) as StoredModelStates) : null;
    } catch { stored = null; }
    if (isFresh(stored, examplesRaw, todayISO)) return stored;

    const fresh = buildStates(examplesRaw, todayISO, since);
    await safeRedisSet(MODEL_STATE_KEY, JSON.stringify(fresh), MODEL_STATE_TTL_SECONDS).catch(() => false);
    return fresh;
  } catch (err) {
    console.error('[assignment-model] centralno treniranje nije uspjelo (klijent trenira lokalno):', err instanceof Error ? err.message : err);
    return null;
  }
}
