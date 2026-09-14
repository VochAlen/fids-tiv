// lib/night-hours.ts
// Aerodrom nema letove u određenom noćnom periodu — u tom periodu
// preskačemo polling u potpunosti, bez ikakvog HTTP zahtjeva.
//
// Noćni prozor:
// - VEČE (početak) — FIX (po zahtjevu): aerodrom je otvoren za
//   poletanje do zalaska sunca + 30 min, ne do fiksnog sata po sezoni.
//   Računa se ASTRONOMSKI, svaki dan iznova, za tačne koordinate
//   aerodroma Tivat (vidi calculateSunsetMinutes niže) — sezonski
//   fiksni sati (21:00 ljeti / 16:00-17:00 zimi) su ZADRŽANI samo kao
//   siguran pad nazad (NIGHT_WINDOW_START_FALLBACK), za teoretski
//   slučaj da astronomski proračun ikad ne uspije.
// - JUTRO (kraj) — NAMJERNO ostaje fiksno po IATA sezoni, nepromijenjeno:
//   Ljetnja IATA sezona (zadnja subota marta – zadnja subota oktobra): 04:00
//   Zimska IATA sezona, decembar i januar (pojačan promet praznika): 05:15
//   Zimska IATA sezona, ostali mjeseci (februar, novembar): 05:00
//   Razlog: čekiranje za letove ka Izraelu počinje 3h prije planiranog
//   polaska, što znači 04:00-05:00 čak i zimi — ranije nego bilo koji
//   izlazak sunca bi predložio da je "dan počeo".
//
// Sati se računaju po lokalnom vremenu Crne Gore (Europe/Podgorica), a ne
// po vremenu servera — Vercel serverless funkcije rade u UTC-u, pa direktno
// čitanje new Date().getHours() daje pogrešan rezultat.

type Minutes = number; // 0-1439

function toMinutes(hours: number, minutes: number = 0): Minutes {
  return hours * 60 + minutes;
}

// FIX (po zahtjevu — večernja granica prati STVARAN zalazak sunca +
// 30 min, ne fiksni sat po sezoni): koordinate aerodroma Tivat (TIV).
// Jutarnja granica NAMJERNO ostaje fiksna (vidi NIGHT_WINDOW_END ispod)
// — čekiranje za letove ka Izraelu počinje 3h prije STD, što znači
// 04:00-05:00 čak i zimi, ranije nego bilo koji izlazak sunca bi
// predložio da je "dan počeo".
const TIVAT_COORDS = { lat: 42.404, lon: 18.696 } as const;

// Koliko minuta poslije zalaska sunca počinje noćni režim.
const SUNSET_GRACE_MINUTES = 30;

// FIX: samo KRAJ noćnog prozora (jutro) i dalje zavisi od sezone —
// nepromijenjeno u odnosu na raniju verziju. POČETAK (veče) se od sad
// računa astronomski, vidi resolveWindowForDate niže.
const NIGHT_WINDOW_END = {
  SUMMER: toMinutes(4, 0),
  WINTER_PEAK: toMinutes(5, 15),
  WINTER_REGULAR: toMinutes(5, 0),
} as const;

// Rezervni (fallback) POČECI — koriste se JEDINO ako astronomski
// proračun ikad ne uspije vratiti validnu vrijednost (na ovoj
// geografskoj širini se to praktično nikad ne dešava — sunce svaki dan
// i izlazi i zalazi — ali defanzivno je bolje imati siguran pad nazad
// nego da isNightHours() ikad baci grešku ili vrati pogrešno "nikad
// noć"). Ovo su STARE, fiksne vrijednosti koje su ranije bile jedini
// mehanizam.
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

// FIX (po zahtjevu — astronomski zalazak sunca): UTC pomak za
// Europe/Podgorica NA DATI DAN (ne fiksan +1/+2 — mora ispravno pratiti
// prelaz na ljetnje/zimsko računanje vremena, poslednja nedjelja marta/
// oktobra). Intl.DateTimeFormat sa timeZoneName:'shortOffset' je jedini
// pouzdan, ugrađen (bez eksterne biblioteke) način da se ovo dobije —
// isti Intl mehanizam koji već koristi mneFormatter iznad za sate/
// minute, samo za pomak umjesto za sate. Testirano protiv poznatih
// datuma (CET/CEST prelazi) prije uvrštavanja u kod.
const offsetFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "Europe/Podgorica",
  timeZoneName: "shortOffset",
});

function getPodgoricaUtcOffsetHours(date: Date): number {
  const parts = offsetFormatter.formatToParts(date);
  const raw = parts.find((p) => p.type === "timeZoneName")?.value ?? "";
  const match = raw.match(/GMT([+-]\d+)/);
  return match ? parseInt(match[1], 10) : 1; // 1 = bezbjedan CET fallback
}

// FIX (po zahtjevu — astronomski zalazak sunca za Tivat, +30 min kao
// večernja granica noćnog režima): standardan, dobro poznat i
// provjeren algoritam (US Naval Observatory / Sunrise Equation, isti
// koji koristi npr. sunrise-sunset.org API) — nema eksternu zavisnost,
// čista matematika. TESTIRANO protiv 5 stvarnih, potvrđenih datuma za
// Tivat (svi u granicama 1-2 minute tačnosti) prije uvrštavanja ovdje.
// Vraća minute-od-ponoći PO PODGORICA lokalnom vremenu, ili null u
// teoretskom slučaju da proračun ne uspije (na ovoj geografskoj širini
// se praktično nikad ne dešava — vidi NIGHT_WINDOW_START_FALLBACK iznad
// za siguran pad nazad u tom slučaju).
function calculateSunsetMinutes(date: Date): Minutes | null {
  const zenith = 90.833; // standardni ugao (atmosferska refrakcija + poluprečnik sunca)

  const yearStartUtc = Date.UTC(date.getUTCFullYear(), 0, 1);
  const todayUtc = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  const dayOfYear = Math.floor((todayUtc - yearStartUtc) / 86_400_000) + 1;

  const lngHour = TIVAT_COORDS.lon / 15;
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
  const latRad = (TIVAT_COORDS.lat * Math.PI) / 180;
  const cosH = (Math.cos(zenithRad) - (sinDec * Math.sin(latRad))) / (cosDec * Math.cos(latRad));

  if (cosH < -1 || cosH > 1) return null; // teoretski slučaj — nikad na ovoj geo. širini

  const H = ((180 / Math.PI) * Math.acos(cosH)) / 15; // sati, zalazak (ne izlazak)

  const T = H + RA - (0.06571 * t) - 6.622;
  let UT = T - lngHour;
  UT = ((UT % 24) + 24) % 24; // sati, UTC

  const offsetHours = getPodgoricaUtcOffsetHours(date);
  let localHours = UT + offsetHours;
  localHours = ((localHours % 24) + 24) % 24;

  return Math.round(localHours * 60);
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
// 30 min), sa sigurnim padom nazad na staru fiksnu vrijednost ako
// proračun ikad ne uspije. Ne mijenja se u toku dana, pa je jedina
// stvar koju ima smisla keširati po danu (vidi getWindowCached) — za
// razliku od samog "da li je sad noć", što zavisi od trenutnog sata i
// mora da se računa na svaki poziv.
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

// Keš: datum (YYYY-MM-DD po Podgorica vremenu) -> koji prozor važi taj dan.
// NAPOMENA: keširamo samo klasifikaciju za taj DAN (uključujući već
// izračunat astronomski početak — mijenja se samo jednom dnevno, po
// kalendarskom danu, ne u toku dana), NIKAD finalni boolean rezultat —
// jer se on mijenja više puta u toku istog dana (dan vs. noć).
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
  const p = getMontenegroParts(date);
  const nowMinutes = toMinutes(p.hour, p.minute);
  const window = getWindowCached(p, date);

  return isWithinWindow(nowMinutes, window.start, window.end);
}

// FIX (minutesSinceFlightTime u lib/flight-data-service.ts računao pogrešno
// za 1-2h): server (Vercel) radi u UTC, a HH:MM string iz rasporeda leta je
// LOKALNO (Podgorica) vrijeme. new Date(); date.setHours(h, m) interpretira
// h/m kao SERVERSKO (UTC) lokalno vrijeme, ne kao Podgorica vrijeme — isti
// razlog zašto je getPodgoricaDateString() iznad morao zamijeniti
// new Date().toISOString(). Ova funkcija vraća "koliko je minuta prošlo od
// ponoći, po Podgorica vremenu" — poredi se sa HH:MM iz rasporeda BEZ
// ikakve Date/timezone aritmetike, pa je immune na server-vs-lokalno
// vrijeme problem u potpunosti (radi samo sa brojevima 0-1439).
export function getPodgoricaMinutesOfDay(date: Date = new Date()): number {
  const p = getMontenegroParts(date);
  return toMinutes(p.hour, p.minute);
}

// FIX (lib/override-ttl.ts računao TTL pogrešno za 1-2h — override-i su
// živjeli u Redis-u 1-2h duže nego što je dizajnirano): treći fajl sa
// istim server-vs-Podgorica-vrijeme problemom (vidi getPodgoricaMinutesOfDay
// i minutesSinceFlightTime u lib/flight-data-service.ts za pun kontekst
// obrasca). Ova funkcija računa APSOLUTNI epoch timestamp za dato HH:MM
// (Podgorica vrijeme) BEZ ikad konstruisati Date objekat preko setHours
// (što bi h/m protumačilo kao serversko/UTC lokalno vrijeme) — radi
// isključivo u prostoru "razlika u minutima od sada", pa je razlika
// dodata na already-correct now.getTime() (koji je UVIJEK apsolutni UTC
// epoch, bez obzira na serversku vremensku zonu — samo su setHours/
// getHours "lokalni" accessor-i problematični, ne i getTime()/Date.now()).
// Vraća null ako hhmm nije parsibilan "HH:MM" string.
export function getPodgoricaEpochMsForTime(hhmm: string, now: Date = new Date()): number | null {
  const m = hhmm.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const targetMinutes = parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
  const nowMinutes = getPodgoricaMinutesOfDay(now);

  let diffMinutes = targetMinutes - nowMinutes;
  const TWELVE_HOURS_MIN = 12 * 60;
  if (diffMinutes > TWELVE_HOURS_MIN) diffMinutes -= 24 * 60;
  else if (diffMinutes < -TWELVE_HOURS_MIN) diffMinutes += 24 * 60;

  return now.getTime() + diffMinutes * 60_000;
}