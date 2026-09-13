// app/api/admin/checkin-stats/route.ts
//
// FIX (KRITIČNO — pravi uzrok "Cannot convert undefined or null to
// object" u StatsModal-u): app/admin/assign-checkin/page.tsx je zvao
// /api/test/stats očekujući { desks: {...}, gates: {...} } sa
// istorijskim sesijama (trajanje svake dodjele) — ali ta ruta je u
// međuvremenu PRENAMIJENJENA za potpuno drugu svrhu (provjera svježine
// flight-meta keša: hash/count/lastModified). Ovo je već ranije
// otkriveno za DRUGOG potrošača iste rute (vidi zakomentarisan blok u
// app/split-board/SplitBoardPageClient.tsx), ali nikad primijenjeno na
// assign-checkin panel. trackStart()/trackEnd() pozivi (POST na istu
// staru rutu) su TIHO padali ovo cijelo vrijeme (405, uhvaćeno u .catch
// bez vidljive greške) — znači dnevna statistika NIKAD nije ni imala
// stvaran backend, ne samo da joj je dugme za otvaranje bilo nedostupno.
//
// Ova ruta je NOVA, namjenska zamjena — POST prati početak/kraj sesije
// (šalter/gate → let, koliko dugo), GET vraća agregat za dati dan u
// tačnom obliku koji StatsModal očekuje. Pod /api/admin/ — automatski
// zaštićena admin-authenticated cookie-jem preko middleware.ts, bez
// posebnog koda ovdje.
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

const STATS_TTL_SECONDS = 3 * 24 * 60 * 60; // 3 dana — dovoljno da se dnevna statistika pogleda i sledećeg jutra, ne raste u nedogled
const ACTIVE_TTL_SECONDS = 24 * 60 * 60; // sigurnosna mreža — ako 'end' nikad ne stigne (npr. panel se zatvori usred rada)

function statsKey(date: string, type: 'desk' | 'gate'): string {
  return `stats:${date}:${type === 'desk' ? 'desks' : 'gates'}`;
}

function activeKey(type: 'desk' | 'gate', resourceId: string): string {
  return `stats:active:${type}:${resourceId}`;
}

function displayTime(d: Date): string {
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Podgorica' });
}

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
    console.error('❌ checkin-stats GET error:', error);
    // FIX: prazan, ali VALJAN oblik na grešku — StatsModal radi
    // Object.entries(data.desks)/(data.gates) bez daljih provjera, pa
    // "prazno" mora biti { desks: {}, gates: {} }, ne null/undefined.
    return NextResponse.json({ desks: {}, gates: {} }, { status: 200 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { action, type, resourceId } = body as {
      action: 'start' | 'end';
      type: 'desk' | 'gate';
      resourceId: string;
      flight?: { FlightNumber?: string; DestinationCityName?: string; DestinationAirportCode?: string };
    };

    if (!action || !type || !resourceId) {
      return NextResponse.json({ success: false, error: 'Nedostaju obavezna polja' }, { status: 400 });
    }

    const client = getRedisClient();
    const now = new Date();

    if (action === 'start') {
      const flight = body.flight as { FlightNumber?: string; DestinationCityName?: string; DestinationAirportCode?: string } | undefined;
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
    console.error('❌ checkin-stats POST error:', error);
    return NextResponse.json({ success: false, error: 'Greška pri upisu statistike' }, { status: 500 });
  }
}
