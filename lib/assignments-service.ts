// lib/assignments-service.ts
import { safeRedisHGetAll } from '@/lib/redis';

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
  [x: string]: any;
  desks: Record<string, string>;
  gates: Record<string, string>;
  // Već izračunat fingerprint (isti onaj koji buildSimpleMaps interno
  // koristi za memoization) — izložen ovdje da ga pozivaoci (npr.
  // /api/flights/status) mogu iskoristiti za jeftin ETag umjesto da
  // ponovo JSON.stringify-uju cijelu strukturu. Dodavanje polja ne
  // kvari postojeće pozivaoce koji destrukturišu samo { desks, gates }.
  fingerprint: string;
};

// ======================================================
// RAW REDIS CACHE
// ======================================================
// NAPOMENA: TTL namjerno ostaje 8s (ne 30s) — usklađen sa
// s-maxage=10s na /api/flights/status. Desk/gate open/closed je
// operativni podatak (koristi ga osoblje na aerodromu), pa
// produženje TTL-a na 30s ne štedi Active CPU (I/O čekanje se ne
// naplaćuje kod Fluid Compute), a UNOSI rizik da promjena statusa
// kasni do 30s umjesto do ~10s. Ne diraj bez razloga.
let cachedRaw: RawAssignments | null = null;
let cachedRawExpiry = 0;
const RAW_CACHE_TTL_MS = 8_000;

// ── FIX (race condition): DESK_ALL_KEY/GATE_ALL_KEY su sada Redis HASH-evi
// (jedno polje po desku/gate-u), ne više jedan JSON string. safeRedisHGetAll
// vraća Record<string, string> (svako polje je JSON-enkodiran DeskEntry/
// GateEntry) — parsiramo polje po polje, umjesto JSON.parse cijelog bloba.
// Vidi opširan komentar u lib/redis.ts iznad safeRedisHSet za PUN kontekst
// bug-a koji je ovo rješavalo. ─────────────────────────────────────────
function parseHashEntries<T>(raw: Record<string, string> | null): Record<string, T> {
  if (!raw) return {};
  const out: Record<string, T> = {};
  for (const [field, json] of Object.entries(raw)) {
    try {
      out[field] = JSON.parse(json) as T;
    } catch {
      // Pojedinačno oštećeno polje ne smije srušiti čitanje svih ostalih —
      // samo ga preskačemo (isto ponašanje kao ranije kad bi cijeli JSON
      // blob bio nevalidan, samo sad izolovano na jedno polje).
    }
  }
  return out;
}

export async function getRawAssignments(): Promise<RawAssignments> {
  const now = Date.now();
  if (cachedRaw && now < cachedRawExpiry) return cachedRaw;

  const [deskRaw, gateRaw] = await Promise.all([
    safeRedisHGetAll(DESK_ALL_KEY),
    safeRedisHGetAll(GATE_ALL_KEY),
  ]);

  const desks = parseHashEntries<DeskEntry>(deskRaw);
  const gates = parseHashEntries<GateEntry>(gateRaw);

  cachedRaw = { desks, gates };
  cachedRawExpiry = now + RAW_CACHE_TTL_MS;
  return cachedRaw;
}

// ======================================================
// SIMPLE MAP CACHE (memoization preko lakog fingerprint-a)
// ======================================================
// Realna ušteda samo kad se buildSimpleMaps() pozove više puta sa
// istim raw objektom unutar RAW_CACHE_TTL_MS prozora (npr. iz više
// ruta/handlera u istom request ciklusu). Za skup od ~30-40
// desk/gate unosa je apsolutna ušteda mikroskopska — ne očekuj da
// se ovo vidi kao stavka na Vercel billing-u, ali nije ni štetno.
let cachedSimple: SimpleAssignments | null = null;
let cachedSimpleFingerprint = '';

function createFingerprint(raw: RawAssignments): string {
  let fingerprint = '';

  // VAŽNO: ključ (broj deska/gate-a) MORA biti u fingerprint-u.
  // Bez njega, zamjena stanja između dva deska sa istim
  // setAt/status/flightNumber ne bi bila detektovana kao promjena.
  //
  // FIX (klasa se ne prikazuje na gate ekranu nakon "setClass" akcije —
  // pravi korijenski uzrok): classType NIJE bio uključen u fingerprint.
  // POST 'setClass' akcija (vidi app/api/test/gate-status-override/route.ts)
  // mijenja SAMO classType polje, ne dira setAt/status/flightNumber — pa je
  // fingerprint prije i poslije klika bio IDENTIČAN. Pošto se ovaj
  // fingerprint koristi u ETag izračunu u app/api/flights/route.ts, server
  // je vraćao 304 Not Modified na sledeći poll (misleći da se ništa nije
  // promijenilo), a klijent je nastavljao da prikazuje KEŠIRANU (staru,
  // bez klase) verziju — TRAJNO, ne samo kratko kašnjenje, sve dok neko
  // drugo polje (npr. nova dodjela) ne bi promijenilo fingerprint slučajno.
  for (const [deskNumber, value] of Object.entries(raw.desks)) {
    fingerprint += `${deskNumber}:${value.setAt ?? 0}-${value.status}-${value.flightNumber}-${value.classType ?? ''}|`;
  }

  fingerprint += '#';

  for (const [gateNumber, value] of Object.entries(raw.gates)) {
    fingerprint += `${gateNumber}:${value.setAt ?? 0}-${value.status}-${value.flightNumber}-${value.classType ?? ''}|`;
  }

  return fingerprint;
}

export function buildSimpleMaps(raw: RawAssignments): SimpleAssignments {
  const fingerprint = createFingerprint(raw);

  if (cachedSimple && cachedSimpleFingerprint === fingerprint) {
    return cachedSimple;
  }

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
      gateMap[gateNumber] = val.flightNumber; // { gateId: flightNumber }
    }
  }

  cachedSimple = { desks: deskMap, gates: gateMap, fingerprint };
  cachedSimpleFingerprint = fingerprint;

  return cachedSimple;
}