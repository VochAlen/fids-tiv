// lib/override-utils.ts
import { getRedisClient, safeRedisHDel, safeRedisHGetAll } from '@/lib/redis';

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
  const deskStatusKeysToDelete: string[] = []; // za "test:desk-status:all" blob update
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
        desks.forEach(desk => deskStatusKeysToDelete.push(desk));
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

  // ✅ Batch: ukloni desk-status unose iz "test:desk-status:all"
  // ── FIX (usklađeno sa Redis Hash prelaskom, vidi lib/redis.ts i
  // app/api/test/desk-status-override/route.ts): "test:desk-status:all" više
  // NIJE jedan JSON blob nego Redis HASH (jedno polje po desku). HDEL po
  // polju je atomaran — nema više čitaj-cijelo/piši-cijelo race-a.
  //
  // FIX #2 (svježa analiza — WRONGTYPE gap): ranije se ovdje koristio SIROV
  // redis.pipeline().hdel(...), zaobilazeći safeRedisHDel wrapper iz
  // lib/redis.ts koji ima ugrađeno samoisceljujuće WRONGTYPE→migracija
  // ponašanje. Da je "test:desk-status:all" i dalje bio zaostali JSON
  // string ključ, ovaj raw pipeline HDEL bi bacio WRONGTYPE (uhvaćen ispod
  // u catch-u, pa se ne ruši cron/cleanup poziv — ali čišćenje departovanih
  // letova bi TIHO otkazivalo svaki put, gomilajući zaglavljene desk-status
  // unose na check-in monitorima i nakon poletanja). Sad koristi
  // safeRedisHDel po polju (Promise.all — isti obrazac batch-a kao
  // cleanupStale() u samim override rutama), pa se automatski samoiscijeli
  // ako naiđe na stari ključ.
  if (deskStatusKeysToDelete.length > 0) {
    try {
      await Promise.all(deskStatusKeysToDelete.map(desk => safeRedisHDel('test:desk-status:all', desk)));
      console.log(`[auto-reset] Očišćeno ${deskStatusKeysToDelete.length} desk-status unosa`);
    } catch (err) {
      console.error('[auto-reset] Greška pri čišćenju desk-status hash-a:', err);
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
// FIX (automatsko čišćenje dodjela za DEPARTED letove — sigurnosna mreža):
// Klijentska strana (app/admin/assign-checkin/page.tsx) već čisti
// test:gate-status:all / test:desk-status:all unose čim let pređe u
// status "Departed", ALI samo dok je taj admin panel OTVOREN na nekom
// uređaju. Ova funkcija je server-side sigurnosna mreža za slučaj da
// panel nije bio otvoren kad je let poletio — poziva se iz VEĆ
// zakazanog cron-a (app/api/admin/cleanup-overrides/route.ts, svaka 4h),
// bez potrebe za novim Vercel Cron job-om (svaki dodatni cron ima svoj
// trošak/limit).
//
// NAMJERNO reaguje SAMO na "Departed" status (ne cancelled/diverted/itd)
// — tačno po zahtjevu, jer ti slučajevi mogu zahtijevati ručnu pažnju
// osoblja umjesto tihog automatskog uklanjanja.
export interface DepartedCleanupResult {
  resourceType: 'desk' | 'gate';
  resourceId: string;
  flightNumber: string;
}

function isDepartedStatus(statusEN: string | undefined): boolean {
  const s = (statusEN || '').toLowerCase();
  return s.includes('departed') || s.includes('poletio') || s.includes('poletjelo');
}

export async function cleanupDepartedResourceAssignments(
  allFlights: FlightLike[],
): Promise<DepartedCleanupResult[]> {
  const results: DepartedCleanupResult[] = [];
  const flightByNumber = new Map(allFlights.map(f => [f.FlightNumber, f]));

  const [deskEntries, gateEntries] = await Promise.all([
    safeRedisHGetAll('test:desk-status:all'),
    safeRedisHGetAll('test:gate-status:all'),
  ]);

  const checks: Array<{ type: 'desk' | 'gate'; key: string; entries: Record<string, string> | null }> = [
    { type: 'desk', key: 'test:desk-status:all', entries: deskEntries },
    { type: 'gate', key: 'test:gate-status:all', entries: gateEntries },
  ];

  for (const { type, key, entries } of checks) {
    if (!entries) continue;
    for (const [resourceId, rawValue] of Object.entries(entries)) {
      let flightNumber: string | undefined;
      try {
        flightNumber = JSON.parse(rawValue)?.flightNumber;
      } catch {
        continue; // oštećen zapis — preskoči, ne diraj
      }
      if (!flightNumber) continue;

      const flight = flightByNumber.get(flightNumber);
      if (flight && isDepartedStatus(flight.StatusEN)) {
        await safeRedisHDel(key, resourceId);
        results.push({ resourceType: type, resourceId, flightNumber });
      }
    }
  }

  return results;
}
