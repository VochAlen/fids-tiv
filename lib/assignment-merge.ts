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

export function mergeNewer(
  prev: Record<string, AssignmentEntry>,
  incoming: Record<string, AssignmentEntry>
): Record<string, AssignmentEntry> {
  const result = { ...prev };
  for (const key of Object.keys(incoming)) {
    const existing = result[key];
    const incomingEntry = incoming[key];
    if (isIncomingNewer(existing, incomingEntry)) {
      result[key] = incomingEntry;
    }
  }
  return result;
}

export function mergeOne(
  prev: Record<string, AssignmentEntry>,
  key: string,
  incomingEntry: AssignmentEntry
): Record<string, AssignmentEntry> {
  const existing = prev[key];
  if (isIncomingNewer(existing, incomingEntry)) {
    return { ...prev, [key]: incomingEntry };
  }
  return prev;
}
