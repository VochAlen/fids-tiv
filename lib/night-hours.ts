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

// ════════════════════════════════════════════════════════════
// KONFIGURACIJA — jedino ovo treba mijenjati za drugi aerodrom
// ════════════════════════════════════════════════════════════
//
// Za aerodrom sa 24h operacijama (nema noćne pauze):
//   postavi ENABLED na false — isNightHours() će uvijek vraćati false,
//   a flight-sync cron nikad neće preskočiti publish zbog "noći".
//
// Za aerodrom u drugoj vremenskoj zoni:
//   promijeni TIMEZONE (IANA naziv, npr. 'Europe/Belgrade', 'Asia/Dubai').
//
// Za drugačije noćne prozore ili IATA sezone:
//   izmijeni NIGHT_WINDOW_END, NIGHT_WINDOW_START_FALLBACK i IATA
//   konstante ispod (već postoje, nepromijenjeno).
//
// FIX (portovano iz glavnog/polling sistema): LATITUDE/LONGITUDE —
// tačne koordinate aerodroma, potrebne za astronomski proračun
// zalaska sunca (vidi calculateSunsetMinutes niže). Za drugi aerodrom,
// promijeni na NJEGOVE koordinate — nema drugih izmjena potrebnih bilo
// gdje drugo u fajlu, isti obrazac kao TIMEZONE iznad.
const NIGHT_MODE_CONFIG = {
  ENABLED: true,
  TIMEZONE: 'Europe/Podgorica',
  LATITUDE: 42.404,
  LONGITUDE: 18.696,
} as const;

type Minutes = number; // 0-1439

function toMinutes(hours: number, minutes: number = 0): Minutes {
  return hours * 60 + minutes;
}

// FIX (po zahtjevu — večernja granica prati STVARAN zalazak sunca +
// 30 min, ne fiksni sat po sezoni, portovano iz glavnog/polling
// sistema): jutarnja granica NAMJERNO ostaje fiksna — čekiranje za
// letove ka Izraelu počinje 3h prije STD, što znači 04:00-05:00 čak i
// zimi, ranije nego bilo koji izlazak sunca bi predložio.
const SUNSET_GRACE_MINUTES = 30;

// FIX: samo KRAJ noćnog prozora (jutro) i dalje zavisi od sezone —
// nepromijenjeno. POČETAK (veče) se od sad računa astronomski, vidi
// resolveWindowForDate niže.
const NIGHT_WINDOW_END = {
  SUMMER: toMinutes(4, 0),
  WINTER_PEAK: toMinutes(5, 15),
  WINTER_REGULAR: toMinutes(5, 0),
} as const;

// Rezervni (fallback) POČECI — koriste se JEDINO ako astronomski
// proračun ikad ne uspije vratiti validnu vrijednost (praktično se
// nikad ne dešava na ovoj geografskoj širini — sunce svaki dan i
// izlazi i zalazi). Stare, fiksne vrijednosti koje su ranije bile
// jedini mehanizam.
const NIGHT_WINDOW_START_FALLBACK = {
  SUMMER: toMinutes(21, 0),
  WINTER_PEAK: toMinutes(16, 0),
  WINTER_REGULAR: toMinutes(17, 0),
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
  timeZone: NIGHT_MODE_CONFIG.TIMEZONE,
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

// lib/night-hours.ts — dodaj OVO (ispod postojeće getMontenegroParts funkcije)

// Datum "danas" po lokalnom (Podgorica) vremenu, u YYYY-MM-DD formatu.
// KORISTITI OVO svuda gdje se poredi "da li je backup od danas" —
// new Date().toISOString() daje UTC datum, što je pogrešno blizu ponoći
// (Podgorica je UTC+1/+2, pa lokalni dan počinje ranije nego UTC dan).
export function getPodgoricaDateString(date: Date = new Date()): string {
  const p = getMontenegroParts(date);
  const mm = String(p.month).padStart(2, '0');
  const dd = String(p.day).padStart(2, '0');
  return `${p.year}-${mm}-${dd}`;
}

// FIX (portovano iz glavnog sistema — potrebno za ispravku UTC-vs-
// Podgorica bug-a u lib/flight-data-service.ts, minutesSinceFlightTime):
// čisto brojevno "minuta od ponoći" po Podgorica lokalnom vremenu, bez
// ijedne Date/timezone operacije nakon ovog poziva — potpuno imuno na
// razliku između serverskog (UTC) i lokalnog vremena.
export function getPodgoricaMinutesOfDay(date: Date = new Date()): number {
  const p = getMontenegroParts(date);
  return p.hour * 60 + p.minute;
}

// FIX (portovano iz glavnog sistema, generalizovano za bilo koju
// NIGHT_MODE_CONFIG.TIMEZONE — ne fiksno "Podgorica" kao u glavnom
// sistemu, dosljedno ostatku ovog fajla): UTC pomak za konfigurisanu
// vremensku zonu NA DATI DAN (ne fiksan +1/+2 — mora ispravno pratiti
// prelaz na ljetnje/zimsko računanje vremena). Intl.DateTimeFormat sa
// timeZoneName:'shortOffset' je jedini pouzdan, ugrađen (bez eksterne
// biblioteke) način da se ovo dobije. Testirano protiv poznatih datuma
// (CET/CEST prelazi) prije uvrštavanja u glavni sistem.
const offsetFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: NIGHT_MODE_CONFIG.TIMEZONE,
  timeZoneName: "shortOffset",
});

function getTimezoneUtcOffsetHours(date: Date): number {
  const parts = offsetFormatter.formatToParts(date);
  const raw = parts.find((p) => p.type === "timeZoneName")?.value ?? "";
  const match = raw.match(/GMT([+-]\d+)/);
  return match ? parseInt(match[1], 10) : 1; // 1 = bezbjedan CET fallback
}

// FIX (po zahtjevu — astronomski zalazak sunca za aerodrom, +
// SUNSET_GRACE_MINUTES kao večernja granica noćnog režima, portovano
// iz glavnog sistema): standardan, dobro poznat i provjeren algoritam
// (US Naval Observatory / Sunrise Equation, isti koji koristi npr.
// sunrise-sunset.org API) — nema eksternu zavisnost, čista matematika.
// TESTIRANO protiv 5 stvarnih, potvrđenih datuma za Tivat (svi u
// granicama 1-2 minute tačnosti) prije uvrštavanja u glavni sistem —
// ista formula, samo generalizovana ovdje da čita koordinate iz
// NIGHT_MODE_CONFIG umjesto tvrdo ukucanih Tivat koordinata (dosljedno
// TIMEZONE obrascu iznad — za drugi aerodrom, samo promijeni
// LATITUDE/LONGITUDE u konfiguraciji na vrhu fajla). Vraća minute-od-
// ponoći po konfigurisanoj lokalnoj zoni, ili null u teoretskom
// slučaju da proračun ne uspije (vidi NIGHT_WINDOW_START_FALLBACK za
// siguran pad nazad u tom slučaju).
function calculateSunsetMinutes(date: Date): Minutes | null {
  const zenith = 90.833; // standardni ugao (atmosferska refrakcija + poluprečnik sunca)

  const yearStartUtc = Date.UTC(date.getUTCFullYear(), 0, 1);
  const todayUtc = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  const dayOfYear = Math.floor((todayUtc - yearStartUtc) / 86_400_000) + 1;

  const lngHour = NIGHT_MODE_CONFIG.LONGITUDE / 15;
  const t = dayOfYear + ((18 - lngHour) / 24);

  const M = (0.9856 * t) - 3.289;
  const Mrad = (M * Math.PI) / 180;

  let L = M + (1.916 * Math.sin(Mrad)) + (0.020 * Math.sin(2 * Mrad)) + 282.634;
  L = ((L % 360) + 360) % 360;
  const Lrad = (L * Math.PI) / 180;

  let RA = (180 / Math.PI) * Math.atan(0.91764 * Math.tan(Lrad));
  RA = ((RA % 360) + 360) % 360;

  const Lquadrant = Math.floor(L / 90) * 90;
  const RAquadrant = Math.floor(RA / 90) * 90;
  RA = (RA + (Lquadrant - RAquadrant)) / 15; // sati

  const sinDec = 0.39782 * Math.sin(Lrad);
  const cosDec = Math.cos(Math.asin(sinDec));

  const zenithRad = (zenith * Math.PI) / 180;
  const latRad = (NIGHT_MODE_CONFIG.LATITUDE * Math.PI) / 180;
  const cosH = (Math.cos(zenithRad) - (sinDec * Math.sin(latRad))) / (cosDec * Math.cos(latRad));

  if (cosH < -1 || cosH > 1) return null; // teoretski slučaj — nikad na ovoj geo. širini

  const H = ((180 / Math.PI) * Math.acos(cosH)) / 15; // sati, zalazak (ne izlazak)

  const T = H + RA - (0.06571 * t) - 6.622;
  let UT = T - lngHour;
  UT = ((UT % 24) + 24) % 24; // sati, UTC

  const offsetHours = getTimezoneUtcOffsetHours(date);
  let localHours = UT + offsetHours;
  localHours = ((localHours % 24) + 24) % 24;

  return Math.round(localHours * 60);
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

// Bira koji prozor (window) važi za dati datum — KRAJ (jutro) po
// sezoni (nepromijenjeno), POČETAK (veče) astronomski (zalazak sunca +
// SUNSET_GRACE_MINUTES), sa sigurnim padom nazad na staru fiksnu
// vrijednost ako proračun ikad ne uspije. Ne mijenja se u toku dana,
// pa je jedina stvar koju ima smisla keširati po danu (vidi
// getWindowCached) — za razliku od samog "da li je sad noć", što
// zavisi od trenutnog sata i mora da se računa na svaki poziv.
function resolveWindowForDate(p: MontenegroParts, date: Date) {
  const seasonKey: keyof typeof NIGHT_WINDOW_END = isSummerIataSeason(p)
    ? "SUMMER"
    : (IATA.PEAK_MONTHS as readonly number[]).includes(p.month)
    ? "WINTER_PEAK"
    : "WINTER_REGULAR";

  const sunsetMinutes = calculateSunsetMinutes(date);
  const start = sunsetMinutes !== null
    ? sunsetMinutes + SUNSET_GRACE_MINUTES
    : NIGHT_WINDOW_START_FALLBACK[seasonKey];

  return { start, end: NIGHT_WINDOW_END[seasonKey] };
}

// Keš: datum (YYYY-MM-DD po lokalnom vremenu) -> koji prozor važi taj
// dan. NAPOMENA: keširamo samo klasifikaciju za taj DAN (uključujući
// već izračunat astronomski početak — mijenja se samo jednom dnevno,
// po kalendarskom danu, ne u toku dana), NIKAD finalni boolean
// rezultat — jer se on mijenja više puta u toku istog dana (dan vs. noć).
const windowCache = new Map<string, { start: Minutes; end: Minutes }>();

function dateKey(p: MontenegroParts): string {
  return `${p.year}-${p.month}-${p.day}`;
}

function getWindowCached(p: MontenegroParts, date: Date) {
  const key = dateKey(p);
  const cached = windowCache.get(key);
  if (cached) return cached;

  const window = resolveWindowForDate(p, date);
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
  if (!NIGHT_MODE_CONFIG.ENABLED) return false;   // ← DODANO: aerodromi sa 24h operacijama

  const p = getMontenegroParts(date);
  const nowMinutes = toMinutes(p.hour, p.minute);
  const window = getWindowCached(p, date);

  return isWithinWindow(nowMinutes, window.start, window.end);
}