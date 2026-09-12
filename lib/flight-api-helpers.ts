// lib/flight-api-helpers.ts
import type { Flight, RawFlightData } from '@/types/flight';
import { getPodgoricaDateString } from '@/lib/night-hours';

// ── Debug logger — aktivan samo u development modu ──────────
// Smanjuje log šum u produkciji (Vercel logovi imaju kvote/retenciju),
// bez gubitka mogućnosti debagovanja lokalno.
const isDev = process.env.NODE_ENV !== 'production';
const dlog = (...args: unknown[]) => { if (isDev) console.log(...args); };

function cleanFlightNumber(flightNumber: string, airlineCode: string): string {
  if (!flightNumber) return flightNumber;
  
  let cleaned = flightNumber.trim();
  
  // Ukloni ICAO kod (3 slova) ako postoji na početku ili iza IATA koda
  // Primeri:
  // - U2EZY2271 → ukloni EZY → U22271
  // - JUASL680 → ukloni ASL → JU680
  // - 4OMNE150 → ukloni MNE → 4O150
  
  // Ako ima IATA kod (2 slova) + ICAO kod (3 slova) + brojevi
  const iataIcaoPattern = /^([A-Z]{2})([A-Z]{3})(\d+)/;
  const match = cleaned.match(iataIcaoPattern);
  
  if (match) {
    const [, iataCode, icaoCode, numbers] = match;
    // Zadrži samo IATA kod i brojeve, ukloni ICAO kod
    cleaned = `${iataCode}${numbers}`;
    dlog(`✈️ Cleaned flight (removed ICAO ${icaoCode}): ${flightNumber} → ${cleaned}`);
    return cleaned;
  }
  
  // Ako ima samo ICAO kod (3 slova) + brojevi (nema IATA kod)
  const icaoOnlyPattern = /^([A-Z]{3})(\d+)/;
  const icaoMatch = cleaned.match(icaoOnlyPattern);
  
  if (icaoMatch) {
    const [, icaoCode, numbers] = icaoMatch;
    // Ako je ICAO kod različit od airlineCode, ukloni ga i dodaj airlineCode
    if (icaoCode !== airlineCode) {
      cleaned = `${airlineCode}${numbers}`;
      dlog(`✈️ Cleaned flight (ICAO only): ${flightNumber} → ${cleaned}`);
    } else {
      cleaned = numbers;
    }
    return cleaned;
  }
  
  // Standardna logika za duplikate
  if (airlineCode && cleaned.startsWith(airlineCode)) {
    // Provjeri da li je dupliran (npr. "JUJU680")
    if (cleaned.length > airlineCode.length && cleaned.substring(airlineCode.length).startsWith(airlineCode)) {
      cleaned = cleaned.substring(airlineCode.length);
    }
  } else if (airlineCode && !cleaned.startsWith(airlineCode) && !/^\d+$/.test(cleaned)) {
    // Ako nema kod kompanije, dodaj ga
    cleaned = airlineCode + cleaned;
  }
  
  // Ako je samo broj, dodaj airlineCode
  if (/^\d+$/.test(cleaned) && airlineCode) {
    cleaned = airlineCode + cleaned;
  }
  
  return cleaned;
}

export function parseGateNumbers(gateString: string): string[] {
  if (!gateString || gateString.trim() === '') return [];
  
  return gateString
    .split(',')
    .map(gate => gate.trim())
    .filter(gate => gate !== '');
}

export function parseCheckInDesks(checkInString: string): string[] {
  if (!checkInString || checkInString.trim() === '') return [];
  
  return checkInString
    .split(',')
    .map(desk => desk.trim())
    .filter(desk => desk !== '');
}

// FIX (mrtav kod uklonjen — CPU/bundle trošak): ovdje je ranije
// postojao cio "logo URL" podsistem (logoCache Map, findExistingLogo,
// getLogoURL, getSimpleLogoURL, getLogoURLWithFallback) — provjereno
// kroz cio projekat da NIŠTA više ne poziva nijednu od ovih funkcija
// (poslednja tri poziva, u sva tri flight-mapera ispod, upravo su
// uklonjena jer se izračunata vrijednost Flight.AirlineLogoURL nigdje
// ne čita/renderuje — svih 8 kiosk tipova nezavisno računa sopstveni
// logo preko lib/airline-logo.ts). findExistingLogo je i onako radio
// SAMO u browseru (eksplicitna `typeof window === 'undefined'`
// provjera), pa server-side pozivi (jedini stvarni pozivaoci, iz
// lib/flight-data-service.ts) nikad nisu ni mogli pronaći stvaran
// logo — uvijek su tiho padali na placeholder, uz nepotreban
// async/Promise/try-catch trošak po letu na najprometnijoj ruti u
// aplikaciji (/api/flights).

export function formatTime(time: string): string {
  if (!time || time.trim() === '') return '--:--';
  
  if (time.includes('T')) {
    return formatIsoTime(time);
  }
  
  if (time.length === 4 && /^\d+$/.test(time)) {
    return `${time.substring(0, 2)}:${time.substring(2, 4)}`;
  }
  
  if (time.includes(':') && time.length === 5) {
    return time;
  }
  
  return time;
}

export function formatIsoTime(isoString: string): string {
  if (!isoString) return '--:--';
  
  try {
    const date = new Date(isoString);
    if (isNaN(date.getTime())) {
      return '--:--';
    }
    
    return date.toLocaleTimeString('en-GB', { 
      hour: '2-digit', 
      minute: '2-digit',
      hour12: false 
    });
  } catch (error) {
    console.error('Error formatting ISO time:', error);
    return '--:--';
  }
}

/**
 * Map raw flight data from API to application format
 * VAŽNO: TipLeta: 'O' = departure, 'I' = arrival
 */
export async function mapRawFlight(raw: RawFlightData): Promise<Flight> {
  // ISPRAVKA: Direktno mapiranje TipLeta na FlightType
  // TipLeta: 'O' (Odlasci) -> 'departure'
  // TipLeta: 'I' (Dolasci) -> 'arrival'
  let flightType: 'departure' | 'arrival';
  
  if (raw.TipLeta === 'O') {
    flightType = 'departure';
  } else if (raw.TipLeta === 'I') {
    flightType = 'arrival';
  } else {
    // Fallback za svaki slučaj
    console.warn(`⚠️ Unknown TipLeta value: ${raw.TipLeta}, defaulting to arrival`);
    flightType = 'arrival';
  }
  
  // Očisti broj leta
  const cleanNumber = cleanFlightNumber(raw.BrojLeta || '', raw.Kompanija || '');
  
  // Parsiraj code-share letove
  const codeShareFlights = raw.CodeShare 
    ? raw.CodeShare.split(',').map(f => f.trim()).filter(Boolean)
    : [];

  // FIX (CPU trošak na najprometnijoj ruti — /api/flights): ranije se
  // ovdje pozivalo `await getLogoURLWithFallback(...)` za SVAKI let u
  // SVAKOM mapiranju — provjereno kroz cio projekat: `Flight.AirlineLogoURL`
  // se NIGDJE ne čita/renderuje (svih 8 kiosk tipova nezavisno računaju
  // sopstveni logo URL preko lib/airline-logo.ts). Sam poziv je i onako
  // gotovo uvijek odmah vraćao placeholder — findExistingLogo() (unutar
  // getLogoURLWithFallback) eksplicitno provjerava `typeof window ===
  // 'undefined'` i vraća null kad se izvršava na serveru (a mapiranje
  // se UVIJEK dešava server-side, u lib/flight-data-service.ts) — ali i
  // dalje je to bio async poziv + Promise + try/catch PO LETU, na ruti
  // koju poll-uje 40+ kiosk ekrana. Prazan string je funkcionalno
  // identičan ishod (vrijednost se svejedno nigdje ne koristi), samo
  // bez ikakvog rada da se do njega dođe.
  const airlineLogoURL = '';

  // Kreiraj deterministički ID
  const flightId = `${raw.Kompanija}${raw.BrojLeta}_${raw.Planirano}_${raw.IATA}`;

  // ── NOVO: Parsiraj datum za sortiranje ──────────────────────────
  // API vraća Datum u formatu "22-05-2026" (dan-mjesec-godina)
  let sortTime: number | undefined = undefined;
  
  if (raw.Datum && raw.Planirano) {
    try {
      const [day, month, year] = raw.Datum.split('-').map(Number);
      // Parsiraj vrijeme (može biti "1115" ili "11:15")
      let hours: number, minutes: number;
      if (raw.Planirano.includes(':')) {
        [hours, minutes] = raw.Planirano.split(':').map(Number);
      } else if (raw.Planirano.length === 4) {
        hours = parseInt(raw.Planirano.substring(0, 2));
        minutes = parseInt(raw.Planirano.substring(2, 4));
      } else {
        hours = 0;
        minutes = 0;
      }
      dlog(`RAW Planirano za HN2392: "${raw.Planirano}", BrojLeta: "${raw.BrojLeta}"`);

      
      if (!isNaN(day) && !isNaN(month) && !isNaN(year) && !isNaN(hours) && !isNaN(minutes)) {
        // FIX (čišćenje mrtvog koda): ranije je ovdje postojao izračun
        // "tzOffset" koji se DODAVAO na sortTime, ali ga je SLEDEĆA
        // linija odmah prepisivala bez njega — tzOffset izračun nije
        // imao NIKAKAV stvaran efekat, samo je zbunjivao čitaoca (i
        // rizikovao da neko slučajno "popravi" kod tako da ga ponovo
        // aktivira, uvodeći zavisnost od sistemske vremenske zone).
        // Date.UTC(...) je već ispravno, namjerno i NEZAVISNO od
        // sistemske zone — isti wall-clock string uvijek daje isti
        // broj, na Vercel-u i na localhost-u podjednako.
        const scheduledDate = new Date(Date.UTC(year, month - 1, day, hours, minutes, 0, 0));
        sortTime = scheduledDate.getTime();
        dlog(`🕐 ${raw.BrojLeta}: input=${hours}:${minutes} | timestamp=${sortTime}`);
      }
    } catch (err) {
      console.warn(`⚠️ Failed to parse date for ${raw.Kompanija}${raw.BrojLeta}:`, err);
    }
  }

  dlog(`📝 Mapping flight: ${raw.Kompanija}${raw.BrojLeta} | TipLeta: ${raw.TipLeta} → FlightType: ${flightType} | SortTime: ${sortTime ? new Date(sortTime).toLocaleString() : 'N/A'}`);

  return {
    id: flightId,
    FlightNumber: cleanNumber,
    AirlineCode: raw.Kompanija || '',
    AirlineICAO: raw.KompanijaICAO || '',
    AirlineName: raw.KompanijaNaziv || '',
    DestinationAirportName: raw.Aerodrom || '',
    DestinationAirportCode: raw.IATA || '',
    ScheduledDepartureTime: formatTime(raw.Planirano || ''),
    EstimatedDepartureTime: formatTime(raw.Predvidjeno || ''),
    ActualDepartureTime: formatTime(raw.Aktuelno || ''),
    StatusEN: raw.StatusEN || raw.Status || 'On Time',
    StatusMN: raw.StatusMN || '',
    Terminal: raw.Terminal || '',
    GateNumber: raw.Gate || '',
    GateNumbers: parseGateNumbers(raw.Gate),
    CheckInDesk: raw.CheckIn || '',
    CheckInDesks: parseCheckInDesks(raw.CheckIn),
    BaggageReclaim: raw.Karusel || '',
    CodeShareFlights: codeShareFlights,
    AirlineLogoURL: airlineLogoURL,
    FlightType: flightType,
    DestinationCityName: raw.Grad || raw.Aerodrom?.split(' ')[0] || '',
    
    // ── NOVO POLJE ZA SORTIRANJE ──────────────────────────────
    _sortTime: sortTime,
    
    // MongoDB polja
    _id: undefined,
    manualOverride: undefined,
    checkInDesks: undefined,
    adminNotes: undefined,
    lastModifiedBy: undefined,
    lastModifiedAt: undefined,
    modificationCount: 0
  };
}

// ── Tip sirovih podataka sa ngrok proxy-ja (/schedule endpoint) ──
export interface NgrokFlightRaw {
  AD: 'DEPARTURE' | 'ARRIVAL';
  acttime: string;
  airlineCode: string;
  airlineICAO: string;
  brlet: string;
  checkinDesk: string;
  codeShareFlights: string;
  comment: string;
  esttime: string;
  fromto: string;
  gate: string;
  operlong: string;
  parkingPosition: string;
  schdate: string;
  schtime: string;
  sifFromto: string;
  sifVia: string;
  via: string;
  baggageReclaim?: string;
}

/**
 * Mapira sirovi zapis sa ngrok proxy-ja u POSTOJEĆI Flight oblik.
 * Ponovo koristi iste helpere kao mapRawFlight (cleanFlightNumber,
 * parseGateNumbers, parseCheckInDesks, getLogoURLWithFallback, formatTime)
 * da izlazni Flight objekat bude potpuno identičnog oblika, bez obzira
 * na to koji je izvor podataka.
 */
export async function mapNgrokFlightToFlight(raw: NgrokFlightRaw): Promise<Flight> {
  const flightType: 'departure' | 'arrival' = raw.AD === 'DEPARTURE' ? 'departure' : 'arrival';

  const cleanNumber = cleanFlightNumber(raw.brlet || '', raw.airlineCode || '');

  const codeShareFlights = raw.codeShareFlights
    ? raw.codeShareFlights.split(',').map(f => f.trim()).filter(Boolean)
    : [];

  // FIX (CPU trošak — isti razlog kao mapRawFlight iznad, vidi opširan
  // komentar tamo): AirlineLogoURL se nigdje ne čita, poziv je bio
  // čist otpad na najprometnijoj ruti u aplikaciji.
  const airlineLogoURL = '';

  const flightId = `${raw.brlet}_${raw.schtime}_${raw.sifFromto}`;

  // ── _sortTime: schtime je wall-clock string u lokalnom (Podgorica)
  // vremenu, npr. "2026-07-31T06:40:00" — BEZ oznake vremenske zone.
  //
  // FIX (border stranica prikazivala jučerašnje letove / ne učitava
  // današnje): raniji kod je radio `new Date(raw.schtime).getTime()`
  // — pošto string NEMA 'Z'/offset oznaku, JavaScript ga parsira kao
  // LOKALNO vrijeme SISTEMA NA KOM KOD RADI. Na Vercel-u je to UTC (pa
  // je "slučajno" ispravno), ali na lokalnoj mašini za testiranje
  // (drugačija sistemska zona) bi isti string dao DRUGAČIJI apsolutni
  // trenutak — kvareći i sortiranje i (nizvodno, u filterTodayFlights)
  // određivanje da li je let "danas". Sad eksplicitno parsiramo
  // komponente i gradimo timestamp preko Date.UTC(...), što je
  // GARANTOVANO nezavisno od sistemske vremenske zone — isti string
  // uvijek daje isti broj, svuda (Vercel produkcija, Vercel preview,
  // localhost, bilo koji OS).
  let sortTime: number | undefined = undefined;
  if (raw.schtime) {
    try {
      const m = raw.schtime.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
      if (m) {
        const [, y, mo, d, h, mi] = m.map(Number) as unknown as number[];
        sortTime = Date.UTC(y, mo - 1, d, h, mi, 0, 0);
      } else {
        // Neočekivan format — pokušaj generičko parsiranje kao fallback,
        // radije nego da let potpuno nestane iz prikaza.
        const parsed = new Date(raw.schtime).getTime();
        if (!isNaN(parsed)) sortTime = parsed;
      }
    } catch (err) {
      console.warn(`⚠️ Failed to parse schtime for ${raw.brlet}:`, err);
    }
  }

  dlog(`📝 Mapping ngrok flight: ${raw.brlet} | AD: ${raw.AD} → FlightType: ${flightType} | SortTime: ${sortTime ? new Date(sortTime).toLocaleString() : 'N/A'}`);

  return {
    id: flightId,
    FlightNumber: cleanNumber,
    AirlineCode: raw.airlineCode || '',
    AirlineICAO: raw.airlineICAO || '',
    AirlineName: raw.operlong || '',
    DestinationAirportName: raw.fromto || '',
    DestinationAirportCode: raw.sifFromto || '',
    ScheduledDepartureTime: formatTime(raw.schtime || ''),
    // esttime je ponekad prazan string prije nego let postane "aktivan" —
    // pada nazad na schtime da EstimatedDepartureTime nikad ne bude '--:--'
    // dok god postoji planirano vrijeme.
    EstimatedDepartureTime: formatTime(raw.esttime || raw.schtime || ''),
    ActualDepartureTime: formatTime(raw.acttime || ''),
    StatusEN: raw.comment || 'On Time',
    StatusMN: '',
    Terminal: '',
    GateNumber: raw.gate || '',
    GateNumbers: parseGateNumbers(raw.gate || ''),
    CheckInDesk: raw.checkinDesk || '',
    CheckInDesks: parseCheckInDesks(raw.checkinDesk || ''),
    BaggageReclaim: raw.baggageReclaim || '',
    CodeShareFlights: codeShareFlights,
    AirlineLogoURL: airlineLogoURL,
    FlightType: flightType,
    DestinationCityName: raw.fromto || '',

    _sortTime: sortTime,

    // MongoDB polja — isto kao u mapRawFlight
    _id: undefined,
    manualOverride: undefined,
    checkInDesks: undefined,
    adminNotes: undefined,
    lastModifiedBy: undefined,
    lastModifiedAt: undefined,
    modificationCount: 0,
  };
}

// ── FIX (KRITIČNO — otkriveno direktnim uživo testom, ne pretpostavkom):
// montenegroairports.com/aerodromixs/cache-flights.php TRENUTNO vraća
// OData format ({"@odata.context":..., "value":[...]})  sa POTPUNO
// drugačijim imenima polja (FlightType, ScheduledDateTime,
// FlightNumberIATA, Gates kao NIZ, itd.) — NE format koji odgovara
// RawFlightData/mapRawFlight (TipLeta/BrojLeta/Planirano) iznad. Taj
// stariji format se možda koristio ranije, ili se koristi na nekom
// DRUGOM endpoint-u — ali OVAJ, tačan URL, SAD vraća ovo. Ako se format
// ikad ponovo promijeni, ovaj mapper će trebati odgovarajuće ažuriranje
// — nema garancije da eksterni API zadrži oblik odgovora zauvijek
// nepromijenjen.
export interface AlternateApiFlight {
  ID: string;
  FlightType: string; // 'Departure' | 'Arrival'
  ScheduledDateTime: string | null; // ISO SA eksplicitnim offset-om, npr. "2026-09-10T07:00:00+02:00"
  EstimatedDateTime: string | null;
  ActualDateTime: string | null;
  FlightNumberIATA: string;
  FlightNumberICAO: string | null;
  StatusID: string | null;
  PublicRemarkAdhoc: string | null;
  Airline: string;
  Airport: string;
  Checkins: string[];
  Gates: string[];
  BaggageBelts: string[];
  Codeshares: string[];
}

export interface AlternateApiResponse {
  value: AlternateApiFlight[];
}

// Izvlači "HH:MM" DIREKTNO iz ISO stringa regex-om, BEZ prolaska kroz
// Date objekat/toLocaleTimeString — ovo drugo bi reinterpretiralo
// vrijeme u SISTEMSKOJ vremenskoj zoni servera (Vercel = UTC),
// pomjerajući npr. "22:50+02:00" (Podgorica) na "20:50" (UTC) — ista
// klasa greške koja je već popravljena na više mjesta u ovom projektu
// za wall-clock vremena BEZ offseta. Ovdje string VEĆ sadrži tačno
// aerodromsko-lokalno vrijeme (offset je samo prateća informacija o
// zoni, ne nešto što treba primijeniti/konvertovati), pa se čita
// direktno.
function extractHHMM(isoWithOffset: string | null): string {
  if (!isoWithOffset) return '';
  const m = isoWithOffset.match(/T(\d{2}):(\d{2})/);
  return m ? `${m[1]}:${m[2]}` : '';
}

export async function mapAlternateApiFlight(raw: AlternateApiFlight): Promise<Flight> {
  const flightType: 'departure' | 'arrival' = raw.FlightType === 'Departure' ? 'departure' : 'arrival';

  const rawNumber = (raw.FlightNumberIATA || '').trim();
  // IATA kod avio kompanije je UVIJEK tačno 2 karaktera (slovo i/ili
  // broj, po IATA standardu) — npr. "W4"+"6450", "JU"+"660", "4O"+"100",
  // "TK"+"1085". Ovaj izvor ne daje odvojeno polje za kod, pa se
  // izvlači iz prva 2 karaktera broja leta.
  const airlineCode = rawNumber.slice(0, 2);
  const cleanNumber = cleanFlightNumber(rawNumber, airlineCode) || rawNumber;

  const gate = (raw.Gates || []).filter(Boolean).join(',');
  const checkIn = (raw.Checkins || []).filter(Boolean).join(',');
  const baggage = (raw.BaggageBelts || []).filter(Boolean).join(',');
  const codeShareFlights = (raw.Codeshares || []).filter(Boolean);

  const schHHMM = extractHHMM(raw.ScheduledDateTime);
  const estHHMM = extractHHMM(raw.EstimatedDateTime) || schHHMM;
  const actHHMM = extractHHMM(raw.ActualDateTime);

  // Za razliku od wall-clock stringova BEZ offseta koje ostatak
  // projekta mora ručno parsirati preko Date.UTC() (vidi komentare u
  // lib/flight-data-service.ts), OVDJE je string već EKSPLICITNO
  // vremenski-zonski nedvosmislen (+02:00/+01:00) — new Date(...) ga
  // ispravno tumači NEZAVISNO od sistemske zone servera, pa je
  // bezbjedno koristiti direktno za sortiranje.
  let sortTime: number | undefined = undefined;
  if (raw.ScheduledDateTime) {
    const parsed = new Date(raw.ScheduledDateTime).getTime();
    if (!isNaN(parsed)) sortTime = parsed;
  }

  // StatusID dolazi kao "Departed 00:15"/"Arrived 23:27" (riječ +
  // ugrađeno vrijeme) ili null za letove koji još nemaju status —
  // izvlači se samo prva riječ radi dosljednosti sa StatusEN oblikom
  // koji ostatak sistema očekuje (i dalje sadrži "departed"/"arrived"
  // kao podstring, pa .includes() provjere elsewhere rade ispravno i
  // bez ove izmjene — ali čist prikaz na ekranu je bolji ovako).
  const statusWord = (raw.StatusID || 'Scheduled').trim().split(/\s+/)[0];

  const flightId = `${cleanNumber}_${schHHMM}_${raw.Airport}`;

  return {
    id: flightId,
    FlightNumber: cleanNumber,
    AirlineCode: airlineCode,
    AirlineICAO: raw.FlightNumberICAO || '',
    AirlineName: raw.Airline || '',
    DestinationAirportName: raw.Airport || '',
    DestinationAirportCode: '',
    ScheduledDepartureTime: schHHMM || '--:--',
    EstimatedDepartureTime: estHHMM || '--:--',
    ActualDepartureTime: actHHMM || '--:--',
    StatusEN: statusWord,
    StatusMN: '',
    Terminal: '',
    GateNumber: gate,
    GateNumbers: parseGateNumbers(gate),
    CheckInDesk: checkIn,
    CheckInDesks: parseCheckInDesks(checkIn),
    BaggageReclaim: baggage,
    CodeShareFlights: codeShareFlights,
    // FIX (CPU trošak — isti razlog kao ostala dva mapera): provjereno
    // kroz cio projekat, AirlineLogoURL se nigdje ne čita/renderuje —
    // svih 8 kiosk tipova nezavisno računa sopstveni logo preko
    // lib/airline-logo.ts. Prazan string umjesto await poziva.
    AirlineLogoURL: '',
    FlightType: flightType,
    DestinationCityName: raw.Airport || '',

    _sortTime: sortTime,

    _id: undefined,
    manualOverride: undefined,
    checkInDesks: undefined,
    adminNotes: undefined,
    lastModifiedBy: undefined,
    lastModifiedAt: undefined,
    modificationCount: 0,
  };
}

export function expandFlightForMultipleGates(flight: Flight): Flight[] {
  const flights: Flight[] = [flight];
  
  const gateNumbers = flight.GateNumbers || parseGateNumbers(flight.GateNumber);
  
  if (gateNumbers.length > 1) {
    for (let i = 1; i < gateNumbers.length; i++) {
      const duplicateFlight = {
        ...flight,
        GateNumber: gateNumbers[i],
        CheckInDesk: flight.CheckInDesk
      };
      flights.push(duplicateFlight);
    }
    
    flights[0].GateNumber = gateNumbers[0];
  }
  
  return flights;
}

// lib/flight-api-helpers.ts
export function sortFlightsByTime(flights: Flight[]): Flight[] {
  return [...flights].sort((a, b) => {
    if (a._sortTime && b._sortTime) return a._sortTime - b._sortTime;
    if (a._sortTime) return -1;
    if (b._sortTime) return 1;
    const timeA = a.EstimatedDepartureTime || a.ScheduledDepartureTime || '';
    const timeB = b.EstimatedDepartureTime || b.ScheduledDepartureTime || '';
    return timeA.localeCompare(timeB);
  });
}

// FIX (border stranica prikazivala jučerašnje letove / ne učitava
// današnje — pravi uzrok pronađen pri analizi): _sortTime je NAMJERNO
// kodiran (vidi mapNgrokFlightToFlight/mapRawFlight iznad) kao
// "wall-clock lokalni datum/vrijeme, upisano preko Date.UTC(...)" — to
// znači da .toISOString() na tom broju UVIJEK vraća TAČAN originalni
// lokalni datum leta (npr. "2026-07-31"), bez obzira u kojoj se
// vremenskoj zoni kod izvršava (Vercel produkcija je UTC, ali
// localhost za testiranje možda nije — ovo više nije bitno).
//
// Raniji kod je radio `new Date(f._sortTime).toDateString()` — to NIJE
// pogrešno samo po sebi, ALI poređeno sa `new Date().toDateString()`
// za "danas" (koje računa UTC kalendarski dan, ne Podgorica dan) —
// oko lokalne ponoći ta dva datuma privremeno NISU ista, pa su se
// letovi neposredno prije/poslije ponoći pogrešno filtrirali kao
// "nisu danas".
//
// Ispravka: "danas" se sad računa u STVARNOM Podgorica lokalnom vremenu
// (getPodgoricaDateString(), ista funkcija koja se već koristi za
// noćni prozor u lib/night-hours.ts), a datum leta se izvlači direktno
// iz UTC-formatiranog _sortTime (BEZ dodatne TZ konverzije — ta
// konverzija je već "ugrađena" u sam broj pri kodiranju, pa bi drugi
// prolaz kroz konverziju datum pomjerio pogrešno).
export function filterTodayFlights(flights: Flight[]): Flight[] {
  const today = getPodgoricaDateString();
  return flights.filter(f => {
    if (!f._sortTime) return true;
    const flightDate = new Date(f._sortTime).toISOString().split('T')[0];
    return flightDate === today;
  });
}