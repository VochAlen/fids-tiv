// lib/assignment-learning-server.ts
//
// NOVO (2026-10-08): SERVERSKI dio učenja dodjela — upis brojača u Redis.
// Čista logika (imena polja, sezona, izvođenje šablona) je u
// lib/assignment-learning.ts; ovdje je samo I/O.
//
// TROŠAK: jedan pipeline (jedna mrežna runda ka Redis-u) sa nekoliko HINCRBY
// komandi po dodjeli — nikakav novi Vercel poziv (poziva se iz postojeće
// rute unutar `after()`), nikakav Ably saobraćaj. Slabljenje starih podataka
// se dešava rijetko (kad brojač pređe DECAY_LIMIT).
//
// SIGURNOST: učenje NIKAD ne smije pokvariti dodjelu — svaka greška se
// guta (samo log), a kad je circuit breaker otvoren, upis se preskače.

import { getRedisClient, isCircuitOpen } from '@/lib/redis';
import { getPodgoricaDateString } from '@/lib/night-hours';
import {
  LEARN_HASH_KEY, DECAY_LIMIT, halve, fieldsOfScope, incrementsForAssignment,
  seasonFromDate, dowFromDate, isoWeekKey, accuracyIncrement, accuracyOutcomeFor,
  type LearnKind, type LearnIncrement, type LearningContext,
} from '@/lib/assignment-learning';

export async function recordAssignmentLearning(args: {
  kind: LearnKind;
  resourceId: string;
  flightNumber: string;
  openCountForFlight?: number;
  /** Dodjela je došla klikom na "Primijeni" (ne uči se šablon, samo se broji "applied"). */
  fromSuggestion?: boolean;
  /** Resursi iz `preferredPool` koji su u tom trenutku bili zauzeti drugim letom. */
  busyPreferred?: string[];
  context?: LearningContext;
}): Promise<void> {
  try {
    if (isCircuitOpen()) return;
    const today = getPodgoricaDateString();
    const season = seasonFromDate(today);
    const weekKey = isoWeekKey(today);
    const ctx = args.context ?? {};

    const learnIncs: LearnIncrement[] = [];
    const accIncs: LearnIncrement[] = [];

    if (args.fromSuggestion) {
      accIncs.push(accuracyIncrement({ kind: args.kind, source: ctx.suggestionSource ?? 'none', outcome: 'applied', weekKey }));
    } else {
      // Zamjena se uči samo kad izabrani resurs NIJE u uobičajenom bazenu.
      const pool = ctx.preferredPool ?? [];
      const fallbackBusy = pool.includes(args.resourceId) ? [] : (args.busyPreferred ?? []);
      learnIncs.push(...incrementsForAssignment({
        kind: args.kind,
        resourceId: args.resourceId,
        flightNumber: args.flightNumber,
        season,
        dow: dowFromDate(today),
        openCountForFlight: args.openCountForFlight,
        fallbackBusy,
      }));
      const outcome = accuracyOutcomeFor(args.resourceId, ctx.suggested);
      accIncs.push(accuracyIncrement({
        kind: args.kind,
        source: outcome === 'none' ? 'none' : (ctx.suggestionSource ?? 'default'),
        outcome,
        weekKey,
      }));
    }

    const incs = [...learnIncs, ...accIncs];
    if (incs.length === 0) return;

    const client = getRedisClient();
    const pipe = client.pipeline();
    for (const inc of incs) pipe.hincrby(LEARN_HASH_KEY, inc.field, 1);
    const res = await pipe.exec();
    if (!res) return;

    // Slabljenje: samo opsezi šablona (ne i tačnost) — prepolovi sva polja opsega.
    const toDecay = new Set<string>();
    res.forEach(([err, val], i) => {
      if (i < learnIncs.length && !err && typeof val === 'number' && val > DECAY_LIMIT) toDecay.add(incs[i].scope);
    });
    if (toDecay.size === 0) return;

    const raw = await client.hgetall(LEARN_HASH_KEY);
    const fix = client.pipeline();
    for (const scope of toDecay) {
      for (const field of fieldsOfScope(raw, scope)) {
        const next = halve(Number(raw[field]) || 0);
        if (next > 0) fix.hset(LEARN_HASH_KEY, field, String(next));
        else fix.hdel(LEARN_HASH_KEY, field);
      }
    }
    await fix.exec();
  } catch (err) {
    console.error('[assignment-learning] upis nije uspio (dodjela NIJE pogođena):', err instanceof Error ? err.message : err);
  }
}
