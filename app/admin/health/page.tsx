// app/admin/health/page.tsx
//
// Moderna, auto-refresh dashboard stranica za /api/admin/health.
// Čisto administrativna vidljivost — ne dira kiosk ekrane, ne poll-uje
// ništa dok neko fizički ne otvori ovu stranicu. Štiti je isti
// middleware.ts admin-auth koji već štiti ostatak /admin/* (nema
// dodatne auth logike ovdje).
//
// Auto-refresh je na 15s dok je tab aktivan/fokusiran — pauzira se kad
// se tab minimizuje/promijeni (isti obrazac kao ostatak sistema:
// Page Visibility API, da ne trošimo pozive dok niko ne gleda).

'use client';

import { useEffect, useState, useCallback, useRef } from 'react';

// ─── Tipovi (ogledalo app/api/admin/health/route.ts) ───────────────
interface StaleAssignment {
  type: 'desk' | 'gate';
  resourceId: string;
  flightNumber: string;
  openSinceMinutesAgo: number;
}

interface HealthChecks {
  redis: {
    ok: boolean;
    circuitOpen: boolean;
    recentFailures: number;
    latencyMs: number | null;
  };
  flightData: {
    ok: boolean;
    source: string;
    isOfflineMode: boolean;
    lastUpdated: string | null;
    totalFlights: number;
    warning: string | null;
  };
  assignments: {
    openDesks: number;
    openGates: number;
    staleAssignments: StaleAssignment[];
  };
}

interface HealthResponse {
  status: 'healthy' | 'degraded';
  checks: HealthChecks;
  checkedAt: string;
}

const REFRESH_MS = 15_000;

// ─── Pomoćne funkcije za prikaz ─────────────────────────────────────
function formatMinutes(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m} min`;
  return `${h}h ${m}min`;
}

function formatTime(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleTimeString('sr-Latn-ME', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return iso;
  }
}

function StatusDot({ ok }: { ok: boolean }) {
  return (
    <span
      className={`inline-block h-2.5 w-2.5 rounded-full ${
        ok ? 'bg-emerald-500' : 'bg-red-500'
      } ${ok ? '' : 'animate-pulse'}`}
    />
  );
}

function Card({
  title,
  ok,
  children,
}: {
  title: string;
  ok: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`rounded-xl border bg-white p-5 shadow-sm transition-colors ${
        ok ? 'border-gray-200' : 'border-red-300 bg-red-50'
      }`}
    >
      <div className="mb-3 flex items-center gap-2">
        <StatusDot ok={ok} />
        <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-700">
          {title}
        </h3>
      </div>
      {children}
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-1 text-sm">
      <span className="text-gray-500">{label}</span>
      <span className="font-medium text-gray-900">{value}</span>
    </div>
  );
}

// ─── Glavna komponenta ───────────────────────────────────────────────
export default function AdminHealthPage() {
  const [data, setData] = useState<HealthResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastFetchedAt, setLastFetchedAt] = useState<Date | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchHealth = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/health', { cache: 'no-store' });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const json: HealthResponse = await res.json();
      setData(json);
      setError(null);
      setLastFetchedAt(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nepoznata greška');
    } finally {
      setLoading(false);
    }
  }, []);

  // Prvi fetch odmah pri otvaranju stranice.
  useEffect(() => {
    fetchHealth();
  }, [fetchHealth]);

  // Auto-refresh + pauza kad tab nije vidljiv (Page Visibility API) —
  // isti obrazac kao ostatak sistema, da ne trošimo pozive uludo.
  useEffect(() => {
    if (!autoRefresh) {
      if (intervalRef.current) clearInterval(intervalRef.current);
      return;
    }

    const tick = () => {
      if (document.visibilityState === 'visible') fetchHealth();
    };

    intervalRef.current = setInterval(tick, REFRESH_MS);

    const onVisibility = () => {
      if (document.visibilityState === 'visible') fetchHealth();
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [autoRefresh, fetchHealth]);

  const overallOk = data?.status === 'healthy';

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-8 sm:px-8">
      <div className="mx-auto max-w-4xl">
        {/* Header */}
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-gray-900">
              Sistem — Health Check
            </h1>
            <p className="text-sm text-gray-500">
              FIDS TIV · admin dijagnostika
            </p>
          </div>
          <div className="flex items-center gap-3">
            <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-600">
              <input
                type="checkbox"
                checked={autoRefresh}
                onChange={(e) => setAutoRefresh(e.target.checked)}
                className="h-4 w-4 rounded border-gray-300"
              />
              Auto-refresh (15s)
            </label>
            <button
              onClick={fetchHealth}
              disabled={loading}
              className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-gray-700 disabled:opacity-50"
            >
              Osvježi
            </button>
          </div>
        </div>

        {/* Overall status banner */}
        {data && (
          <div
            className={`mb-6 flex items-center justify-between rounded-xl px-5 py-4 text-white shadow-sm ${
              overallOk ? 'bg-emerald-600' : 'bg-red-600'
            }`}
          >
            <div className="flex items-center gap-3">
              <span
                className={`h-3 w-3 rounded-full bg-white ${
                  overallOk ? '' : 'animate-pulse'
                }`}
              />
              <span className="text-base font-semibold">
                {overallOk ? 'Sistem radi normalno' : 'Sistem ima problema — provjeri detalje ispod'}
              </span>
            </div>
            <span className="text-sm opacity-90">
              provjereno u {formatTime(data.checkedAt)}
            </span>
          </div>
        )}

        {error && (
          <div className="mb-6 rounded-xl border border-red-300 bg-red-50 px-5 py-4 text-sm text-red-700">
            Health provjera nije uspjela: {error}
          </div>
        )}

        {loading && !data && (
          <div className="rounded-xl border border-gray-200 bg-white p-8 text-center text-gray-400">
            Učitavanje…
          </div>
        )}

        {data && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {/* Redis */}
            <Card title="Redis" ok={data.checks.redis.ok}>
              <Row
                label="Circuit breaker"
                value={data.checks.redis.circuitOpen ? 'OTVOREN ⚠️' : 'zatvoren'}
              />
              <Row label="Skorašnji failovi" value={data.checks.redis.recentFailures} />
              <Row
                label="Latencija"
                value={
                  data.checks.redis.latencyMs !== null
                    ? `${data.checks.redis.latencyMs} ms`
                    : '—'
                }
              />
            </Card>

            {/* Flight data */}
            <Card title="Flight podaci" ok={data.checks.flightData.ok}>
              <Row label="Izvor" value={data.checks.flightData.source} />
              <Row
                label="Offline mode"
                value={data.checks.flightData.isOfflineMode ? 'DA ⚠️' : 'ne'}
              />
              <Row
                label="Letovi (ukupno)"
                value={data.checks.flightData.totalFlights}
              />
              <Row
                label="Zadnje ažurirano"
                value={formatTime(data.checks.flightData.lastUpdated)}
              />
              {data.checks.flightData.warning && (
                <p className="mt-2 rounded bg-amber-50 px-2 py-1 text-xs text-amber-700">
                  {data.checks.flightData.warning}
                </p>
              )}
            </Card>

            {/* Assignments */}
            <Card
              title="Dodjele"
              ok={data.checks.assignments.staleAssignments.length === 0}
            >
              <Row label="Otvoreni šalteri" value={data.checks.assignments.openDesks} />
              <Row label="Otvoreni gate-ovi" value={data.checks.assignments.openGates} />
              <Row
                label="Zaglavljene"
                value={data.checks.assignments.staleAssignments.length}
              />
            </Card>
          </div>
        )}

        {/* Stale assignments detail table */}
        {data && data.checks.assignments.staleAssignments.length > 0 && (
          <div className="mt-6 overflow-hidden rounded-xl border border-amber-300 bg-white shadow-sm">
            <div className="border-b border-amber-200 bg-amber-50 px-5 py-3">
              <h3 className="text-sm font-semibold text-amber-800">
                ⚠️ Dodjele otvorene predugo — provjeri da nisu zaboravljene
              </h3>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-left text-gray-500">
                  <th className="px-5 py-2 font-medium">Tip</th>
                  <th className="px-5 py-2 font-medium">Broj</th>
                  <th className="px-5 py-2 font-medium">Let</th>
                  <th className="px-5 py-2 font-medium">Otvoreno</th>
                </tr>
              </thead>
              <tbody>
                {data.checks.assignments.staleAssignments
                  .sort((a, b) => b.openSinceMinutesAgo - a.openSinceMinutesAgo)
                  .map((s) => (
                    <tr key={`${s.type}-${s.resourceId}`} className="border-b border-gray-50 last:border-0">
                      <td className="px-5 py-2 capitalize text-gray-700">
                        {s.type === 'desk' ? 'Šalter' : 'Gate'}
                      </td>
                      <td className="px-5 py-2 font-medium text-gray-900">{s.resourceId}</td>
                      <td className="px-5 py-2 text-gray-700">{s.flightNumber || '—'}</td>
                      <td className="px-5 py-2 font-medium text-amber-700">
                        {formatMinutes(s.openSinceMinutesAgo)}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}

        {lastFetchedAt && (
          <p className="mt-4 text-center text-xs text-gray-400">
            Zadnji fetch u browseru: {lastFetchedAt.toLocaleTimeString('sr-Latn-ME')}
          </p>
        )}
      </div>
    </div>
  );
}
