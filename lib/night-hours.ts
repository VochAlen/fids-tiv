// lib/night-hours.ts
// Aerodrom nema letove između 21:00 i 04:00 — u tom periodu
// preskačemo polling u potpunosti, bez ikakvog HTTP zahtjeva.
// export function isNightHours(): boolean {
//   const h = new Date().getHours();
//   return h >= 21 || h < 4;
// }

/// lib/night-hours.ts
// Aerodrom nema letove u određenom noćnom periodu — u tom periodu
// preskačemo polling u potpunosti, bez ikakvog HTTP zahtjeva.
//
// Noćni prozor zavisi od IATA sezone:
// - Ljetnja IATA sezona (zadnja subota marta – zadnja subota oktobra): 21:00–04:00
// - Zimska IATA sezona, decembar i januar (pojačan promet praznika): 16:00–05:15
// - Zimska IATA sezona, ostali mjeseci (februar, novembar): 17:00–05:00
//
// Sati se računaju po lokalnom vremenu Crne Gore (Europe/Podgorica), a ne
// po vremenu servera — Vercel serverless funkcije rade u UTC-u, pa direktno
// čitanje new Date().getHours() daje pogrešan rezultat.

type Minutes = number; // 0-1439

function toMinutes(hours: number, minutes: number = 0): Minutes {
  return hours * 60 + minutes;
}

const NIGHT_WINDOWS = {
  SUMMER: { start: toMinutes(21, 0), end: toMinutes(4, 0), label: "Ljeto" },
  WINTER_PEAK: {
    start: toMinutes(16, 0),
    end: toMinutes(5, 15),
    label: "Zima (praznici)",
  },
  WINTER_REGULAR: {
    start: toMinutes(17, 0),
    end: toMinutes(5, 0),
    label: "Zima (regularno)",
  },
} as const;

const IATA = {
  SUMMER_START_MONTH: 3, // Mart
  SUMMER_END_MONTH: 10, // Oktobar
  PEAK_MONTHS: [12, 1], // Decembar, Januar
} as const;

interface MontenegroParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
}

// Formatter se pravi samo jednom — Intl.DateTimeFormat konstruktor nije jeftin,
// pa nema smisla da se instancira na svaki poziv funkcije.
const mneFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Podgorica",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function getMontenegroParts(date: Date): MontenegroParts {
  const parts = mneFormatter.formatToParts(date);
  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value ?? 0);

  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
  };
}

// Zadnja subota u datom mjesecu (month je 1-12), vraća "kalendarski broj"
// oblika YYYYMMDD radi lakog poređenja, bez uticaja vremenske zone.
function lastSaturdayOfMonth(year: number, month: number): number {
  const lastDay = new Date(Date.UTC(year, month, 0));
  const dayOfWeek = lastDay.getUTCDay(); // 0=nedjelja ... 6=subota
  const diff = (dayOfWeek - 6 + 7) % 7;
  lastDay.setUTCDate(lastDay.getUTCDate() - diff);

  return (
    lastDay.getUTCFullYear() * 10000 +
    (lastDay.getUTCMonth() + 1) * 100 +
    lastDay.getUTCDate()
  );
}

function isSummerIataSeason(p: MontenegroParts): boolean {
  const today = p.year * 10000 + p.month * 100 + p.day;
  const summerStart = lastSaturdayOfMonth(p.year, IATA.SUMMER_START_MONTH);
  const summerEnd = lastSaturdayOfMonth(p.year, IATA.SUMMER_END_MONTH);

  return today >= summerStart && today < summerEnd;
}

// Bira koji prozor (window) važi za dati datum. Ova klasifikacija se ne
// mijenja u toku dana, pa je jedina stvar koju ima smisla keširati —
// za razliku od samog "da li je sad noć", što zavisi od trenutnog sata
// i mora da se računa na svaki poziv.
function resolveWindowForDate(p: MontenegroParts) {
  if (isSummerIataSeason(p)) return NIGHT_WINDOWS.SUMMER;
  if ((IATA.PEAK_MONTHS as readonly number[]).includes(p.month))
    return NIGHT_WINDOWS.WINTER_PEAK;
  return NIGHT_WINDOWS.WINTER_REGULAR;
}

// Keš: datum (YYYY-MM-DD po Podgorica vremenu) -> koji prozor važi taj dan.
// NAPOMENA: keširamo samo klasifikaciju sezone, NIKAD finalni boolean
// rezultat — jer se on mijenja više puta u toku istog dana (dan vs. noć).
const windowCache = new Map<string, (typeof NIGHT_WINDOWS)[keyof typeof NIGHT_WINDOWS]>();

function dateKey(p: MontenegroParts): string {
  return `${p.year}-${p.month}-${p.day}`;
}

function getWindowCached(p: MontenegroParts) {
  const key = dateKey(p);
  const cached = windowCache.get(key);
  if (cached) return cached;

  const window = resolveWindowForDate(p);
  windowCache.set(key, window);

  // Kontejner živi dok živi serverless instanca — keš ima maksimalno par
  // desetina unosa (dani), ali za svaki slučaj ograničimo rast.
  if (windowCache.size > 30) {
    windowCache.clear();
  }

  return window;
}

// Provjerava da li je "now" (u minutima od ponoći) unutar prozora
// koji može da pređe preko ponoći (npr. 21:00–04:00).
function isWithinWindow(
  nowMinutes: Minutes,
  startMinutes: Minutes,
  endMinutes: Minutes
): boolean {
  if (startMinutes > endMinutes) {
    // prozor prelazi preko ponoći
    return nowMinutes >= startMinutes || nowMinutes < endMinutes;
  }
  return nowMinutes >= startMinutes && nowMinutes < endMinutes;
}

export function isNightHours(date: Date = new Date()): boolean {
  const p = getMontenegroParts(date);
  const nowMinutes = toMinutes(p.hour, p.minute);
  const window = getWindowCached(p);

  return isWithinWindow(nowMinutes, window.start, window.end);
}