// app/api/test/assignments/route.ts
import { NextResponse } from 'next/server';
import { getRawAssignments, buildSimpleMaps } from '@/lib/assignments-service';
import { createHash } from 'crypto';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const raw = await getRawAssignments();
    const simple = buildSimpleMaps(raw);

    const responseBody = {
      // ── FlightBoard format (flightNumber -> deskNumber/gateNumber) ──
      desks: simple.desks,
      gates: simple.gates,
      // ── Admin panel format (deskNumber/gateNumber -> puni entry) ──
      deskEntries: raw.desks,
      gateEntries: raw.gates,
    };

    // ── IZRAČUNAJ ETag ────────────────────────────────────────
    const hash = createHash('md5')
      .update(JSON.stringify(responseBody))
      .digest('hex')
      .substring(0, 16);
    const etag = `"${hash}"`;

    // ── PROVJERI If-None-Match ────────────────────────────────
    const ifNoneMatch = request.headers.get('if-none-match');
    if (ifNoneMatch && ifNoneMatch === etag) {
      return new NextResponse(null, {
        status: 304,
        headers: {
          'ETag': etag,
        'Cache-Control': 'private, no-cache',
        },
      });
    }

    return NextResponse.json(responseBody, {
      headers: {
       'Cache-Control': 'private, no-cache',
        'ETag': etag,
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