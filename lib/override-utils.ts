/**
 * lib/override-utils.ts
 *
 * Centralna logika za auto-reset override-ova:
 *
 * CheckInDesk  → resetuje se na STD - 30 minuta
 * GateNumber   → resetuje se na STD (ili ETD ako postoji i bliže je)
 *
 * Funkcije se pozivaju:
 *  1. Iz GET /api/admin/flight-override?action=getAllOverrides
 *  2. Iz GET /api/admin/auto-reset (cron / interval poziv svakih 60s)
 */

import { getRedisClient } from '@/lib/redis';

// ─────────────────────────────────────────────
// Tipovi
// ─────────────────────────────────────────────

export interface AutoResetResult {
  flightNumber: string;
  field: 'CheckInDesk' | 'GateNumber';
  reason: string;
}

// ─────────────────────────────────────────────
// Pomoćne funkcije za rad s vremenom
// ─────────────────────────────────────────────

/** Konvertuje "HH:MM" string u ukupan broj minuta od ponoći */
export function parseTimeToMinutes(timeStr: string): number {
  if (!timeStr || !timeStr.includes(':')) return -1;
  const [h, m] = timeStr.split(':').map(Number);
  if (isNaN(h) || isNaN(m)) return -1;
  return h * 60 + m;
}

/** Vraća trenutno vrijeme u minutama od ponoći (lokalno) */
export function getCurrentMinutes(): number {
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes();
}

/**
 * Koliko minuta do određenog vremena (može biti negativno = prošlo je).
 * Uzima u obzir prelazak ponoći.
 */
export function minutesUntil(targetTimeStr: string): number {
  const target = parseTimeToMinutes(targetTimeStr);
  if (target < 0) return Infinity;
  const current = getCurrentMinutes();
  let diff = target - current;
  if (diff < -720) diff += 1440;
  return diff;
}

/**
 * Koliko minuta do "STD - 30 minuta" (kada treba resetovati check-in).
 * Pozitivna vrijednost = još toliko minuta do reset-a.
 * Negativna vrijednost = reset je trebao biti prije toliko minuta.
 */
export function minutesUntilCheckInReset(scheduledTime: string): number {
  if (!scheduledTime || !scheduledTime.includes(':')) return Infinity;

  const [h, m] = scheduledTime.split(':').map(Number);
  if (isNaN(h) || isNaN(m)) return Infinity;

  // Vrijeme reset-a = STD - 30 minuta
  let resetHour = h;
  let resetMinute = m - 30;

  if (resetMinute < 0) {
    resetHour--;
    resetMinute += 60;
  }
  if (resetHour < 0) {
    resetHour += 24;
  }

  const resetTotalMinutes = resetHour * 60 + resetMinute;
  const currentTotalMinutes = getCurrentMinutes();

  let diff = resetTotalMinutes - currentTotalMinutes;

  if (diff < -720) diff += 1440;
  if (diff > 720) diff -= 1440;

  return diff;
}

// ─────────────────────────────────────────────
// Logika za reset pojedinih polja
// ─────────────────────────────────────────────

/**
 * CheckInDesk se resetuje kada je trenutno vrijeme >= STD - 30 minuta.
 *
 * Primjer: STD = 09:05
 *  - U 08:34 → NE resetuje (još 1 minuta do praga)
 *  - U 08:35 → resetuje (tačno na pragu)
 *  - U 09:10 → resetuje (5 min nakon STD)
 *  - U 12:00 → NE resetuje (prošlo više od 3h od praga)
 */
export function shouldResetCheckIn(
  scheduledTime: string,
  statusEN: string
): { reset: boolean; reason: string } {
  if (!scheduledTime) return { reset: false, reason: 'nema scheduled time' };

  const s = (statusEN || '').toLowerCase();
  const isTerminated =
    s.includes('departed') || s.includes('poletio') ||
    s.includes('cancelled') || s.includes('otkazan') ||
    s.includes('diverted') || s.includes('preusmjeren');

  if (isTerminated) {
    return { reset: false, reason: 'let je terminiran' };
  }

  const minsToReset = minutesUntilCheckInReset(scheduledTime);

  // Resetuj ako je prag dostignut (<=0) ali nije prošlo više od 3h (-180 min)
  if (minsToReset <= 0 && minsToReset > -180) {
    return {
      reset: true,
      reason: `STD ${scheduledTime} — check-in reset (${Math.abs(minsToReset)} min nakon praga STD-30min)`
    };
  }

  return {
    reset: false,
    reason: minsToReset > 0
      ? `Još ${minsToReset} min do reset praga (STD ${scheduledTime} - 30min)`
      : `Prošlo više od 3h od praga, preskačem`
  };
}

/**
 * GateNumber se resetuje kada ETD (ili STD ako ETD ne postoji) prođe.
 * Prozor: od 0 do -4h.
 */
export function shouldResetGate(
  scheduledTime: string,
  estimatedTime: string | undefined,
  statusEN: string
): { reset: boolean; reason: string; usedTime: string } {
  const referenceTime =
    estimatedTime && parseTimeToMinutes(estimatedTime) >= 0
      ? estimatedTime
      : scheduledTime;

  const mins = minutesUntil(referenceTime);
  const usedTime = referenceTime;

  const s = (statusEN || '').toLowerCase();
  const isTerminated =
    s.includes('departed') || s.includes('poletio') ||
    s.includes('cancelled') || s.includes('otkazan') ||
    s.includes('diverted') || s.includes('preusmjeren');

  if (isTerminated) {
    return { reset: false, reason: 'let je terminiran', usedTime };
  }

  if (mins <= 0 && mins > -240) {
    return {
      reset: true,
      reason: `${estimatedTime ? 'ETD' : 'STD'} ${referenceTime} je dostignut (${Math.abs(mins)} min prošlo)`,
      usedTime
    };
  }

  return {
    reset: false,
    reason: `${mins} min do ${estimatedTime ? 'ETD' : 'STD'}, previše rano`,
    usedTime
  };
}

// ─────────────────────────────────────────────
// Glavna funkcija
// ─────────────────────────────────────────────

/**
 * Prolazi kroz sve Redis override ključeve, provjerava svaki let
 * i resetuje CheckInDesk i/ili GateNumber gdje je potrebno.
 */
export async function runAutoReset(allFlights: any[]): Promise<AutoResetResult[]> {
  const redis = getRedisClient();
  const results: AutoResetResult[] = [];

  console.log(`[auto-reset] Pokrenuto u ${new Date().toLocaleTimeString('sr-Latn-RS')}, letova: ${allFlights.length}`);

  let keys: string[] = [];
  try {
    keys = await redis.keys('override:*');
    console.log(`[auto-reset] Redis ključevi (${keys.length}):`, keys);
  } catch (err) {
    console.error('[auto-reset] Redis keys() greška:', err);
    return results;
  }

  for (const key of keys) {
    const flightNumber = key.replace('override:', '');
    let data: Record<string, string> = {};

    try {
      data = await redis.hgetall(key);
    } catch {
      continue;
    }

    if (!data || Object.keys(data).length === 0) continue;

    // Pronađi let iz live podataka
    const flight = allFlights.find((f: any) => f.FlightNumber === flightNumber);
    if (!flight) {
      console.warn(`[auto-reset] ⚠️ Let "${flightNumber}" nije pronađen u live podacima!`);
      console.warn(`[auto-reset] Dostupni letovi: ${allFlights.map((f: any) => f.FlightNumber).join(', ')}`);
      continue;
    }

    const std = flight.ScheduledDepartureTime || '';
    const etd = flight.EstimatedDepartureTime || '';
    const status = flight.StatusEN || '';

    // ── Desk status reset (ako je let departed) ────────────────
const s = (status || '').toLowerCase();
const isDeparted =
  s.includes('departed') || s.includes('poletio') ||
  s.includes('cancelled') || s.includes('otkazan') ||
  s.includes('diverted') || s.includes('preusmjeren');

if (isDeparted) {
  // Reset desk-status override-ova za sve deskove ovog leta
  const deskValue = data.CheckInDesk || '';
  if (deskValue) {
    const desks = deskValue.split(',').map((d: string) => d.trim());
    for (const desk of desks) {
      if (desk) {
        try {
          await redis.del(`desk-status:${desk}`);
          console.log(`[auto-reset] ✅ desk-status:${desk} obrisan za departed let ${flightNumber}`);
        } catch (err) {
          console.error(`[auto-reset] ❌ desk-status redis greška za ${desk}:`, err);
        }
      }
    }
  }

  // Reset cijelog override ključa za departed let
  try {
    await redis.del(key);
    console.log(`[auto-reset] ✅ Svi override-ovi obrisani za departed let ${flightNumber}`);
    results.push({ flightNumber, field: 'CheckInDesk', reason: 'let je departed — full reset' });
  } catch (err) {
    console.error(`[auto-reset] ❌ Full reset greška za ${flightNumber}:`, err);
  }
  
  continue; // Preskači dalju obradu ovog leta
}

    console.log(`[auto-reset] Provjera ${flightNumber}: STD=${std}, ETD=${etd}, status="${status}", minsToReset=${minutesUntilCheckInReset(std)}`);

    // ── CheckInDesk reset ──────────────────────────────────
    if (data.CheckInDesk !== undefined) {
      const { reset, reason } = shouldResetCheckIn(std, status);
      if (reset) {
        try {
          await redis.hdel(key, 'CheckInDesk');
          console.log(`[auto-reset] ✅ CheckInDesk reset za ${flightNumber}: ${reason}`);
          results.push({ flightNumber, field: 'CheckInDesk', reason });

          const rem = await redis.hlen(key);
          if (rem === 0) await redis.del(key);
        } catch (err) {
          console.error(`[auto-reset] ❌ CheckInDesk redis greška za ${flightNumber}:`, err);
        }
      } else {
        console.log(`[auto-reset] ⏳ CheckInDesk NE resetuje za ${flightNumber}: ${reason}`);
      }
    }

    // ── GateNumber reset ───────────────────────────────────
    if (data.GateNumber !== undefined) {
      let freshData: Record<string, string> = {};
      try {
        freshData = await redis.hgetall(key);
      } catch {
        continue;
      }
      if (!freshData || freshData.GateNumber === undefined) continue;

      const { reset, reason, usedTime } = shouldResetGate(std, etd, status);
      if (reset) {
        try {
          await redis.hdel(key, 'GateNumber');
          console.log(`[auto-reset] ✅ GateNumber reset za ${flightNumber} (ref: ${usedTime}): ${reason}`);
          results.push({ flightNumber, field: 'GateNumber', reason });

          const rem = await redis.hlen(key);
          if (rem === 0) await redis.del(key);
        } catch (err) {
          console.error(`[auto-reset] ❌ GateNumber redis greška za ${flightNumber}:`, err);
        }
      } else {
        console.log(`[auto-reset] ⏳ GateNumber NE resetuje za ${flightNumber}: ${reason}`);
      }
    }
  }

  console.log(`[auto-reset] Završeno — resetovano ${results.length} polja`);
  return results;
}

// ─────────────────────────────────────────────
// Legacy funkcije (zadržano za kompatibilnost)
// ─────────────────────────────────────────────

let _timerRunning = false;
let _timerHandle: ReturnType<typeof setInterval> | null = null;

export function isTimerRunning(): boolean {
  return _timerRunning;
}

export function startAutoResetTimer(): void {
  if (_timerRunning) return;
  _timerRunning = true;
  console.log('[auto-reset-timer] Timer pokrenut (interval 5min)');
  _timerHandle = setInterval(async () => {
    try {
      await resetExpiredCheckInOverrides();
    } catch (err) {
      console.error('[auto-reset-timer] Greška:', err);
    }
  }, 5 * 60 * 1000);
}

export function stopAutoResetTimer(): void {
  if (_timerHandle) clearInterval(_timerHandle);
  _timerRunning = false;
  _timerHandle = null;
  console.log('[auto-reset-timer] Timer zaustavljen');
}

/** Legacy: zadržano za kompatibilnost, nova logika koristi runAutoReset() */
export async function resetExpiredCheckInOverrides(): Promise<number> {
  const redis = getRedisClient();
  let count = 0;
  const keys = await redis.keys('override:*');

  for (const key of keys) {
    const data = await redis.hgetall(key);
    if (!data?.CheckInDesk) continue;
    count++;
  }
  return count;
}