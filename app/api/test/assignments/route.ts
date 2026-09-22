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
        // FIX (KRITIČNO — pravi uzrok prijavljenog "i nakon reload-a let
        // i dalje stoji dodijeljen"): max-age=15/s-maxage=25 je bio
        // predugačak TTL za rutu koja služi kao GLAVNI "istinit" izvor
        // stanja pri mount-u/reload-u svakog kiosk ekrana (checkin,
        // gate, departures, split-board) i admin panela — cache:
        // 'no-store' na klijentskoj strani (hooks/useRealtimeAssignments.ts)
        // zaobilazi SAMO browser-ov lokalni HTTP keš, ne i Vercel-ov
        // CDN keš koji ovaj header kontroliše. Ako je CDN već keširao
        // odgovor PRIJE nego što je admin uklonio dodjelu, svaki
        // naredni zahtjev (UKLJUČUJUĆI reload) je dobijao taj isti,
        // zastarjeli CDN odgovor do 25s — bez obzira na 'no-store' na
        // klijentu. Skraćeno na 2s — dovoljno za osnovnu zaštitu od
        // ekstremnog naleta zahtjeva u istom, veoma kratkom prozoru,
        // ali garantuje da reload/mount uvijek vidi stvarno svježe
        // stanje u praktičnom smislu.
        'Cache-Control': 'public, max-age=2, s-maxage=2, stale-while-revalidate=3',
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