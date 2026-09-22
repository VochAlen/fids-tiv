// app/api/test/stats/route.ts
//
// FIX (KRITIČNO — pravi uzrok konstantnog "POST /api/test/stats 405"
// u produkciji, vidljivo u logu na svaku dodjelu/uklanjanje): ova ruta
// je nekad služila SASVIM DRUGOJ svrsi (provjera svježine flight-meta
// keša preko GET-a: hash/count/lastModified) — ali njen JEDINI STVARAN
// potrošač u cijelom projektu (app/admin/assign-checkin/page.tsx,
// trackStart/trackEnd/fetchDailyStats) očekuje POTPUNO DRUGAČIJI posao:
// praćenje POČETKA/KRAJA dodjele šaltera/gate-a radi dnevne statistike
// ("koliko je let X stajao na šalteru Y"). GET nije imao POST parnjaka
// nikad, pa su trackStart/trackEnd tiho padali (405, uhvaćeno u .catch
// bez vidljive greške) — dnevna statistika NIKAD nije ni imala stvaran
// backend. Potvrđeno (grep cijelog projekta) da NIŠTA DRUGO ne koristi
// staru GET svrhu — sigurno za potpunu zamjenu na mjestu.
//
// Ključevi su NAMJERNO prefiksirani sa 'ably-fids:' — isti razlog kao
// app/api/test/desk-status-override/route.ts (vidi opširan komentar
// tamo): glavni (polling) FIDS sistem ima SVOJU, stariju verziju ove
// iste funkcije (app/api/admin/checkin-stats/route.ts) sa identičnim
// imenima ključeva ('stats:${date}:desks' itd.) — bez prefiksa bi ovo
// bila TAČNO ISTA klasa kolizije (WRONGTYPE/prepisivanje podataka
// između dva sistema) koju smo upravo pronašli i popravili za desk/
// gate-status ključeve.
import { NextResponse } from 'next/server';
import { getRedisClient } from '@/lib/redis';
import { getPodgoricaDateString } from '@/lib/night-hours';

interface StatSession {
  flight: string;
  destination: string;
  from: string;
  to: string;
  minutes: number;
}

interface DailyStats {
  desks: Record<string, StatSession[]>;
  gates: Record<string, StatSession[]>;
}

interface ActiveSession {
  flightNumber: string;
  destination: string;
  startedAtDisplay: string;
  startedAtEpoch: number;
}

interface StatsRequestBody {
  action?: 'start' | 'end';
  type?: 'desk' | 'gate';
  resourceId?: string;
  flight?: {
    FlightNumber?: string;
    DestinationCityName?: string;
    DestinationAirportCode?: string;
  };
}

const STATS_TTL_SECONDS = 3 * 24 * 60 * 60; // 3 dana — dovoljno da se dnevna statistika pogleda i sledećeg jutra, ne raste u nedogled
const ACTIVE_TTL_SECONDS = 24 * 60 * 60; // sigurnosna mreža — ako 'end' nikad ne stigne (npr. panel se zatvori usred rada)

function statsKey(date: string, type: 'desk' | 'gate'): string {
  return `ably-fids:stats:${date}:${type === 'desk' ? 'desks' : 'gates'}`;
}

function activeKey(type: 'desk' | 'gate', resourceId: string): string {
  return `ably-fids:stats:active:${type}:${resourceId}`;
}

function displayTime(d: Date): string {
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Podgorica' });
}

// FIX (bez ovoga, GET() bez dinamičkih API poziva može Next.js
// tretirati kao statičku rutu i zamrznuti odgovor preko internog Data
// Cache-a) — isti princip kao ostale test/* rute u projektu.
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const date = searchParams.get('date') || getPodgoricaDateString();

    const client = getRedisClient();
    const [desksRaw, gatesRaw] = await Promise.all([
      client.get(statsKey(date, 'desk')),
      client.get(statsKey(date, 'gate')),
    ]);

    const result: DailyStats = {
      desks: desksRaw ? JSON.parse(desksRaw) : {},
      gates: gatesRaw ? JSON.parse(gatesRaw) : {},
    };

    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('❌ /api/test/stats GET error:', error);
    // FIX: prazan, ali VALJAN oblik na grešku — StatsModal radi
    // Object.entries(data.desks)/(data.gates) bez daljih provjera, pa
    // "prazno" mora biti { desks: {}, gates: {} }, ne null/undefined.
    return NextResponse.json({ desks: {}, gates: {} }, { status: 200 });
  }
}

export async function POST(request: Request) {
  let body: StatsRequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON' }, { status: 400 });
  }

  const { action, type, resourceId, flight } = body;

  if (!action || !type || !resourceId) {
    return NextResponse.json({ success: false, error: 'Nedostaju obavezna polja' }, { status: 400 });
  }

  try {
    const client = getRedisClient();
    const now = new Date();

    if (action === 'start') {
      const session: ActiveSession = {
        flightNumber: flight?.FlightNumber || '',
        destination: flight?.DestinationCityName || flight?.DestinationAirportCode || '',
        startedAtDisplay: displayTime(now),
        startedAtEpoch: now.getTime(),
      };
      await client.set(activeKey(type, resourceId), JSON.stringify(session), 'EX', ACTIVE_TTL_SECONDS);
      return NextResponse.json({ success: true });
    }

    if (action === 'end') {
      const activeRaw = await client.get(activeKey(type, resourceId));
      if (!activeRaw) {
        // Nema aktivne sesije za ovaj resurs (npr. server restartovan
        // usred dodjele, ili end stigao bez prethodnog start-a) — nije
        // greška vrijedna 500, samo nema šta da se zabilježi.
        return NextResponse.json({ success: true, recorded: false });
      }

      const active = JSON.parse(activeRaw) as ActiveSession;
      const minutes = Math.max(0, Math.round((now.getTime() - active.startedAtEpoch) / 60_000));

      const newSession: StatSession = {
        flight: active.flightNumber,
        destination: active.destination,
        from: active.startedAtDisplay,
        to: displayTime(now),
        minutes,
      };

      const date = getPodgoricaDateString(now);
      const key = statsKey(date, type);

      // Read-modify-write — prihvatljiv rizik ovdje: dodjele su ručne,
      // rijetke akcije osoblja, ne visoko-frekventan saobraćaj gdje bi
      // race condition između dva istovremena 'end' poziva bio stvaran
      // problem u praksi.
      const existingRaw = await client.get(key);
      const existing: Record<string, StatSession[]> = existingRaw ? JSON.parse(existingRaw) : {};
      existing[resourceId] = [...(existing[resourceId] || []), newSession];

      await Promise.all([
        client.set(key, JSON.stringify(existing), 'EX', STATS_TTL_SECONDS),
        client.del(activeKey(type, resourceId)),
      ]);

      return NextResponse.json({ success: true, recorded: true, session: newSession });
    }

    return NextResponse.json({ success: false, error: 'Nepoznata akcija' }, { status: 400 });
  } catch (error) {
    console.error('❌ /api/test/stats POST error:', error);
    return NextResponse.json({ success: false, error: 'Greška pri upisu statistike' }, { status: 500 });
  }
}
