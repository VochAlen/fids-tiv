// lib/override-ttl.ts
import { getPodgoricaEpochMsForTime } from '@/lib/night-hours';

export function computeOverrideTTL(
  field: string,
  scheduledTime: string | null,
  estimatedTime: string | null
): number {
  const SIX_HOURS = 6 * 60 * 60;
  const EIGHT_HOURS = 8 * 60 * 60;

  // StatusEN, Terminal, Note - fiksno 8 sati
  if (['StatusEN', 'Terminal', 'Note'].includes(field)) {
    return EIGHT_HOURS;
  }

  if (!scheduledTime) return SIX_HOURS;

  const now = Date.now();

  // FIX (override-i živjeli u Redis-u 1-2h duže nego što je dizajnirano):
  // bilo je `new Date(); d.setHours(h, m, 0, 0)` — server (Vercel) radi u
  // UTC, a scheduledTime/estimatedTime su LOKALNO (Podgorica) vrijeme.
  // setHours(h, m) je te brojeve protumačio kao UTC sate, pa je izračunati
  // "trenutak zatvaranja/polijetanja" bio 1-2h kasniji nego stvarno — TTL
  // (closeMs - now) je zbog toga bio precijenjen za tačno taj iznos.
  // getPodgoricaEpochMsForTime (lib/night-hours.ts) radi isključivo u
  // "minuta od sada" prostoru, potpuno imuno na server-vs-Podgorica
  // razliku. Ime parseHHMM zadržano da poziv ispod ostane čitljiv.
  const parseHHMM = (t: string): number | null => getPodgoricaEpochMsForTime(t);

  const stdMs = parseHHMM(scheduledTime);
  if (!stdMs) return SIX_HOURS;

  // CHECK-IN DESK: gasi se STD - 30 minuta
  if (field === 'CheckInDesk') {
    const closeMs = stdMs - 30 * 60 * 1000;  // 30 min prije STD
    const ttl = Math.floor((closeMs - now) / 1000);
    
    // Ako je već prošlo vrijeme zatvaranja, odmah ukloni override
    if (ttl <= 0) return 0;
    return Math.min(ttl, EIGHT_HOURS);
  }

  // GATE: vrijedi do polijetanja (STD ili ETD)
  if (field === 'GateNumber') {
    const refTime = estimatedTime ? parseHHMM(estimatedTime) : null;
    const refMs = refTime ?? stdMs;
    const ttl = Math.floor((refMs - now) / 1000);
    
    // Ako je već prošlo vrijeme polijetanja, odmah ukloni override
    if (ttl <= 0) return 0;
    return Math.min(ttl, EIGHT_HOURS);
  }

  return SIX_HOURS;
}