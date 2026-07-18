// lib/airline-logo.ts
//
// Statička lista ICAO kodova koji imaju lokalni AVIF logo u /public/airlines.
// Svi lokalni logoi su konvertovani u .avif (manja veličina → manji
// Vercel Data Transfer trošak). Kod IZ liste → učitava se direktno kao
// .avif. Kod VAN liste → nema lokalnog fajla, ide se odmah na FlightAware.
export const AIRLINE_LOGO_CODES: ReadonlySet<string> = new Set([
  'AHY', 'EWG', 'FIA', 'TUI',
  'AIZ', 'AUA', 'BAW', 'BTI', 'DLH', 'EDW',
  'EJU', 'EZS', 'FDB', 'HST', 'HTA', 'IBK',
  'ISR', 'JAF', 'JZR', 'LGL', 'LOT', 'MLD',
  'MNE', 'NOZ', 'NVD', 'NZS', 'SAS', 'SHT',
  'SQP', 'SQY', 'THY', 'UZB', 'VLG', 'WMT',
  'WUK', 'WZZ', 'NAX',
  'ASL', 'ELY', 'ENT', 'EXS', 'EZY', 'FIE',
  'IBE', 'TVF', 'TDR',
]);

// ── VERZIONISANJE LOGOA — rješava problem 24h Cache-Control keša ──────
// Fajl na /airlines/{ICAO}.avif je keširan sa "immutable" na 24h
// (vercel.json), pa zamjena fajla sama po sebi ne prisiljava browser/CDN
// da povuku novu verziju — stari kešrani fajl ostaje vidljiv do isteka.
//
// Rješenje: dodajemo ?v=N na URL. Novi broj verzije = nov URL = nov,
// odmah vidljiv cache unos, dok stari URL (bez traženja) prirodno istekne
// bez ikakvog dodatnog Vercel troška — i dalje se svaki fajl servira i
// keširan samo jednom po verziji, ne po svakom requestu.
//
// KAKO DA PROMIJENIŠ LOGO:
// 1. Zamijeni fajl /public/airlines/{ICAO}.avif novom slikom.
// 2. Ovdje poveći broj za taj ICAO kod za 1 (ili dodaj novi ako ga nema).
// 3. Deploy — logo je odmah vidljiv na svim ekranima na sljedećem
//    osvježavanju stranice, bez čekanja 24h.
// ── VERZIONISANJE LOGOA — rješava problem 24h Cache-Control keša ──────
// KAKO DA PROMIJENIŠ LOGO:
// 1. Zamijeni fajl /public/airlines/{ICAO}.avif novom slikom.
// 2. OVDJE dodaj/poveći broj za taj ICAO kod za 1.
// 3. Deploy.
const LOGO_VERSIONS: Record<string, number> = {
  FDB: 2,
  VLG: 2,
};
const DEFAULT_LOGO_VERSION = 1;

function getLogoVersion(icao: string): number {
  return LOGO_VERSIONS[icao] ?? DEFAULT_LOGO_VERSION;
}

export const getFlightawareLogoURL = (icao: string): string =>
  icao ? `https://www.flightaware.com/images/airline_logos/180px/${icao}.png` : '';

// Vraća src za PRVI pokušaj — poznat kod ide na lokalni .avif (sa
// verzijom u query stringu), nepoznat kod ide direktno na FlightAware.
export function getInitialAirlineLogoSrc(icao: string, placeholder: string): string {
  if (AIRLINE_LOGO_CODES.has(icao)) {
    return `/airlines/${icao}.avif?v=${getLogoVersion(icao)}`;
  }
  return getFlightawareLogoURL(icao) || placeholder;
}

// Da li je prvi pokušaj bio lokalni fajl (za onError logiku)
export function isKnownLocalLogo(icao: string): boolean {
  return AIRLINE_LOGO_CODES.has(icao);
}