// app/api/admin/overview/route.ts
//
// Pregled šaltera i gate-ova za /admin/overview: stanje dodjela (otvoreno/zatvoreno, let, od kada) + status monitora.
// Lakša od /api/admin/health (nema Ably/Redis INFO/učenja): 3 čitanja Redisa (dodjele su u 8 s in-process kešu, monitori HGETALL).
// Poziva se samo dok je stranica otvorena i tab vidljiv.
import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';
import { getRawAssignments } from '@/lib/assignments-service';
import { loadKiosks } from '@/lib/kiosk-status-server';
import { isNightHours } from '@/lib/night-hours';
import type { OpenTruth } from '@/lib/kiosk-health';
import type { OverviewResource, OverviewResponse } from '@/lib/overview-types';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type RawEntry = { status: 'open' | 'closed' | null; flightNumber: string | null; setAt: number | null };

export async function GET(request: Request) {
  const { error: authError } = await requireAdmin(request);
  if (authError) return authError;

  const now = Date.now();
  const desks: Record<string, OverviewResource> = {};
  const gates: Record<string, OverviewResource> = {};
  const open: OpenTruth[] = [];
  let ok = true;

  try {
    const raw = await getRawAssignments();
    ok = raw.ok !== false;
    const collect = (type: 'desk' | 'gate', entries: Record<string, RawEntry>, out: Record<string, OverviewResource>) => {
      for (const [id, e] of Object.entries(entries ?? {})) {
        if (e?.status !== 'open' && e?.status !== 'closed') continue;
        const sinceMin = e.setAt ? Math.max(0, Math.round((now - e.setAt) / 60_000)) : 0;
        out[id] = { status: e.status, flight: e.flightNumber || '', sinceMin };
        if (e.status === 'open') open.push({ type, resourceId: id, flightNumber: e.flightNumber || '', openSinceMinutesAgo: sinceMin });
      }
    };
    collect('desk', raw.desks as Record<string, RawEntry>, desks);
    collect('gate', raw.gates as Record<string, RawEntry>, gates);
  } catch (err) {
    ok = false;
    console.error('[admin/overview] dodjele:', err instanceof Error ? err.message : err);
  }

  let kiosks: OverviewResponse['kiosks'] = [];
  try {
    kiosks = await loadKiosks(open);
  } catch (err) {
    console.error('[admin/overview] monitori:', err instanceof Error ? err.message : err);
  }

  const body: OverviewResponse = { checkedAt: new Date(now).toISOString(), night: isNightHours(), ok, desks, gates, kiosks };
  return NextResponse.json(body, { headers: { 'Cache-Control': 'no-store' } });
}
