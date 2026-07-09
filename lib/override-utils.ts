// lib/override-utils.ts
import { getRedisClient } from '@/lib/redis';

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

  // ✅ Batch: ukloni desk-status unose iz "test:desk-status:all" bloba
  if (deskStatusKeysToDelete.length > 0) {
    try {
      const raw = await redis.get('test:desk-status:all');
      if (raw) {
        const all = JSON.parse(raw);
        let changed = false;
        deskStatusKeysToDelete.forEach(desk => {
          if (all[desk]) { delete all[desk]; changed = true; }
        });
        if (changed) {
          await redis.set('test:desk-status:all', JSON.stringify(all), 'EX', 4 * 60 * 60);
          console.log(`[auto-reset] Očišćeno ${deskStatusKeysToDelete.length} desk-status unosa`);
        }
      }
    } catch (err) {
      console.error('[auto-reset] Greška pri čišćenju desk-status bloba:', err);
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