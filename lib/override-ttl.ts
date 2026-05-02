// lib/override-ttl.ts
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

  const parseHHMM = (t: string): number | null => {
    const m = t.match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return null;
    const d = new Date();
    d.setHours(parseInt(m[1]), parseInt(m[2]), 0, 0);
    return d.getTime();
  };

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