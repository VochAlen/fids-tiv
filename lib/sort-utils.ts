// lib/sort-utils.ts
//
// FIX (po zahtjevu — prijavljen bug: šalteri dodijeljeni redom
// 10, 11, pa 9 su se prikazivali kao "10,11,9" umjesto "9,10,11" na
// combined/departures/split-board stranicama): JavaScript-ov
// Array.prototype.sort() BEZ komparatora radi LEKSIKOGRAFSKO (tekstualno)
// sortiranje po default-u, ne brojevno — "10" < "11" < "9" tekstualno,
// jer se poredi karakter-po-karakter ('1' < '1' izjednačeno, '0' < '1'
// -> "10" prije "11"; zatim '1' < '9' -> "11" prije "9"). Ova funkcija
// sortira brojevno, uz siguran fallback na tekstualno poređenje ako
// vrijednost nije čist broj (npr. neki neočekivan format šaltera).
export function sortNumericStrings(values: string[]): string[] {
  return [...values].sort((a, b) => {
    const na = parseInt(a, 10);
    const nb = parseInt(b, 10);
    if (isNaN(na) || isNaN(nb)) return a.localeCompare(b);
    if (na !== nb) return na - nb;
    return a.localeCompare(b); // isti broj, razlikuje se npr. u vodećim nulama ("05" vs "5")
  });
}
