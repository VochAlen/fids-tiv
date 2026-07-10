// lib/airline-logo.ts
//
// Statička mapa ekstenzija za /public/airlines loga — generisano iz
// stvarnog sadržaja foldera. Izbjegava nepotrebne 404 pokušaje:
// - Kod IZ mape → zna se tačna ekstenzija, učitava se direktno.
// - Kod VAN mape → nema lokalnog fajla, ide se odmah na FlightAware.
export const AIRLINE_LOGO_EXT: Record<string, 'png' | 'jpg'> = {
  AHY: 'png', EWG: 'png', FIA: 'png', TUI: 'png',
  AIZ: 'jpg', AUA: 'jpg', BAW: 'jpg', BTI: 'jpg', DLH: 'jpg', EDW: 'jpg',
  EJU: 'jpg', EZS: 'jpg', FDB: 'jpg', HST: 'jpg', HTA: 'jpg', IBK: 'jpg',
  ISR: 'jpg', JAF: 'jpg', JZR: 'jpg', LGL: 'jpg', LOT: 'jpg', MLD: 'jpg',
  MNE: 'jpg', NOZ: 'jpg', NVD: 'jpg', NZS: 'jpg', SAS: 'jpg', SHT: 'jpg',
  SQP: 'jpg', SQY: 'jpg', THY: 'jpg', UZB: 'jpg', VLG: 'jpg', WMT: 'jpg',
  WUK: 'jpg', WZZ: 'jpg',NAX: 'jpg', 
  // Kodovi sa oba fajla — png je dovoljan, prvi pokušaj uvijek uspijeva
  ASL: 'png', ELY: 'png', ENT: 'png', EXS: 'png', EZY: 'png', FIE: 'png',
  IBE: 'png', TVF: 'png',TDR: 'png',
};

export const getFlightawareLogoURL = (icao: string): string =>
  icao ? `https://www.flightaware.com/images/airline_logos/180px/${icao}.png` : '';

// Vraća src za PRVI pokušaj — poznat kod ide na tačnu ekstenziju,
// nepoznat kod ide direktno na FlightAware (bez uzaludnog png/jpg pokušaja).
export function getInitialAirlineLogoSrc(icao: string, placeholder: string): string {
  const ext = AIRLINE_LOGO_EXT[icao];
  if (ext) return `/airlines/${icao}.${ext}`;
  return getFlightawareLogoURL(icao) || placeholder;
}

// Da li je prvi pokušaj bio lokalni fajl (za onError logiku)
export function isKnownLocalLogo(icao: string): boolean {
  return !!AIRLINE_LOGO_EXT[icao];
}