// hooks/useIdleLogout.ts
'use client';

import { useEffect, useRef } from 'react';

/**
 * v4.2 FIX: Activity-based idle logout.
 *
 * Ranije: logout se okinuo ODMAH čim tab ode u pozadinu
 * (visibilitychange → hidden). To je bilo preagresivno — osoblje
 * koje prebaci na drugu aplikaciju na par sekundi (npr. provjeri
 * notifikaciju) bi bilo odjavljeno.
 *
 * Sad: timer se resetuje na SVAKU korisničku aktivnost (mousemove,
 * keydown, click, scroll, touchstart). Logout se dešava tek poslije
 * `timeoutMs` (5 min) potpune neaktivnosti — nema pokreta, klikova,
 * tipkanja, scroll-a.
 *
 * visibilitychange se i dalje prati, ali samo kao DODATNI signal —
 * kad tab ode u pozadinu, timer NE staje (broji dalje). Ako korisnik
 * ne radi ništa 5 min u pozadinskom tabu, logout se dešava.
 *
 * Ako korisnik se vrati na tab prije isteka 5 min, timer se resetuje
 * na prvimousemove/click i sesija nastavlja.
 */
export function useIdleLogout(
  onIdle: () => void,
  timeoutMs: number,
  enabled: boolean = true,
) {
  const onIdleRef = useRef(onIdle);
  // FIX (KRITIČNO — pravi React anti-pattern, otkriven kroz sveobuhvatnu
  // analizu): mutacija ref-a DIREKTNO u tijelu komponente (van
  // useEffect-a) je bila ovdje. React refs ne bi trebalo mijenjati
  // tokom render-a — pod React-ovim Concurrent Mode ponašanjem (npr.
  // dvostruko pozivanje render funkcije u StrictMode dev režimu, ili
  // prekinut/odbačen render), ovo može ostaviti ref na zastarjeloj
  // vrijednosti. Premješteno u useEffect — standardan, siguran obrazac
  // za "uvijek pozovi NAJNOVIJU verziju callback-a iz tajmera, bez
  // potrebe da se tajmer restartuje kad se callback referenca
  // promijeni". U OVOM konkretnom slučaju (onIdle je već stabilna
  // referenca preko useCallback u pozivaocu) praktičan uticaj je
  // vjerovatno bio nizak — ali je ispravka i dalje vrijedna, ispravna,
  // i budućnosti-otporna promjena.
  useEffect(() => {
    onIdleRef.current = onIdle;
  }, [onIdle]);

  useEffect(() => {
    if (!enabled) return;

    let firedAlready = false;
    let lastActivity = Date.now();
    let timerId: ReturnType<typeof setTimeout>;

    const resetTimer = () => {
      lastActivity = Date.now();
      if (firedAlready) return; // već ispaljeno, ne restartuj
      clearTimeout(timerId);
      timerId = setTimeout(fireOnce, timeoutMs);
    };

    const fireOnce = () => {
      if (firedAlready) return;
      // Provjeri da li je stvarno prošlo timeoutMs od posljednje aktivnosti
      const idleTime = Date.now() - lastActivity;
      if (idleTime < timeoutMs) {
        // Nije prošlo dovoljno — produži timer
        timerId = setTimeout(fireOnce, timeoutMs - idleTime);
        return;
      }
      firedAlready = true;
      onIdleRef.current();
    };

    // ── Aktivnost korisnika resetuje timer ──
    const events: (keyof WindowEventMap)[] = [
      'mousemove', 'mousedown', 'keydown', 'click', 'scroll', 'touchstart', 'wheel',
    ];

    events.forEach(evt => {
      window.addEventListener(evt, resetTimer, { passive: true });
    });

    // ── visibilitychange — ne odjavljuj odmah, samo označi aktivnost ──
    // Kad se tab vrati u foreground, to je "aktivnost" — timer se resetuje.
    const handleVisibility = () => {
      if (!document.hidden) {
        // Tab se vratio u foreground → korisnik je aktivan
        resetTimer();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    // ── Inicijalni timer ──
    timerId = setTimeout(fireOnce, timeoutMs);

    return () => {
      clearTimeout(timerId);
      events.forEach(evt => {
        window.removeEventListener(evt, resetTimer);
      });
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [timeoutMs, enabled]);
}
