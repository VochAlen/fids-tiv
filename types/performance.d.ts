// types/performance.d.ts
//
// FIX (po zahtjevu — zamjena "as any" pravim tipom, na JEDNOM mjestu
// umjesto ponavljanja u 7 fajlova): `performance.memory` je Chrome-
// specifično proširenje (nije u standardnom TypeScript lib.dom.d.ts),
// koje više kiosk stranica koristi za "memory pressure" auto-reload
// provjeru (ako korišćena JS memorija pređe ~85% limita, stranica se
// sama osvježi prije nego postane vidljivo spora). Deklaracija ispod
// globalno proširuje standardni Performance interfejs preko
// TypeScript "declaration merging" — nakon ovoga, `performance.memory`
// je ispravno tipizirano SVUDA u projektu, bez potrebe za "as any" (ili
// čak lokalnim "as X") na svakom pojedinačnom mjestu korišćenja.
// Opciono (`memory?:`) jer ne postoji u browserima koji nisu
// Chromium-bazirani — svako mjesto korišćenja već ispravno provjerava
// `perf?.memory` prije pristupa poljima.
interface Performance {
  memory?: {
    usedJSHeapSize: number;
    totalJSHeapSize: number;
    jsHeapSizeLimit: number;
  };
}
