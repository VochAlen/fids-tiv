// app/api/admin/desk-status-override/route.ts
import { NextResponse } from 'next/server';
import { getRedisClient } from '@/lib/redis';

const VALID_ACTIONS = new Set(['open', 'closed', 'clear']);
const EIGHT_HOURS   = 8 * 60 * 60;

// ─────────────────────────────────────────────
// Tip za podatke o letu vezane za šalter
// ─────────────────────────────────────────────

interface DeskFlightInfo {
  flightNumber:    string;
  airlineIata:     string;
  scheduledTime:   string;
  estimatedTime:   string | null;
  checkInOpenMins: number;  // iz checkin-config API-ja
  checkInOpensAt:  number;  // ms — STD - checkInOpenMins
  checkInClosesAt: number;  // ms — STD - 30min (uvijek)
}

// ─────────────────────────────────────────────
// Helper: dohvati checkin-config mapu (airline → minuta)
// ─────────────────────────────────────────────

async function loadCheckInConfig(baseUrl: string): Promise<Record<string, number>> {
  try {
    const res = await fetch(`${baseUrl}/api/checkin-config`, { cache: 'no-store' });
    if (!res.ok) return {};
    const data = await res.json();
    return data as Record<string, number>;
  } catch {
    console.warn('[desk-helper] checkin-config nedostupan, koristim default 120min');
    return {};
  }
}

// ─────────────────────────────────────────────
// Helper: dohvati SVE letove za dati šalter, sortirane po STD
// ─────────────────────────────────────────────

async function getFlightsForDesk(deskNumber: string): Promise<DeskFlightInfo[]> {
  try {
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';

    // Dohvati letove i checkin-config paralelno
    const [flightsRes, checkInConfig] = await Promise.all([
      fetch(`${baseUrl}/api/flights?nocache=${Date.now()}`, {
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-cache' },
      }),
      loadCheckInConfig(baseUrl),
    ]);

    if (!flightsRes.ok) return [];
    const data = await flightsRes.json();

    const DEFAULT_CHECKIN_MINS: number = checkInConfig['default'] ?? 120;

    const parseHHMM = (t: string): number | null => {
      const m = t?.match(/^(\d{1,2}):(\d{2})$/);
      if (!m) return null;
      const d = new Date();
      d.setHours(parseInt(m[1]), parseInt(m[2]), 0, 0);
      return d.getTime();
    };

    const allFlights = [...(data.departures || []), ...(data.arrivals || [])];

    const relevant = allFlights.filter((f: any) => {
      if (!f.CheckInDesk) return false;
      const desks = f.CheckInDesk.split(',').map((d: string) => d.trim());
      return (
        desks.includes(deskNumber) ||
        desks.includes(deskNumber.replace(/^0+/, '')) ||
        desks.includes(deskNumber.padStart(2, '0'))
      );
    });

    if (relevant.length === 0) return [];

    const result: DeskFlightInfo[] = [];

    for (const f of relevant) {
      const stdMs = parseHHMM(f.ScheduledDepartureTime);
      if (!stdMs) continue;

      // Izvuci airline IATA iz broja leta (prva 2 slova/znaka)
      const airlineIata: string = (f.AirlineCode || f.FlightNumber || '')
        .substring(0, 2)
        .toUpperCase();

      // Dohvati checkInOpenMins iz config-a — fallback na default
      const checkInOpenMins: number =
        checkInConfig[airlineIata] ?? DEFAULT_CHECKIN_MINS;

      result.push({
        flightNumber:    f.FlightNumber,
        airlineIata,
        scheduledTime:   f.ScheduledDepartureTime,
        estimatedTime:   f.EstimatedDepartureTime || null,
        checkInOpenMins,
        checkInOpensAt:  stdMs - checkInOpenMins * 60 * 1000, // STD - airline-specific
        checkInClosesAt: stdMs - 30 * 60 * 1000,              // STD - 30min (uvijek)
      });
    }

    // Sortiraj po STD
    result.sort((a, b) => {
      const aMs = parseHHMM(a.scheduledTime) ?? Infinity;
      const bMs = parseHHMM(b.scheduledTime) ?? Infinity;
      return aMs - bMs;
    });

    console.log(
      `[desk-helper] Desk ${deskNumber} — pronađeno ${result.length} letova:`,
      result.map(f =>
        `${f.flightNumber} (${f.airlineIata}) STD ${f.scheduledTime} ` +
        `opens=${f.checkInOpenMins}min closes=STD-30min`
      )
    );

    return result;
  } catch (error) {
    console.error('[desk-helper] Greška pri dohvatu letova:', error);
    return [];
  }
}

// ─────────────────────────────────────────────
// Ključna logika: izračunaj TTL za desk-status
// ─────────────────────────────────────────────

/**
 * TTL mora biti najmanji od:
 *  A) checkInClosesAt trenutnog leta  (STD_current - 30min)
 *  B) checkInOpensAt  sljedećeg leta  (STD_next - checkInOpenMins_next)
 *
 * Primjer sa tvojim scenarijem:
 *   W6 567  STD 11:00  checkInCloses = 10:30  (Ryanair, 120min)
 *   Let XY  STD 12:00  checkInOpens  = 10:00  (Ryanair, 120min)
 *
 *   FORCE OPEN u 08:30 →
 *     A = 10:30 - 08:30 = 120min
 *     B = 10:00 - 08:30 = 90min
 *     TTL = min(120, 90) = 90min → ključ istekne u 10:00 ✅
 *
 * Primjer sa Jet2 (150min):
 *   LS 123  STD 11:00  checkInCloses = 10:30
 *   LS 456  STD 12:00  checkInOpens  = 09:30  (150min prije STD)
 *
 *   FORCE OPEN u 08:30 →
 *     A = 10:30 - 08:30 = 120min
 *     B = 09:30 - 08:30 = 60min
 *     TTL = min(120, 60) = 60min → ključ istekne u 09:30 ✅
 */
function computeDeskStatusTTL(
  current: DeskFlightInfo,
  next: DeskFlightInfo | null,
  now: number
): number {
  const closesIn   = Math.floor((current.checkInClosesAt - now) / 1000);
  const nextOpensIn = next
    ? Math.floor((next.checkInOpensAt - now) / 1000)
    : Infinity;

  const ttl = Math.min(closesIn, nextOpensIn);

  console.log(
    `[desk-ttl] ${current.flightNumber} (${current.airlineIata} ${current.checkInOpenMins}min) ` +
    `closes in ${Math.floor(closesIn / 60)}min` +
    (next
      ? `, next ${next.flightNumber} (${next.airlineIata} ${next.checkInOpenMins}min) opens in ${Math.floor(nextOpensIn / 60)}min`
      : ', no next flight') +
    ` → TTL = ${Math.floor(ttl / 60)}min`
  );

  if (ttl <= 0) return 0;
  return Math.min(ttl, EIGHT_HOURS);
}

// ─────────────────────────────────────────────
// POST handler
// ─────────────────────────────────────────────

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { deskNumber, action, flightNumber: providedFlightNumber } = body;

    // Validacija
    const desk = String(deskNumber ?? '').trim();
    if (!desk) {
      return NextResponse.json(
        { message: 'Nedostaje ili je prazan broj šaltera' },
        { status: 400 }
      );
    }
    if (!VALID_ACTIONS.has(action)) {
      return NextResponse.json(
        { message: `Nepoznata akcija "${action}". Dozvoljeno: open, closed, clear` },
        { status: 400 }
      );
    }

    const client   = getRedisClient();
    const redisKey = `desk-status:${desk}`;

    // ── Clear ────────────────────────────────────────────────────────────
    if (action === 'clear') {
      await client.del(redisKey);
      console.log(`[desk-status-override] Desk ${desk} — override obrisan`);
      return NextResponse.json({ success: true, message: `Status šaltera ${desk} resetovan` });
    }

    // ── Open / Closed ────────────────────────────────────────────────────
    const now     = Date.now();
    const flights = await getFlightsForDesk(desk);

    if (flights.length === 0) {
      await client.del(redisKey);
      return NextResponse.json({
        success: true,
        message: `Nema letova na šalteru ${desk} — override obrisan`,
        cleared: true,
      });
    }

    // Pronađi trenutno aktivni let (check-in prozor još nije zatvoren)
    const currentFlight = flights.find((f) => f.checkInClosesAt > now) ?? null;

    if (!currentFlight) {
      await client.del(redisKey);
      console.log(`[desk-status-override] Desk ${desk} — svi check-in prozori zatvoreni`);
      return NextResponse.json({
        success: true,
        message: `Svi check-in prozori su zatvoreni za šalter ${desk} — override obrisan`,
        cleared: true,
      });
    }

    // Pronađi sljedeći let IZA trenutnog
    const currentIdx = flights.indexOf(currentFlight);
    const nextFlight = flights[currentIdx + 1] ?? null;

    const ttl = computeDeskStatusTTL(currentFlight, nextFlight, now);

    if (ttl <= 0) {
      await client.del(redisKey);
      console.log(`[desk-status-override] Desk ${desk} — TTL=0, odmah brisanje`);
      return NextResponse.json({
        success: true,
        message: `Check-in prozor za šalter ${desk} je zatvoren — override obrisan`,
        cleared: true,
      });
    }

    // Spremi JSON sa svim relevantnim podacima (korisno za debug i GET endpoint)
    const flightNum = providedFlightNumber || currentFlight.flightNumber;
    const expiresAt = new Date(now + ttl * 1000);

    const value = JSON.stringify({
      status:       action,
      flightNumber: flightNum,
      airlineIata:  currentFlight.airlineIata,
      std:          currentFlight.scheduledTime,
      nextFlight:   nextFlight?.flightNumber ?? null,
      nextSTD:      nextFlight?.scheduledTime ?? null,
      setAt:        new Date().toISOString(),
      expiresAt:    expiresAt.toISOString(),
    });

    await client.set(redisKey, value, 'EX', ttl);

    console.log(
      `[desk-status-override] Desk ${desk} — status: ${action}, ` +
      `let: ${flightNum} (${currentFlight.airlineIata}, STD ${currentFlight.scheduledTime}, opens ${currentFlight.checkInOpenMins}min), ` +
      (nextFlight
        ? `sljedeći: ${nextFlight.flightNumber} (${nextFlight.airlineIata}, STD ${nextFlight.scheduledTime}, opens ${nextFlight.checkInOpenMins}min), `
        : '') +
      `TTL: ${Math.floor(ttl / 60)}min, istekne: ${expiresAt.toLocaleTimeString('sr-Latn-RS', { hour: '2-digit', minute: '2-digit' })}`
    );

    return NextResponse.json({
      success:      true,
      message:      `Status šaltera ${desk} ažuriran na "${action}"`,
      ttl,
      flightNumber: flightNum,
      nextFlight:   nextFlight?.flightNumber ?? null,
      expiresAt:    expiresAt.toLocaleTimeString('sr-Latn-RS', { hour: '2-digit', minute: '2-digit' }),
    });

  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[desk-status-override] Greška:', msg);
    return NextResponse.json(
      { message: 'Redis nedostupan, pokušajte ponovo za nekoliko sekundi' },
      { status: 503 }
    );
  }
}