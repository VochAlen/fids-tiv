// app/api/health/route.ts
//
// FIX (24/7/365 self-recovery audit — nedostajao je BILO KAKAV način
// da se sistemsko zdravlje provjeri automatski): prošli health-ish
// endpoint (app/api/flights/status) je penzionisan tokom ranijeg
// čišćenja, i nikad zamijenjen. Bez ovoga, "self-recovery" arhitektura
// (fallback na backup podatke, Redis circuit breaker, itd.) je
// NEVIDLJIVA — sistem može raditi u degradiranom stanju danima a da
// niko ne zna dok se fizički ne pogleda ekran.
//
// NAMJENA: ovo NIJE zamjena za /api/flights (koji i dalje treba da
// bude što je moguće jeftiniji i brži za 40+ kiosk ekrana) — ovo je
// SEPARATE, lagana ruta namijenjena EKSTERNOM monitoring servisu
// (npr. besplatan UptimeRobot/BetterStack ping na ovaj URL svakih par
// minuta, ili Vercel Cron Job koji ovo provjerava i šalje Slack/email
// upozorenje ako status nije "healthy"). Sama po sebi NE šalje
// upozorenja — samo IZVJEŠTAVA stanje; alarm treba spojiti spolja.
//
// STATUS KODOVI (standardna konvencija za health-check rute):
//   200 = healthy   — sve radi normalno, uživo podaci
//   207 = degraded  — sistem RADI (self-recovery je uspio), ali servira
//                     stare/backup podatke jer uživo izvor trenutno ne
//                     radi — vrijedi provjeriti ngrok tunel/uzvodni izvor
//   503 = unhealthy — Redis nedostupan ILI nema podataka nijednog izvora
import { NextResponse } from 'next/server';
import { getRedisClient } from '@/lib/redis';
import { getCurrentFlightDataSafe } from '@/lib/flight-data-service';

export const dynamic = 'force-dynamic';

export async function GET() {
  const checks: Record<string, unknown> = {};
  let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';

  // ── 1. Redis ──────────────────────────────────────────────
  const redisStart = Date.now();
  try {
    const client = getRedisClient();
    await client.ping();
    checks.redis = { ok: true, latencyMs: Date.now() - redisStart };
  } catch (err) {
    checks.redis = {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
    status = 'unhealthy';
  }

  // ── 2. Izvor podataka o letovima ─────────────────────────────
  // getCurrentFlightDataSafe() čita KEŠ prvo (isti put kao /api/flights
  // za 40+ kiosk ekrana) — ovaj poziv NE pokreće dodatan uživo fetch
  // osim ako je keš već istekao za SVE ostale ekrane, u kom slučaju bi
  // se to desilo bez obzira na ovaj health-check.
  try {
    const flightStart = Date.now();
    const data = await getCurrentFlightDataSafe();
    const usingFallback = data.source === 'live-alternate' || data.source === 'backup' || data.source === 'auto-processed' || data.source === 'emergency';

    checks.flightData = {
      ok: true,
      source: data.source || 'unknown',
      totalFlights: data.totalFlights,
      lastUpdated: data.lastUpdated,
      isOfflineMode: !!data.isOfflineMode,
      warning: data.warning || null,
      latencyMs: Date.now() - flightStart,
    };

    if (data.source === 'emergency' && data.totalFlights === 0) {
      // Svi izvori (uživo I backup) su pali — nema apsolutno ništa za
      // prikaz. Ovo je stanje koje ZAHTIJEVA ljudsku pažnju bez obzira
      // na self-recovery arhitekturu (nema šta više da se automatski
      // pokuša).
      status = 'unhealthy';
    } else if (usingFallback && status === 'healthy') {
      // Self-recovery RADI (nešto se prikazuje), ali servira se
      // stari/backup podatak — vrijedi znati, ne treba paničiti.
      status = 'degraded';
    }
  } catch (err) {
    checks.flightData = {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
    status = 'unhealthy';
  }

  const statusCode = status === 'healthy' ? 200 : status === 'degraded' ? 207 : 503;

  return NextResponse.json(
    {
      status,
      timestamp: new Date().toISOString(),
      checks,
    },
    {
      status: statusCode,
      headers: { 'Cache-Control': 'no-store, max-age=0' },
    },
  );
}
