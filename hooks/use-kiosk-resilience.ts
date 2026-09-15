// hooks/use-kiosk-resilience.ts
//
// ZAŠTO OVO POSTOJI:
// Analiza svih kiosk stranica (combined, departures, border, arrivals,
// arrivals-small, split-board, gate, checkin, security) pokazala je
// NEUJEDNAČENU i NEPOTPUNU zaštitu za 24/7 rad bez nadzora:
//
//   - Heartbeat watchdog (detektuje zamrznut/blokiran event loop):
//     imali su ga SAMO combined, departures, split-board, border.
//   - Periodično čišćenje memorije (ograničava neograničen rast nizova/
//     objekata u state-u): SAMO combined, departures, split-board.
//   - Globalni error handler za KRITIČNE greške (OOM, stack overflow) —
//     greške VAN React render stabla koje Error Boundary NE hvata jer
//     se dešavaju u event handlerima, tajmerima ili async kodu: SAMO
//     departures.
//   - Handler za NEUHVAĆENE ODBIJENE PROMISE-e (npr. fetch() poziv bez
//     .catch()): NIJEDNA stranica — univerzalan propust. Bez ovoga,
//     Chrome samo ispiše upozorenje u konzoli i UI može ostati u tihom,
//     nedosljednom stanju bez ikakvog signala da se nešto pokvarilo.
//   - Periodičan "hard reset" (potpuni reload kao krajnja sigurnosna
//     mreža, čisti i Chrome-ov interni memory/GPU cache koji se
//     akumulira tokom dana): gate/checkin/arrivals-small su ga imali,
//     ali BEZ ičega drugog. Security/baggage/dashboard nisu imali NIŠTA.
//
// Ovaj hook objedinjuje SVE navedeno na jedno mjesto, tako da svaka
// kiosk stranica dobija identičnu, potpunu zaštitu jednim pozivom, bez
// duplirane/nekonzistentne logike po fajlu.

'use client';

import { useEffect, useRef, useCallback } from 'react';

interface KioskResilienceOptions {
  /** Kratak identifikator stranice za logove (npr. "gate-21", "combined"). */
  pageName: string;
  /** Interval punog reload-a kao krajnja sigurnosna mreža. Podrazumijevano
   * 6h + nasumičan jitter do 30 min (da se svi ekrani ne restartuju u
   * istom trenutku ako su upaljeni istovremeno). */
  hardResetIntervalMs?: number;
  /** Koliko često provjeravamo da event loop nije zamrznut/blokiran. */
  heartbeatCheckIntervalMs?: number;
  /** Ako prođe VIŠE od ovoga od poslednjeg uspješnog "otkucaja",
   * proglašavamo tab zamrznutim i restartujemo. Mora biti veće od
   * heartbeatCheckIntervalMs (inače bi se okidalo i pri normalnom radu). */
  heartbeatTimeoutMs?: number;
  /** Opcioni callback za periodično čišćenje memorije — stranica ovdje
   * prosleđuje SVOJU logiku (npr. obrezivanje nizova letova na max
   * dužinu, brisanje starih unosa iz Map/Set keš-eva). */
  onMemoryCleanup?: () => void;
  memoryCleanupIntervalMs?: number;
  /** Isključi sve mehanizme (npr. tokom razvoja/debagovanja). */
  enabled?: boolean;
}

const DEFAULT_HARD_RESET_MS = 6 * 60 * 60 * 1000; // 6h
const DEFAULT_HARD_RESET_JITTER_MS = 30 * 60 * 1000; // do +30 min
const DEFAULT_HEARTBEAT_CHECK_MS = 30_000;
const DEFAULT_HEARTBEAT_TIMEOUT_MS = 120_000;
const DEFAULT_MEMORY_CLEANUP_MS = 30 * 60 * 1000; // 30 min

export function useKioskResilience(options: KioskResilienceOptions) {
  const {
    pageName,
    hardResetIntervalMs = DEFAULT_HARD_RESET_MS,
    heartbeatCheckIntervalMs = DEFAULT_HEARTBEAT_CHECK_MS,
    heartbeatTimeoutMs = DEFAULT_HEARTBEAT_TIMEOUT_MS,
    onMemoryCleanup,
    memoryCleanupIntervalMs = DEFAULT_MEMORY_CLEANUP_MS,
    enabled = true,
  } = options;

  const lastHeartbeatRef = useRef(Date.now());

  // ── 1) HARD RESET — periodičan pun reload kao krajnja sigurnosna mreža.
  // Ovo NIJE priznanje poraza — dugotrajne Chrome sesije (dani/nedelje bez
  // restarta) akumuliraju interni browser cache/GPU memoriju i sitne
  // curenja čak i u savršeno napisanoj aplikaciji. Periodičan, planiran
  // reload u kontrolisanom trenutku je standardna praksa za kiosk/digital
  // signage sisteme, i mnogo je bolji ishod od neplaniranog pada nakon
  // nedelju dana rada. Jitter (nasumičnih do 30 min) sprečava da se svi
  // fizički ekrani restartuju u istom trenutku (što bi izazvalo kratak,
  // ali primjetan "svi ekrani su prazni odjednom" efekat).
  useEffect(() => {
    if (!enabled) return;
    const jitter = Math.floor(Math.random() * DEFAULT_HARD_RESET_JITTER_MS);
    const id = setTimeout(() => {
      console.log(`[kiosk-resilience:${pageName}] Planiran periodičan restart (sigurnosna mreža za dugotrajan rad)`);
      window.location.reload();
    }, hardResetIntervalMs + jitter);
    return () => clearTimeout(id);
  }, [enabled, hardResetIntervalMs, pageName]);

  // ── 2) HEARTBEAT WATCHDOG — detektuje zamrznut/blokiran event loop.
  // Radi na principu "lag detektora": svaki tick ažurira lastHeartbeatRef
  // na trenutno vrijeme. Ako je event loop bio blokiran (npr. beskonačna
  // petlja, teška sinhrona operacija, deadlock) duže nego
  // heartbeatTimeoutMs, ONDA KAD SE BLOKADA KONAČNO OSLOBODI i ovaj tick
  // uspije da se izvrši, razlika između "sada" i poslednjeg zabilježenog
  // vremena će biti mnogo veća od normalnog intervala — to je siguran
  // znak da je tab bio neresponzivan, pa restartujemo.
  useEffect(() => {
    if (!enabled) return;
    lastHeartbeatRef.current = Date.now();
    const id = setInterval(() => {
      const now = Date.now();
      const gap = now - lastHeartbeatRef.current;
      if (gap > heartbeatTimeoutMs) {
        console.error(`[kiosk-resilience:${pageName}] Heartbeat kašnjenje ${gap}ms (prag ${heartbeatTimeoutMs}ms) — tab je bio neresponzivan, restartujem`);
        window.location.reload();
        return;
      }
      lastHeartbeatRef.current = now;
    }, heartbeatCheckIntervalMs);
    return () => clearInterval(id);
  }, [enabled, heartbeatCheckIntervalMs, heartbeatTimeoutMs, pageName]);

  // ── 3) GLOBALNI ERROR HANDLER — hvata greške VAN React render stabla
  // (event handleri, setTimeout/setInterval callbacks, async kod) koje
  // React Error Boundary NE MOŽE uhvatiti (Error Boundary hvata samo
  // greške tokom render-a/lifecycle metoda). Fokus na KRITIČNE greške
  // (OOM, stack overflow, heap) koje najavljuju da će tab uskoro potpuno
  // pasti — kontrolisan, blagovremen reload je mnogo bolji ishod nego
  // da Chrome sam, u nepredvidivom trenutku, ubije tab.
  useEffect(() => {
    if (!enabled) return;
    const onError = (e: ErrorEvent) => {
      const msg = e.error?.message || e.message || '';
      console.error(`[kiosk-resilience:${pageName}] Neuhvaćena greška:`, msg);
      if (/out of memory|stack overflow|javascript heap|maximum call stack/i.test(msg)) {
        console.error(`[kiosk-resilience:${pageName}] KRITIČNA greška detektovana — kontrolisan restart za 2s`);
        setTimeout(() => window.location.reload(), 2_000);
      }
    };
    window.addEventListener('error', onError);
    return () => window.removeEventListener('error', onError);
  }, [enabled, pageName]);

  // ── 4) NEUHVAĆENE ODBIJENE PROMISE-e — FIX: univerzalan propust, nije
  // postojao NA NIJEDNOJ stranici prije ovoga. fetch() pozivi bez
  // .catch(), ili async funkcije čija greška ne stigne do try/catch,
  // završavaju ovdje. Bez ovog handlera, Chrome samo ispiše upozorenje u
  // konzoli i ništa više se ne dešava — UI može ostati u tihom,
  // nedosljednom stanju (npr. "loading" spinner koji se nikad ne
  // ukloni) bez ikakvog signala da se nešto pokvarilo. Ovdje bar
  // logujemo grešku vidljivo, da je moguće naknadno dijagnostikovati
  // preko Vercel/browser logova umjesto da nestane bez traga.
  useEffect(() => {
    if (!enabled) return;
    const onRejection = (e: PromiseRejectionEvent) => {
      const msg = e.reason?.message || String(e.reason) || 'nepoznata greška';
      console.error(`[kiosk-resilience:${pageName}] Neuhvaćena odbijena promise:`, msg);
    };
    window.addEventListener('unhandledrejection', onRejection);
    return () => window.removeEventListener('unhandledrejection', onRejection);
  }, [enabled, pageName]);

  // ── 5) PERIODIČNO ČIŠĆENJE MEMORIJE (opciono) — stranica prosleđuje
  // sopstvenu logiku (obrezivanje nizova/mapa u state-u na ograničenu
  // veličinu). Sprečava neograničen rast memorije tokom višednevnog rada
  // bez restarta, nezavisno od HARD_RESET sigurnosne mreže iznad.
  useEffect(() => {
    if (!enabled || !onMemoryCleanup) return;
    const id = setInterval(onMemoryCleanup, memoryCleanupIntervalMs);
    return () => clearInterval(id);
  }, [enabled, onMemoryCleanup, memoryCleanupIntervalMs]);

  // Stranica može ručno "otkucati" heartbeat nakon sopstvenog uspješnog
  // ciklusa (npr. poslije uspješnog fetch-a) za dodatnu preciznost —
  // opciono, watchdog iz koraka 2) radi ispravno i bez ovoga.
  const touchHeartbeat = useCallback(() => {
    lastHeartbeatRef.current = Date.now();
  }, []);

  return { touchHeartbeat };
}
