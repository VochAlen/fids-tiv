// Pomoćne funkcije za stranicu dodjele (/admin/assign-checkin): čisto računanje iz
// podataka koje stranica već ima — nema dodatnih zahtjeva ka serveru.

/** Koliko minuta do polaska (ETD ako je validan HH:MM, inače STD); null ako vrijeme nije čitljivo. */
export function minutesToDeparture(
  std: string | undefined, etd: string | undefined, nowMin: number,
): number | null {
  const parse = (s?: string): number | null => {
    const m = /^(\d{1,2}):(\d{2})/.exec((s ?? '').trim());
    if (!m) return null;
    const h = Number(m[1]), mm = Number(m[2]);
    if (h > 23 || mm > 59) return null;
    return h * 60 + mm;
  };
  const t = parse(etd) ?? parse(std);
  if (t === null) return null;
  let diff = t - nowMin;
  if (diff < -720) diff += 1440; // let poslije ponoći, a sad je prije ponoći
  if (diff > 720) diff -= 1440;
  return diff;
}

export const CLOSE_CHECKIN_MIN = 20;

/** Check-in treba zatvoriti: polazak za manje od 20 min (a još nije prošao) i šalter je još otvoren. */
export function shouldCloseCheckin(minToDep: number | null, deskOpen: boolean): boolean {
  return deskOpen && minToDep !== null && minToDep >= 0 && minToDep < CLOSE_CHECKIN_MIN;
}

/** Slobodni resursi, u redoslijedu liste `all`. */
export function freeResources(all: readonly string[], occupiedIds: Iterable<string>): string[] {
  const occ = new Set(occupiedIds);
  return all.filter(id => !occ.has(id));
}
