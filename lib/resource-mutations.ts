// lib/resource-mutations.ts
//
// NOVO (po zahtjevu — automatski testovi za kritičnu logiku): izdvojena,
// ČISTA odlučivačka logika iz app/api/test/desk-status-override/route.ts
// i gate-status-override/route.ts (koje su strukturno identične — samo
// "deskNumber"/"gateNumber" se razlikuje). Redis I/O (lock, read, write)
// OSTAJE u tim route.ts fajlovima (nije praktično testirati bez Redis-a);
// ova funkcija dobija/vraća čist podatak, testabilna bez ijedne mrežne
// zavisnosti.
//
// Ovo je NAJVIŠE PUTA popravljena logika ove sesije:
// 1) 'clear' na već obrisanom zapisu (auto-cleanup ga je tiho obrisao)
//    ranije nije objavljivalo Ably poruku — kiosk je ostajao zaglavljen
//    zauvijek.
// 2) cleanup sam (istekli unosi, MAX_AGE_MS) ranije NIKAD nije
//    objavljivao promjenu — isti simptom.
export type ResourceEntry = {
  status: 'open' | 'closed' | null;
  flightNumber: string | null;
  classType: string | null;
  setAt: number | null;
  seq: number;
};

export type ResourceAction = 'open' | 'closed' | 'clear' | 'setClass';

export type MutateResult = {
  changed: boolean;
  publishedEntry?: { key: string; entry: ResourceEntry } | null;
};

// FIX (KRITIČNO — vidi opširan komentar iznad, tačka 1): 'clear' na
// već-nepostojećem zapisu vraća {changed: false} BEZ publishedEntry —
// namjerno, ovo je ISPRAVNO ponašanje za ručnu 'clear' akciju kad
// zaista nema šta da se ukloni. Zaštita za slučaj "auto-cleanup ga je
// već tiho obrisao" je u computeCleanup ispod, NE ovdje — cleanup i
// ručna akcija su odvojeni koraci koji se OBA moraju objaviti.
export function applyResourceAction(
  all: Record<string, ResourceEntry>,
  key: string,
  action: ResourceAction,
  flightNumber: string | undefined,
  classType: string | null | undefined,
  now: number
): MutateResult {
  const existing = all[key];

  if (action === 'open' && flightNumber) {
    const entry: ResourceEntry = { status: 'open', flightNumber, classType: existing?.classType ?? null, setAt: now, seq: 0 };
    all[key] = entry;
    return { changed: true, publishedEntry: { key, entry } };
  }

  if (action === 'closed') {
    const entry: ResourceEntry = { status: 'closed', flightNumber: flightNumber || '', classType: existing?.classType ?? null, setAt: now, seq: 0 };
    all[key] = entry;
    return { changed: true, publishedEntry: { key, entry } };
  }

  if (action === 'clear') {
    if (!existing) return { changed: false };
    delete all[key];
    const entry: ResourceEntry = { status: null, flightNumber: '', classType: null, setAt: now, seq: 0 };
    return { changed: true, publishedEntry: { key, entry } };
  }

  if (action === 'setClass') {
    if (!existing) return { changed: false };
    const entry: ResourceEntry = { ...existing, classType: classType ?? null };
    all[key] = entry;
    return { changed: true, publishedEntry: { key, entry } };
  }

  return { changed: false };
}

// FIX (KRITIČNO — vidi opširan komentar iznad, tačka 2): mutira `all`
// IN PLACE (briše istekle ključeve) i vraća listu cleanedEntries koje
// POZIVALAC MORA objaviti preko Ably-a — bez ovoga, kiosk ekran za taj
// resurs nikad ne sazna da se stanje automatski promijenilo.
export function computeCleanup(
  all: Record<string, ResourceEntry>,
  now: number,
  maxAgeMs: number
): { key: string; entry: ResourceEntry }[] {
  const cleanedEntries: { key: string; entry: ResourceEntry }[] = [];
  for (const k of Object.keys(all)) {
    const v = all[k];
    if (v?.setAt && now - v.setAt > maxAgeMs) {
      delete all[k];
      cleanedEntries.push({
        key: k,
        entry: { status: null, flightNumber: '', classType: null, setAt: now, seq: 0 },
      });
    }
  }
  return cleanedEntries;
}
