// lib/assignments-service.ts
import { safeRedisGetStrict } from '@/lib/redis';

// FIX (vidi opširan komentar u
// app/api/test/desk-status-override/route.ts): preimenovano da nikad
// ne kolidira sa glavnim (polling) sistemom, koji koristi identična
// stara imena ('test:desk-status:all'/'test:gate-status:all') ali kao
// Redis HASH umjesto string.
const DESK_ALL_KEY = 'ably-fids:desk-status:all';
const GATE_ALL_KEY = 'ably-fids:gate-status:all';

export type DeskEntry = {
  status: 'open' | 'closed' | null;
  flightNumber: string;
  classType: string | null;
  setAt: number | null;
  // FIX (dosljednost sa app/api/test/desk-status-override/route.ts —
  // vidi opširan komentar tamo za pun kontekst): ova stranica čita
  // ISTI Redis ključ direktno, pa tip mora pratiti stvaran oblik
  // podatka koji se tamo sad upisuje.
  seq: number;
};

export type GateEntry = {
  status: 'open' | 'closed' | null;
  flightNumber: string | null;
  classType: string | null;
  setAt: number | null;
  seq: number;
};

export type RawAssignments = {
  desks: Record<string, DeskEntry>;
  gates: Record<string, GateEntry>;
  // NOVO (KRITIČNO — regresija pronađena pri ponovnoj analizi nakon fix-a
  // u lib/assignment-merge.ts, 2026-09-28): `mergeNewer` na klijentu SAD
  // ispravno tretira "ključ nedostaje u punom snapshot-u" kao "obrisano na
  // serveru" (vidi opširan komentar tamo). To znači da OVAJ snapshot MORA
  // biti pouzdano razlikovati "stvarno prazno" od "čitanje nije uspjelo"
  // — inače bi svaki prolazan Redis/circuit-breaker problem (ili bilo koji
  // neuhvaćen izuzetak u GET ruti) doveo do toga da klijent PRIMI
  // LAŽNO PRAZAN snapshot i (ispravno, prema svojoj sad ispravljenoj
  // logici) OBRIŠE BAŠ SVE trenutno aktivne dodjele na SVIM kioscima
  // odjednom — mnogo gori, širi oblik istog bug-a koji je upravo popravljen.
  // `ok: false` signalizira pozivaocu (ovdje: /api/test/assignments) da
  // OVAJ odgovor NIJE pouzdan pun snapshot i da ga klijent (hooks/
  // useRealtimeAssignments.ts) ne smije koristiti za merge — mora ga
  // tretirati identično kao neuspio fetch (zadrži trenutno stanje, probaj
  // ponovo na sledećem ciklusu).
  ok: boolean;
};

export type SimpleAssignments = {
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
// NAPOMENA: keš čuva podatak BEZ `ok` polja — `ok` je isključivo
// procjena SVJEŽINE konkretnog poziva (da li JE OVAJ poziv uspio da
// pročita Redis), ne osobina samog keširanog sadržaja, pa se dodaje
// tek u povratnoj vrijednosti (vidi getRawAssignments ispod).
let cachedRaw: Omit<RawAssignments, 'ok'> | null = null;
let cachedRawExpiry = 0;
const RAW_CACHE_TTL_MS = 8_000;

// FIX (KRITIČNO — pravi uzrok prijavljenog "i nakon reload-a let i
// dalje stoji dodijeljen"): ovaj in-process keš (cachedRaw) živi u
// memoriji JEDNE serverless instance. desk/gate-status-override rute
// (koje upisuju promjene) RANIJE nisu uopšte znale za ovaj keš, pa ga
// nikad nisu invalidirale na upis — ako bi GET zahtjev (npr. reload
// kiosk stranice) pogodio ISTU, "toplu" instancu koja je NEDAVNO
// (unutar prethodnih 8s) već pozvala getRawAssignments(), dobijao bi
// STAR podatak iz memorije, čak i kad je Redis već ispravno ažuriran.
// Vercel-ov Fluid Compute često rutira uzastopne zahtjeve na istu
// "toplu" instancu, pa je ovaj scenario stvaran, ne teoretski.
//
// Izloženo da ga desk/gate-status-override rute pozovu ODMAH nakon
// uspješnog upisa (isti princip kao njihov sopstveni `cachedAll =
// null` za sopstveni GET keš) — ovo pokriva "ista instanca" slučaj u
// potpunosti; kratak TTL (8s) ostaje kao zaštita za rijeđi slučaj gdje
// upis i naredno čitanje pogode RAZLIČITE instance.
export function invalidateAssignmentsCache(): void {
  cachedRaw = null;
  cachedRawExpiry = 0;
}

export async function getRawAssignments(): Promise<RawAssignments> {
  const now = Date.now();
  if (cachedRaw && now < cachedRawExpiry) return { ...cachedRaw, ok: true };

  // NOVO (KRITIČNO — vidi opširan komentar uz `ok` polje u RawAssignments):
  // safeRedisGetStrict (ista bezbjedna primitiva kao u desk/gate-status-
  // override rutama) razlikuje "ključ stvarno ne postoji" od "čitanje nije
  // uspjelo" (Redis greška / circuit breaker otvoren) — za razliku od
  // ranijeg safeRedisGet, koji je obje situacije tiho tretirao identično
  // kao "prazno".
  const [deskResult, gateResult] = await Promise.all([
    safeRedisGetStrict(DESK_ALL_KEY),
    safeRedisGetStrict(GATE_ALL_KEY),
  ]);

  if (!deskResult.ok || !gateResult.ok) {
    console.warn('[assignments-service] Redis čitanje nije uspjelo — ne vraćam lažno prazan snapshot.');
    // Bolje vratiti POSLEDNJI POZNAT (čak i istekao) keš nego lažno
    // prazno stanje — pozivalac (npr. /api/test/assignments) i dalje
    // MORA proslijediti `ok: false` dalje, bez obzira šta ovdje vratimo
    // kao `desks`/`gates`, jer je i keširan podatak sad potencijalno
    // zastarjeo i ne smije se koristiti za merge na klijentu.
    if (cachedRaw) return { ...cachedRaw, ok: false };
    return { desks: {}, gates: {}, ok: false };
  }

  let desks: Record<string, DeskEntry> = {};
  let gates: Record<string, GateEntry> = {};
  if (deskResult.value) { try { desks = JSON.parse(deskResult.value); } catch { desks = {}; } }
  if (gateResult.value) { try { gates = JSON.parse(gateResult.value); } catch { gates = {}; } }

  cachedRaw = { desks, gates };
  cachedRawExpiry = now + RAW_CACHE_TTL_MS;
  return { ...cachedRaw, ok: true };
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
  for (const [deskNumber, value] of Object.entries(raw.desks)) {
    fingerprint += `${deskNumber}:${value.setAt ?? 0}-${value.status}-${value.flightNumber}|`;
  }

  fingerprint += '#';

  for (const [gateNumber, value] of Object.entries(raw.gates)) {
    fingerprint += `${gateNumber}:${value.setAt ?? 0}-${value.status}-${value.flightNumber}|`;
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