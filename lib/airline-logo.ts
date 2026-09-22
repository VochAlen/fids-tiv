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

export const getFlightawareLogoURL = (icao: string): string =>
  icao ? `https://www.flightaware.com/images/airline_logos/180px/${icao}.png` : '';

// Vraća src za PRVI pokušaj — poznat kod ide na lokalni .avif,
// nepoznat kod ide direktno na FlightAware.
export function getInitialAirlineLogoSrc(icao: string, placeholder: string): string {
  if (AIRLINE_LOGO_CODES.has(icao)) return `/airlines/${icao}.avif`;
  return getFlightawareLogoURL(icao) || placeholder;
}

// Da li je prvi pokušaj bio lokalni fajl (za onError logiku)
export function isKnownLocalLogo(icao: string): boolean {
  return AIRLINE_LOGO_CODES.has(icao);
}