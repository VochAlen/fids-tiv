// lib/assignments-service.ts
import { safeRedisGet } from '@/lib/redis';

const DESK_ALL_KEY = 'test:desk-status:all';
const GATE_ALL_KEY = 'test:gate-status:all';

export type DeskEntry = {
  status: 'open' | 'closed' | null;
  flightNumber: string;
  classType: string | null;
  setAt: number | null;
};

export type GateEntry = {
  status: 'open' | 'closed' | null;
  flightNumber: string | null;
  classType: string | null;
  setAt: number | null;
};

export type RawAssignments = {
  desks: Record<string, DeskEntry>;
  gates: Record<string, GateEntry>;
};

export type SimpleAssignments = {
  desks: Record<string, string>;
  gates: Record<string, string>;
};

// OBRISANO: cachedRaw, cachedRawExpiry, refreshing, CACHE_TTL_MS
// Dodjele su podaci koji se mijenjaju na zahtjev osoblja u realnom
// vremenu — ne smiju se keširati u memoriji funkcije, jer serverless
// instance nisu međusobno sinhronizovane.

export async function getRawAssignments(): Promise<RawAssignments> {
  const [deskRaw, gateRaw] = await Promise.all([
    safeRedisGet(DESK_ALL_KEY),
    safeRedisGet(GATE_ALL_KEY),
  ]);

  let desks: Record<string, DeskEntry> = {};
  let gates: Record<string, GateEntry> = {};

  if (deskRaw) {
    try { desks = JSON.parse(deskRaw); } catch { desks = {}; }
  }
  if (gateRaw) {
    try { gates = JSON.parse(gateRaw); } catch { gates = {}; }
  }

  return { desks, gates };
}

export function buildSimpleMaps(raw: RawAssignments): SimpleAssignments {
  const deskMap: Record<string, string> = {};
  for (const [deskNumber, val] of Object.entries(raw.desks)) {
    if (val?.status === 'open' && val.flightNumber) {
      const fn = val.flightNumber;
      deskMap[fn] = deskMap[fn] ? `${deskMap[fn]}, ${deskNumber}` : deskNumber;
    }
  }

  const gateMap: Record<string, string> = {};
  for (const [gateNumber, val] of Object.entries(raw.gates)) {
    if (val?.status === 'open' && val.flightNumber) {
      gateMap[val.flightNumber] = gateNumber;
    }
  }

  return { desks: deskMap, gates: gateMap };
}