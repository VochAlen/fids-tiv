// lib/delay-propagation.ts
//
// Procjena kašnjenja POLASKA iz kašnjenja DOLASKA istog aviona (rotacija). Ako JU680 stiže sa +40 min,
// JU681 (isti avion nazad) vjerovatno neće poletjeti na vrijeme — a ETD za polazak često stigne tek kasnije.
// Čista logika (bez React-a, bez mreže, bez Redis-a). Nije naučen model: koristi fizičko pravilo
// "avion je spreman tek kad sleti + minimalno zadržavanje na zemlji".
//
// Uparivanje dolazak→polazak: ista kompanija, isti grad (odakle je došao = kamo ide), polazak 20 min–6 h
// poslije planiranog dolaska; svaki dolazak i svaki polazak koriste se najviše jednom (najbliži parovi prvi).

export const MIN_TURNAROUND_MIN = 35;
export const MIN_PREDICT_MIN = 10;
export const MAX_PREDICT_MIN = 180;
const MIN_GAP_MIN = 20;
const MAX_GAP_MIN = 360;

export interface DelayFlightLike {
  FlightNumber: string;
  AirlineCode?: string;
  DestinationCityName?: string;
  DestinationAirportCode?: string;
  ScheduledDepartureTime?: string;
  EstimatedDepartureTime?: string;
  ActualDepartureTime?: string;
  StatusEN?: string;
}

export interface PredictedDelay {
  /** Procijenjeno kašnjenje polaska (min), zaokruženo na 5. */
  delayMin: number;
  fromFlight: string;
  arrivalDelayMin: number;
  /** Rezerva na zemlji u rasporedu iznad minimalnog zadržavanja (min). */
  slackMin: number;
  note: string;
}

const clock = (s: string | undefined): number | null => {
  const m = (s ?? '').trim().match(/^(\d{1,2})[:.](\d{2})/);
  if (!m) return null;
  const h = +m[1], mi = +m[2];
  return h > 23 || mi > 59 ? null : h * 60 + mi;
};
const cyc = (a: number, b: number) => (((b - a) % 1440) + 1440) % 1440;
const dead = (st: string | undefined) => /cancel|otkaz|divert|preusmjer/i.test(st ?? '');
const gone = (st: string | undefined) => /departed|poletio/i.test(st ?? '');
const airlineOf = (f: DelayFlightLike) => ((f.AirlineCode || f.FlightNumber.slice(0, 2)) || '').toUpperCase();
const cityKey = (f: DelayFlightLike) => (f.DestinationAirportCode || f.DestinationCityName || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

/** Kašnjenje dolaska (min): procijenjeno (ili stvarno) minus planirano; ETA "prije" plana se ignoriše. */
export function arrivalDelayMin(a: DelayFlightLike): number {
  const sta = clock(a.ScheduledDepartureTime);
  const eta = clock(a.EstimatedDepartureTime) ?? clock(a.ActualDepartureTime);
  if (sta === null || eta === null) return 0;
  const d = cyc(sta, eta);
  return d >= 720 ? 0 : d;
}

export function predictDepartureDelays(
  arrivals: readonly DelayFlightLike[],
  departures: readonly DelayFlightLike[],
): Record<string, PredictedDelay> {
  const pairs: Array<{ a: DelayFlightLike; d: DelayFlightLike; gap: number }> = [];
  for (const a of arrivals) {
    const sta = clock(a.ScheduledDepartureTime);
    if (sta === null || dead(a.StatusEN)) continue;
    for (const d of departures) {
      const std = clock(d.ScheduledDepartureTime);
      if (std === null || dead(d.StatusEN) || gone(d.StatusEN)) continue;
      const ca = cityKey(a), cd = cityKey(d);
      if (!ca || ca !== cd || airlineOf(a) !== airlineOf(d)) continue;
      const gap = cyc(sta, std);
      if (gap >= MIN_GAP_MIN && gap <= MAX_GAP_MIN) pairs.push({ a, d, gap });
    }
  }
  pairs.sort((x, y) => x.gap - y.gap);
  const usedA = new Set<string>(), usedD = new Set<string>();
  const out: Record<string, PredictedDelay> = {};
  for (const { a, d, gap } of pairs) {
    if (usedA.has(a.FlightNumber) || usedD.has(d.FlightNumber)) continue;
    usedA.add(a.FlightNumber); usedD.add(d.FlightNumber);
    const arrDelay = arrivalDelayMin(a);
    const slack = Math.max(gap - MIN_TURNAROUND_MIN, 0);
    const raw = arrDelay - slack;
    if (raw < MIN_PREDICT_MIN) continue;
    const delayMin = Math.min(Math.round(raw / 5) * 5, MAX_PREDICT_MIN);
    out[d.FlightNumber] = {
      delayMin,
      fromFlight: a.FlightNumber,
      arrivalDelayMin: arrDelay,
      slackMin: slack,
      note: `Očekivano kašnjenje ~${delayMin} min: dolazni ${a.FlightNumber} kasni ${arrDelay} min (rezerva na zemlji ${slack} min).`,
    };
  }
  return out;
}
