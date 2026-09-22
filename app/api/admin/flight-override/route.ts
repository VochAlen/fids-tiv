// app/api/admin/flight-override/route.ts
//
// v3 FIX (2026-08-24):
// ─────────────────────────────────────────────────────────────
// 1. REDIS LOCK (per-flight) — ranije je hset+expire i hdel+hlen+del
//    radio bez lock-a. Race condition:
//      Request A: assign GateNumber=5 → hset → expire(3min)
//      Request B: clear GateNumber → hdel → hlen=0 → del
//    Ako B uskoči između A-ovog hset i expire, A-ov expire pada
//    na nepostojeći ključ (no-op), a B-ov del briše cijeli hash.
//    Rezultat: A-ova dodjela je izgubljena, a A korisnik to ne vidi.
//
//    Sad: SET lock:flight-override:{flightNumber} NX EX 5 oko cijelog
//    ciklusa. Per-flight granularnost — dva različita leta mogu biti
//    editovana paralelno bez blokade.
//
// 2. AUTO-RESET UKLONJEN IZ GET — ranije je GET ?action=getAllOverrides
//    radio write (hdel + del) na read-only putanji da bi auto-reset-ovao
//    CheckInDesk za letove koji se približavaju STD. To je:
//      a) write na read-only putanji (CPU na GET-u)
//      b) trka ako dva GET-a istovremeno pokušaju auto-reset
//    Sad: auto-reset se radi isključivo preko cron job-a
//    /api/admin/cleanup-overrides (svaka 4h u vercel.json). GET
//    ?action=getAllOverrides vraća samo trenutno stanje, bez write-a.
//
// 3. ABLY PUBLISH — kada admin promijeni GateNumber ili CheckInDesk
//    preko ove rute (ne preko test/desk-status-override ili
//    test/gate-status-override), kiosci moraju biti obaviješteni.
//    Publish na odgovarajući Ably kanal (fire-and-forget).
// ─────────────────────────────────────────────────────────────

import { NextResponse, after } from 'next/server';
import { getRedisClient } from '@/lib/redis';
import { resetExpiredCheckInOverrides } from '@/lib/override-utils';
import { getCurrentFlightData } from '@/lib/flight-data-service';
import { publishToChannel } from '@/lib/ably-server';
import { requireAdmin } from '@/lib/admin-auth';
import type { Flight } from '@/types/flight';

// ============================================================
// SIGURNOSNA LISTA: Dozvoljava samo ova polja za upis u Redis
// ============================================================
const ALLOWED_FIELDS = [
  'GateNumber',
  'CheckInDesk',
  'BaggageReclaim',
  'StatusEN',
  'Note',
  'EstimatedDepartureTime',
  'Terminal'
];

// ── Lock konstante (per-flight) ──────────────────────────────
const LOCK_TTL_SECONDS = 5;
const LOCK_WAIT_POLL_MS = 200;
const LOCK_WAIT_MAX_MS = 2_000;

function lockKey(flightNumber: string): string {
  return `lock:flight-override:${flightNumber}`;
}

function generateLockToken(): string {
  return `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

const UNLOCK_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end
`;

async function acquireLock(flightNumber: string): Promise<string | null> {
  const client = getRedisClient();
  const token = generateLockToken();
  const key = lockKey(flightNumber);
  const deadline = Date.now() + LOCK_WAIT_MAX_MS;

  while (Date.now() < deadline) {
    try {
      const got = await client.set(key, token, 'EX', LOCK_TTL_SECONDS, 'NX');
      if (got === 'OK') return token;
    } catch (err) {
      console.warn(`[flight-override] lock acquire error for ${flightNumber}:`, err instanceof Error ? err.message : err);
      return null;
    }
    await new Promise(r => setTimeout(r, LOCK_WAIT_POLL_MS));
  }
  return null;
}

async function releaseLock(flightNumber: string, token: string): Promise<void> {
  try {
    const client = getRedisClient();
    await client.eval(UNLOCK_SCRIPT, 1, lockKey(flightNumber), token);
  } catch (e) {
    // Nekritično — lock će isteći sam kroz LOCK_TTL_SECONDS
    console.warn(`[flight-override] lock release error for ${flightNumber}:`, e instanceof Error ? (e as Error).message : e);
  }
}

// Vraća Date za HH:MM, SAMO ako nije stariji od 20 sati
function parseSTDtoDate(timeStr: string): Date | null {
  if (!timeStr) return null;
  const [hours, minutes] = timeStr.split(':').map(Number);
  if (isNaN(hours) || isNaN(minutes)) return null;

  const now = new Date();
  const d = new Date(now);
  d.setHours(hours, minutes, 0, 0);

  const diffMs = now.getTime() - d.getTime();
  const THIRTY_MIN_MS  = 30 * 60 * 1000;
  const TWENTY_HOURS_MS = 20 * 60 * 60 * 1000;

  if (diffMs > THIRTY_MIN_MS && diffMs < TWENTY_HOURS_MS) {
    d.setDate(d.getDate() + 1);
  } else if (diffMs >= TWENTY_HOURS_MS) {
    console.warn(`[parseSTDtoDate] Zastarjeli STD "${timeStr}" (diff: ${Math.round(diffMs / 3600000)}h) — odbačen`);
    return null;
  }

  return d;
}

function minutesUntilSTD(timeStr: string): number | null {
  const stdDate = parseSTDtoDate(timeStr);
  if (!stdDate) return null;
  return Math.floor((stdDate.getTime() - Date.now()) / 60_000);
}

function shouldAutoResetCheckIn(scheduledTime: string): boolean {
  if (!scheduledTime) return false;
  const mins = minutesUntilSTD(scheduledTime);
  return mins === null || (mins <= 30 && mins > -120);
}

// ── ZAMJENA za sve self-fetch funkcije ────────────────────────
// Umjesto HTTP poziva ka /api/flights, direktan poziv iste funkcije
// koju ta ruta koristi — nema round-trip-a, nema dodatne invokacije.
async function getFlightScheduleAndStatus(flightNumber: string): Promise<{ scheduledTime: string | null; status: string | null }> {
  try {
    const data = await getCurrentFlightData();
    const allFlights = [...(data.departures || []), ...(data.arrivals || [])];
    const flight = allFlights.find((f: Flight) => f.FlightNumber === flightNumber);
    return {
      scheduledTime: flight?.ScheduledDepartureTime || null,
      status: flight?.StatusEN || null,
    };
  } catch (error) {
    console.error(`Error fetching flight data for ${flightNumber}:`, error);
    return { scheduledTime: null, status: null };
  }
}

async function getFlightScheduledTime(flightNumber: string): Promise<string | null> {
  const { scheduledTime } = await getFlightScheduleAndStatus(flightNumber);
  return scheduledTime;
}

// ============================================================
// POST FUNKCIJA — sa Redis lock-om i Ably publish-om
// ============================================================
export async function POST(request: Request) {
    // ── v4: Admin auth check ──
    const auth = await requireAdmin(request);
    if (auth.error) return auth.error;
  let client;
  try {
    const body = await request.json();

    if (body.action === 'resetExpired') {
      const resetCount = await resetExpiredCheckInOverrides();
      return NextResponse.json({
        success: true,
        resetCount,
        message: `Resetovano ${resetCount} override-ova`
      });
    }

    const { flightNumber, field, action, value } = body;

    if (!flightNumber || !field || !action) {
      return NextResponse.json({ message: 'Nedostaju parametri' }, { status: 400 });
    }

    if (!ALLOWED_FIELDS.includes(field)) {
      return NextResponse.json({
        message: `Zabranjeno polje: "${field}". Dozvoljena su samo: ${ALLOWED_FIELDS.join(', ')}`
      }, { status: 400 });
    }

    if (action !== 'assign' && action !== 'clear') {
      return NextResponse.json({ message: 'Nepoznata akcija. Koristite "assign" ili "clear".' }, { status: 400 });
    }

    if (action === 'assign' && value === undefined) {
      return NextResponse.json({ message: 'Vrijednost (value) je obavezna kod akcije "assign".' }, { status: 400 });
    }

    // ── Validacija (prije lock-a — ne mora biti atomarna) ──
    // CheckInDesk logika
    if (field === 'CheckInDesk' && action === 'assign') {
      const { scheduledTime, status: flightStatus } = await getFlightScheduleAndStatus(flightNumber);

      if (scheduledTime && shouldAutoResetCheckIn(scheduledTime)) {
        return NextResponse.json({
          message: `Ne možete otvoriti check-in za let ${flightNumber} manje od 30 minuta prije polijetanja (polijetanje u ${scheduledTime})`
        }, { status: 400 });
      }

      const statusLower = (flightStatus || '').toLowerCase();
      if (statusLower.includes('departed') || statusLower.includes('poletio')) {
        return NextResponse.json({ message: `Ne možete otvoriti check-in za let ${flightNumber} jer je već poletio` }, { status: 400 });
      }
      if (statusLower.includes('cancelled') || statusLower.includes('otkazan')) {
        return NextResponse.json({ message: `Ne možete otvoriti check-in za let ${flightNumber} jer je otkazan` }, { status: 400 });
      }
      if (statusLower.includes('diverted') || statusLower.includes('preusmjeren')) {
        return NextResponse.json({ message: `Ne možete otvoriti check-in za let ${flightNumber} jer je preusmjeren` }, { status: 400 });
      }
    }

    // GateNumber logika
    if (field === 'GateNumber' && action === 'assign') {
      const { status: flightStatus } = await getFlightScheduleAndStatus(flightNumber);
      const statusLower = (flightStatus || '').toLowerCase();
      const isTerminated =
        statusLower.includes('departed') || statusLower.includes('poletio') ||
        statusLower.includes('cancelled') || statusLower.includes('canceled') || statusLower.includes('otkazan') ||
        statusLower.includes('diverted') || statusLower.includes('preusmjeren');

      if (isTerminated) {
        return NextResponse.json({ message: `Ne možete promijeniti Gate za let ${flightNumber} jer je let ${flightStatus}` }, { status: 400 });
      }
    }

    // ── Acquire per-flight lock ──────────────────────────────
    const lockToken = await acquireLock(flightNumber);
    if (!lockToken) {
      return NextResponse.json(
        { message: 'Concurrent modification — please retry in a moment', retryable: true },
        { status: 503 }
      );
    }

    try {
      client = getRedisClient();
      const redisKey = `override:${flightNumber}`;

      if (action === 'assign') {
        const cleanValue = value === '' ? '__EMPTY__' : value.toString().trim();
        await client.hset(redisKey, { [field]: cleanValue });

        if (field !== 'Terminal') {
          try {
            const { scheduledTime } = await getFlightScheduleAndStatus(flightNumber);
            if (scheduledTime) {
              const stdDate = parseSTDtoDate(scheduledTime);
              if (stdDate) {
                const secondsUntilSTD = Math.floor((stdDate.getTime() - Date.now()) / 1000);
                const ttl = Math.max(300, secondsUntilSTD + 7200);
                await client.expire(redisKey, ttl);
                console.log(`[flight-override] ${flightNumber} TTL: ${ttl}s (STD: ${scheduledTime}, istekne: ${new Date(Date.now() + ttl * 1000).toLocaleTimeString()})`);
              } else {
                await client.expire(redisKey, 300);
                console.warn(`[flight-override] ${flightNumber} zastarjeli STD "${scheduledTime}" — TTL=300s`);
              }
            } else {
              await client.expire(redisKey, 21600);
            }
          } catch {
            await client.expire(redisKey, 21600);
          }
        } else {
          await client.expire(redisKey, 86400);
        }

      } else if (action === 'clear') {
        await client.hdel(redisKey, field);
        const remaining = await client.hlen(redisKey);
        if (remaining === 0) {
          await client.del(redisKey);
        }
      }
    } finally {
      await releaseLock(flightNumber, lockToken);
    }

    // ── 📡 ABLY PUBLISH — pomjeren u after(), garantovano dovršen.
    // Ako je promijenjen GateNumber ili CheckInDesk, obavijesti kioske
    // preko Ably-ja da odmah refresh-uju prikaz. Ostale izmjene
    // (StatusEN, EstimatedDepartureTime, itd.) će kiosci vidjeti
    // na sljedećem cron flight-sync ciklusu (svaka 3 min).
    //
    // AŽURIRANO (dva poboljšanja odjednom):
    // 1. after() umjesto gole .catch() bez await-a — garantuje da
    //    Vercel runtime ne prekine izvršavanje funkcije prije nego
    //    što se publish stvarno završi (isti fix kao u
    //    gate-status-override i desk-status-override).
    // 2. getCurrentFlightData() fetch je SAD TAKOĐE unutar after() —
    //    ranije se ovaj fetch čekao (await) PRIJE slanja response-a
    //    admin korisniku, iako je taj podatak potreban SAMO za Ably
    //    publish, ne za sam response. Admin sad dobija potvrdu odmah.
    // 3. Dva identična if/else grane (GateNumber i CheckInDesk) su
    //    spojene u jednu — bile su bukvalno isti kod dupliran dva puta.
    if (field === 'GateNumber' || field === 'CheckInDesk') {
      after(async () => {
        try {
          const flightData = await getCurrentFlightData().catch(() => null);
          await publishToChannel('flights:combined', 'update', flightData || null);
        } catch (err) {
          console.error('[flight-override] Ably publish (flights:combined) failed:', err);
        }
      });
    }

    return NextResponse.json({
      success: true,
      message: `Uspješno: ${field} -> ${action === 'assign' ? value : 'Uklonjeno'}`
    });

  } catch (error) {
    console.error('Override API Error:', error);
    return NextResponse.json({ message: 'Serverska greška' }, { status: 500 });
  }
}

// ============================================================
// GET FUNKCIJA — bez write-a (auto-reset premješten u cron)
// ============================================================
export async function GET(request: Request) {
    // ── v4: Admin auth check ──
    const auth = await requireAdmin(request);
    if (auth.error) return auth.error;
  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action');

  if (action === 'getAllOverrides') {
    // ── v3 FIX: samo čitanje, bez auto-reset write-a ──
    // Auto-reset se radi preko cron job-a /api/admin/cleanup-overrides
    // (svaka 4h u vercel.json). Ovdje samo vraćamo trenutno stanje.
    try {
      const client = getRedisClient();

      const keys: string[] = [];
      let cursor = '0';
      do {
        const [nextCursor, foundKeys] = await client.scan(cursor, 'MATCH', 'override:*', 'COUNT', 100);
        cursor = nextCursor;
        keys.push(...foundKeys);
      } while (cursor !== '0');

      const overrides: Record<string, Record<string, string>> = {};

      if (keys.length > 0) {
        const pipeline = client.pipeline();
        keys.forEach(key => pipeline.hgetall(key));
        const results = await pipeline.exec();

        results?.forEach((result, i) => {
          const key = keys[i];
          const data = (result?.[1] as Record<string, string>) || {};
          if (!Object.keys(data).length) return;

          const flightNumber = key.replace('override:', '');
          overrides[flightNumber] = data;
        });
      }

      return NextResponse.json(overrides);
    } catch (error) {
      console.error('Error getting overrides:', error);
      return NextResponse.json({ error: 'Failed to get overrides' }, { status: 500 });
    }
  }

  if (action === 'triggerReset') {
    const resetCount = await resetExpiredCheckInOverrides();
    return NextResponse.json({
      success: true,
      resetCount,
      message: `Resetovano ${resetCount} override-ova`
    });
  }

  const flightNumber = searchParams.get('flightNumber');

  if (!flightNumber) {
    return NextResponse.json({ message: 'Nedostaje flightNumber parametar' }, { status: 400 });
  }

  try {
    const scheduledTime = await getFlightScheduledTime(flightNumber);
    const shouldReset = scheduledTime ? shouldAutoResetCheckIn(scheduledTime) : false;

    return NextResponse.json({
      flightNumber,
      scheduledTime,
      shouldAutoReset: shouldReset,
      message: shouldReset ? `Check-in za let ${flightNumber} će biti automatski resetovan` : null
    });
  } catch (error) {
    console.error('Error checking auto-reset status:', error);
    return NextResponse.json({ message: 'Greška pri provjeri' }, { status: 500 });
  }
}
