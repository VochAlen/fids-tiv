// hooks/useKioskSupervisor.ts
'use client';

import { useEffect, useRef } from 'react';
import { setKioskInfo, isBuildStale, KIOSK_CMD_CHANNEL, KIOSK_CMD_EVENT, type KioskView, type KioskCommand } from '@/lib/kiosk-beacon';
import { getSharedAbly, type AblyClientRole } from '@/lib/ably-client';
import { nowMs } from '@/lib/server-clock';
import { getPodgoricaDateString, getPodgoricaMinutesOfDay } from '@/lib/night-hours';

// Nadzornik kioska — isti u Chromeu i u Electron klijentu (čisto web, bez ikakve izmjene exe-a).
//  1) prijavljuje serveru ko je ovaj monitor i šta prikazuje (uz postojeći reconcile fetch, vidi lib/kiosk-beacon.ts);
//  2) dnevni samoreload oko 04:00 po aerodromskom vremenu (pomak 0–20 min po monitoru): čisti curenje memorije i sav
//     akumulirani state, bez Task Schedulera i bez restarta aplikacije;
//  4) daljinski restart sa /admin/health (poruka 'kiosk-cmd' na već postojećem kanalu flights:combined, ciljana po id-u monitora):
//     Electron sa novim main.js/preload.js restartuje cijelu aplikaciju, ostali (Chrome, stariji Electron) reloaduju stranicu;
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
const CMD_NONCE_KEY = '__kiosk_cmd_nonce__';

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

export function useKioskSupervisor(opts: { id: string; role: AblyClientRole; view: KioskView; flight: string; reload: (reason: string) => void }) {
  const { id, role, view, flight } = opts;
  const reloadRef = useRef(opts.reload);
  const viewRef = useRef(view);
  useEffect(() => { reloadRef.current = opts.reload; }, [opts.reload]);
  useEffect(() => { viewRef.current = view; }, [view]);

  // id se postavlja ODMAH pri renderu (idempotentno), da već PRVI fetch iz useRealtimeAssignments (koji se pokreće u efektu
  // iste komponente) nosi beacon; stanje (view/flight) se dopunjuje u efektu ispod.
  setKioskInfo({ id });
  useEffect(() => { setKioskInfo({ id, view, flight }); }, [id, view, flight]);

  // 4) daljinske komande (nema ni periodičnih zahtjeva ni novih kanala: samo slušanje poruke na kanalu koji kiosk već ima)
  useEffect(() => {
    let ch: ReturnType<ReturnType<typeof getSharedAbly>['channels']['get']> | null = null;
    const handler = (msg: { data?: unknown }) => {
      try {
        const d = msg.data as Partial<KioskCommand> | null;
        if (!d || d.id !== id || d.cmd !== 'restart' || typeof d.ts !== 'number' || typeof d.nonce !== 'string') return;
        if (Math.abs(nowMs() - d.ts) > 120_000) return; // stara komanda
        if (sessionStorage.getItem(CMD_NONCE_KEY) === d.nonce) return; // već izvršena
        sessionStorage.setItem(CMD_NONCE_KEY, d.nonce);
        const api = (window as unknown as { electronAPI?: { restartApp?: () => void } }).electronAPI;
        if (typeof api?.restartApp === 'function') {
          api.restartApp();
          // ako IPC iz nekog razloga ne odradi restart, reloaduj stranicu (ako se aplikacija restartuje, ovaj tajmer nestaje s njom)
          setTimeout(() => reloadRef.current('remote-restart-fallback'), 20_000);
        } else {
          reloadRef.current('remote-reload');
        }
      } catch { /* komanda nikad ne smije srušiti stranicu */ }
    };
    try {
      ch = getSharedAbly(role).channels.get(KIOSK_CMD_CHANNEL);
      ch.subscribe(KIOSK_CMD_EVENT, handler)?.catch(() => {});
    } catch { /* bez Ably-ja nema daljinskih komandi, ostalo radi */ }
    return () => {
      try { ch?.unsubscribe(KIOSK_CMD_EVENT, handler); } catch { /* ignore */ }
    };
  }, [id, role]);

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
