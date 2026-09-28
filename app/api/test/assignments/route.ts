// app/api/test/assignments/route.ts
import { NextResponse } from 'next/server';
import { getRawAssignments, buildSimpleMaps } from '@/lib/assignments-service';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const raw = await getRawAssignments();
    const simple = buildSimpleMaps(raw);

    // NOVO (KRITIČNO — vidi opširan komentar uz `ok` polje u
    // lib/assignments-service.ts, RawAssignments): ako Redis čitanje
    // nije uspjelo, `raw.desks`/`raw.gates` mogu biti (best-effort)
    // POSLEDNJI POZNAT keš, ne garantovano svjež pun snapshot — klijent
    // (hooks/useRealtimeAssignments.ts, fetchSnapshot) MORA dobiti
    // eksplicitan `ok: false` da zna da NE SMIJE ovaj odgovor
    // upotrijebiti za merge (koji sad ispravno briše ključeve koji
    // nedostaju — na lažno/zastarjelo praznom odgovoru bi to obrisalo
        // sve aktivne dodjele na SVIM kioscima odjednom). Cache-Control se
    // takođe NE SMIJE keširati na CDN-u u ovom slučaju — inače bi CDN
    // servirao ISTI degradiran odgovor svim kioscima do isteka keša.
    if (!raw.ok) {
      return NextResponse.json({
        desks: simple.desks,
        gates: simple.gates,
        deskEntries: raw.desks,
        gateEntries: raw.gates,
        ok: false,
      }, { headers: { 'Cache-Control': 'no-store' } });
    }

    return NextResponse.json({
      // ── FlightBoard format (flightNumber -> deskNumber/gateNumber) ──
      desks: simple.desks,
      gates: simple.gates,
      // ── Admin panel format (deskNumber/gateNumber -> puni entry) ──
      deskEntries: raw.desks,
      gateEntries: raw.gates,
      ok: true,
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
    // NOVO (KRITIČNO — isti razlog kao gore): ranije se ovdje vraćalo
    // lažno prazno {} sa HTTP 200 i BEZ ikakvog signala da nešto nije u
    // redu — klijentov mergeNewer bi to (sad ispravno, prema svojoj
    // popravljenoj logici) protumačio kao "sve obrisano na serveru".
    // `ok: false` govori klijentu da ovaj odgovor potpuno ignoriše.
    return NextResponse.json(
      { desks: {}, gates: {}, deskEntries: {}, gateEntries: {}, ok: false },
      { status: 200, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}