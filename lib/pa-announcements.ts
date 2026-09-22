// lib/pa-announcements.ts
//
// v5.9 — Automatske PA najave, portovano iz starog components/AirportPA.tsx
// (legacy sistem koji je direktno pollovao /api/flights/tv/ svakih 60s i
// radio sa RawFlightData-stilom poljima — BrojLeta, Kompanija, Grad, HHMM
// vremena bez dvotačke, kodirani statusi kao "A07ARR"/"A09DEP").
//
// Ovaj modul radi sa TRENUTNIM, transformisanim Flight tipom
// (types/flight.ts): FlightNumber je već spojen (npr. "W61234"),
// vremena su "HH:MM" stringovi, StatusEN je čitljiv tekst ("Delayed",
// "Cancelled", "Arrived"...) — isti oblik koji border/departures/baggage
// stranice već koriste. Logika ispod je funkcionalno identična starom
// sistemu (isti vremenski prozori za checkin/boarding/final pozive,
// isti gate-change/delay/cancel/divert/arrival trigeri), samo prilagođena
// ovom obliku podataka — nema kopiranja stare RawFlightData logike 1:1.
//
// NAMJERNO IZOSTAVLJENO naspram starog fajla: MP3 pre-recorded lookup
// (buildDepMP3Url/buildArrMP3Url/checkMP3Exists) i gong zvuk — u ovom
// projektu ne postoji /public/DEP, /public/ARR ni gong.mp3 fajl, pa bi
// ta logika samo generisala HEAD 404 zahtjeve uzalud. Sve najave idu
// isključivo preko Web Speech API TTS-a (isto kao manuelni PA sistem iz
// prethodne runde). Ako MP3 fajlovi budu dodani kasnije, ovaj modul je
// mjesto gdje bi se ta logika vratila.

import type { Flight } from '@/types/flight';
import { checkFlightStatus } from '@/lib/check-in-service';

// ── Vremenski prozori (identično starom sistemu) ──────────────────────
export interface AnnouncementWindow {
  type: string;
  triggerOffsetMin: number; // minuta PRIJE planiranog polaska (pozitivno = prije)
  windowMin: number;        // koliko minuta nakon trigger trenutka ostaje "aktuelno"
}

export const DEPARTURE_WINDOWS: AnnouncementWindow[] = [
  { type: 'checkin_120', triggerOffsetMin: 120, windowMin: 10 },
  { type: 'checkin_90',  triggerOffsetMin: 90,  windowMin: 10 },
  { type: 'checkin_60',  triggerOffsetMin: 60,  windowMin: 10 },
  { type: 'boarding_30', triggerOffsetMin: 30,  windowMin: 10 },
  { type: 'boarding_20', triggerOffsetMin: 20,  windowMin: 10 },
  { type: 'final_15',    triggerOffsetMin: 15,  windowMin: 7 },
  { type: 'final_10',    triggerOffsetMin: 10,  windowMin: 7 },
];

// ── Vrijeme — "HH:MM" stringovi (NE stari HHMM bez dvotačke) ──────────
export function parseHHMM(str?: string): number | null {
  if (!str) return null;
  const m = str.trim().match(/^(\d{1,2})[:.](\d{2})$/);
  if (!m) return null;
  const h = +m[1], min = +m[2];
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

export function nowMinutes(): number {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
}

export function formatTimeDisplay(str?: string): string {
  return str && str.trim() ? str.trim() : '--:--';
}

// ── Status klasifikacija — reuse postojećeg checkFlightStatus() iz
// lib/check-in-service.ts (isti string-matching pattern koji cijeli
// projekat već koristi) + lokalna "arrived" provjera (isti pattern kao
// app/baggage/[beltNumber]/BaggagePageClient.tsx). ─────────────────────
export function isArrivedStatus(status: string): boolean {
  const s = (status || '').toLowerCase();
  return s.includes('arrived') || s.includes('sletio') || s.includes('landed');
}

// ── Da li se najava za dati let+tip treba izgovoriti SADA (vremenski
// prozor + status uslov). Identična logika kao stari shouldPlayAnnouncement,
// samo na "HH:MM" formatu. ─────────────────────────────────────────────
export function shouldPlayDepartureWindow(flight: Flight, win: AnnouncementWindow): boolean {
  const std = parseHHMM(flight.ScheduledDepartureTime);
  if (std === null) return false;

  const now = nowMinutes();
  let trigger = std - win.triggerOffsetMin;
  if (trigger < 0) trigger += 1440; // prelaz preko ponoći

  return now >= trigger && now < trigger + win.windowMin;
}

export function shouldAnnounceArrival(flight: Flight): boolean {
  const now = nowMinutes();
  const actualTime = parseHHMM(flight.ActualDepartureTime);
  if (actualTime === null) return true; // nema aktuelnog vremena — najavi jednom, dedup ionako sprečava ponavljanje
  let minutesSince = now - actualTime;
  if (minutesSince < 0) minutesSince += 1440;
  return minutesSince <= 10;
}

export function shouldAnnounceDelay(flight: Flight): boolean {
  const std = parseHHMM(flight.ScheduledDepartureTime);
  if (std === null) return false;
  const now = nowMinutes();
  const minTime = std - 120;
  const maxTime = std + 30;
  if (minTime < 0) {
    if (now >= 0 && now <= maxTime) return true;
    if (now >= minTime + 1440 && now <= 1439) return true;
    return false;
  }
  return now >= minTime && now <= maxTime;
}

// ── Dedup ključ — FlightNumber+ScheduledDepartureTime je stabilan
// identitet leta za taj dan (isti pattern kao 'key' prop fix u
// departures/arrivals/border stranicama). ──────────────────────────────
export function getAnnouncementKey(flight: Flight, type: string): string {
  return `${flight.FlightNumber}_${flight.ScheduledDepartureTime}_${type}`;
}

// ── Broj leta za izgovor — FlightNumber je već spojen (npr. "W61234"),
// otsijeci vodeća slova (kod avio-kompanije) i izgovori samo cifre.
// Stari sistem je ovo radio SAMO za EasyJet (posebna grana); u trenutnom
// sistemu je FlightNumber UVIJEK spojen, pa je ovo sad opšte pravilo. ──
function extractDigits(flightNumber: string): string {
  const match = (flightNumber || '').match(/(\d+)$/);
  return match ? match[1] : flightNumber || '';
}

const numWordsEN: Record<string, string> = {
  '0': 'zero', '1': 'one', '2': 'two', '3': 'three', '4': 'four',
  '5': 'five', '6': 'six', '7': 'seven', '8': 'eight', '9': 'nine',
};
const numWordsLocal: Record<string, string> = {
  '0': 'nula', '1': 'jedan', '2': 'dva', '3': 'tri', '4': 'četiri',
  '5': 'pet', '6': 'šest', '7': 'sedam', '8': 'osam', '9': 'devet',
};

export function spokenFlightNumberEN(flight: Flight): string {
  return extractDigits(flight.FlightNumber).split('').map(ch => numWordsEN[ch] ?? ch).join(' ');
}
export function spokenFlightNumberLocal(flight: Flight): string {
  return extractDigits(flight.FlightNumber).split('').map(ch => numWordsLocal[ch] ?? ch).join(' ');
}

function naturalNumberWordEN(num: number): string {
  const ones  = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
  const teens = ['ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
  const tens  = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
  if (num === 0) return 'zero';
  if (num < 10) return ones[num];
  if (num < 20) return teens[num - 10];
  const ten = Math.floor(num / 10), unit = num % 10;
  return unit === 0 ? tens[ten] : `${tens[ten]}-${ones[unit]}`;
}

function brojRijecima(num: number): string {
  const ones  = ['', 'jedan', 'dva', 'tri', 'četiri', 'pet', 'šest', 'sedam', 'osam', 'devet'];
  const teens = ['deset', 'jedanaest', 'dvanaest', 'trinaest', 'četrnaest', 'petnaest', 'šesnaest', 'sedamnaest', 'osamnaest', 'devetnaest'];
  const tens  = ['', '', 'dvadeset', 'trideset', 'četrdeset', 'pedeset', 'šezdeset', 'sedamdeset', 'osamdeset', 'devedeset'];
  if (num === 0) return 'nula';
  if (num < 10) return ones[num];
  if (num < 20) return teens[num - 10];
  const ten = Math.floor(num / 10), unit = num % 10;
  return unit === 0 ? tens[ten] : `${tens[ten]} ${ones[unit]}`;
}

function formatGateStringEN(gate: string): string {
  if (!gate) return '';
  return gate.replace(/\d+/g, m => naturalNumberWordEN(parseInt(m, 10)));
}
function formatGateStringLocal(gate: string): string {
  if (!gate) return '';
  return gate.replace(/\d+/g, m => brojRijecima(parseInt(m, 10)));
}
function formatCheckInStringEN(checkIn: string): string {
  if (!checkIn) return '';
  return checkIn.split(',').map(p => {
    p = p.trim();
    if (p.includes('-')) {
      const r = p.split('-').map(x => parseInt(x.trim(), 10));
      if (r.length === 2 && !isNaN(r[0]) && !isNaN(r[1])) return `${naturalNumberWordEN(r[0])} to ${naturalNumberWordEN(r[1])}`;
      return p;
    }
    const n = parseInt(p, 10);
    return !isNaN(n) ? naturalNumberWordEN(n) : p;
  }).join(', ');
}
function formatCheckInStringLocal(checkIn: string): string {
  if (!checkIn) return '';
  return checkIn.split(',').map(p => {
    p = p.trim();
    if (p.includes('-')) {
      const r = p.split('-').map(x => parseInt(x.trim(), 10));
      if (r.length === 2 && !isNaN(r[0]) && !isNaN(r[1])) return `${brojRijecima(r[0])} do ${brojRijecima(r[1])}`;
      return p;
    }
    const n = parseInt(p, 10);
    return !isNaN(n) ? brojRijecima(n) : p;
  }).join(', ');
}

export function computeDelayMinutes(flight: Flight): number | null {
  const plan = parseHHMM(flight.ScheduledDepartureTime);
  const est  = parseHHMM(flight.EstimatedDepartureTime);
  if (plan === null || est === null) return null;
  let diff = est - plan;
  if (diff < 0) diff += 1440;
  if (diff > 720) return null;
  return diff > 0 ? diff : null;
}

// ── Nazivi avio-kompanija i gradova za "lokalni jezik" izgovor. Ove
// liste su fonetski pisane (npr. "Ryanair" -> "Rajner") da bi se, ako
// Chrome nema pravi hr/sr glas instaliran (uobičajen slučaj — Chrome-ov
// standardni glasovni spisak obično NE sadrži balkanske jezike), tekst
// mogao pročitati preko ENGLESKOG glasa i i dalje zvučati prepoznatljivo
// — isti "fonetska transliteracija preko engleskog TTS motora" princip
// koji je ranija verzija ovog PA sistema već koristila (vidi speak()
// fallback logiku u app/pa/PaPageClient.tsx). Kopirano iz starog fajla,
// prošireno minimalno gdje je nedostajalo. ─────────────────────────────
export const AIRLINE_NAME_LOCAL: Record<string, string> = {
  "Jet2.com": "Džet Tu", "easyJet": "Izi Džet", "EasyJet Europe": "Izi Džet",
  "Norwegian Air Sweden AOC AB": "Norvidžian", "Arkia Israeli Air-Lines": "Arkia",
  "El-Al Israel Airlines Ltd Sundor": "El Al Sandor", "British Airways": "Britiš Ervejz",
  "Air Serbia": "Er Srbija", "Luxair": "Luks Er", "Ryanair": "Rajner",
  "Wizz Air": "Viz Er", "Wizz Air UK": "Viz Er UK", "Wizz Air Malta": "Viz Er Malta",
  "Lufthansa": "Lufthansa", "Eurowings": "Evrovings", "Austrian Airlines": "Austrian Erlajns",
  "Swiss International Air Lines": "Švajc Erlajns", "KLM Royal Dutch Airlines": "KLM",
  "Air France": "Er Frans", "Turkish Airlines": "Turkiš Erlajns", "Pegasus Airlines": "Pegasus",
  "Transavia France": "Transavija Frans", "Transavia Airlines": "Transavija",
  "Vueling Airlines": "Vueling", "Iberia": "Iberia", "SAS Scandinavian Airlines": "SAS",
  "Finnair": "Finer", "Aegean Airlines": "Edžin Erlajns", "Air Baltic": "Er Baltik",
  "LOT Polish Airlines": "Lot", "Czech Airlines": "Češka Erlajns",
  "Croatia Airlines": "Kroacija Erlajns", "Air Montenegro": "Er Montenegro",
  "AirMontenegro": "Er Montenegro", "Bulgaria Air": "Bugarski Er", "TAROM": "Tarom",
  "Blue Air": "Ble Er", "Sky Express": "Skaj Ekspres", "Volotea": "Volotea",
  "TUI Airways": "TUI Ervejz", "TUI fly Belgium": "TUI flaj Belgija",
  "Corendon Airlines": "Korendon Erlajns", "Freebird Airlines": "Fribird Erlajns",
  "SunExpress": "San Ekspres", "SmartLynx Airlines": "Smart Links", "Enter Air": "Enter Er",
  "Air Cairo": "Er Kairo", "Air Europa": "Er Europa", "Air Malta": "Er Malta",
  "Alitalia": "Alitalija", "Brussels Airlines": "Brisel Erlajns", "Condor": "Kondor",
  "Norwegian Air Shuttle": "Norvidžian er šatl", "Olympic Air": "Olimpik er",
  "TAP Air Portugal": "Tap er Portugal", "Edelweiss Air": "Edelvajs er",
  "Helvetic Airways": "Helvetik ervejz", "FlyDubai": "Flaj Dubai", "Fly Dubai": "Flaj Dubai",
};

export const CITY_NAME_LOCAL: Record<string, string> = {
  "Belgrade": "Beograd", "Vienna": "Beč", "Rome": "Rim", "Munich": "Minhen",
  "Stockholm": "Štokholm", "Manchester": "Mančester", "Paris": "Pariz",
  "Athens": "Atina", "Budapest": "Budimpešta", "London STN": "London Stansted",
  "London LTN": "London Luton", "London LHR": "London Hitrou", "London LGW": "London Getvik",
  "Frankfurt": "Frankfurt", "Berlin": "Berlin", "Milan": "Milano", "Warsaw": "Varšava",
  "Prague": "Prag", "Brussels": "Brisel", "Copenhagen": "Kopenhagen", "Oslo": "Oslo",
  "Helsinki": "Helsinki", "Dublin": "Dublin", "Amsterdam": "Amsterdam", "Zurich": "Cirih",
  "Lisbon": "Lisabon", "Madrid": "Madrid", "Barcelona": "Barcelona", "Istanbul": "Istanbul",
  "Moscow": "Moskva", "Dubai": "Dubai", "Doha": "Doha", "Catania": "Katanija",
};

export function localAirlineName(original: string): string {
  if (!original) return '';
  const norm = original.trim().replace(/\s+/g, ' ').toLowerCase();
  for (const [k, v] of Object.entries(AIRLINE_NAME_LOCAL)) {
    if (norm === k.trim().replace(/\s+/g, ' ').toLowerCase()) return v;
  }
  return original;
}
export function localCityName(original: string): string {
  return CITY_NAME_LOCAL[original] || original;
}

// ── Builders — EN ──────────────────────────────────────────────────────
export function buildArrivalEN(f: Flight): string {
  return `Attention please. ${f.AirlineName} flight ${spokenFlightNumberEN(f)} from ${f.DestinationCityName} has arrived. Thank you.`;
}

export function buildDepartureEN(f: Flight, type: string): string {
  const dest = f.DestinationCityName;
  const airline = f.AirlineName;
  const checkins = f.CheckInDesk ? `Check-in desks ${formatCheckInStringEN(f.CheckInDesk)}.` : '';
  const gate = f.GateNumber ? `Gate ${formatGateStringEN(f.GateNumber)}` : 'the designated gate';
  const num = spokenFlightNumberEN(f);

  switch (type) {
    case 'checkin_120': return `Attention please. ${airline} flight ${num} to ${dest} is now open for check-in. ${checkins} Check-in will close 30 minutes before departure. Thank you.`;
    case 'checkin_90':  return `Attention please. This is a reminder that check-in is open for ${airline} flight ${num} to ${dest}. ${checkins} Please ensure you have checked in before the desk closes. Thank you.`;
    case 'checkin_60':  return `Attention please. Last call for check-in. ${airline} flight ${num} to ${dest}. ${checkins} Check-in closes in 15 minutes. Please proceed immediately. Thank you.`;
    case 'boarding_30': return `Attention please. ${airline} flight ${num} to ${dest} is now ready for boarding at ${gate}. Please have your boarding pass and identification ready. Thank you.`;
    case 'boarding_20': return `Attention please. Boarding is in progress for ${airline} flight ${num} to ${dest} at ${gate}. All passengers should now be at the gate. Thank you.`;
    case 'final_15':    return `Final call. Final call for ${airline} flight ${num} to ${dest}. Please proceed immediately to ${gate}. Thank you.`;
    case 'final_10':    return `Last and final call. ${airline} flight ${num} to ${dest}. The gate is about to close. Report immediately to ${gate} or you will be offloaded. Thank you.`;
    default: return '';
  }
}

export function buildDelayEN(f: Flight): string {
  const minutes = computeDelayMinutes(f);
  const direction = f.FlightType === 'departure' ? `to ${f.DestinationCityName}` : `from ${f.DestinationCityName}`;
  if (minutes !== null && minutes > 0) {
    return `Attention please. ${f.AirlineName} flight ${spokenFlightNumberEN(f)} ${direction} will be delayed approximately ${naturalNumberWordEN(minutes)} minutes. We apologize for the inconvenience. Thank you for your patience.`;
  }
  const newTime = formatTimeDisplay(f.EstimatedDepartureTime || f.ActualDepartureTime);
  return `Attention please. We regret to inform you that ${f.AirlineName} flight ${spokenFlightNumberEN(f)} ${direction} has been delayed. The new expected time is ${newTime}. We apologize for the inconvenience. Thank you for your patience.`;
}

export function buildCancelledEN(f: Flight): string {
  const dir = f.FlightType === 'departure' ? `to ${f.DestinationCityName}` : `from ${f.DestinationCityName}`;
  return `Attention please. We regret to announce that ${f.AirlineName} flight ${spokenFlightNumberEN(f)} ${dir} has been cancelled. Please contact your airline representative or proceed to the information desk for assistance. We apologize for the inconvenience.`;
}

export function buildDivertedEN(f: Flight): string {
  const dir = f.FlightType === 'departure' ? `to ${f.DestinationCityName}` : `from ${f.DestinationCityName}`;
  return `Attention please. ${f.AirlineName} flight ${spokenFlightNumberEN(f)} ${dir} has been diverted. Please proceed to the information desk or contact your airline for further details. We apologize for any inconvenience caused.`;
}

export function buildGateChangeEN(f: Flight, oldGate: string, newGate: string): string {
  const num = spokenFlightNumberEN(f);
  return `Attention please. Gate change. Gate change for ${f.AirlineName} flight ${num} to ${f.DestinationCityName}. ` +
    `This flight has changed from gate ${formatGateStringEN(oldGate)} to gate ${formatGateStringEN(newGate)}. ` +
    `All passengers please proceed immediately to gate ${formatGateStringEN(newGate)}. We apologize for any inconvenience. Thank you.`;
}

// ── Builders — lokalni jezik ────────────────────────────────────────────
export function buildArrivalLocal(f: Flight): string {
  return `Pažnja molim. Let kompanije ${localAirlineName(f.AirlineName)} broj ${spokenFlightNumberLocal(f)} iz ${localCityName(f.DestinationCityName)} je sletio. Hvala.`;
}

export function buildDepartureLocal(f: Flight, type: string): string {
  const dest = localCityName(f.DestinationCityName);
  const airline = localAirlineName(f.AirlineName);
  const checkins = f.CheckInDesk ? `Šalteri za registraciju ${formatCheckInStringLocal(f.CheckInDesk)}.` : '';
  const gate = f.GateNumber ? `izlaz ${formatGateStringLocal(f.GateNumber)}` : 'određeni izlaz';
  const num = spokenFlightNumberLocal(f);

  switch (type) {
    case 'checkin_120': return `Pažnja molim. Let kompanije ${airline} broj ${num} za ${dest} je otvoren za registraciju putnika. ${checkins} Prijava se zatvara 30 minuta prije polijetanja. Hvala.`;
    case 'checkin_90':  return `Pažnja molim. Podsjetnik – registracija putnika je otvorena za let kompanije ${airline} broj ${num} za ${dest}. ${checkins} Molimo prijavite se na vrijeme. Hvala.`;
    case 'checkin_60':  return `Pažnja molim. Posljednji poziv za registraciju putnika. Let kompanije ${airline} broj ${num} za ${dest}. ${checkins} Registracija se zatvara za 15 minuta. Molimo odmah pristupite šalteru. Hvala.`;
    case 'boarding_30': return `Pažnja molim. Let kompanije ${airline} broj ${num} za ${dest} spreman je za ukrcavanje na ${gate}. Molimo pripremite Vašu putnu ispravu i kartu za ukrcavanje. Hvala.`;
    case 'boarding_20': return `Pažnja molim. Ukrcavanje je u toku za let kompanije ${airline} broj ${num} za ${dest} na ${gate}. Svi putnici trebaju biti na izlazu. Hvala.`;
    case 'final_15':    return `Posljednji poziv za putnike leta kompanije ${airline} broj ${num} za ${dest}. Molimo odmah pristupite ${gate}. Hvala.`;
    case 'final_10':    return `Poslednji poziv. Let kompanije ${airline} broj ${num} za ${dest}. Izlaz se zatvara. Odmah pristupite ${gate} ili ćete biti odjavljeni. Hvala.`;
    default: return '';
  }
}

export function buildDelayLocal(f: Flight): string {
  const minutes = computeDelayMinutes(f);
  const direction = f.FlightType === 'departure' ? `za ${localCityName(f.DestinationCityName)}` : `iz ${localCityName(f.DestinationCityName)}`;
  const airline = localAirlineName(f.AirlineName);
  if (minutes !== null && minutes > 0) {
    return `Pažnja molim. Let kompanije ${airline} broj ${spokenFlightNumberLocal(f)} ${direction} kasnit će otprilike ${brojRijecima(minutes)} minuta. Ispričavamo se na neugodnosti. Hvala na strpljenju.`;
  }
  const newTime = formatTimeDisplay(f.EstimatedDepartureTime || f.ActualDepartureTime);
  return `Pažnja molim. Žalimo što moramo obavijestiti da let kompanije ${airline} broj ${spokenFlightNumberLocal(f)} ${direction} kasni. Novo očekivano vrijeme je ${newTime}. Izvinjavamo se na neugodnosti. Hvala na strpljenju.`;
}

export function buildCancelledLocal(f: Flight): string {
  const dir = f.FlightType === 'departure' ? `za ${localCityName(f.DestinationCityName)}` : `iz ${localCityName(f.DestinationCityName)}`;
  const airline = localAirlineName(f.AirlineName);
  return `Pažnja molim. Žalimo što moramo obavijestiti da je let kompanije ${airline} broj ${spokenFlightNumberLocal(f)} ${dir} otkazan. Molimo kontaktirajte predstavnika avio kompanije ili se obratite šalteru informacija. Izvinjavamo se na neugodnosti.`;
}

export function buildDivertedLocal(f: Flight): string {
  const dir = f.FlightType === 'departure' ? `za ${localCityName(f.DestinationCityName)}` : `iz ${localCityName(f.DestinationCityName)}`;
  const airline = localAirlineName(f.AirlineName);
  return `Pažnja molim. Let kompanije ${airline} broj ${spokenFlightNumberLocal(f)} ${dir} preusmjeren je na drugi aerodrom. Molimo obratite se informacijama ili vašoj avio kompaniji. Izvinjavamo se na neugodnosti.`;
}

export function buildGateChangeLocal(f: Flight, oldGate: string, newGate: string): string {
  const num = spokenFlightNumberLocal(f);
  return `Pažnja molim. Promjena izlaza. Promjena izlaza za let kompanije ${localAirlineName(f.AirlineName)} broj ${num} za ${localCityName(f.DestinationCityName)}. ` +
    `Ovaj let je premješten sa izlaza ${formatGateStringLocal(oldGate)} na izlaz ${formatGateStringLocal(newGate)}. ` +
    `Molimo sve putnike da odmah pristupe izlazu ${formatGateStringLocal(newGate)}. Izvinjavamo se na neugodnosti. Hvala.`;
}

// ── Periodične bezbjednosne najave (svakih 30 min, samo dok NIJE noć —
// vidi isNightHours() u lib/night-hours.ts, koristi se umjesto stare,
// manje precizne getSecurityHours() DST-aproksimacije). ────────────────
export const SECURITY_MESSAGES_EN = [
  "Security announcement. Please do not leave your baggage unattended at any time. Unattended baggage will be removed and may be destroyed. Thank you for your cooperation.",
  "Security announcement. For the safety of all passengers, please report any suspicious items or behaviour to airport security staff immediately. Thank you.",
  "Security announcement. Please keep your baggage with you at all times. Any unattended items will be removed by security personnel. Thank you.",
];
export const SECURITY_MESSAGES_LOCAL = [
  "Bezbjedonosno obavještenje. Molimo vas da nikada ne ostavljate svoj prtljag bez nadzora. Prtljag bez nadzora bit će uklonjen i može biti uništen. Hvala na saradnji.",
  "Bezbjedonosno obavještenje. Radi sigurnosti svih putnika, molimo prijavite sumnjive predmete ili ponašanje odmah osoblju aerodroma. Hvala.",
  "Bezbjedonosno obavještenje. Molimo čuvajte svoj prtljag uz sebe u svakom trenutku. Ostavljene predmete bez nadzora uklonit će zaštitarska služba. Hvala.",
];

export { checkFlightStatus };
