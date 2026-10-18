// lib/assignment-limits.ts
//
// NOVO (2026-10-17): JEDNO mjesto za rok trajanja dodjela šaltera/gate-ova.
//
// UZROK prijavljenog "let je dodijeljen u assign-checkin, a check-in/gate ne prikazuje (ili prestane)":
// dodjela je ranije imala TVRD rok od 4 h (šalteri) / 6 h (gate-ovi) — i po unosu (MAX_AGE_MS) i kao TTL
// cijelog Redis ključa. Rok se računa od trenutka dodjele, a ne od polaska leta, pa je kašnjenje leta od
// par sati (ili ranije otvaranje šaltera) bilo dovoljno da dodjela TIHO nestane dok je let još aktivan:
//   • cleanup pri sljedećoj POST akciji na BILO KOM šalteru briše unose starije od roka,
//   • a ako 4 h niko ne upiše ništa u blob, Redis obriše CIJEO ključ (svi šalteri odjednom), bez Ably poruke.
// Kiosk bi tek na sljedećem sinhronu (≤3 min) vidio "obrisano" i prešao u inactive.
//
// Stvarno zatvaranje poletjelih/otkazanih letova radi autoClose (cron svake 3 min) i `matchIsDeparted`
// na kiosku — rok ispod je samo SIGURNOSNA MREŽA za zaboravljene unose, pa smije biti širok.
// TTL ključa MORA biti >= roka unosa, inače ključ istekne prije unosa.
export const ASSIGNMENT_MAX_AGE_MS = 12 * 60 * 60 * 1000;
export const ASSIGNMENT_TTL_SECONDS = 12 * 60 * 60;
