// lib/clock-format.ts
//
// Jedan izvor za sat (hh:mm) na kiosku. Ranije je sat koristio `new Date()` (sat RAČUNARA), dok se faza
// dolasci↔odlasci računa iz serverski ispravljenog sata — pa su monitori sa računarom koji "ide" pogrešno
// pokazivali drugačiji hh:mm od ostalih. Sada se vrijeme dobija iz nowMs() (server-clock) i uvijek
// formatira u vremenskoj zoni aerodroma, nezavisno od podešavanja računara.

export const AIRPORT_TZ = 'Europe/Podgorica';

let fmt: Intl.DateTimeFormat | null | undefined;

function getFormatter(): Intl.DateTimeFormat | null {
  if (fmt !== undefined) return fmt;
  try {
    fmt = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: AIRPORT_TZ });
  } catch {
    fmt = null; // starija okolina bez tz podataka → lokalna zona
  }
  return fmt;
}

/** "HH:MM" za dati trenutak (ms). */
export function formatClockHHMM(ms: number): string {
  const f = getFormatter();
  if (f) {
    const s = f.format(new Date(ms));
    return s.replace(/^24:/, '00:');
  }
  return new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

/** Koliko ms do početka sljedećeg minuta (uvijek 1..60000). */
export function msToNextMinute(ms: number): number {
  return 60_000 - (((ms % 60_000) + 60_000) % 60_000);
}
