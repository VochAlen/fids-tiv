// hooks/useKioskSupervisor.ts
'use client';

import { useEffect, useRef } from 'react';
import { setKioskInfo, isBuildStale, type KioskView } from '@/lib/kiosk-beacon';
import { getPodgoricaDateString, getPodgoricaMinutesOfDay } from '@/lib/night-hours';

// Nadzornik kioska — isti u Chromeu i u Electron klijentu (čisto web, bez ikakve izmjene exe-a).
//  1) prijavljuje serveru ko je ovaj monitor i šta prikazuje (uz postojeći reconcile fetch, vidi lib/kiosk-beacon.ts);
//  2) dnevni samoreload oko 04:00 po aerodromskom vremenu (pomak 0–20 min po monitoru): čisti curenje memorije i sav
//     akumulirani state, bez Task Schedulera i bez restarta aplikacije;
//  3) osvježavanje poslije deploya: kad server javi drugi BUILD_ID, stranica se sama reloaduje čim je ekran idle
//     (ili najkasnije za 30 min, i najviše jednom u 15 min — da se nikad ne napravi petlja).
const DAILY_TARGET_MIN = 4 * 60;
const DAILY_WINDOW_MIN = 10;
const MIN_PAGE_AGE_MS = 60 * 60_000;
const STALE_MAX_WAIT_MS = 30 * 60_000;
const BUILD_RELOAD_COOLDOWN_MS = 15 * 60_000;
const CHECK_INTERVAL_MS = 30_000;

const DAILY_KEY = '__kiosk_daily_reload__';
const BUILD_RELOAD_KEY = '__kiosk_build_reload_at__';

/** Stabilan pomak 0–20 min iz id-a monitora (da se svi ne osvježe istovremeno). */
export function dailyJitterMinutes(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h % 21;
}

/** true ako je sada prozor dnevnog reload-a za ovaj monitor (čista funkcija, testirana). */
export function inDailyWindow(minutesOfDay: number, id: string): boolean {
  const start = DAILY_TARGET_MIN + dailyJitterMinutes(id);
  return minutesOfDay >= start && minutesOfDay < start + DAILY_WINDOW_MIN;
}

export function useKioskSupervisor(opts: { id: string; view: KioskView; flight: string; reload: (reason: string) => void }) {
  const { id, view, flight } = opts;
  const reloadRef = useRef(opts.reload);
  const viewRef = useRef(view);
  useEffect(() => { reloadRef.current = opts.reload; }, [opts.reload]);
  useEffect(() => { viewRef.current = view; }, [view]);

  // id se postavlja ODMAH pri renderu (idempotentno), da već PRVI fetch iz useRealtimeAssignments (koji se pokreće u efektu
  // iste komponente) nosi beacon; stanje (view/flight) se dopunjuje u efektu ispod.
  setKioskInfo({ id });
  useEffect(() => { setKioskInfo({ id, view, flight }); }, [id, view, flight]);

  useEffect(() => {
    let staleSince = 0;
    const tick = () => {
      try {
        // 2) dnevni reload
        const pageAge = performance.now();
        if (pageAge > MIN_PAGE_AGE_MS && inDailyWindow(getPodgoricaMinutesOfDay(), id)) {
          const today = getPodgoricaDateString();
          if (sessionStorage.getItem(DAILY_KEY) !== today) {
            sessionStorage.setItem(DAILY_KEY, today);
            reloadRef.current('daily 04:00');
            return;
          }
        }
        // 3) novi deploy
        if (isBuildStale()) {
          if (!staleSince) staleSince = Date.now();
          const waited = Date.now() - staleSince;
          const calm = viewRef.current === 'idle' || viewRef.current === 'closed';
          const last = parseInt(sessionStorage.getItem(BUILD_RELOAD_KEY) || '0', 10) || 0;
          if ((calm || waited > STALE_MAX_WAIT_MS) && waited > 20_000 && Date.now() - last > BUILD_RELOAD_COOLDOWN_MS) {
            sessionStorage.setItem(BUILD_RELOAD_KEY, String(Date.now()));
            reloadRef.current('new-build');
          }
        } else {
          staleSince = 0;
        }
      } catch { /* nadzor nikad ne smije praviti probleme */ }
    };
    const timer = setInterval(tick, CHECK_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [id]);
}
