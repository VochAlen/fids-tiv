// app/api/admin/radar/route.ts
//
// Radar aviona oko Tivta (adsb.lol, besplatan ADS-B izvor). SAMO za prijavljenog admina.
//
// TROŠAK / OGRANIČENJA (namjerno):
//  • Jedan upstream poziv dijele SVI gledaoci: rezultat ide u Redis (ključ ispod, TTL 30 min), a
//    SET NX lock od 20 s sprječava da dva istovremena zahtjeva zovu adsb.lol.
//  • Učestalost diktira raspored letova (lib/radar.ts planRefresh): ~3,5 min blizu leta, ≤12 min između
//    letova, u noćnom režimu nikako. Zahtjev bez gledaoca = nula poziva (poziva se samo dok je stranica otvorena).
//  • Dnevni budžet upstream poziva (RADAR_DAILY_CAP) štiti od ograničenja izvora; kad se potroši, vraća se
//    zadnji keširani snimak (stale:true). 429 od izvora → pauza 5 min.
//  • Svi novi Redis ključevi imaju eksplicitan EXPIRE.
import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';
import { getRedisClient } from '@/lib/redis';
import { peekCachedFlightData } from '@/lib/flight-data-service';
import { isNightHours, getPodgoricaDateString } from '@/lib/night-hours';
import { nowMs } from '@/lib/server-clock';
import { getRawAssignments } from '@/lib/assignments-service';
import { KNOWN_CALLSIGNS } from '@/lib/radar-callsigns';
import type { Flight } from '@/types/flight';
import { TIV, RADIUS_NM, bearingDeg, buildScheduleIndex, distanceNm, etaMinutes, buildGroundMap, heuristicMatch, matchCallsign, matchFlightNumber, pendingFlights, type Entry, planRefresh, type RadarAircraft, type RadarOther, type RadarResponse } from '@/lib/radar';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 15;

const CACHE_KEY = 'ably-fids:radar:v1';
const LOCK_KEY = 'ably-fids:radar:lock';
const BACKOFF_KEY = 'ably-fids:radar:backoff';
const budgetKey = (day: string) => `ably-fids:radar:budget:${day}`;
const CACHE_TTL_S = 1800;
const RADAR_DAILY_CAP = 400; // izvor javlja ~500/dan po IP; ostavljamo rezervu
const UPSTREAM = `https://api.adsb.lol/v2/lat/${TIV.lat}/lon/${TIV.lon}/dist/${RADIUS_NM}`;

interface RawAc {
  hex?: string; flight?: string; r?: string; t?: string; alt_baro?: number | 'ground'; gs?: number; track?: number;
  lat?: number; lon?: number; baro_rate?: number; seen_pos?: number; seen?: number;
}
interface Snap { at: number; ac: Array<{ hex: string; cs: string; r: string; t: string; alt: number; gnd: boolean; gs: number; trk: number; lat: number; lon: number; vr: number; age: number }> }

function slim(ac: RawAc[]): Snap['ac'] {
  const out: Snap['ac'] = [];
  for (const a of ac) {
    if (typeof a.lat !== 'number' || typeof a.lon !== 'number' || !a.hex) continue;
    const gnd = a.alt_baro === 'ground';
    out.push({
      hex: a.hex, cs: (a.flight ?? '').trim(), r: a.r ?? '', t: a.t ?? '',
      alt: gnd ? 0 : typeof a.alt_baro === 'number' ? a.alt_baro : 0, gnd,
      gs: Math.round(a.gs ?? 0), trk: Math.round(a.track ?? 0), lat: +a.lat.toFixed(4), lon: +a.lon.toFixed(4),
      vr: Math.round(a.baro_rate ?? 0), age: Math.round(a.seen_pos ?? a.seen ?? 0),
    });
  }
  return out;
}

async function readSnap(): Promise<Snap | null> {
  try {
    const raw = await getRedisClient().get(CACHE_KEY);
    return raw ? (JSON.parse(raw) as Snap) : null;
  } catch { return null; }
}

/** Vraća svjež snimak (ili zadnji poznati uz razlog zašto nije osvježen). */
async function getSnapshot(intervalSec: number, now: number): Promise<{ snap: Snap | null; stale: boolean; note?: string }> {
  const cached = await readSnap();
  const freshMs = Math.max(45, Math.floor(intervalSec * 0.8)) * 1000;
  if (cached && now - cached.at < freshMs) return { snap: cached, stale: false };

  let redis;
  try { redis = getRedisClient(); } catch { return { snap: cached, stale: !!cached, note: 'redis' }; }

  try {
    if (await redis.get(BACKOFF_KEY)) return { snap: cached, stale: !!cached, note: 'pauza (izvor ograničio pozive)' };
    const day = getPodgoricaDateString();
    const used = await redis.incr(budgetKey(day));
    if (used === 1) await redis.expire(budgetKey(day), 172_800);
    if (used > RADAR_DAILY_CAP) return { snap: cached, stale: !!cached, note: 'dnevni limit poziva potrošen' };
    const gotLock = await redis.set(LOCK_KEY, '1', 'EX', 20, 'NX');
    if (!gotLock) return { snap: cached, stale: !!cached, note: 'osvježavanje u toku' };

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 7000);
    try {
      const res = await fetch(UPSTREAM, { signal: ctrl.signal, cache: 'no-store', headers: { 'user-agent': 'tivat-fids-radar/1.0', accept: 'application/json' } });
      if (res.status === 429) { await redis.set(BACKOFF_KEY, '1', 'EX', 300); return { snap: cached, stale: !!cached, note: 'izvor vratio 429' }; }
      if (!res.ok) return { snap: cached, stale: !!cached, note: `izvor HTTP ${res.status}` };
      const json = (await res.json()) as { ac?: RawAc[] };
      const snap: Snap = { at: nowMs(), ac: slim(Array.isArray(json.ac) ? json.ac : []) };
      await redis.set(CACHE_KEY, JSON.stringify(snap), 'EX', CACHE_TTL_S);
      return { snap, stale: false };
    } finally {
      clearTimeout(timer);
      await redis.del(LOCK_KEY).catch(() => undefined);
    }
  } catch (err) {
    return { snap: cached, stale: !!cached, note: err instanceof Error && err.name === 'AbortError' ? 'izvor ne odgovara' : 'greška izvora' };
  }
}

export async function GET(request: Request) {
  const { error: authError } = await requireAdmin(request);
  if (authError) return authError;

  const now = nowMs();
  let arrivals: Flight[] = [];
  let departures: Flight[] = [];
  try {
    const fd = await peekCachedFlightData();
    arrivals = fd?.arrivals ?? [];
    departures = fd?.departures ?? [];
  } catch { /* bez rasporeda: radar ostaje prazan */ }

  // Dodjele gate-ova/šaltera (8 s in-process keš + jedno Redis čitanje; bez poziva ka izvoru aviona).
  let ground: RadarResponse['ground'] = {};
  try {
    const raw = await getRawAssignments();
    ground = buildGroundMap(arrivals, departures, raw.desks, raw.gates);
  } catch { /* bez dodjela: prikazuje se samo plan */ }
  if (new URL(request.url).searchParams.get('ground') === '1') {
    return NextResponse.json({ now, ground }, { headers: { 'Cache-Control': 'no-store' } });
  }

  const plan = planRefresh(arrivals, departures, now, isNightHours());
  if (plan.mode === 'night') {
    return NextResponse.json({ now, fetchedAt: null, mode: 'night', intervalSec: null, next: plan.next, aircraft: [], pending: [], ground, others: 0, stale: false, note: null } satisfies RadarResponse, { headers: { 'Cache-Control': 'no-store' } });
  }

  const { snap, stale, note } = await getSnapshot(plan.intervalSec ?? 720, now);
  const idx = buildScheduleIndex(arrivals, departures, now);
  const wantAll = new URL(request.url).searchParams.get('all') === '1';
  const allOthers: RadarOther[] = [];
  const aircraft: RadarAircraft[] = [];
  const matched = new Set<string>();
  let others = 0;
  const normFn = (x: string) => x.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  const known = new Map(Object.entries(KNOWN_CALLSIGNS).map(([k, v]) => [normFn(k), v]));
  const unique = new Map<string, Entry>();
  for (const e of idx.values()) unique.set(`${e.sched.type}:${normFn(e.sched.flightNumber)}`, e);
  const taken = new Set<string>();
  const place = (a: Snap['ac'][number], m: Entry, via: RadarAircraft['via']) => {
    const dist = distanceNm(TIV.lat, TIV.lon, a.lat, a.lon);
    if (dist > RADIUS_NM + 5) return;
    taken.add(`${m.sched.type}:${normFn(m.sched.flightNumber)}`);
    matched.add(normFn(m.sched.flightNumber));
    const eta = m.sched.type === 'arrival' && !a.gnd ? etaMinutes(dist, a.gs) : null;
    aircraft.push({
      ...a, via, dist: +dist.toFixed(1), brg: Math.round(bearingDeg(TIV.lat, TIV.lon, a.lat, a.lon)),
      etaMin: eta == null ? null : Math.round(eta * 10) / 10,
      sched: { fn: m.sched.flightNumber, type: m.sched.type, city: m.sched.city, std: m.sched.std, etd: m.sched.etd, status: m.sched.status, atMs: m.sched.atMs },
    });
  };
  const rest: Snap['ac'] = [];
  for (const a of snap?.ac ?? []) {
    const fnKnown = known.get(normFn(a.cs));
    const m = (fnKnown ? matchFlightNumber(fnKnown, idx) : null) ?? matchCallsign(a.cs, idx);
    if (m) place(a, m, fnKnown ? 'map' : 'cs'); else rest.push(a);
  }
  // Procjena po vremenu za callsign-ove bez broja leta (najbliži TIV-u prvi).
  rest.sort((x, y) => distanceNm(TIV.lat, TIV.lon, x.lat, x.lon) - distanceNm(TIV.lat, TIV.lon, y.lat, y.lon));
  for (const a of rest) {
    const cands = [...unique.entries()].filter(([k]) => !taken.has(k)).map(([, e]) => e);
    const m = heuristicMatch(a, cands, now);
    if (m) { place(a, m, 'est'); continue; }
    others++;
    if (wantAll) {
      const d = distanceNm(TIV.lat, TIV.lon, a.lat, a.lon);
      if (d <= RADIUS_NM + 5) allOthers.push({ ...a, dist: +d.toFixed(1), brg: Math.round(bearingDeg(TIV.lat, TIV.lon, a.lat, a.lon)) });
    }
  }
  aircraft.sort((x, y) => x.dist - y.dist);

  const body: RadarResponse = {
    now, fetchedAt: snap?.at ?? null, mode: plan.mode, intervalSec: plan.intervalSec, next: plan.next,
    aircraft, pending: pendingFlights(arrivals, departures, matched, now), ground, others, stale, note: note ?? null,
    ...(wantAll ? { allOthers } : {}),
  };
  return NextResponse.json(body, { headers: { 'Cache-Control': 'no-store' } });
}
