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
  desks: Record<string, string>; // flightNumber -> deskNumber(s)
  gates: Record<string, string>; // flightNumber -> gateNumber
};

// ── IN-PROCESS KEŠ — dijeli ga i /api/test/assignments i /api/flights/status,
// tako da čak i kad obje rute čitaju u istom ciklusu, Redis se pogađa
// najviše jednom na 10s po serverless instanci ──────────────────────────
let cachedRaw: RawAssignments | null = null;
let cachedRawExpiry = 0;
let refreshing = false;
const CACHE_TTL_MS = 10_000;

async function readRaw(): Promise<RawAssignments> {
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

export async function getRawAssignments(): Promise<RawAssignments> {
  const now = Date.now();

  if (cachedRaw && now < cachedRawExpiry) return cachedRaw;
  if (refreshing && cachedRaw) return cachedRaw;

  refreshing = true;
  try {
    const fresh = await readRaw();
    cachedRaw = fresh;
    cachedRawExpiry = now + CACHE_TTL_MS;
    return fresh;
  } finally {
    refreshing = false;
  }
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