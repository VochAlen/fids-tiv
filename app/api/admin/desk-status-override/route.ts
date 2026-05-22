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

    const [flightsRes, checkInConfig] = await Promise.all([
      fetch(`${baseUrl}/api/flights`, {  // ← ukloni ?nocache, koristi Redis cache!
        cache: 'force-cache',
      }),
      loadCheckInConfig(baseUrl),
    ]);

    if (!flightsRes.ok) return [];
    const data = await flightsRes.json();

    const DEFAULT_CHECKIN_MINS: number = checkInConfig['default'] ?? 120;

    // ── ISPRAVLJEN parseHHMM sa 18h threshold ──────────────────
// Najjednostavnije i najispravnije rješenje:
const parseHHMM = (t: string): number | null => {
  if (!t) return null;
  
  // Ako već ima datum, koristi ga
  if (t.includes('T') || t.includes('-')) {
    const d = new Date(t);
    if (!isNaN(d.getTime())) return d.getTime();
  }
  
  // Samo HH:MM format
  const [h, m] = t.split(':').map(Number);
  if (isNaN(h) || isNaN(m)) return null;
  
  const d = new Date();
  d.setHours(h, m, 0, 0);
  
  // Ako je trenutno između 00:00 i 03:00, koriguj za aviation day
  const currentHour = new Date().getHours();
  if (currentHour >= 0 && currentHour < 3 && h >= 3) {
    // Let iz "jučerašnjeg" dana koji je poletio poslije 03:00
    d.setDate(d.getDate() - 1);
  }
  
  return d.getTime();
};

    const allFlights = [...(data.departures || []), ...(data.arrivals || [])];

    const relevant = allFlights.filter((f: any) => {
      const deskField = f.CheckInDesk;
      if (!deskField) return false;
      const desks = deskField.split(',').map((d: string) => d.trim());
      const normalizedDesk = deskNumber.replace(/^0+/, '');
      const paddedDesk = deskNumber.padStart(2, '0');
      return desks.includes(deskNumber) ||
             desks.includes(normalizedDesk) ||
             desks.includes(paddedDesk);
    });

    if (relevant.length === 0) return [];

    const result: DeskFlightInfo[] = [];
    const now = Date.now();

    for (const f of relevant) {
      const stdMs = parseHHMM(f.ScheduledDepartureTime);
      if (!stdMs) continue;

      // ── DODATNA PROVJERA: Preskoči letove koji su već poletjeli ──
      const status = (f.StatusEN || '').toLowerCase();
      const isDeparted = status.includes('departed') || status.includes('poletio');
      const isCancelled = status.includes('cancelled') || status.includes('otkazan');
      
      if (isDeparted || isCancelled) {
        console.log(`[desk-helper] Skipping ${f.FlightNumber} - status: ${status}`);
        continue;
      }

      // ── PRESKOČI LETOVE KOJI SU ZATVORENI (__EMPTY__) ──
      if (f.CheckInDesk === '__EMPTY__') {
        console.log(`[desk-helper] Skipping ${f.FlightNumber} - manually closed (__EMPTY__)`);
        continue;
      }

      const airlineIata: string = (f.AirlineCode || f.FlightNumber || '')
        .substring(0, 2)
        .toUpperCase();

      const checkInOpenMins: number = checkInConfig[airlineIata] ?? DEFAULT_CHECKIN_MINS;

      const checkInOpensAt = stdMs - checkInOpenMins * 60 * 1000;
      const checkInClosesAt = stdMs - 30 * 60 * 1000;

      // ── PRESKOČI LETOVE KOJIMA JE CHECK-IN VEĆ ZATVOREN ──
      if (checkInClosesAt < now) {
        console.log(`[desk-helper] Skipping ${f.FlightNumber} - check-in closed at ${new Date(checkInClosesAt).toLocaleTimeString()}`);
        continue;
      }

      result.push({
        flightNumber:    f.FlightNumber,
        airlineIata,
        scheduledTime:   f.ScheduledDepartureTime,
        estimatedTime:   f.EstimatedDepartureTime || null,
        checkInOpenMins,
        checkInOpensAt,
        checkInClosesAt,
      });
    }

    result.sort((a, b) => {
      const aMs = parseHHMM(a.scheduledTime) ?? Infinity;
      const bMs = parseHHMM(b.scheduledTime) ?? Infinity;
      return aMs - bMs;
    });

    console.log(
      `[desk-helper] Desk ${deskNumber} — pronađeno ${result.length} aktivnih letova:`,
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
// Helper: Postavi/obriši CheckInDesk override za let
// ─────────────────────────────────────────────
async function setFlightCheckInDeskOverride(
  flightNumber: string,
  action: 'assign' | 'clear',
  value?: string
): Promise<void> {
  try {
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
    const response = await fetch(`${baseUrl}/api/admin/flight-override`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        flightNumber,
        field: 'CheckInDesk',
        action,
        value,
      }),
    });
    if (!response.ok) {
      console.error(`Failed to set flight override for ${flightNumber}:`, await response.text());
    }
  } catch (err) {
    console.error(`Error calling flight-override for ${flightNumber}:`, err);
  }
}

// ─────────────────────────────────────────────
// Ključna logika: izračunaj TTL za desk-status
// ─────────────────────────────────────────────

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

    // ── Clear (Reset to Auto) ────────────────────────────────────────────
    if (action === 'clear') {
      await client.del(redisKey);
      console.log(`[desk-status-override] Desk ${desk} — override obrisan (reset to auto)`);
      // Ne diramo flight-override marker __EMPTY__ – to ostaje, tako da zatvoreni letovi ostaju zatvoreni.
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

    let currentFlight: DeskFlightInfo | null = null;
    let flightNumberToStore: string | null = null;

    // Ako je action 'open' i poslan je flightNumber – koristi taj let
    if (action === 'open' && providedFlightNumber) {
      const targetFlight = flights.find(f => f.flightNumber === providedFlightNumber);
      if (!targetFlight) {
        return NextResponse.json({
          message: `Let ${providedFlightNumber} nije dodijeljen šalteru ${desk}`,
        }, { status: 400 });
      }
      // Provjeri da li je check-in prozor već zatvoren
      if (targetFlight.checkInClosesAt < now) {
        return NextResponse.json({
          message: `Ne možete otvoriti let ${providedFlightNumber} jer je check-in zatvoren u ${new Date(targetFlight.checkInClosesAt).toLocaleTimeString()}`,
        }, { status: 400 });
      }
      currentFlight = targetFlight;
      flightNumberToStore = targetFlight.flightNumber;
      console.log(`[desk-status-override] Desk ${desk} — ručno odabran let ${providedFlightNumber}`);
      
      // Kada ručno otvaramo let, uklanjamo mu __EMPTY__ marker (ako je postojao)
      await setFlightCheckInDeskOverride(providedFlightNumber, 'clear');
    } else if (action === 'closed' && providedFlightNumber) {
      // Ručno zatvaranje – označi let kao trajno zatvoren za automatsku logiku
      await setFlightCheckInDeskOverride(providedFlightNumber, 'assign', '__EMPTY__');
      // Zatim nastavi sa postavljanjem desk-status (closed) – koristimo isti let kao activeFlight
      const targetFlight = flights.find(f => f.flightNumber === providedFlightNumber);
      if (targetFlight) {
        currentFlight = targetFlight;
        flightNumberToStore = targetFlight.flightNumber;
      } else {
        // Ako let nije pronađen u listi, ipak zatvaramo desk bez prikaza leta
        await client.set(redisKey, JSON.stringify({ status: 'closed', flightNumber: providedFlightNumber, setAt: new Date().toISOString() }), 'EX', 3600);
        return NextResponse.json({ success: true, message: `Šalter ${desk} zatvoren bez aktivnog leta` });
      }
    } else {
      // Postojeća logika: pronađi trenutno aktivni let (check-in prozor još nije zatvoren)
      currentFlight = flights.find((f) => f.checkInClosesAt > now) ?? null;
      if (!currentFlight) {
        await client.del(redisKey);
        console.log(`[desk-status-override] Desk ${desk} — svi check-in prozori zatvoreni`);
        return NextResponse.json({
          success: true,
          message: `Svi check-in prozori su zatvoreni za šalter ${desk} — override obrisan`,
          cleared: true,
        });
      }
      flightNumberToStore = currentFlight.flightNumber;
    }

    // Pronađi sljedeći let IZA currentFlight (u sortiranom nizu flights)
    const currentIdx = flights.findIndex(f => f.flightNumber === currentFlight!.flightNumber);
    const nextFlight = (currentIdx >= 0 && currentIdx < flights.length - 1) ? flights[currentIdx + 1] : null;

    // Ako je action === 'closed', želimo da desk status bude 'closed', a ne 'open'
    const finalAction = (action === 'closed') ? 'closed' : 'open';
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

    const expiresAt = new Date(now + ttl * 1000);
    const value = JSON.stringify({
      status:       finalAction,
      flightNumber: flightNumberToStore,
      airlineIata:  currentFlight.airlineIata,
      std:          currentFlight.scheduledTime,
      nextFlight:   nextFlight?.flightNumber ?? null,
      nextSTD:      nextFlight?.scheduledTime ?? null,
      setAt:        new Date().toISOString(),
      expiresAt:    expiresAt.toISOString(),
    });

    await client.set(redisKey, value, 'EX', ttl);

    console.log(
      `[desk-status-override] Desk ${desk} — status: ${finalAction}, ` +
      `let: ${flightNumberToStore} (${currentFlight.airlineIata}, STD ${currentFlight.scheduledTime}, opens ${currentFlight.checkInOpenMins}min), ` +
      (nextFlight
        ? `sljedeći: ${nextFlight.flightNumber} (${nextFlight.airlineIata}, STD ${nextFlight.scheduledTime}, opens ${nextFlight.checkInOpenMins}min), `
        : '') +
      `TTL: ${Math.floor(ttl / 60)}min, istekne: ${expiresAt.toLocaleTimeString('sr-Latn-RS', { hour: '2-digit', minute: '2-digit' })}`
    );

    return NextResponse.json({
      success:      true,
      message:      `Status šaltera ${desk} ažuriran na "${finalAction}"`,
      ttl,
      flightNumber: flightNumberToStore,
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