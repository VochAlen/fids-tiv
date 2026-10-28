// lib/board-phase.ts
//
// Faza naizmjeničnog prikaza (dolasci ↔ odlasci) na /combined, izvedena iz SATA, ne iz brojača u stranici.
// Zašto: Electron klijent svake ~3 min učita istu stranicu u skrivenom prozoru i zamijeni je; nova stranica je ranije
// uvijek počinjala od "dolazaka" (plava) i praznog tijela → kratak "plavi prazan ekran" kad je stara pokazivala odlaske.
// Sa fazom iz (serverski ispravljenog) sata nova stranica odmah pokazuje ISTU fazu kao stara, a svi monitori mijenjaju
// prikaz u istom trenutku. Čista funkcija — bez React-a, bez mreže.

export const BOARD_PHASE_MS = 20_000;

/** true = dolasci, false = odlasci. */
export function isArrivalsPhase(nowMs: number, phaseMs: number = BOARD_PHASE_MS): boolean {
  return Math.floor(nowMs / phaseMs) % 2 === 0;
}

/** Koliko ms do sljedećeg prelaza faze (uvijek > 0). */
export function msToNextPhase(nowMs: number, phaseMs: number = BOARD_PHASE_MS): number {
  return phaseMs - (((nowMs % phaseMs) + phaseMs) % phaseMs);
}
