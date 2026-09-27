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

export function mergeNewer(
  prev: Record<string, AssignmentEntry>,
  incoming: Record<string, AssignmentEntry>
): Record<string, AssignmentEntry> {
  const result = { ...prev };
  for (const key of Object.keys(incoming)) {
    const existing = result[key];
    const incomingEntry = incoming[key];
    if (!existing || (incomingEntry.seq ?? 0) >= (existing.seq ?? 0)) {
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
  if (!existing || (incomingEntry.seq ?? 0) >= (existing.seq ?? 0)) {
    return { ...prev, [key]: incomingEntry };
  }
  return prev;
}
