// app/api/cron/flight-sync/route.ts
import { NextResponse } from 'next/server';
import { getCurrentFlightDataSafe } from '@/lib/flight-data-service';
import { getRedisClient } from '@/lib/redis';
import { publishToChannel } from '@/lib/ably-server';
import { isNightHours } from '@/lib/night-hours';   // ← NOVO
import { requireCronSecret } from '@/lib/admin-auth';
// NOVO (po zahtjevu — "ako let poleti a osoblje zaboravi da
// zatvori/iskloni salter, narocito na zadnjem letu dana kad osoblje
// zuri kuci, salter treba AUTOMATSKI da se oslobodi"): vidi opsiran
// komentar uz autoCloseDepartedDesks/autoCloseDepartedGates u
// lib/override-utils.ts. Poziva se ovdje (svaka 3 min, nezavisno od
// bilo koje admin akcije) umjesto da se cekaju sledeca 4h ciscenja.
import { autoCloseDepartedDesks, autoCloseDepartedGates } from '@/lib/override-utils';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const LAST_PUBLISHED_HASH_KEY = 'cache:flights:lastPublishedHash';
const FLIGHT_META_KEY = 'cache:flights:meta';

export async function GET(request: Request) {
  try {
    // ── v4: Cron secret check ──
    const cronAuth = requireCronSecret(request);
    if (cronAuth) return cronAuth;

    // ── NOĆNA BARIJERA — nikad ne publish-uj na Ably tokom noćne pauze,
    // bez obzira na hash-check ispod. Garantuje 0 Ably poruka noću,
    // čak i ako se meta-hash iz nekog razloga promijeni (npr. cache TTL istekne
    // i getCurrentFlightDataSafe vrati "prazan noćni" objekat sa drugačijim hash-om).
    if (isNightHours()) {
      return NextResponse.json({ ok: true, published: false, reason: 'night-mode' });
    }

    // Ovo interno već poštuje night-mode throttling (1x/h noću) i cache TTL —
    // ne pravi novi live fetch ako nije potrebno.
    const data = await getCurrentFlightDataSafe();

    // NOVO (po zahtjevu — vidi opširan komentar uz
    // autoCloseDepartedDesks/autoCloseDepartedGates u
    // lib/override-utils.ts): nezavisno od toga da li se flights:combined
    // hash promijenio (ispod) — auto-close mora da radi na SVAKI
    // ciklus ovog cron-a (svaka 3 min) da bi salter/gate za upravo
    // poletio/otkazan/preusmjeren let bio automatski oslobodjen brzo,
    // ne tek pri sledecoj slucajnoj admin akciji ili 4h cleanup-u.
    // Greška ovdje NE SMIJE prekinuti glavni flights:combined publish
    // ispod — odvojen try/catch.
    try {
      const allFlights = [...(data.departures || []), ...(data.arrivals || [])];
      const [closedDesks, closedGates] = await Promise.all([
        autoCloseDepartedDesks(allFlights),
        autoCloseDepartedGates(allFlights),
      ]);
      if (closedDesks.length > 0 || closedGates.length > 0) {
        console.log(`[cron/flight-sync] auto-close: šalteri=[${closedDesks.join(',')}], gate-ovi=[${closedGates.join(',')}]`);
      }
    } catch (err) {
      console.error('[cron/flight-sync] auto-close greška:', err instanceof Error ? err.message : err);
    }

    const client = getRedisClient();
    const rawMeta = await client.get(FLIGHT_META_KEY);
    const currentHash = rawMeta ? JSON.parse(rawMeta).hash : null;

    if (!currentHash) {
      return NextResponse.json({ ok: true, published: false, reason: 'no-hash' });
    }

    const lastPublishedHash = await client.get(LAST_PUBLISHED_HASH_KEY);

    if (currentHash === lastPublishedHash) {
      return NextResponse.json({ ok: true, published: false, reason: 'unchanged' });
    }

    await publishToChannel('flights:combined', 'update', data);
    await client.set(LAST_PUBLISHED_HASH_KEY, currentHash, 'EX', 6 * 60 * 60);

    console.log(`📡 Ably publish: flights:combined (hash ${currentHash})`);
    return NextResponse.json({ ok: true, published: true, hash: currentHash });
  } catch (err) {
    console.error('[cron/flight-sync] error:', err instanceof Error ? err.message : err);
    return NextResponse.json({ ok: false, error: 'sync failed' }, { status: 500 });
  }
}