// app/api/admin/health/route.ts
//
// Read-only dijagnostička ruta: agregira brze provjere (Redis, Ably, podaci o letovima, dodjele, učenje,
// sistem) u JEDAN poziv. Poziva se samo kad neko otvori /admin/health (i dok je tab vidljiv) — ne dira
// kiosk ekrane i nema vlastiti interval.
//
// 2026-10-20: (1) zaštićeno requireAdmin (ranije javno); (2) dodato: Ably, Redis INFO (memorija, ključevi,
// hit rate), starost podataka o letovima, lista SVIH otvorenih dodjela, učenje (tačnost + samoprovjera),
// sistemski podaci, trajanje provjere, i lista "issues" sa preporukom šta uraditi.
//
// STALE pragovi (zaboravljene dodjele): šalter 4 h, gate 3 h — gornja granica uobičajenog trajanja.
import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';
import { getRedisClient, isCircuitOpen, getCircuitFailureCount } from '@/lib/redis';
import { getCurrentFlightDataSafe } from '@/lib/flight-data-service';
import { getRawAssignments } from '@/lib/assignments-service';
import { getAblyRest } from '@/lib/ably-server';
import { getPodgoricaMinutesOfDay, getPodgoricaDateString, isNightHours } from '@/lib/night-hours';
import { LEARN_HASH_KEY, summarizeAccuracy, recentWeekKeys, type LearnKind } from '@/lib/assignment-learning';
import { EXAMPLES_HASH_KEY } from '@/lib/assignment-model';
import { decideGate } from '@/lib/learning-gate';
import { BUILD_ID } from '@/lib/build-id';
import { KIOSK_HASH_KEY } from '@/lib/kiosk-beacon';
import { classifyKiosks, parseStoredKiosks, KIOSK_FORGET_AFTER_DAYS, type KioskInfo } from '@/lib/kiosk-health';
import type {
  HealthIssue, HealthResponse, OpenAssignment, LearningKindSummary, RedisCheck, AblyCheck,
} from '@/lib/health-types';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const STALE_ASSIGNMENT_HOURS: Record<'desk' | 'gate', number> = { desk: 4, gate: 3 };
const REDIS_SLOW_MS = 200;
const ABLY_SLOW_MS = 1500;
const ABLY_TIMEOUT_MS = 3000;
const FLIGHT_STALE_WARN_MIN = 10;
const FLIGHT_STALE_ERROR_MIN = 30;
const MEMORY_WARN_RATIO = 0.8;

function parseInfo(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    if (!line || line.startsWith('#')) continue;
    const i = line.indexOf(':');
    if (i > 0) out[line.slice(0, i)] = line.slice(i + 1).trim();
  }
  return out;
}
const num = (v: string | undefined): number | null => {
  if (v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let t: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, rej) => { t = setTimeout(() => rej(new Error(`timeout ${ms} ms`)), ms); });
  try { return await Promise.race([p, timeout]); } finally { clearTimeout(t!); }
}

async function checkRedis(): Promise<RedisCheck> {
  const r: RedisCheck = {
    ok: true, circuitOpen: false, recentFailures: 0, latencyMs: null,
    version: null, uptimeSec: null, usedMemoryBytes: null, maxMemoryBytes: null,
    connectedClients: null, keys: null, hitRate: null, evictedKeys: null,
  };
  try {
    const client = getRedisClient();
    const start = Date.now();
    await client.ping();
    r.latencyMs = Date.now() - start;
    r.circuitOpen = isCircuitOpen();
    r.recentFailures = getCircuitFailureCount();
    r.ok = !r.circuitOpen;
    // Dopunski podaci — greška ovdje (npr. INFO zabranjen) NE znači da Redis ne radi.
    try {
      const [info, keys] = await Promise.all([client.info(), client.dbsize()]);
      const m = parseInfo(info);
      r.version = m.redis_version ?? null;
      r.uptimeSec = num(m.uptime_in_seconds);
      r.usedMemoryBytes = num(m.used_memory);
      const max = num(m.maxmemory);
      r.maxMemoryBytes = max && max > 0 ? max : null;
      r.connectedClients = num(m.connected_clients);
      r.keys = keys;
      const hits = num(m.keyspace_hits) ?? 0, misses = num(m.keyspace_misses) ?? 0;
      r.hitRate = hits + misses > 0 ? hits / (hits + misses) : null;
      r.evictedKeys = num(m.evicted_keys);
    } catch { /* INFO nije dostupan */ }
  } catch (err) {
    r.ok = false;
    console.error('[admin/health] Redis ping failed:', err);
  }
  return r;
}

async function checkAbly(): Promise<AblyCheck> {
  if (!process.env.ABLY_API_KEY) return { ok: false, configured: false, latencyMs: null, error: 'ABLY_API_KEY nije postavljen' };
  const start = Date.now();
  try {
    await withTimeout(getAblyRest().time(), ABLY_TIMEOUT_MS);
    return { ok: true, configured: true, latencyMs: Date.now() - start, error: null };
  } catch (err) {
    return { ok: false, configured: true, latencyMs: null, error: err instanceof Error ? err.message : 'greška' };
  }
}

async function checkFlights(): Promise<HealthResponse['checks']['flightData']> {
  const f: HealthResponse['checks']['flightData'] = {
    ok: true, source: 'unknown', isOfflineMode: false, lastUpdated: null, ageMinutes: null,
    totalFlights: 0, departures: 0, arrivals: 0, warning: null,
  };
  try {
    const data = await getCurrentFlightDataSafe();
    f.source = data.source || 'unknown';
    f.isOfflineMode = !!data.isOfflineMode;
    f.lastUpdated = data.lastUpdated;
    f.departures = data.departures?.length || 0;
    f.arrivals = data.arrivals?.length || 0;
    f.totalFlights = f.departures + f.arrivals;
    f.warning = data.warning || null;
    f.ok = !data.isOfflineMode;
    const t = data.lastUpdated ? Date.parse(data.lastUpdated) : NaN;
    if (Number.isFinite(t)) f.ageMinutes = Math.max(0, Math.round((Date.now() - t) / 60_000));
  } catch (err) {
    f.ok = false;
    console.error('[admin/health] Flight data check failed:', err);
  }
  return f;
}

async function checkAssignments(): Promise<HealthResponse['checks']['assignments']> {
  const a: HealthResponse['checks']['assignments'] = { openDesks: 0, openGates: 0, staleAssignments: [], open: [] };
  try {
    const raw = await getRawAssignments();
    const now = Date.now();
    const collect = (type: 'desk' | 'gate', entries: Record<string, { status: 'open' | 'closed' | null; flightNumber: string | null; setAt: number | null }>) => {
      for (const [resourceId, e] of Object.entries(entries)) {
        if (e?.status !== 'open') continue;
        const mins = e.setAt ? Math.max(0, Math.round((now - e.setAt) / 60_000)) : 0;
        const stale = !!e.setAt && mins >= STALE_ASSIGNMENT_HOURS[type] * 60;
        const item: OpenAssignment = { type, resourceId, flightNumber: e.flightNumber || '', openSinceMinutesAgo: mins, stale };
        a.open.push(item);
        if (stale) a.staleAssignments.push({ type, resourceId, flightNumber: item.flightNumber, openSinceMinutesAgo: mins });
        if (type === 'desk') a.openDesks++; else a.openGates++;
      }
    };
    collect('desk', raw.desks);
    collect('gate', raw.gates);
    const byNum = (x: OpenAssignment, y: OpenAssignment) => Number(x.resourceId) - Number(y.resourceId);
    a.open.sort((x, y) => (x.type === y.type ? byNum(x, y) : x.type === 'desk' ? -1 : 1));
  } catch (err) {
    console.error('[admin/health] Assignments check failed:', err);
  }
  return a;
}

/** Minuta od kraja noćnog režima (null = noć je). Traži unazad u koracima od 5 min (max 12 h). */
function minutesSinceDayStart(now: number): number | null {
  if (isNightHours(new Date(now))) return null;
  for (let m = 5; m <= 12 * 60; m += 5) {
    if (isNightHours(new Date(now - m * 60_000))) return m;
  }
  return 12 * 60;
}

async function checkKiosks(redisOk: boolean, open: OpenAssignment[]): Promise<KioskInfo[]> {
  if (!redisOk) return [];
  try {
    const client = getRedisClient();
    const hash = await client.hgetall(KIOSK_HASH_KEY);
    const stored = parseStoredKiosks(hash);
    const now = Date.now();
    // zaboravi monitore koji se nisu javili 14 dana (ugašeni/preimenovani) — da lista ne raste
    const old = stored.filter((k) => now - k.seen > KIOSK_FORGET_AFTER_DAYS * 86_400_000).map((k) => k.id);
    if (old.length) client.hdel(KIOSK_HASH_KEY, ...old).catch(() => {});
    return classifyKiosks(
      stored.filter((k) => !old.includes(k.id)),
      open,
      { now, night: isNightHours(), minutesSinceDayStart: minutesSinceDayStart(now), currentBuild: BUILD_ID },
    );
  } catch (err) {
    console.error('[admin/health] Kiosks check failed:', err);
    return [];
  }
}

async function checkLearning(redisOk: boolean): Promise<HealthResponse['checks']['learning']> {
  if (!redisOk) return null;
  try {
    const client = getRedisClient();
    const [raw, exampleCount] = await Promise.all([client.hgetall(LEARN_HASH_KEY), client.hlen(EXAMPLES_HASH_KEY)]);
    const today = getPodgoricaDateString();
    const weeks = recentWeekKeys(today, 4);
    const summarize = (kind: LearnKind): LearningKindSummary => {
      const s = summarizeAccuracy(raw, kind, weeks);
      const bySource = (Object.entries(s.bySource) as Array<[string, { hit: number; miss: number }]>)
        .filter(([src, b]) => src !== 'none' && b.hit + b.miss > 0)
        .map(([source, b]) => ({ source, n: b.hit + b.miss, rate: b.hit / (b.hit + b.miss) }));
      return { hitRate: s.hitRate, evaluated: s.evaluated, applied: s.total.applied, bySource, distrust: decideGate(raw, kind, today).distrust };
    };
    return { counterFields: Object.keys(raw ?? {}).length, exampleCount, desk: summarize('desk'), gate: summarize('gate') };
  } catch (err) {
    console.error('[admin/health] Learning check failed:', err);
    return null;
  }
}

function buildIssues(c: HealthResponse['checks'], night: boolean): HealthIssue[] {
  const out: HealthIssue[] = [];
  const { redis, ably, flightData: fd, assignments, learning, kiosks } = c;
  if (!redis.ok) {
    out.push({
      severity: 'error',
      title: redis.circuitOpen ? 'Redis: circuit breaker je otvoren' : 'Redis ne odgovara',
      hint: 'Dodjele i sinhronizacija mogu zakasniti. Provjeri Redis servis; sistem se sam oporavlja kad Redis proradi.',
    });
  } else {
    if (redis.latencyMs !== null && redis.latencyMs > REDIS_SLOW_MS) out.push({ severity: 'warn', title: `Redis je spor (${redis.latencyMs} ms)`, hint: 'Normalno je ispod ~50 ms. Povremeni skokovi nisu problem; stalno visoko jeste.' });
    if (redis.usedMemoryBytes !== null && redis.maxMemoryBytes && redis.usedMemoryBytes / redis.maxMemoryBytes > MEMORY_WARN_RATIO) {
      out.push({ severity: 'warn', title: 'Redis memorija je preko 80%', hint: 'Provjeri ključeve koji rastu (npr. lib/redis cleanup cron).' });
    }
    if (redis.evictedKeys) out.push({ severity: 'warn', title: `Redis je izbacio ${redis.evictedKeys} ključeva zbog memorije`, hint: 'Ključevi su brisani zbog nedostatka memorije.' });
  }
  if (!ably.configured) out.push({ severity: 'error', title: 'Ably nije podešen', hint: 'ABLY_API_KEY nedostaje u okruženju.' });
  else if (!ably.ok) out.push({ severity: 'error', title: 'Ably nije dostupan', hint: `Realtime ne radi (${ably.error}). Kiosci se oslanjaju na periodično osvježavanje (do 5 min kašnjenja).` });
  else if (ably.latencyMs !== null && ably.latencyMs > ABLY_SLOW_MS) out.push({ severity: 'warn', title: `Ably je spor (${ably.latencyMs} ms)` });
  if (fd.isOfflineMode) out.push({ severity: 'error', title: 'Podaci o letovima su u offline modu', hint: fd.warning ?? 'Izvor podataka nije dostupan; prikazuje se zadnja sačuvana verzija.' });
  if (fd.ageMinutes !== null && !night) {
    if (fd.ageMinutes >= FLIGHT_STALE_ERROR_MIN) out.push({ severity: 'error', title: `Podaci o letovima stari ${fd.ageMinutes} min`, hint: 'Cron flight-sync bi trebalo da osvježava svaka 3 min. Provjeri Vercel Cron i izvor podataka.' });
    else if (fd.ageMinutes >= FLIGHT_STALE_WARN_MIN) out.push({ severity: 'warn', title: `Podaci o letovima stari ${fd.ageMinutes} min`, hint: 'Očekivano je osvježavanje svaka ~3 min.' });
  }
  if (assignments.staleAssignments.length) {
    out.push({ severity: 'warn', title: `${assignments.staleAssignments.length} dodjela otvoreno predugo`, hint: 'Provjeri da nisu zaboravljene (vidi tabelu ispod).' });
  }
  if (learning) {
    for (const [label, k] of [['šalteri', learning.desk], ['gate-ovi', learning.gate]] as const) {
      if (k.distrust) out.push({ severity: 'warn', title: `Učenje (${label}): naučeni šabloni privremeno isključeni`, hint: 'Zadnje 4 sedmice pogađaju jasno lošije od ručnog profila; važi profil dok se ne poprave.' });
    }
  }
  const silent = kiosks.filter((k) => k.status === 'silent');
  if (silent.length) {
    const names = silent.slice(0, 6).map((k) => k.id).join(', ') + (silent.length > 6 ? ` +${silent.length - 6}` : '');
    out.push({ severity: 'error', title: `${silent.length} monitor(a) se ne javlja: ${names}`, hint: 'Nema izvještaja duže od 17 min. Provjeri da je računar uključen, da aplikacija radi i da ima mreže; ako je tab zaglavljen, restart klijenta.' });
  }
  const mism = kiosks.filter((k) => k.status === 'mismatch');
  if (mism.length) {
    const names = mism.slice(0, 6).map((k) => `${k.id} (prikazuje ${k.view === 'open' ? k.flight || '?' : k.view}, treba ${k.expected})`).join('; ');
    out.push({ severity: 'warn', title: `${mism.length} monitor(a) prikazuje drugo od onoga što piše u bazi: ${names}`, hint: 'Dodjela postoji duže nego što je monitor to javio — monitor je vjerovatno propustio poruku. Sam bi trebalo da se ispravi pri sljedećoj provjeri.' });
  }
  const oldBuild = kiosks.filter((k) => !k.buildCurrent && k.status !== 'silent' && k.status !== 'night');
  if (oldBuild.length) out.push({ severity: 'info', title: `${oldBuild.length} monitor(a) na staroj verziji`, hint: 'Osvježit će se sama čim ekran bude idle (ili najkasnije oko 04:00).' });
  if (night) out.push({ severity: 'info', title: 'Noćni režim je aktivan', hint: 'Automatska osvježavanja kiosaka i admin telefona su pauzirana.' });
  const rank = { error: 0, warn: 1, info: 2 } as const;
  return out.sort((a, b) => rank[a.severity] - rank[b.severity]);
}

export async function GET() {
  { const { error: authError } = await requireAdmin(); if (authError) return authError; }
  const started = Date.now();

  const [redis, ably, flightData, assignments] = await Promise.all([checkRedis(), checkAbly(), checkFlights(), checkAssignments()]);
  const [learning, kiosks] = await Promise.all([checkLearning(redis.ok), checkKiosks(redis.ok, assignments.open)]);

  const night = isNightHours();
  const mins = getPodgoricaMinutesOfDay();
  const checks = { redis, ably, flightData, assignments, learning, kiosks };
  const issues = buildIssues(checks, night);
  const status: HealthResponse['status'] = !redis.ok ? 'down' : issues.some(i => i.severity !== 'info') ? 'degraded' : 'healthy';

  const body: HealthResponse = {
    status,
    checkedAt: new Date().toISOString(),
    durationMs: Date.now() - started,
    issues,
    checks,
    system: {
      nodeVersion: process.version,
      region: process.env.VERCEL_REGION ?? null,
      environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? null,
      commit: process.env.VERCEL_GIT_COMMIT_SHA ? process.env.VERCEL_GIT_COMMIT_SHA.slice(0, 7) : null,
      commitMessage: process.env.VERCEL_GIT_COMMIT_MESSAGE ? process.env.VERCEL_GIT_COMMIT_MESSAGE.slice(0, 80) : null,
      uptimeSec: Math.round(process.uptime()),
      memoryMb: Math.round(process.memoryUsage().rss / 1048576),
      airportTime: `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`,
      isNight: night,
      build: BUILD_ID,
    },
  };
  return NextResponse.json(body, { status: 200, headers: { 'Cache-Control': 'no-store' } });
}
