// lib/assignment-merge.ts
//
// NOVO (po zahtjevu — automatski testovi za kritičnu logiku):
// izdvojeno iz hooks/useRealtimeAssignments.ts da bi bilo testabilno
// (React hookovi se ne mogu direktno unit-testirati bez punog DOM
// okruženja) — hook sad IMPORTUJE ove funkcije, umjesto da ih
// definiše lokalno, pa se testira ISTI, živi kod koji app stvarno
// koristi, ne duplikat.
//
// KRITIČNO (vidi opširan komentar uz AssignmentEntry.seq u
// hooks/useRealtimeAssignments.ts): sprečava DVIJE odvojene klase
// race condition-a otkrivene ove sesije —
// 1) REST snapshot (krenuo prije Ably poruke, ali mrežno kasnije
//    stigne) da prepiše svježe stanje koje je već stiglo preko
//    Ably-ja,
// 2) Ably poruke koje stignu van reda (reconnect/resume scenariji).
// Poređenje je po `seq` (strogo rastući Redis brojač), NE po `setAt`
// (wall-clock vrijeme, nepouzdano pod brzim uzastopnim akcijama —
// dvije akcije unutar iste milisekunde bi imale isti setAt).
export type AssignmentEntry = {
  status: 'open' | 'closed' | null;
  flightNumber: string;
  classType: string | null;
  setAt: number | null;
  seq: number;
};

// NOVO (KRITIČNO — prijavljen bug, 2026-09-27 poslijepodne: "osoblje
// zatvori check-in u admin panelu, ALI kiosk displej i dalje prikazuje
// upravo zatvoren let", uprkos svim ranijim zaštitama ove sesije —
// seq-based merge, auto-cleanup publish, data-staleness watchdog):
// otkriven je TREĆI, do sada nepokriven scenario u kome i sam
// seq-poredak zna da zataji.
//
// `seq` je Redis INCR brojač (SEQ_KEY u desk-status-override/
// route.ts) — pretpostavka cijele ove zaštite je da taj brojač NIKAD
// ne opada niti se resetuje. To NIJE garantovano: Redis restart,
// eviction pod memorijskim pritiskom (uobičajeno na free/hobby
// Upstash/Vercel KV planovima kad key nema TTL zaštitu — a SEQ_KEY
// ga nema), redeploy na drugu Redis instancu, ili ručni FLUSHALL —
// bilo koji od ovih vraća brojač na 1.
//
// Ako se to desi, SVAKI kiosk koji već ima keširan viši seq (npr. 487
// od prije reseta) bi TRAJNO odbijao SVAKI budući, validan update za
// taj šalter — kroz Ably poruke I kroz periodični reconciliation fetch
// (oba prolaze kroz OVU istu funkciju), jer bi svaki novi seq (2, 3,
// 4...) uvijek ispao "manji" od starog. Kiosk bi ostao zaglavljen
// ZAUVIJEK na starom letu — i, što je podmuklije, NIJEDAN postojeći
// watchdog to ne bi primijetio: svi oni provjeravaju da li
// SINHRONIZACIJA STIŽE (lastSyncAtRef), ne da li je PRIHVAĆENA —
// poruke bi stizale sasvim uredno, samo bi ih ova funkcija tiho
// odbacivala.
//
// Zaštita: mali, iz normalnog rada uobičajen pad u seq-u (npr. poruka
// koja kasni par mjesta) i dalje se tretira kao "starija, ignoriši" —
// isto ponašanje kao do sad. ALI drastičan pad (> SEQ_RESET_DROP_THRESHOLD,
// nešto što se u normalnom radu praktično ne može desiti bez reseta
// samog brojača) se tretira kao signal da je brojač resetovan, i u
// TOM izuzetnom slučaju se umjesto seq-a koristi setAt (wall-clock)
// da se odluči da li je incoming zaista noviji — setAt je inače
// namjerno izbjegavan za ovo poređenje (vidi komentar na vrhu fajla),
// ali kao rijedak fallback SAMO za ovaj scenario je siguran, jer bez
// njega alternativa je "zauvijek zaglavljen", što je gore.
const SEQ_RESET_DROP_THRESHOLD = 50;

function isIncomingNewer(
  existing: AssignmentEntry | undefined,
  incoming: AssignmentEntry
): boolean {
  if (!existing) return true;
  const existingSeq = existing.seq ?? 0;
  const incomingSeq = incoming.seq ?? 0;
  if (incomingSeq >= existingSeq) return true;

  const drop = existingSeq - incomingSeq;
  if (drop > SEQ_RESET_DROP_THRESHOLD) {
    // Vjerovatan reset seq brojača na serveru — vjeruj wall-clock
    // vremenu umjesto seq-u, SAMO u ovom izuzetnom slučaju.
    return (incoming.setAt ?? 0) >= (existing.setAt ?? 0);
  }
  return false;
}

// NOVO (GC/render-churn optimizacija, 2026-10-04 — primijetio korisnik:
// "ako mergeNewer() uvijek kreira novi objekat čak kada se ništa nije
// promijenilo... imaš nepotreban allocation → GC → render → recomputation
// ciklus"): `isIncomingNewer()` vraća true i kad je `incomingSeq ===
// existingSeq` (namjerno, vidi test "JEDNAKIM seq (>=, ne samo >)" —
// potrebno je zbog "republish" scenarija gdje server ponovo pošalje isti
// seq sa ISTIM sadržajem, npr. retry logika). Bez provjere sadržaja, OBA
// mergeNewer i mergeOne su ranije uvijek alocirala nov objekat/entry čim
// bi seq provjera prošla — čak i kad incoming entry ima IDENTIČNE
// vrijednosti kao postojeći. Pošto svaki snapshot fetch (mount, reconnect,
// fallback poll, 3-min reconciliation, i novi 12-15s "close in 20s"
// watchdog na check-in stranici) prolazi kroz mergeNewer, ovo je
// uzrokovalo setState → render → CheckInDisplay → computeAssignment() na
// SVAKI fetch, čak i kad se apsolutno ništa nije promijenilo na serveru.
//
// `entriesEqual` dodaje provjeru sadržaja (sva polja, ne samo seq) prije
// zamjene unosa — ako je incoming seq-noviji-ili-jednak ALI sadržajno
// identičan postojećem, ne pravimo novi objekat. mergeNewer dodatno
// alocira svoj top-level rezultat LIJENO (tek kad se prvi put nešto
// zaista promijeni) umjesto bezuslovnog `{ ...prev }` na početku, da bi
// vratio TAČNO istu `prev` referencu kad se ništa ne promijeni u cijelom
// snapshot-u (najčešći slučaj u praksi — većina fetch-eva ne nosi
// nikakvu stvarnu promjenu). Seq-based poredak (isIncomingNewer) ostaje
// potpuno netaknut — ovo je isključivo dodatna provjera IZNAD njega, ne
// zamjena za njega.
function entriesEqual(
  a: AssignmentEntry | undefined,
  b: AssignmentEntry
): boolean {
  if (!a) return false;
  return (
    a.status === b.status &&
    a.flightNumber === b.flightNumber &&
    a.classType === b.classType &&
    a.setAt === b.setAt &&
    (a.seq ?? 0) === (b.seq ?? 0)
  );
}

// NOVO (KRITIČNO — pravi uzrok prijavljenog bug-a, 2026-09-28 jutro:
// "zatvore check-in šalter, ali monitor na tom šalteru i dalje
// prikazuje let koji su upravo zatvorili", na skoro svim šalterima
// koji su tada bili u upotrebi): `mergeNewer` se poziva ISKLJUČIVO sa
// PUNIM snapshot-om cijelog desk/gate bloba (vidi jedini pozivalac —
// fetchSnapshot u hooks/useRealtimeAssignments.ts, `data.deskEntries`/
// `data.gateEntries` su CIJEL Redis blob, ne djelimičan delta). Server
// (lib/resource-mutations.ts, `applyResourceAction` grana 'clear', i
// `computeCleanup`) 'clear' akciju sprovodi tako što BRIŠE ključ iz
// bloba u potpunosti — NE postavlja status na null, nego ga ukloni.
// To znači da 'clear'-ovan šalter NIKAD više ne postoji u sledećem
// REST snapshot-u.
//
// Ranija verzija ove funkcije je iterisala SAMO kroz `Object.keys(incoming)`
// i prosto zadržavala SVAKI ključ iz `prev` koji incoming ne pominje —
// ispravno ponašanje ZA DJELIMIČAN delta, ali POGREŠNO za pun snapshot:
// ako se izgubi TA JEDNA Ably 'clear' poruka (mrežni blip, noćni
// reconnect ciklus opisan u lib/ably-client.ts, zombie kanal), stari
// (otvoren) unos je ostajao ZAUVIJEK u React state-u kioska — periodični
// reconciliation fetch (svaka 3 min, i pri svakom reconnect-u), koji bi
// TREBALO da bude sigurnosna mreža upravo za ovakav slučaj, ga NIKAD
// nije mogao ispraviti, jer je taj isti fetch bio izvor koji je (tiho)
// zadržavao staro stanje.
//
// Ispravka: pošto je `incoming` UVIJEK pun, autoritativan snapshot,
// svaki ključ koji postoji u `prev` ali NEDOSTAJE u `incoming` znači da
// je resurs u međuvremenu obrisan/zatvoren na serveru — tretiramo ga
// kao eksplicitan "clear" unos, osim ako već i lokalno pokazuje
// status: null (ništa se ne mijenja, izbjegava nepotreban re-render).
//
// NOVO (KRITIČNO — korisnik primijetio, 2026-10-04: clear-ovan unos je
// ranije dobijao seq: existing.seq ?? 0 — ISTI seq kao zadnje poznato
// stanje, ne veći. Ably garantuje "at-least-once" isporuku, što znači
// da RIJETKO, ali MOGUĆE, ista poruka (npr. "otvoreno" sa seq=500) može
// stići JOŠ JEDNOM nakon reconnect/resume ciklusa, i to i nakon što je
// server u međuvremenu šalter obrisao/zatvorio. Pošto isIncomingNewer()
// namjerno prihvata incomingSeq >= existingSeq (potrebno za legitiman
// "republish" slučaj), stari duplikat sa seq=500 bi prošao protiv
// clear-ovanog lokalnog unosa koji TAKOĐE ima seq=500, i "uskrsnuo" bi
// već zatvoren šalter na kiosku.
//
// Zaštita: clear-ovan unos dobija existing.seq + 1, STROGO veći od
// zadnjeg poznatog realnog seq-a za taj ključ. Ovo je sigurno jer je
// SEQ_KEY dijeljen/monoton brojač — svaka buduća STVARNA mutacija nad
// bilo kojim resursom pomjera ga dalje, pa će svaki legitiman budući
// update za ovaj ključ prirodno imati seq >= existing.seq + 1. Jedino
// što ova +1 granica odbija jeste TAČNO ponovljena stara poruka sa
// TAČNO istim seq-om kao prije clear-a — što je upravo scenario koji
// treba odbiti.
const CLEARED_BY_SNAPSHOT: Omit<AssignmentEntry, 'setAt' | 'seq'> = {
  status: null,
  flightNumber: '',
  classType: null,
};

export function mergeNewer(
  prev: Record<string, AssignmentEntry>,
  incoming: Record<string, AssignmentEntry>
): Record<string, AssignmentEntry> {
  // Lijena alokacija: `result` ostaje `null` (i na kraju vraćamo tačno
  // `prev` referencu) dok se ne desi BAREM jedna stvarna izmjena. Ovo je
  // namjerno drugačije od ranije verzije koja je uvijek radila
  // `{ ...prev }` na početku.
  let result: Record<string, AssignmentEntry> | null = null;

  for (const key of Object.keys(incoming)) {
    const existing = (result ?? prev)[key];
    const incomingEntry = incoming[key];
    if (isIncomingNewer(existing, incomingEntry) && !entriesEqual(existing, incomingEntry)) {
      if (!result) result = { ...prev };
      result[key] = incomingEntry;
    }
  }

  for (const key of Object.keys(prev)) {
    if (Object.prototype.hasOwnProperty.call(incoming, key)) continue;
    const existing = prev[key];
    if (!existing || existing.status === null) continue;
    if (!result) result = { ...prev };
    result[key] = { ...CLEARED_BY_SNAPSHOT, setAt: Date.now(), seq: (existing.seq ?? 0) + 1 };
  }

  return result ?? prev;
}

export function mergeOne(
  prev: Record<string, AssignmentEntry>,
  key: string,
  incomingEntry: AssignmentEntry
): Record<string, AssignmentEntry> {
  const existing = prev[key];
  if (isIncomingNewer(existing, incomingEntry) && !entriesEqual(existing, incomingEntry)) {
    return { ...prev, [key]: incomingEntry };
  }
  return prev;
}