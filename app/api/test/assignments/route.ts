// app/api/test/assignments/route.ts
import { NextResponse } from 'next/server';
import { getRawAssignments, buildSimpleMaps } from '@/lib/assignments-service';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const raw = await getRawAssignments();
    const simple = buildSimpleMaps(raw);

    return NextResponse.json({
      // ── FlightBoard format (flightNumber -> deskNumber/gateNumber) ──
      desks: simple.desks,
      gates: simple.gates,
      // ── Admin panel format (deskNumber/gateNumber -> puni entry) ──
      deskEntries: raw.desks,
      gateEntries: raw.gates,
    }, {
      headers: {
        'Cache-Control': 'public, max-age=15, s-maxage=25, stale-while-revalidate=30',
      },
    });
  } catch (err) {
    console.error('[assignments] GET error:', err instanceof Error ? err.message : err);
    return NextResponse.json(
      { desks: {}, gates: {}, deskEntries: {}, gateEntries: {} },
      { status: 200, headers: { 'Cache-Control': 'no-cache' } }
    );
  }
}