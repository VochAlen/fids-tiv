// hooks/use-idle-logout.ts
//
// ZAŠTO OVO POSTOJI:
// Analiza je pokazala DVIJE odvojene, ručno pisane kopije auto-logout
// logike (app/admin/page.tsx: 180s, app/admin/assign-checkin/page.tsx:
// 240s) — različiti timeout-i na različitim stranicama ISTOG admin panela,
// što znači da se osoblje neće ni sjetiti tačno koliko dugo ima prije nego
// što ih sistem izbaci, zavisno od toga na kom je pod-ekranu. Dvije druge
// admin stranice (app/admin/flights/page.tsx, app/admin/business-class/
// page.tsx) NISU imale idle-logout uopšte — na dijeljenoj aerodromskoj
// radnoj stanici, sesija ostavljena otvorenu na tim ekranima ostaje
// prijavljena do isteka 8h cookie-a, bez ikakve zaštite od "neko drugi
// sjedne za tastaturu dok je prava osoba na pauzi".
//
// Ovaj hook:
//   1. Objedinjuje logiku na JEDNO mjesto — svih 5 admin stranica sad
//      koristi identično ponašanje.
//   2. Postavlja idle prag na 3 minuta (180s) — sredina traženog
//      2-4 minuta opsega.
//   3. Dodaje UPOZORENJE 30s prije odjave (nešto što RANIJE nije
//      postojalo ni u jednoj od dvije postojeće implementacije) — osoblje
//      dobija priliku da pomjeri miš/dodirne ekran i ostane prijavljeno,
//      umjesto da ih sistem iznenada izbaci nasred dodjele gate-a.
//   4. Prati i 'mousemove' i 'scroll'/'wheel' aktivnost (ranije verzije su
//      pratile SAMO mousedown/touchstart/keydown/click — osoblje koje
//      SAMO skroluje spisak letova, bez klika, bi ranije bilo odjavljeno
//      usred pregledanja, iako je aktivno gledalo ekran).

'use client';

import { useEffect, useRef, useState, useCallback } from 'react';

const DEFAULT_IDLE_MS = 3 * 60 * 1000;     // 3 min — sredina 2-4 min zahtjeva
const DEFAULT_WARNING_MS = 30 * 1000;      // upozorenje 30s prije odjave

interface UseIdleLogoutOptions {
  idleMs?: number;
  warningMs?: number;
  enabled?: boolean;
}

export function useIdleLogout(options: UseIdleLogoutOptions = {}) {
  const idleMs = options.idleMs ?? DEFAULT_IDLE_MS;
  const warningMs = options.warningMs ?? DEFAULT_WARNING_MS;
  const enabled = options.enabled ?? true;

  // Sekunde preostale do odjave, ili null kad NIJE u periodu upozorenja
  // (tj. korisnik je aktivan i nema razloga za prikaz banner-a).
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);

  const idleTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const warnTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const countdownRef = useRef<ReturnType<typeof setInterval>>();

  const doLogout = useCallback(async () => {
    try {
      await fetch('/api/admin/logout', { method: 'POST' });
    } catch {
      // I ako mrežni poziv padne, ipak forsiramo redirect — httpOnly
      // cookie ima svoj 8h hard-cap kao posljednju liniju odbrane, ali ne
      // treba da čekamo mrežni odgovor da bismo maknuli osoblje sa
      // osjetljivog ekrana kad je isteklo vrijeme neaktivnosti.
    }
    window.location.href = '/admin/login?reason=idle';
  }, []);

  useEffect(() => {
    if (!enabled) return;

    const clearAll = () => {
      clearTimeout(idleTimerRef.current);
      clearTimeout(warnTimerRef.current);
      clearInterval(countdownRef.current);
    };

    const scheduleWarning = () => {
      setSecondsLeft(null);
      warnTimerRef.current = setTimeout(() => {
        let remaining = Math.round(warningMs / 1000);
        setSecondsLeft(remaining);
        countdownRef.current = setInterval(() => {
          remaining -= 1;
          setSecondsLeft(remaining > 0 ? remaining : 0);
        }, 1000);
      }, Math.max(idleMs - warningMs, 0));

      idleTimerRef.current = setTimeout(doLogout, idleMs);
    };

    const reset = () => {
      clearAll();
      scheduleWarning();
    };

    const activityEvents: (keyof WindowEventMap)[] = [
      'mousedown', 'mousemove', 'touchstart', 'keydown', 'click', 'scroll', 'wheel',
    ];
    activityEvents.forEach((evt) =>
      window.addEventListener(evt, reset, { passive: true }),
    );

    reset(); // pokreni odmah pri mount-u

    return () => {
      clearAll();
      activityEvents.forEach((evt) => window.removeEventListener(evt, reset));
    };
  }, [enabled, idleMs, warningMs, doLogout]);

  return { secondsLeft };
}
