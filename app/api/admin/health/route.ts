// app/api/admin/health/route.ts
//
// NOVO (FIDS Innovation Harness — idea #1): jednostavna, read-only
// dijagnostička ruta koja agregira nekoliko brzih provjera u JEDAN
// poziv. Motivacija: kroz ovu sesiju smo satima lovili probleme (Redis
// WRONGTYPE greška, kolizija ključeva sa glavnim sistemom, potpuno
// pokvarena statistika mjesecima) koji su bili NEVIDLJIVI dok korisnik
// nije slučajno pokazao server log — ova ruta čini tu klasu problema
// vidljivom za par sekundi, na zahtjev, umjesto tek kroz naknadnu
// istragu. Ne dodaje NIŠTA kiosk ekranima — čisto administrativna
// vidljivost, pozvana samo kad neko otvori admin health prikaz, ne na
// interval/polling.
//
// STALE_ASSIGNMENT_HOURS prag (3h) je namjerno konzervativan — cilj je
// uhvatiti OČIGLEDNO zaboravljene dodjele (šalter otvoren cijelo
// prijepodne jer ga niko nije zatvorio), ne da lažno uzbunjuje za
// legitimno duge letove. Formulisano kao "provjeri", ne "greška".
import { NextResponse } from 'next/server';
import { getRedisClient, isCircuitOpen, getCircuitFailureCount } from '@/lib/redis';
import { getCurrentFlightDataSafe } from '@/lib/flight-data-service';
import { getRawAssignments } from '@/lib/assignments-service';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// NOVO (po zahtjevu — odvojeni pragovi po tipu resursa): check-in
// šalter normalno može ostati otvoren duže (do 3-4h za veći/raniji
// let), gate obično kraće (do 2-3h) — jedinstven prag od 3h za oba bi
// ili lažno uzbunjivao za legitimno duge šaltere, ili prekasno hvatao
// zaboravljene gate-ove. Postavljeno na GORNJU granicu date procjene
// za svaki tip (4h šalter, 3h gate) — iznad toga je skoro sigurno
// zaboravljeno, ne legitiman rad.
const STALE_ASSIGNMENT_HOURS: Record<'desk' | 'gate', number> = {
  desk: 4,
  gate: 3,
};

interface StaleAssignment {
  type: 'desk' | 'gate';
  resourceId: string;
  flightNumber: string;
  openSinceMinutesAgo: number;
}

export async function GET() {
  const checks = {
    redis: { ok: true, circuitOpen: false, recentFailures: 0, latencyMs: null as number | null },
    flightData: { ok: true, source: 'unknown', isOfflineMode: false, lastUpdated: null as string | null, totalFlights: 0, warning: null as string | null },
    assignments: { openDesks: 0, openGates: 0, staleAssignments: [] as StaleAssignment[] },
  };

  // ── Redis: čist ping + trenutno stanje circuit breaker-a ──────
  try {
    const start = Date.now();
    const client = getRedisClient();
    await client.ping();
    checks.redis.latencyMs = Date.now() - start;
    checks.redis.circuitOpen = isCircuitOpen();
    checks.redis.recentFailures = getCircuitFailureCount();
    checks.redis.ok = !checks.redis.circuitOpen;
  } catch (err) {
    checks.redis.ok = false;
    console.error('[admin/health] Redis ping failed:', err);
  }

  // ── Flight podaci: izvor i svježina ────────────────────────────
  try {
    const data = await getCurrentFlightDataSafe();
    checks.flightData.source = data.source || 'unknown';
    checks.flightData.isOfflineMode = !!data.isOfflineMode;
    checks.flightData.lastUpdated = data.lastUpdated;
    checks.flightData.totalFlights = (data.departures?.length || 0) + (data.arrivals?.length || 0);
    checks.flightData.warning = data.warning || null;
    checks.flightData.ok = !data.isOfflineMode;
  } catch (err) {
    checks.flightData.ok = false;
    console.error('[admin/health] Flight data check failed:', err);
  }

  // ── Dodjele: brojevi + provjera "zaglavljenih" (predugo otvorenih) ──
  try {
    const raw = await getRawAssignments();
    const now = Date.now();

    const findStale = (type: 'desk' | 'gate', entries: typeof raw.desks | typeof raw.gates): StaleAssignment[] => {
      const stale: StaleAssignment[] = [];
      for (const [resourceId, entry] of Object.entries(entries)) {
        if (entry?.status !== 'open' || !entry.setAt) continue;
        const openMinutes = Math.round((now - entry.setAt) / 60_000);
        if (openMinutes >= STALE_ASSIGNMENT_HOURS[type] * 60) {
          stale.push({
            type,
            resourceId,
            flightNumber: entry.flightNumber || '',
            openSinceMinutesAgo: openMinutes,
          });
        }
      }
      return stale;
    };

    const openDesks = Object.values(raw.desks).filter(e => e?.status === 'open').length;
    const openGates = Object.values(raw.gates).filter(e => e?.status === 'open').length;

    checks.assignments.openDesks = openDesks;
    checks.assignments.openGates = openGates;
    checks.assignments.staleAssignments = [
      ...findStale('desk', raw.desks),
      ...findStale('gate', raw.gates),
    ];
  } catch (err) {
    console.error('[admin/health] Assignments check failed:', err);
  }

  const allOk = checks.redis.ok && checks.flightData.ok && checks.assignments.staleAssignments.length === 0;

  return NextResponse.json(
    { status: allOk ? 'healthy' : 'degraded', checks, checkedAt: new Date().toISOString() },
    { status: 200, headers: { 'Cache-Control': 'no-store' } }
  );
}
