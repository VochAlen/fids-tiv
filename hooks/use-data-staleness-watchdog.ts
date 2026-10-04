// hooks/use-data-staleness-watchdog.ts
//
// ZAŠTO OVO POSTOJI (dopuna postojećeg use-kiosk-resilience.ts):
// Heartbeat watchdog u use-kiosk-resilience.ts hvata SAMO potpuno
// zamrznut/blokiran event loop. Ne hvata slučaj kad JS i dalje radi
// normalno (heartbeat kuca, nema grešaka), ali je KONKRETNA pretplata
// na Ably kanal (ili reconciliation fetch) tiho prestala da isporučuje
// nove podatke — npr. "zombie" websocket konekcija koja izgleda otvorena
// ali ne prima poruke, ili reconnect logika koja tiho ne uspijeva.
//
// Rezultat tog scenarija: desk/gate ekran ostaje zaglavljen na starom
// stanju (npr. "otvoreno" za let koji je odavno zatvoren/otišao), a
// generički 6h hard reset iz use-kiosk-resilience.ts bi to na kraju
// riješio — ali za do 6h, što je predugo kad osoblje čeka da se šalter
// zatvori ODMAH.
//
// KAKO SE KORISTI:
// Stranica poziva touchData() SVAKI PUT kad uspješno primi/obradi
// podatak — iz Ably message handlera I iz reconciliation fetch-a.
// Ako touchData() ne bude pozvan duže od `staleAfterMs`, watchdog
// zaključuje da je kanal za podatke zaglavljen (bez obzira što je tab
// inače "živ") i radi kontrolisan window.location.reload().
'use client';

import { useEffect, useRef, useCallback } from 'react';

interface DataStalenessOptions {
  /** Kratak identifikator stranice/resursa za logove (npr. "checkin-desk-12"). */
  pageName: string;
  /** Ako prođe više od ovoga bez ijednog touchData() poziva, restartujemo.
   * Podrazumijevano 10 min — dovoljno duže od normalnog Ably+reconciliation
   * ritma (Ably je skoro trenutan, reconciliation fallback je na 3 min),
   * da se ne okida lažno pri kratkim mrežnim zastojima. */
  staleAfterMs?: number;
  /** Koliko često provjeravamo da li je podatak postao "star". */
  checkIntervalMs?: number;
  enabled?: boolean;
}

const DEFAULT_STALE_AFTER_MS = 10 * 60 * 1000; // 10 min
const DEFAULT_CHECK_INTERVAL_MS = 30_000; // 30s

export function useDataStalenessWatchdog(options: DataStalenessOptions) {
  const {
    pageName,
    staleAfterMs = DEFAULT_STALE_AFTER_MS,
    checkIntervalMs = DEFAULT_CHECK_INTERVAL_MS,
    enabled = true,
  } = options;

  // FIX (greška — "Cannot call impure function during render" /
  // react-hooks/purity, 2026-10-04): Date.now() se ranije pozivao
  // direktno u useRef inicijalizatoru (izvršava se TOKOM render-a).
  // Inicijalizuje se na 0 i odmah postavlja na stvaran Date.now() u
  // zasebnom efektu ispod (izvršava se u istom commit-u, davno prije
  // prve interval provjere) — i dalje sprečava lažni reload odmah pri
  // mount-u, isti cilj kao i ranije, samo bez direktnog poziva
  // Date.now() tokom render-a.
  const lastDataAtRef = useRef(0);
  const reloadTriggeredRef = useRef(false);

  useEffect(() => {
    if (lastDataAtRef.current === 0) lastDataAtRef.current = Date.now();
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => {
      if (reloadTriggeredRef.current) return;
      const gap = Date.now() - lastDataAtRef.current;
      if (gap > staleAfterMs) {
        reloadTriggeredRef.current = true;
        console.error(
          `[data-staleness:${pageName}] Nema uspješnog ažuriranja podataka ${Math.round(gap / 1000)}s ` +
          `(prag ${Math.round(staleAfterMs / 1000)}s) — kanal je vjerovatno zaglavljen (zombie websocket/` +
          `reconnect greška), restartujem stranicu.`
        );
        window.location.reload();
      }
    }, checkIntervalMs);
    return () => clearInterval(id);
  }, [enabled, staleAfterMs, checkIntervalMs, pageName]);

  // Pozvati OVO iz Ably message handlera i iz reconciliation fetch success
  // grane — svaki uspješan "znak života" podataka resetuje brojač.
  const touchData = useCallback(() => {
    lastDataAtRef.current = Date.now();
  }, []);

  return { touchData };
}