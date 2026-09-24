// // hooks/useRealtimeAssignments.ts
// 'use client';

// import { useEffect, useState } from 'react';
// import * as Ably from 'ably';

// export type AssignmentEntry = {
//   status: 'open' | 'closed' | null;
//   flightNumber: string;
//   classType: string | null;
//   setAt: number | null;
// };

// let sharedAbly: Ably.Realtime | null = null;
// function getSharedAbly(): Ably.Realtime {
//   if (!sharedAbly) {
//     sharedAbly = new Ably.Realtime({ authUrl: '/api/ably-token', autoConnect: true });
//   }
//   return sharedAbly;
// }

// export function useRealtimeAssignments() {
//   const [deskEntries, setDeskEntries] = useState<Record<string, AssignmentEntry>>({});
//   const [gateEntries, setGateEntries] = useState<Record<string, AssignmentEntry>>({});
//   const [connectionState, setConnectionState] = useState<'connecting' | 'connected' | 'disconnected'>('connecting');

//   useEffect(() => {
//     let mounted = true;

//     // ── 1. Snapshot odmah ──
//     fetch('/api/test/assignments')
//       .then(res => res.json())
//       .then((data: { deskEntries?: Record<string, AssignmentEntry>; gateEntries?: Record<string, AssignmentEntry> }) => {
//         if (!mounted) return;
//         setDeskEntries(data.deskEntries ?? {});
//         setGateEntries(data.gateEntries ?? {});
//       })
//       .catch(() => { /* ostani prazan */ });

//     // ── 2. Realtime delte — ispravan mehanizam sa dva odvojena kanala ──
//     const ably = getSharedAbly();
//     ably.connection.on('connected',    () => mounted && setConnectionState('connected'));
//     ably.connection.on('disconnected', () => mounted && setConnectionState('disconnected'));
//     ably.connection.on('suspended',    () => mounted && setConnectionState('disconnected'));

//     const deskChannel = ably.channels.get('assignments:desks');
//     const gateChannel = ably.channels.get('assignments:gates');

//     const onDeskMsg = (msg: Ably.Message) => {
//       if (!mounted) return;
//       const { deskNumber, entry } = msg.data as { deskNumber: string; entry: AssignmentEntry };
//       setDeskEntries(prev => ({ ...prev, [deskNumber]: entry }));
//     };
//     const onGateMsg = (msg: Ably.Message) => {
//       if (!mounted) return;
//       const { gateNumber, entry } = msg.data as { gateNumber: string; entry: AssignmentEntry };
//       setGateEntries(prev => ({ ...prev, [gateNumber]: entry }));
//     };

//     deskChannel.subscribe(onDeskMsg);
//     gateChannel.subscribe(onGateMsg);

//     return () => {
//       mounted = false;
//       deskChannel.unsubscribe(onDeskMsg);
//       gateChannel.unsubscribe(onGateMsg);
//     };
//   }, []);

//   return { deskEntries, gateEntries, connectionState };
// }
// hooks/useRealtimeAssignments.ts
'use client';

import { useEffect, useRef, useState } from 'react';
import * as Ably from 'ably';

export type AssignmentEntry = {
  status: 'open' | 'closed' | null;
  flightNumber: string;
  classType: string | null;
  setAt: number | null;
  // FIX (KRITIČNO — pravi uzrok prijavljenog "brzo uklonim pa odmah
  // dodijelim novi let, novi se ne prikaže"): portovano sa servera —
  // vidi opširan komentar uz DeskEntry.seq u
  // app/api/test/desk-status-override/route.ts za pun kontekst. mergeOne/
  // mergeNewer ispod sad porede po seq (strogo rastući, imun na
  // varijacije brzine obrade između serverless poziva), ne po setAt
  // (wall-clock, nepouzdan za ovu svrhu pod brzim uzastopnim akcijama).
  seq: number;
};

type AssignmentsResponse = {
  deskEntries?: Record<string, AssignmentEntry>;
  gateEntries?: Record<string, AssignmentEntry>;
};

import { getSharedAbly, type AblyClientRole } from '@/lib/ably-client';
import { isNightHours } from '@/lib/night-hours';

// ── Merge helper — NIKAD ne prepisuj noviji zapis starijim.
// Sprečava race condition gdje REST snapshot (koji je krenuo prije
// Ably poruke ali mrežno kasnije stigne) prepiše svježe stanje koje
// je već stiglo preko Ably-ja. Isto štiti i od Ably poruka koje bi
// eventualno stigle van reda (reconnect/resume scenariji). ──────────
function mergeNewer(
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

function mergeOne(
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

// ── Fallback polling — aktivan SAMO kad Ably nije 'connected' I nije
// namjerno u noćnom režimu ('night-sleep' — vidi lib/ably-client.ts).
// Ovo je sigurnosna mreža za slučaj da WebSocket konekcija padne na
// duže (blokirana mreža na kiosku, Ably regionalni incident i sl.),
// da ekran ne ostane zaglavljen na starom stanju satima. ────────────
// FIX (po zahtjevu — prijavljeno kašnjenje 15-30s pri uklanjanju
// dodjele šaltera): 20s je bio predugačak worst-case prozor za
// oporavak nakon privremenog Ably "blip"-a na kiosk uređaju (kratak
// mrežni prekid, uobičajen na touchscreen uređajima) — poruka o
// promjeni (npr. uklanjanje/"clear") bi se izgubila, a ekran bi čekao
// do 20s da se sam ponovo uskladi preko ovog fallback poll-a. Skraćeno
// na 5s — direktno smanjuje worst-case kašnjenje 4x, uz zanemarljiv
// dodatni trošak (ovaj poll radi ISKLJUČIVO dok veza NIJE 'connected'/
// 'night-sleep', što treba da bude rijedak, kratkotrajan slučaj u
// normalnom radu).
// FIX (po zahtjevu — dodatno smanjenje Edge Requests ka
// /api/test/assignments): 5s je bio POTREBAN da riješi stvaran, ranije
// prijavljen bug (podatak zastario do 20-30s nakon uklanjanja dodjele)
// — ali ako veza ostane prekinuta DUŽE (stvarni, produženiji mrežni
// ispad, ne kratak "blip"), bombardovanje na SVAKIH 5s je nepotrebno
// skupo bez stvarne koristi (korisnik ionako ne vidi svježe podatke
// dok je veza dole). Eksponencijalni backoff: prvi pokušaj i dalje na
// 5s (brz oporavak za kratke prekide), svaki naredni PRODUŽEN pokušaj
// duplira interval do FALLBACK_POLL_MAX_MS, resetuje se na 5s ČIM se
// veza vrati (effect se iznova pokreće na svaku promjenu
// connectionState-a).
const FALLBACK_POLL_INTERVAL_MS = 5_000;
const FALLBACK_POLL_MAX_MS = 60_000;

export function useRealtimeAssignments(role: AblyClientRole) {
  const [deskEntries, setDeskEntries] = useState<Record<string, AssignmentEntry>>({});
  const [gateEntries, setGateEntries] = useState<Record<string, AssignmentEntry>>({});
  const [connectionState, setConnectionState] = useState<'connecting' | 'connected' | 'disconnected' | 'night-sleep'>('connecting');
  const mountedRef = useRef(true);

  const fetchSnapshot = () => {
    // cache: 'no-store' je NAMJERNO — ruta /api/test/assignments ima
    // Cache-Control (max-age=15, s-maxage=25, stale-while-revalidate=30)
    // koji je ispravan za CDN/kioske, ali bez ovoga bi admin panel
    // mogao dobiti stale podatak iz browser HTTP keša pri svakom
    // remount-u (npr. nakon logout/login), umjesto svježeg stanja.
    fetch('/api/test/assignments', { cache: 'no-store' })
      .then(res => res.json())
      .then((data: AssignmentsResponse) => {
        if (!mountedRef.current) return;
        setDeskEntries(prev => mergeNewer(prev, data.deskEntries ?? {}));
        setGateEntries(prev => mergeNewer(prev, data.gateEntries ?? {}));
      })
      .catch(() => { /* ostani na trenutnom stanju */ });
  };

  useEffect(() => {
    mountedRef.current = true;

    // ── 1. Snapshot odmah pri mount-u ──
    fetchSnapshot();

    // ── 2. Realtime delte — dva odvojena kanala ──
    const ably = getSharedAbly(role);

    const onConnected    = () => {
      if (!mountedRef.current) return;
      setConnectionState('connected');
      // ── v4 FIX: re-fetch snapshot nakon (re)connect-a ──
      // Ako je konekcija pala i ponovo se digla, poruke objavljene
      // tokom ispada su izgubljene. Re-fetch da sinhronizujemo stanje.
      fetchSnapshot();
    };
    const onDisconnected = () => mountedRef.current && setConnectionState('disconnected');
    const onSuspended    = () => mountedRef.current && setConnectionState('disconnected');
    const onClosed = () => {
      if (!mountedRef.current) return;
      setConnectionState(isNightHours() ? 'night-sleep' : 'disconnected');
    };

    ably.connection.on('connected', onConnected);
    ably.connection.on('disconnected', onDisconnected);
    ably.connection.on('suspended', onSuspended);
    ably.connection.on('closed', onClosed);

    // Postavi početno stanje na osnovu trenutnog stanja konekcije
    // (ako je konekcija već uspostavljena od strane drugog hooka, npr.
    // useRealtimeFlightData, ne želimo ostati zaglavljeni na 'connecting').
    // NAPOMENA: setState se NE poziva sinhrono ovdje (React upozorenje —
    // "cascading renders"). queueMicrotask izbacuje poziv iz sinhronog
    // tijela efekta, ponašajući se kao da je stigao kroz event handler.
    if (ably.connection.state === 'connected') {
      queueMicrotask(() => {
        if (mountedRef.current) setConnectionState('connected');
      });
    } else if (
      (ably.connection.state === 'closed' || ably.connection.state === 'initialized') &&
      isNightHours()
    ) {
      queueMicrotask(() => {
        if (mountedRef.current) setConnectionState('night-sleep');
      });
    }

    // ── FIX: pretplati se SAMO na kanale koje ova uloga smije da čita
    // (mora se poklapati sa ROLE_CAPABILITIES u app/api/ably-token/route.ts).
    // Gate ekran nikad ne smije ni pokušati da dotakne assignments:desks
    // (i obrnuto za checkin) — token za tu ulogu nema tu dozvolu, pa bi
    // Ably odbio pretplatu ("Channel denied access based on given
    // capability") čim bi se to pokušalo, bez obzira što je pokušaj
    // bezopasan po namjeri.
    const needsDeskChannel = role === 'checkin' || role === 'board';
    const needsGateChannel = role === 'gate' || role === 'board';

    const deskChannel = needsDeskChannel ? ably.channels.get('assignments:desks') : null;
    const gateChannel = needsGateChannel ? ably.channels.get('assignments:gates') : null;

    const onDeskMsg = (msg: Ably.Message) => {
      if (!mountedRef.current) return;
      const { deskNumber, entry } = msg.data as { deskNumber: string; entry: AssignmentEntry };
      setDeskEntries(prev => mergeOne(prev, deskNumber, entry));
    };
    const onGateMsg = (msg: Ably.Message) => {
      if (!mountedRef.current) return;
      const { gateNumber, entry } = msg.data as { gateNumber: string; entry: AssignmentEntry };
      setGateEntries(prev => mergeOne(prev, gateNumber, entry));
    };

    deskChannel?.subscribe(onDeskMsg);
    gateChannel?.subscribe(onGateMsg);

    return () => {
      mountedRef.current = false;
      deskChannel?.unsubscribe(onDeskMsg);
      gateChannel?.unsubscribe(onGateMsg);
      ably.connection.off('connected', onConnected);
      ably.connection.off('disconnected', onDisconnected);
      ably.connection.off('suspended', onSuspended);
      ably.connection.off('closed', onClosed);
      // Napomena: NE zatvaramo 'ably' konekciju ovdje jer je dijeljena —
      // druge komponente na istoj stranici je možda i dalje koriste.
    };
  }, [role]);

  // ── 3. Fallback polling kad Ably nije konektovan I nije night-sleep ──
  // FIX (po zahtjevu — eksponencijalni backoff, vidi opširan komentar
  // uz FALLBACK_POLL_INTERVAL_MS/FALLBACK_POLL_MAX_MS): setInterval
  // (fiksan razmak) zamijenjen rekurzivnim setTimeout lancem — svaki
  // naredni poziv duplira čekanje, do plafona.
  useEffect(() => {
    if (connectionState === 'connected' || connectionState === 'night-sleep') return;

    let cancelled = false;
    let delay = FALLBACK_POLL_INTERVAL_MS;
    let timeoutId: ReturnType<typeof setTimeout>;

    const tick = () => {
      if (cancelled) return;
      fetchSnapshot();
      delay = Math.min(delay * 2, FALLBACK_POLL_MAX_MS);
      timeoutId = setTimeout(tick, delay);
    };
    timeoutId = setTimeout(tick, delay);

    return () => { cancelled = true; clearTimeout(timeoutId); };
  }, [connectionState]);

  return { deskEntries, gateEntries, connectionState };
}