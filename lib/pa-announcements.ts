// lib/pa-announcements.ts
//
// Sva tekst/vremenska logika za automatski PA (razglas) sistem —
// namjerno odvojeno od app/pa/PaPageClient.tsx (koji samo orkestrira:
// čita letove, poziva ove funkcije, stavlja rezultat u red za govor).
//
// RADI KLIJENTSKI (u browseru na PC-u u operativnom centru, fizički
// povezanom na PA pojačalo) — isNightHours() iz lib/night-hours.ts
// koristi Intl.DateTimeFormat sa eksplicitnom "Europe/Podgorica" zonom,
// pa je ispravan bez obzira na to koju vremensku zonu misli da ima
// operativni računar. Vremenski prozori ispod (minutesUntil) namjerno
// NE koriste tu funkciju — rade čisto na STRING poređenju HH:MM iz
// leta naspram browser-ovog `new Date()`, što je tačno onoliko dobro
// koliko je tačan sistemski sat tog računara (razumna pretpostavka za
// fizički PC u avio-kompaniji, isti princip kao ostatak klijentskog
// koda u ovoj aplikaciji — npr. assign-checkin/page.tsx).
import type { Flight } from '@/types/flight';

// ════════════════════════════════════════════════════════════
// VREMENSKA LOGIKA
// ════════════════════════════════════════════════════════════

function timeStrToMinutes(t: string | undefined): number | null {
  if (!t || !t.includes(':')) return null;
  const [h, m] = t.split(':').map(Number);
  if (isNaN(h) || isNaN(m)) return null;
  return h * 60 + m;
}

function diffFromNow(targetMinutes: number): number {
  const now = new Date();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  let diff = targetMinutes - nowMinutes;
  const TWELVE_HOURS = 12 * 60;
  if (diff > TWELVE_HOURS) diff -= 24 * 60;
  else if (diff < -TWELVE_HOURS) diff += 24 * 60;
  return diff;
}

// Minuta do PROCIJENJENOG (ili, ako ga nema, planiranog) polaska —
// koristi se za boarding/final_call/last_call, gdje je bitno KAD će
// let STVARNO poletjeti (prati kašnjenje), ne kad je izvorno bio
// planiran.
function minutesUntilEstimated(f: Flight): number | null {
  const timeStr = f.EstimatedDepartureTime || f.ScheduledDepartureTime;
  const target = timeStrToMinutes(timeStr);
  if (target === null) return null;
  return diffFromNow(target);
}

// Minuta do PLANIRANOG (scheduled) polaska — NAMJERNO ignoriše
// EstimatedDepartureTime. Koristi se za registracijske podsjetnike
// (120/90/60 min), po eksplicitnom zahtjevu: šalter za registraciju
// se ne pomjera samo zato što je let naknadno prijavljen kao
// zakašnjeo — putnik i dalje treba da se registruje u odnosu na
// IZVORNO planirano vrijeme, ne na (možda tek kasnije saznato)
// kašnjenje.
function minutesUntilScheduled(f: Flight): number | null {
  const target = timeStrToMinutes(f.ScheduledDepartureTime);
  if (target === null) return null;
  return diffFromNow(target);
}

// ════════════════════════════════════════════════════════════
// PROZORI ZA ODLASKE (registracija / boarding / final call / last call)
// ════════════════════════════════════════════════════════════
//
// Namjerno GENERIČKI pragovi (ne po aviokompaniji) — standardna
// aerodromska praksa, isti za sve letove. Ako je nekoj aviokompaniji
// stvarno potreban drugačiji raspored najava, to je konfiguraciona
// izmjena OVDJE (jedno mjesto), ne u glavnoj PA komponenti.
export type DepartureWindowType =
  | 'checkin_120' | 'checkin_90' | 'checkin_60'
  | 'boarding' | 'final_call' | 'last_call';

export interface DepartureWindow {
  type: DepartureWindowType;
  minutesBefore: number;
  // 'scheduled' = računa se od ScheduledDepartureTime, ignoriše kašnjenje
  //   (registracijski podsjetnici — vidi minutesUntilScheduled iznad).
  // 'estimated' = računa se od EstimatedDepartureTime (ili Scheduled ako
  //   Estimated ne postoji) — prati stvarno očekivano vrijeme poletanja
  //   (boarding pozivi — putnike zoveš kad let STVARNO ide, ne po
  //   izvornom planu ako je poznato kašnjenje).
  timeBasis: 'scheduled' | 'estimated';
}

// VAŽNO: mora ostati sortirano OPADAJUĆE po minutesBefore — logika u
// shouldPlayDepartureWindow se oslanja na taj redoslijed da uvijek
// nađe NAJKASNIJI (najhitniji) prozor u koji let trenutno upada, umjesto
// da najavljuje sve odjednom (npr. ako se PA stranica upravo pokrenula,
// a let je već blizu polaska). Registracijski i boarding prozori se
// TRETIRAJU ODVOJENO (vidi shouldPlayDepartureWindow) jer imaju
// različitu vremensku osnovu (scheduled vs. estimated) — "najhitniji"
// se bira UNUTAR iste grupe, ne međusobno.
export const DEPARTURE_WINDOWS: DepartureWindow[] = [
  { type: 'checkin_120', minutesBefore: 120, timeBasis: 'scheduled' },
  { type: 'checkin_90',  minutesBefore: 90,  timeBasis: 'scheduled' },
  { type: 'checkin_60',  minutesBefore: 60,  timeBasis: 'scheduled' },
  { type: 'boarding',    minutesBefore: 35,  timeBasis: 'estimated' },
  { type: 'final_call',  minutesBefore: 20,  timeBasis: 'estimated' },
  { type: 'last_call',   minutesBefore: 10,  timeBasis: 'estimated' },
];

const CHECKIN_WINDOWS = DEPARTURE_WINDOWS.filter(w => w.timeBasis === 'scheduled');
const BOARDING_WINDOWS = DEPARTURE_WINDOWS.filter(w => w.timeBasis === 'estimated');

// Vraća NAJHITNIJI prozor (unutar SVOJE grupe — registracija ili
// boarding, vidi komentar uz DEPARTURE_WINDOWS) u koji let TRENUTNO
// upada, ili null ako nijedan. Funkcija sama bira najmanji minutesBefore
// koji i dalje zadovoljava uslov, pa uvijek vraća samo JEDAN (najhitniji)
// prozor iz te grupe, nikad više njih odjednom.
export function shouldPlayDepartureWindow(f: Flight, win: DepartureWindow): boolean {
  const group = win.timeBasis === 'scheduled' ? CHECKIN_WINDOWS : BOARDING_WINDOWS;
  const mins = win.timeBasis === 'scheduled' ? minutesUntilScheduled(f) : minutesUntilEstimated(f);
  if (mins === null || mins < 0) return false;

  let mostUrgent: DepartureWindow | null = null;
  for (const w of group) {
    if (mins <= w.minutesBefore) {
      if (!mostUrgent || w.minutesBefore < mostUrgent.minutesBefore) mostUrgent = w;
    }
  }
  return mostUrgent?.type === win.type;
}

// ════════════════════════════════════════════════════════════
// KAŠNJENJE
// ════════════════════════════════════════════════════════════
//
// Najavi kašnjenje SAMO ako je stvarno značajno (≥15 min) — sitne
// razlike u minutu-dvije su uobičajen šum u podacima, ne vrijede
// posebne najave putnicima. getAnnouncementKey (ispod) uključuje
// EstimatedDepartureTime u ključ za "delayed" tip, pa NOVO kašnjenje
// (izmijenjeno procijenjeno vrijeme) ispravno generiše NOVU najavu,
// dok isto kašnjenje prijavljeno na svakom sledećem pollu ne dupli.
export function shouldAnnounceDelay(f: Flight): boolean {
  const sched = timeStrToMinutes(f.ScheduledDepartureTime);
  const est = timeStrToMinutes(f.EstimatedDepartureTime);
  if (sched === null || est === null) return false;

  let diff = est - sched;
  const TWELVE_HOURS = 12 * 60;
  if (diff > TWELVE_HOURS) diff -= 24 * 60;
  else if (diff < -TWELVE_HOURS) diff += 24 * 60;

  return diff >= 15;
}

export function isArrivedStatus(status: string): boolean {
  const s = (status || '').toLowerCase();
  return s.includes('arrived') || s.includes('landed') || s.includes('sletio') || s.includes('sletjel');
}

// Zadržano kao poseban "hook" (a ne samo isArrivedStatus direktno) da
// bude lako kasnije dodati uslov (npr. ne najavljuj dolaske noću, iako
// to već pokriva isNightHours() gate u PaPageClient.tsx).
export function shouldAnnounceArrival(_f: Flight): boolean {
  return true;
}

// ════════════════════════════════════════════════════════════
// DEDUP KLJUČEVI
// ════════════════════════════════════════════════════════════
export function getAnnouncementKey(f: Flight, type: string): string {
  if (type === 'delayed') {
    // Vidi komentar uz shouldAnnounceDelay — namjerno uključuje
    // EstimatedDepartureTime da NOVO kašnjenje generiše NOVU najavu.
    return `${f.FlightNumber}_${f.ScheduledDepartureTime}_delayed_${f.EstimatedDepartureTime || ''}`;
  }
  return `${f.FlightNumber}_${f.ScheduledDepartureTime}_${type}`;
}

// ════════════════════════════════════════════════════════════
// TEKST NAJAVA — ENGLESKI
// ════════════════════════════════════════════════════════════
//
// Standardna, profesionalna aerodromska PA fraziranja. Namjerno
// kratke, jasne rečenice — TTS glas ih mora izgovoriti razumljivo, ne
// pisati "lijepo" kao članak.
function destOrFallback(f: Flight): string {
  return f.DestinationCityName || f.DestinationAirportName || f.DestinationAirportCode || 'destination';
}

// FIX (po zahtjevu — TTS je čitao "07"/"03" kao "zero seven"/"zero
// three" umjesto "seven"/"three"): brojevi gate-ova/šaltera često
// dolaze sa vodećom nulom (radi ujednačenog prikaza NA EKRANIMA), ali
// glas treba da ih izgovori kao obične brojeve. Uklanja vodeću nulu
// SAMO ako je ostatak i dalje čisto brojčan (npr. "07" → "7") — ne
// dira alfanumeričke oznake ako ih neki aerodrom koristi (npr. "A7"),
// niti sam string "0".
function stripLeadingZero(value: string): string {
  if (!value) return value;
  const trimmed = value.trim();
  return /^0\d+$/.test(trimmed) ? trimmed.replace(/^0+/, '') : trimmed;
}

// FIX (PRAVI uzrok "i dalje se čuje zero four/zero five" I "TTS čita
// comma" iako je prošli fix trebalo da riješi oboje): f.GateNumber i
// f.CheckInDesk NISU uvijek jedan broj — za letove sa dodijeljenih
// više gate-ova/šaltera odjednom, dolaze kao string odvojen zarezom,
// npr. "04,05" (isti obrazac koji app/combined/CombinedPageClient.tsx,
// app/departures/page.tsx i lib/flight-service.ts već hendluju preko
// `.split(',')[0]` — CheckInDesk ovo radi ČEŠĆE od GateNumber-a).
// stripLeadingZero() iznad je tražio da je CIJELI string čist broj
// ("^0\d+$") — za "04,05" taj test PADA (ima zarez), pa se string
// vraćao NETAKNUT: vodeća nula OSTAJE, I doslovni zarez ostaje u
// tekstu (TTS ga čita kao riječ "comma" — ISTI bug kao ranije, samo iz
// drugog izvora, ne iz hardkodiranih šablona koje sam prošli put
// popravio). Ova funkcija prvo uzima SAMO PRVI gate/šalter (dosljedno
// sa ostatkom aplikacije — u PA najavi nema smisla nabrajati sve
// dodijeljene gate-ove, dovoljan je jedan za usmjeravanje putnika), pa
// tek onda skida vodeću nulu. Naziv "Number" jer se koristi za OBA
// polja (gate i check-in desk), ne samo gate.
function firstNumberField(value: string): string {
  const first = value.split(',')[0]?.trim() || value.trim();
  return stripLeadingZero(first);
}

// FIX (po zahtjevu — TTS je čitao broj leta kao cio broj, npr. "683"
// kao "six hundred eighty-three"/"šesto osamdeset tri", umjesto
// cifra-po-cifra "six eight three"/"šest osam tri"): standardna
// aerodromska konvencija — brojevi leta se UVIJEK čitaju pojedinačno
// po cifri, na svakom jeziku. Razmak između svake cifre tjera TTS da
// ih tretira kao odvojene tokene umjesto kao jedan broj. Slovni
// prefiks (IATA kod avio kompanije, npr. "JU", "4O") se NAMJERNO
// ostavlja spojen — čita se prirodno kao kratka cjelina, nije
// prijavljeno kao problem. Radi ispravno bez obzira na dužinu
// slovnog prefiksa (uobičajeno 2 karaktera, rijetko 3) jer cilja SVAKI
// niz cifara u stringu, ne pretpostavlja fiksnu poziciju.
function spellFlightNumber(flightNumber: string): string {
  if (!flightNumber) return flightNumber;
  return flightNumber.replace(/\d+/g, (digits) => ' ' + digits.split('').join(' ')).trim();
}

function gateOrFallback(f: Flight): string {
  return f.GateNumber ? firstNumberField(f.GateNumber) : '—';
}
function airlineOrFallback(f: Flight): string {
  return f.AirlineName || 'the airline';
}
function checkInDeskPhraseEN(f: Flight): string {
  return f.CheckInDesk ? `check-in desk ${firstNumberField(f.CheckInDesk)}` : `the check-in area`;
}

export function buildDepartureEN(f: Flight, type: DepartureWindowType): string {
  const airline = airlineOrFallback(f), city = destOrFallback(f), gate = gateOrFallback(f), num = spellFlightNumber(f.FlightNumber);
  const desk = checkInDeskPhraseEN(f);

  if (type === 'checkin_120') {
    return `Attention please. Check-in for ${airline} flight ${num} to ${city} is now open at ${desk}. Passengers are kindly requested to proceed to check-in.`;
  }
  if (type === 'checkin_90') {
    return `This is a reminder. Check-in for ${airline} flight ${num} to ${city} is open at ${desk}. Passengers who have not yet checked in are kindly requested to do so.`;
  }
  if (type === 'checkin_60') {
    return `Attention please. Check-in for ${airline} flight ${num} to ${city} will close soon. Passengers who have not yet checked in should proceed to ${desk} immediately.`;
  }
  if (type === 'boarding') {
    return `Attention please. ${airline} flight ${num} to ${city} is now boarding at gate ${gate}. Passengers are kindly requested to proceed to the gate.`;
  }
  if (type === 'final_call') {
    // FIX (po zahtjevu — TTS je izgovarao "comma" negdje u engleskom
    // tekstu): rečenica je bila spojena zarezom
    // ("...to {city}, boarding now at gate {gate}.") — neki glasovi
    // (posebno Windows SAPI) znaju doslovno pročitati zarez kao riječ
    // "comma" umjesto da ga tretiraju kao prirodnu pauzu. Razdvojeno u
    // dvije kratke rečenice — čita se prirodnije i bez rizika.
    return `This is the final call for ${airline} flight ${num} to ${city}. Boarding now at gate ${gate}. Passengers are kindly requested to proceed to the gate immediately.`;
  }
  return `Last call for ${airline} flight ${num} to ${city}. This flight is now closing. Passengers should proceed to gate ${gate} immediately.`;
}

export function buildArrivalEN(f: Flight): string {
  return `${airlineOrFallback(f)} flight ${spellFlightNumber(f.FlightNumber)} from ${destOrFallback(f)} has landed.`;
}

export function buildDelayEN(f: Flight): string {
  return `We regret to inform you that ${airlineOrFallback(f)} flight ${spellFlightNumber(f.FlightNumber)} to ${destOrFallback(f)} is delayed. The new estimated departure time is ${f.EstimatedDepartureTime}.`;
}

// Za ručni "Kasni — sledeća informacija za pola sata/sat" dugme (vidi
// app/admin/pa/page.tsx) — namjerno NE tvrdi novo tačno vrijeme (osoblje
// koje kliče dugme obično to još ne zna), samo obavještava putnike da
// kašnjenje postoji i kad da očekuju sledeću informaciju.
//
// FIX (radi i za DOLASKE, ne samo odlaske): "to [grad]" je tačno za
// odlazak, ali za let koji DOLAZI, destOrFallback(f) vraća grad
// PORIJEKLA (isto polje — DestinationCityName — se generički koristi
// za "drugi grad" bez obzira na FlightType, vidi buildArrivalEN niže),
// pa bi "to [grad porijekla]" bilo pogrešno/zbunjujuće. Predlog
// ("from"/"iz") se sad bira prema f.FlightType.
export function buildDelayNoticeEN(f: Flight, minutesUntilUpdate: 30 | 60): string {
  const prep = f.FlightType === 'arrival' ? 'from' : 'to';
  return `We regret to inform you that ${airlineOrFallback(f)} flight ${spellFlightNumber(f.FlightNumber)} ${prep} ${destOrFallback(f)} is delayed. Further information will be provided in approximately ${minutesUntilUpdate} minutes. We apologise for the inconvenience.`;
}

export function buildCancelledEN(f: Flight): string {
  const desk = f.CheckInDesk ? ` at check-in desk ${firstNumberField(f.CheckInDesk)}` : '';
  return `We regret to inform you that ${airlineOrFallback(f)} flight ${spellFlightNumber(f.FlightNumber)} to ${destOrFallback(f)} has been cancelled. Please contact the ${airlineOrFallback(f)} check-in staff${desk} for further information.`;
}

export function buildDivertedEN(f: Flight): string {
  return `${airlineOrFallback(f)} flight ${spellFlightNumber(f.FlightNumber)} has been diverted. Please contact the ${airlineOrFallback(f)} check-in staff for further information.`;
}

// Za ručno "Preusmjeren u [XXXX]" dugme, gdje osoblje otkuca stvarnu
// lokaciju preusmjerenja (vidi app/admin/pa/page.tsx) — namjerno bez
// destOrFallback/FlightType razlike, jer se ovdje uvijek govori o TOME
// GDJE JE LET STVARNO OTIŠAO, ne o njegovoj izvornoj destinaciji/
// porijeklu, pa fraziranje ne zavisi od toga da li je odlazak ili
// dolazak.
export function buildDivertedToEN(f: Flight, divertedTo: string): string {
  return `${airlineOrFallback(f)} flight ${spellFlightNumber(f.FlightNumber)} has been diverted to ${divertedTo}. Please contact the ${airlineOrFallback(f)} check-in staff for further information.`;
}

export function buildGateChangeEN(f: Flight, oldGate: string, newGate: string): string {
  return `Attention please. The departure gate for ${airlineOrFallback(f)} flight ${spellFlightNumber(f.FlightNumber)} to ${destOrFallback(f)} has been changed from gate ${firstNumberField(oldGate)} to gate ${firstNumberField(newGate)}.`;
}

// ════════════════════════════════════════════════════════════
// POZIV PUTNIKA (ime + let + gdje da se javi) — vidi app/admin/pa/page.tsx
// ════════════════════════════════════════════════════════════
export type PageLocationType = 'gate' | 'info' | 'checkin';

function pageLocationPhraseEN(locationType: PageLocationType, locationNumber: string): string {
  const num = locationNumber ? stripLeadingZero(locationNumber) : '—';
  if (locationType === 'gate')    return `gate ${num}`;
  if (locationType === 'checkin') return `check-in desk ${num}`;
  return 'the information desk';
}

// FIX (po zahtjevu — TTS je izgovarao "comma" u ovom tekstu): bilo je
// "Passenger {name}, travelling on flight {num} to {city}, please
// proceed..." — DVA zareza u istoj rečenici. Razdvojeno u kratke,
// jasne rečenice bez ijednog zareza — ista informacija, čita se čisto.
export function buildPassengerPageEN(
  passengerName: string, flightNumber: string, destination: string,
  locationType: PageLocationType, locationNumber: string
): string {
  const loc = pageLocationPhraseEN(locationType, locationNumber);
  return `Paging passenger ${passengerName}. Please proceed to ${loc} immediately. Passenger ${passengerName} is travelling on flight ${spellFlightNumber(flightNumber)} to ${destination}.`;
}

export const SECURITY_MESSAGES_EN: string[] = [
  // FIX (po zahtjevu — TTS je izgovarao "comma"): uklonjen zarez na
  // početku ove dvije poruke ("For security reasons, please..." →
  // "For security reasons please..."). Blago labavije gramatički, ali
  // se čita čisto na svakom glasu — namjerno prioritet nad
  // "savršenom" interpunkcijom teksta koji se NIKAD ne čita, samo
  // izgovara.
  'For security reasons please do not leave your baggage unattended at any time. Unattended baggage will be removed and may be subject to security procedures.',
  'Please note that smoking is not permitted anywhere within the terminal building.',
  'Passengers are kindly reminded to keep their boarding pass and identification document available at all times.',
  'For your safety please keep a close watch on your personal belongings throughout the terminal.',
];

// ════════════════════════════════════════════════════════════
// TEKST NAJAVA — LOKALNI JEZIK (crnogorski/srpski, ijekavica)
// ════════════════════════════════════════════════════════════
function destOrFallbackLocal(f: Flight): string {
  return f.DestinationCityName || f.DestinationAirportName || f.DestinationAirportCode || 'destinaciju';
}
function checkInDeskPhraseLocal(f: Flight): string {
  return f.CheckInDesk ? `šalteru ${firstNumberField(f.CheckInDesk)}` : `šalterima za registraciju`;
}

export function buildDepartureLocal(f: Flight, type: DepartureWindowType): string {
  const airline = airlineOrFallback(f), city = destOrFallbackLocal(f), gate = gateOrFallback(f), num = spellFlightNumber(f.FlightNumber);
  const desk = checkInDeskPhraseLocal(f);

  if (type === 'checkin_120') {
    return `Poštovani putnici, obavještavamo vas da je počela registracija za let ${airline}, broj ${num}, za ${city}, na ${desk}. Molimo putnike da se upute ka registraciji.`;
  }
  if (type === 'checkin_90') {
    return `Podsjećamo putnike da je u toku registracija za let ${airline}, broj ${num}, za ${city}, na ${desk}. Putnici koji se još nisu registrovali mole se da to učine.`;
  }
  if (type === 'checkin_60') {
    return `Poštovani putnici, obavještavamo vas da se registracija za let ${airline}, broj ${num}, za ${city} uskoro zatvara. Putnici koji se još nisu registrovali mole se da se odmah upute ka ${desk}.`;
  }
  // FIX (po zahtjevu — na crnogorskom se izgovaralo englesko "gate"
  // umjesto "izlaz"): "gate-u"/"gate" zamijenjeno sa "izlazu"/"izlaz"
  // (odgovarajući padež) na sva tri mjesta ispod.
  if (type === 'boarding') {
    return `Poštovani putnici, obavještavamo vas da je počelo ukrcavanje za let ${airline}, broj ${num}, za ${city}, na izlazu ${gate}. Molimo putnike da se upute ka izlazu.`;
  }
  if (type === 'final_call') {
    return `Ovo je posljednji poziv za ukrcavanje na let ${airline}, broj ${num}, za ${city}, izlaz ${gate}. Molimo putnike da se odmah upute ka izlazu.`;
  }
  return `Posljednji poziv za let ${airline}, broj ${num}. Ukrcavanje se zatvara. Putnici se hitno mole da se upute ka izlazu ${gate}.`;
}

export function buildArrivalLocal(f: Flight): string {
  return `Let ${airlineOrFallback(f)}, broj ${spellFlightNumber(f.FlightNumber)}, iz ${destOrFallbackLocal(f)} je sletio.`;
}

export function buildDelayLocal(f: Flight): string {
  return `Obavještavamo vas da je let ${airlineOrFallback(f)}, broj ${spellFlightNumber(f.FlightNumber)}, za ${destOrFallbackLocal(f)} u kašnjenju. Novo predviđeno vrijeme polaska je ${f.EstimatedDepartureTime}.`;
}

export function buildDelayNoticeLocal(f: Flight, minutesUntilUpdate: 30 | 60): string {
  const prep = f.FlightType === 'arrival' ? 'iz' : 'za';
  return `Obavještavamo vas da je let ${airlineOrFallback(f)}, broj ${spellFlightNumber(f.FlightNumber)}, ${prep} ${destOrFallbackLocal(f)} u kašnjenju. Dodatne informacije biće dostupne za približno ${minutesUntilUpdate} minuta. Izvinjavamo se na neprijatnosti.`;
}

export function buildCancelledLocal(f: Flight): string {
  const desk = f.CheckInDesk ? `, šalter ${firstNumberField(f.CheckInDesk)}` : '';
  return `Obavještavamo vas da je let ${airlineOrFallback(f)}, broj ${spellFlightNumber(f.FlightNumber)}, za ${destOrFallbackLocal(f)} otkazan. Za dodatne informacije obratite se osoblju na šalteru ${airlineOrFallback(f)}${desk}.`;
}

export function buildDivertedLocal(f: Flight): string {
  return `Let ${airlineOrFallback(f)}, broj ${spellFlightNumber(f.FlightNumber)}, je preusmjeren. Za dodatne informacije obratite se osoblju na šalteru ${airlineOrFallback(f)}.`;
}

export function buildDivertedToLocal(f: Flight, divertedTo: string): string {
  return `Let ${airlineOrFallback(f)}, broj ${spellFlightNumber(f.FlightNumber)}, je preusmjeren u ${divertedTo}. Za dodatne informacije obratite se osoblju na šalteru ${airlineOrFallback(f)}.`;
}

export function buildGateChangeLocal(f: Flight, oldGate: string, newGate: string): string {
  // FIX (po zahtjevu — "gate" → "izlaz" na crnogorskom): "promijenjen
  // gate" → "promijenjen izlaz", "sa gate-a" → "sa izlaza" (genitiv),
  // "na gate" → "na izlaz".
  return `Poštovani putnici, obavještavamo vas da je promijenjen izlaz za let ${airlineOrFallback(f)}, broj ${spellFlightNumber(f.FlightNumber)}, za ${destOrFallbackLocal(f)}, sa izlaza ${firstNumberField(oldGate)} na izlaz ${firstNumberField(newGate)}.`;
}

function pageLocationPhraseLocal(locationType: PageLocationType, locationNumber: string): string {
  const num = locationNumber ? stripLeadingZero(locationNumber) : '—';
  // FIX (po zahtjevu — "gate" → "izlaz" na crnogorskom).
  if (locationType === 'gate')    return `izlazu ${num}`;
  if (locationType === 'checkin') return `šalteru ${num}`;
  return 'info pultu';
}

export function buildPassengerPageLocal(
  passengerName: string, flightNumber: string, destination: string,
  locationType: PageLocationType, locationNumber: string
): string {
  const loc = pageLocationPhraseLocal(locationType, locationNumber);
  return `Poziv putniku ${passengerName}. Putnik ${passengerName}, koji putuje letom ${spellFlightNumber(flightNumber)} za ${destination}, molimo da se odmah javi na ${loc}.`;
}

export const SECURITY_MESSAGES_LOCAL: string[] = [
  'Iz bezbjednosnih razloga, molimo vas da ne ostavljate prtljag bez nadzora. Prtljag bez nadzora biće uklonjen i može biti predmet bezbjednosne provjere.',
  'Obavještavamo vas da je pušenje zabranjeno u svim prostorijama terminala.',
  'Molimo putnike da kartu za ukrcavanje i lični dokument drže dostupnim tokom cijelog boravka u terminalu.',
  'Radi vaše bezbjednosti, molimo vas da pazite na svoje lične stvari tokom boravka u terminalu.',
];