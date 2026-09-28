// lib/override-utils.ts
import { getRedisClient, safeRedisGetStrict, safeRedisSet } from '@/lib/redis';
import { publishToChannel } from '@/lib/ably-server';
import { invalidateAssignmentsCache } from '@/lib/assignments-service';

// NOVO (po zahtjevu — isti razlog kao cleanup u
// app/api/test/desk-status-override/route.ts, ISTA seq brojač kolona
// da ostanemo u istom, globalnom monotonom nizu): koristi se ispod da
// se svaki šalter koji ovaj auto-reset obriše ipak ispravno objavi
// preko Ably-a — bez ovoga, kiosk ekran za taj šalter nikad ne sazna
// da se stanje automatski promijenilo.
const AUTO_RESET_SEQ_KEY = 'ably-fids:seq:desk-status';
async function nextAutoResetSeq(): Promise<number> {
  const client = getRedisClient();
  return client.incr(AUTO_RESET_SEQ_KEY);
}

export interface AutoResetResult {
  flightNumber: string;
  field: 'CheckInDesk' | 'GateNumber';
  reason: string;
}

interface FlightLike {
  FlightNumber: string;
  ScheduledDepartureTime?: string;
  EstimatedDepartureTime?: string;
  StatusEN?: string;
  CheckInDesk?: string;
}

// ─────────────────────────────────────────────
// Pomoćne funkcije za rad s vremenom (nepromijenjeno)
// ─────────────────────────────────────────────

export function parseTimeToMinutes(timeStr: string): number {
  if (!timeStr || !timeStr.includes(':')) return -1;
  const [h, m] = timeStr.split(':').map(Number);
  if (isNaN(h) || isNaN(m)) return -1;
  return h * 60 + m;
}

export function getCurrentMinutes(): number {
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes();
}

export function minutesUntil(targetTimeStr: string): number {
  const target = parseTimeToMinutes(targetTimeStr);
  if (target < 0) return Infinity;
  const current = getCurrentMinutes();
  let diff = target - current;
  if (diff < -720) diff += 1440;
  return diff;
}

export function minutesUntilCheckInReset(scheduledTime: string): number {
  if (!scheduledTime || !scheduledTime.includes(':')) return Infinity;
  const [h, m] = scheduledTime.split(':').map(Number);
  if (isNaN(h) || isNaN(m)) return Infinity;

  let resetHour = h;
  let resetMinute = m - 30;
  if (resetMinute < 0) { resetHour--; resetMinute += 60; }
  if (resetHour < 0) resetHour += 24;

  const resetTotalMinutes = resetHour * 60 + resetMinute;
  const currentTotalMinutes = getCurrentMinutes();
  let diff = resetTotalMinutes - currentTotalMinutes;
  if (diff < -720) diff += 1440;
  if (diff > 720) diff -= 1440;
  return diff;
}

export function isTerminatedStatus(statusEN: string): boolean {
  const s = (statusEN || '').toLowerCase();
  return (
    s.includes('departed')  || s.includes('poletio')    ||
    s.includes('cancelled') || s.includes('otkazan')    ||
    s.includes('diverted')  || s.includes('preusmjeren')
  );
}

export function shouldResetCheckIn(
  scheduledTime: string,
  statusEN: string
): { reset: boolean; reason: string } {
  if (!scheduledTime) return { reset: false, reason: 'nema scheduled time' };
  if (isTerminatedStatus(statusEN)) return { reset: false, reason: 'let je terminiran' };

  const minsToReset = minutesUntilCheckInReset(scheduledTime);
  if (minsToReset <= 0 && minsToReset > -180) {
    return { reset: true, reason: `STD ${scheduledTime} — check-in reset (${Math.abs(minsToReset)} min nakon praga STD-30min)` };
  }
  return {
    reset: false,
    reason: minsToReset > 0
      ? `Još ${minsToReset} min do reset praga (STD ${scheduledTime} - 30min)`
      : `Prošlo više od 3h od praga, preskačem`
  };
}

export function shouldResetGate(
  scheduledTime: string,
  estimatedTime: string | undefined,
  statusEN: string
): { reset: boolean; reason: string; usedTime: string } {
  if (!scheduledTime && !estimatedTime) return { reset: false, reason: 'nema STD ni ETD', usedTime: '' };
  if (isTerminatedStatus(statusEN)) return { reset: false, reason: 'let je terminiran', usedTime: scheduledTime };

  const etdMins = estimatedTime ? parseTimeToMinutes(estimatedTime) : -1;
  const stdMins = parseTimeToMinutes(scheduledTime);
  const useETD  = etdMins > stdMins;
  const referenceTime = useETD ? estimatedTime! : scheduledTime;
  const usedTime = referenceTime;
  const mins = minutesUntil(referenceTime);

  if (mins <= 0 && mins > -240) {
    return { reset: true, reason: `${useETD ? 'ETD' : 'STD'} ${referenceTime} je dostignut (${Math.abs(mins)} min prošlo)`, usedTime };
  }
  return {
    reset: false,
    reason: mins === Infinity
      ? 'referentno vrijeme nije parsibilno'
      : `${mins} min do ${useETD ? 'ETD' : 'STD'} (${referenceTime}), previše rano`,
    usedTime
  };
}

// ─────────────────────────────────────────────
// NAPOMENA: cleanupDeskStatusOverrides() je uklonjena —
// ciljala je 'desk-status:*' prefiks koji se u ovom projektu
// nikad nije koristio (aplikacija koristi 'test:desk-status:*').
// Bila je mrtav kod koji je nepotrebno radio KEYS+sekvencijalne
// pozive na svaki auto-reset ciklus.
// ─────────────────────────────────────────────

// ─────────────────────────────────────────────
// Glavna funkcija — SCAN + pipeline umjesto KEYS + sekvencijalno
// ─────────────────────────────────────────────

export async function runAutoReset(allFlights: FlightLike[]): Promise<AutoResetResult[]> {
  const redis = getRedisClient();
  const results: AutoResetResult[] = [];

  // ✅ SCAN umjesto blokirajućeg KEYS
  const keys: string[] = [];
  let cursor = '0';
  try {
    do {
      const [nextCursor, foundKeys] = await redis.scan(cursor, 'MATCH', 'override:*', 'COUNT', 100);
      cursor = nextCursor;
      keys.push(...foundKeys);
    } while (cursor !== '0');
  } catch (err) {
    console.error('[auto-reset] Redis scan greška:', err);
    return results;
  }

  if (keys.length === 0) return results;

  // ✅ Pipeline umjesto sekvencijalnog hgetall po ključu
  const pipeline = redis.pipeline();
  keys.forEach(key => pipeline.hgetall(key));
  const hgetallResults = await pipeline.exec();

  // Grupiši šta treba uraditi, pa izvrši batch operacije na kraju
  const keysToFullyDelete: string[] = [];
  // NOVO (KRITIČNO — dodatna zaštita, pronađena pri analizi sličnih
  // mogućih uzroka "kiosk prikazuje pogrešan/stari let"): ranije je ovo
  // bio string[] (samo broj šaltera) — pamti sad i flightNumber kome
  // taj šalter PRIPADA prema legacy override:* hash-u, da bi se ispod
  // moglo provjeriti da li šalter u ably-fids:desk-status:all I DALJE
  // pokazuje BAŠ TAJ let prije brisanja (vidi opširan komentar niže).
  const deskStatusKeysToDelete: { desk: string; flightNumber: string }[] = [];
  const checkInResets: string[] = [];
  const gateResets: string[] = [];

  hgetallResults?.forEach((result, i) => {
    const key = keys[i];
    const data = (result?.[1] as Record<string, string>) || {};
    if (!data || Object.keys(data).length === 0) return;

    const flightNumber = key.replace('override:', '');
    const flight = allFlights.find(f => f.FlightNumber === flightNumber);
    if (!flight) return;

    const std = flight.ScheduledDepartureTime || '';
    const etd = flight.EstimatedDepartureTime || '';
    const status = flight.StatusEN || '';

    if (isTerminatedStatus(status)) {
      keysToFullyDelete.push(key);
      if (data.CheckInDesk) {
        const desks = data.CheckInDesk.split(',').map(d => d.trim()).filter(Boolean);
        desks.forEach(desk => deskStatusKeysToDelete.push({ desk, flightNumber }));
      }
      results.push({ flightNumber, field: 'CheckInDesk', reason: `let je terminiran (${status}) — full reset` });
      return;
    }

    if (data.CheckInDesk !== undefined) {
      const { reset, reason } = shouldResetCheckIn(std, status);
      if (reset) {
        checkInResets.push(key);
        results.push({ flightNumber, field: 'CheckInDesk', reason });
      }
    }

    if (data.GateNumber !== undefined) {
      const { reset, reason, usedTime } = shouldResetGate(std, etd || undefined, status);
      if (reset) {
        gateResets.push(key);
        results.push({ flightNumber, field: 'GateNumber', reason: `${reason} (ref: ${usedTime})` });
      }
    }
  });

  // ✅ Batch: potpuno obriši terminated letove
  if (keysToFullyDelete.length > 0) {
    const delPipeline = redis.pipeline();
    keysToFullyDelete.forEach(key => delPipeline.del(key));
    await delPipeline.exec();
    console.log(`[auto-reset] Obrisano ${keysToFullyDelete.length} override-ova (terminated letovi)`);
  }

  // ✅ Batch: ukloni desk-status unose iz "test:desk-status:all" bloba
  // v4 FIX: read-modify-write pod Redis lock-om (lock:desk-status:override).
  // Ranije bez lock-a — ako admin istovremeno edituje desk preko
  // /api/test/desk-status-override, cleanup bi mogao pregaziti promjenu.
  if (deskStatusKeysToDelete.length > 0) {
    const LOCK_KEY = 'ably-fids:lock:desk-status:override';
    const LOCK_TTL_SECONDS = 5;
    const LOCK_WAIT_MAX_MS = 2_000;
    const LOCK_WAIT_POLL_MS = 200;
    const lockToken = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    let acquired = false;
    const deadline = Date.now() + LOCK_WAIT_MAX_MS;
    while (Date.now() < deadline) {
      try {
        const got = await redis.set(LOCK_KEY, lockToken, 'EX', LOCK_TTL_SECONDS, 'NX');
        if (got === 'OK') { acquired = true; break; }
      } catch (e) {
        console.warn('[auto-reset] lock acquire error:', e instanceof Error ? (e as Error).message : e);
        break;
      }
      await new Promise(r => setTimeout(r, LOCK_WAIT_POLL_MS));
    }

    if (!acquired) {
      console.warn('[auto-reset] Could not acquire desk-status lock — skipping desk-status cleanup');
    } else {
      try {
        // FIX (vidi opširan komentar u
        // app/api/test/desk-status-override/route.ts): preimenovano
        // da nikad ne kolidira sa glavnim (polling) sistemom.
        const raw = await redis.get('ably-fids:desk-status:all');
        if (raw) {
          let all: Record<string, unknown>;
          try {
            all = JSON.parse(raw);
          } catch (parseErr) {
            console.error('[auto-reset] desk-status blob corrupt — skipping:', parseErr);
            all = {};
          }
          let changed = false;
          // NOVO (KRITIČNO — dodatna zaštita protiv "cross-contamination":
          // deskStatusKeysToDelete dolazi iz LEGACY override:* hash-a
          // (per-flight, upisan preko app/api/admin/flight-override —
          // odvojen, nezavisan sistem od ably-fids:desk-status:all koji
          // stvarno prati assign-checkin admin panel). Bez ove provjere,
          // brisanje je bilo BEZUSLOVNO po broju šaltera — ako je taj isti
          // broj šaltera u međuvremenu (dok je stari override:* zapis još
          // važio, prije nego što mu istekne TTL) RUČNO dodijeljen NOVOM,
          // potpuno drugom, aktivnom letu preko assign-checkin panela,
          // ovaj auto-reset bi ga tiho obrisao — kiosk bi iznenada prikazao
          // prazan ekran usred aktivnog korišćenja, iako taj let/šalter
          // nema nikakve veze sa terminiranim letom koji je pokrenuo reset.
          // Sad se briše SAMO ako šalter I DALJE pokazuje TAČNO ISTI let
          // za koji se auto-reset upravo pokreće.
          const actuallyDeleted: { desk: string; flightNumber: string }[] = [];
          deskStatusKeysToDelete.forEach(({ desk, flightNumber }) => {
            const current = all[desk] as { flightNumber?: string } | undefined;
            if (current && current.flightNumber === flightNumber) {
              delete all[desk];
              changed = true;
              actuallyDeleted.push({ desk, flightNumber });
            }
          });
          if (changed) {
            await redis.set('ably-fids:desk-status:all', JSON.stringify(all), 'EX', 4 * 60 * 60);
            console.log(`[auto-reset] Očišćeno ${actuallyDeleted.length} desk-status unosa`);
            // FIX (KRITIČNO — po zahtjevu, prijavljen bug: "dodijelim
            // let, pojavi se stari let sa jutra" i "klasa se ne mijenja
            // nakon ~1h"): OVDJE je bio nedostatak — auto-reset je
            // tiho mijenjao isti Redis blob koji kiosk ekrani prate
            // (ably-fids:desk-status:all), ali NIKAD nije objavio Ably
            // poruku o tome. Kiosk je ostajao zaglavljen na starom
            // prikazu (stari let), a ručne akcije (npr. setClass) su
            // nailazile na već-obrisan zapis bez ikakvog upozorenja.
            // Sad se svaki obrisan šalter objavljuje preko Ably-a,
            // isto kao ručna 'clear' akcija.
            for (const { desk } of actuallyDeleted) {
              const seq = await nextAutoResetSeq();
              await publishToChannel('assignments:desks', 'update', {
                deskNumber: desk,
                entry: { status: null, flightNumber: '', classType: null, setAt: Date.now(), seq },
              }).catch(err => console.error('[auto-reset] Ably publish (desk cleanup) failed:', err));
            }
          }
        }
      } catch (err) {
        console.error('[auto-reset] Greška pri čišćenju desk-status bloba:', err);
      } finally {
        // Atomic unlock — obriši samo ako je naš token
        const UNLOCK_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end
`;
        try {
          await redis.eval(UNLOCK_SCRIPT, 1, LOCK_KEY, lockToken);
        } catch (e) {
          // Nekritično — lock će isteći sam
        }
      }
    }
  }

  // ✅ Batch: reset CheckInDesk polja
  if (checkInResets.length > 0) {
    const hdelPipeline = redis.pipeline();
    checkInResets.forEach(key => hdelPipeline.hdel(key, 'CheckInDesk'));
    await hdelPipeline.exec();
  }

  // ✅ Batch: reset GateNumber polja
  if (gateResets.length > 0) {
    const hdelPipeline = redis.pipeline();
    gateResets.forEach(key => hdelPipeline.hdel(key, 'GateNumber'));
    await hdelPipeline.exec();
  }

  // ✅ Batch: provjeri koji ključevi su ostali prazni pa ih obriši
  const keysToCheckEmpty = [...new Set([...checkInResets, ...gateResets])]
    .filter(k => !keysToFullyDelete.includes(k));

  if (keysToCheckEmpty.length > 0) {
    const lenPipeline = redis.pipeline();
    keysToCheckEmpty.forEach(key => lenPipeline.hlen(key));
    const lenResults = await lenPipeline.exec();

    const emptyKeys = keysToCheckEmpty.filter((_, i) => lenResults?.[i]?.[1] === 0);
    if (emptyKeys.length > 0) {
      const delPipeline = redis.pipeline();
      emptyKeys.forEach(key => delPipeline.del(key));
      await delPipeline.exec();
    }
  }

  console.log(`[auto-reset] Završeno — resetovano ${results.length} polja`);
  return results;
}

// ─────────────────────────────────────────────
// Legacy funkcije — zadržane samo za /api/admin/flight-override
// (resetExpired/triggerReset akcije). startTimer/stopTimer i
// isTimerRunning su UKLONJENE jer initAutoReset (Vercel Cron)
// sad radi taj posao ispravno.
// ─────────────────────────────────────────────

export async function resetExpiredCheckInOverrides(): Promise<number> {
  const redis = getRedisClient();
  let count = 0;

  const keys: string[] = [];
  let cursor = '0';
  do {
    const [nextCursor, foundKeys] = await redis.scan(cursor, 'MATCH', 'override:*', 'COUNT', 100);
    cursor = nextCursor;
    keys.push(...foundKeys);
  } while (cursor !== '0');

  if (keys.length === 0) return 0;

  const pipeline = redis.pipeline();
  keys.forEach(key => pipeline.hgetall(key));
  const results = await pipeline.exec();

  results?.forEach(result => {
    const data = result?.[1] as Record<string, string> | undefined;
    if (data?.CheckInDesk) count++;
  });

  return count;
}

// ─────────────────────────────────────────────
// AUTO-CLOSE za AKTIVAN (Ably) desk/gate-status-override sistem
// ─────────────────────────────────────────────
//
// NOVO (po zahtjevu — "ako je let AB100 departed/poletio, a osoblje
// zaboravi da ga iskljuci/zatvori (narocito na zadnjem letu, iz zurbe
// da osoblje ide kuci), salter treba AUTOMATSKI da se obrise/zatvori"):
// jedino postojece automatsko ciscenje na OVOM (Ably) sistemu
// (computeCleanup, MAX_AGE_MS u desk/gate-status-override/route.ts) je
// ciscenje po VREMENU OD DODJELE (4h/6h), potpuno nezavisno od
// stvarnog statusa leta, i pokrece se SAMO oportunisticki — kao
// nuzan sporedni efekat NEKE druge POST akcije na tu istu rutu. Na
// zadnjem letu dana, kad niko vise ne dira admin panel do sledeceg
// jutra, salter bi ostao "otvoren" satima ili preko cijele noci, iako
// je let odavno poletio.
//
// Ova funkcija se poziva iz /api/cron/flight-sync (svaka 3 min, NEZAVISNO
// od bilo koje admin akcije) i brise salter/gate CIM let na njemu
// stvarno dobije terminalan status (departed/cancelled/diverted) —
// isti princip kao runAutoReset iznad za legacy override:* sistem, ali
// ovdje DIREKTNO na zivom (Ably) sistemu koji kiosk ekrani prate. Deli
// ISTE Redis kljuceve (lock/seq/blob) kao desk-status-override/
// gate-status-override rute, pa ne moze da se otme sa rucnom akcijom
// osoblja (ista brava, isti monotoni seq niz) — ako osoblje bas u tom
// trenutku rucno nesto radi na istom resursu, ova funkcija jednostavno
// preskace taj ciklus (lock zauzet) i pokusa ponovo za 3 min.
const AUTO_CLOSE_LOCK_TTL_SECONDS = 5;
const AUTO_CLOSE_LOCK_WAIT_MAX_MS = 2_000;
const AUTO_CLOSE_LOCK_WAIT_POLL_MS = 200;

type AutoCloseEntry = {
  status: 'open' | 'closed' | null;
  flightNumber: string | null;
  classType: string | null;
  setAt: number | null;
  seq: number;
};

async function withAutoCloseLock<T>(lockKey: string, fn: () => Promise<T | null>): Promise<T | null> {
  const redis = getRedisClient();
  const token = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const deadline = Date.now() + AUTO_CLOSE_LOCK_WAIT_MAX_MS;
  let acquired = false;

  while (Date.now() < deadline) {
    try {
      const got = await redis.set(lockKey, token, 'EX', AUTO_CLOSE_LOCK_TTL_SECONDS, 'NX');
      if (got === 'OK') { acquired = true; break; }
    } catch (e) {
      console.warn('[auto-close-departed] lock acquire error:', e instanceof Error ? e.message : e);
      return null;
    }
    await new Promise(r => setTimeout(r, AUTO_CLOSE_LOCK_WAIT_POLL_MS));
  }

  if (!acquired) return null;

  try {
    return await fn();
  } finally {
    const UNLOCK_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end
`;
    try {
      await redis.eval(UNLOCK_SCRIPT, 1, lockKey, token);
    } catch {
      // Nekritično — lock će isteći sam kroz AUTO_CLOSE_LOCK_TTL_SECONDS
    }
  }
}

async function autoCloseTerminatedInBlob(
  blobKey: string,
  lockKey: string,
  seqKey: string,
  blobTtlSeconds: number,
  ablyChannel: string,
  numberField: 'deskNumber' | 'gateNumber',
  allFlights: FlightLike[]
): Promise<string[]> {
  return (await withAutoCloseLock(lockKey, async () => {
    const { ok, value: raw } = await safeRedisGetStrict(blobKey);
    if (!ok) return []; // Redis/circuit-breaker problem — ne diraj, probaj ponovo za 3 min.

    let all: Record<string, AutoCloseEntry> = {};
    if (raw) {
      try {
        all = JSON.parse(raw);
      } catch (parseErr) {
        console.error(`[auto-close-departed] ${blobKey} blob corrupt — preskačem:`, parseErr);
        return [];
      }
    }

    const closed: string[] = [];
    for (const [resourceNumber, entry] of Object.entries(all)) {
      if (!entry?.flightNumber) continue;
      const flight = allFlights.find(f => f.FlightNumber === entry.flightNumber);
      if (!flight) continue; // let nije u trenutnom rasporedu — ne diraj (npr. drugi dan)
      if (isTerminatedStatus(flight.StatusEN || '')) {
        delete all[resourceNumber];
        closed.push(resourceNumber);
      }
    }

    if (closed.length === 0) return [];

    const redis = getRedisClient();
    await safeRedisSet(blobKey, JSON.stringify(all), blobTtlSeconds);
    invalidateAssignmentsCache();

    for (const resourceNumber of closed) {
      const seq = await redis.incr(seqKey);
      await publishToChannel(ablyChannel, 'update', {
        [numberField]: resourceNumber,
        entry: { status: null, flightNumber: '', classType: null, setAt: Date.now(), seq },
      }).catch(err => console.error(`[auto-close-departed] Ably publish (${ablyChannel}) failed:`, err));
    }

    console.log(`[auto-close-departed] ${blobKey}: automatski zatvoreno ${closed.length} (let poletio/otkazan/preusmjeren)`);
    return closed;
  })) ?? [];
}

export async function autoCloseDepartedDesks(allFlights: FlightLike[]): Promise<string[]> {
  return autoCloseTerminatedInBlob(
    'ably-fids:desk-status:all',
    'ably-fids:lock:desk-status:override',
    'ably-fids:seq:desk-status',
    4 * 60 * 60,
    'assignments:desks',
    'deskNumber',
    allFlights
  );
}

export async function autoCloseDepartedGates(allFlights: FlightLike[]): Promise<string[]> {
  return autoCloseTerminatedInBlob(
    'ably-fids:gate-status:all',
    'ably-fids:lock:gate-status:override',
    'ably-fids:seq:gate-status',
    6 * 60 * 60,
    'assignments:gates',
    'gateNumber',
    allFlights
  );
}