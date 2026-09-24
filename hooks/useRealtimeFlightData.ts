// // hooks/useRealtimeFlightData.ts
// 'use client';

// import { useEffect, useRef, useState } from 'react';
// import * as Ably from 'ably';
// import type { FlightData } from '@/types/flight';

// const EMERGENCY_CACHE_KEY = 'flight_board_emergency_v2';

// const saveEmergencyCache = (data: FlightData) => {
//   try { localStorage.setItem(EMERGENCY_CACHE_KEY, JSON.stringify({ data, timestamp: Date.now() })); }
//   catch { /* quota exceeded */ }
// };

// const loadEmergencyCache = (): FlightData | null => {
//   try {
//     const raw = localStorage.getItem(EMERGENCY_CACHE_KEY);
//     if (!raw) return null;
//     const { data, timestamp } = JSON.parse(raw);
//     return Date.now() - timestamp > 60 * 60_000 ? null : data; // vrijedi 1h
//   } catch { return null; }
// };

// // Dijeljena Ably konekcija po tabu — ista instanca koju koriste i
// // useRealtimeDeskStatus i useRealtimeAssignments, tako da svaki
// // ekran (ili admin panel) drži samo JEDNU aktivnu Ably konekciju,
// // bez obzira koliko realtime hookova koristi istovremeno.
// let sharedAbly: Ably.Realtime | null = null;
// function getSharedAbly(): Ably.Realtime {
//   if (!sharedAbly) {
//     sharedAbly = new Ably.Realtime({ authUrl: '/api/ably-token', autoConnect: true });
//   }
//   return sharedAbly;
// }

// export function useRealtimeFlightData() {
//   const [data, setData] = useState<FlightData | null>(null);
//   const [connectionState, setConnectionState] = useState<'connecting' | 'connected' | 'disconnected'>('connecting');
//   const mountedRef = useRef(true);

//   useEffect(() => {
//     mountedRef.current = true;

//     // ── 1. Snapshot odmah (ne čekaj prvu Ably poruku) ──────────
//     fetch('/api/flights/snapshot')
//       .then(res => res.json())
//       .then((snapshot: FlightData) => {
//         if (!mountedRef.current) return;
//         setData(snapshot);
//         saveEmergencyCache(snapshot);
//       })
//       .catch(() => {
//         const cached = loadEmergencyCache();
//         if (cached && mountedRef.current) setData(cached);
//       });

//     // ── 2. Ably konekcija za sve buduće promjene ────────────────
//     const ably = getSharedAbly();

//     const onConnected    = () => mountedRef.current && setConnectionState('connected');
//     const onDisconnected = () => mountedRef.current && setConnectionState('disconnected');
//     const onSuspended    = () => mountedRef.current && setConnectionState('disconnected');

//     ably.connection.on('connected', onConnected);
//     ably.connection.on('disconnected', onDisconnected);
//     ably.connection.on('suspended', onSuspended);

//     const channel = ably.channels.get('flights:combined');
//     const handler = (msg: Ably.Message) => {
//       if (!mountedRef.current) return;
//       const newData = msg.data as FlightData;
//       setData(newData);
//       saveEmergencyCache(newData);
//     };
//     channel.subscribe('update', handler);

//     return () => {
//       mountedRef.current = false;
//       channel.unsubscribe('update', handler);
//       ably.connection.off('connected', onConnected);
//       ably.connection.off('disconnected', onDisconnected);
//       ably.connection.off('suspended', onSuspended);
//       // Napomena: NE zatvaramo 'ably' konekciju ovdje jer je dijeljena
//       // (sharedAbly) — druge komponente na istoj stranici je možda
//       // i dalje koriste. Zatvara se samo kad se cijeli tab/prozor zatvori.
//     };
//   }, []);

//   return { data, connectionState };
// }
// hooks/useRealtimeFlightData.ts
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import * as Ably from 'ably';
import type { FlightData } from '@/types/flight';

const EMERGENCY_CACHE_KEY = 'flight_board_emergency_v2';

const saveEmergencyCache = (data: FlightData) => {
  try { localStorage.setItem(EMERGENCY_CACHE_KEY, JSON.stringify({ data, timestamp: Date.now() })); }
  catch { /* quota exceeded */ }
};

const loadEmergencyCache = (): FlightData | null => {
  try {
    const raw = localStorage.getItem(EMERGENCY_CACHE_KEY);
    if (!raw) return null;
    const { data, timestamp } = JSON.parse(raw);
    return Date.now() - timestamp > 60 * 60_000 ? null : data; // vrijedi 1h
  } catch { return null; }
};

import { getSharedAbly, reportDynamicNightMode, type AblyClientRole } from '@/lib/ably-client';
import { isNightHours } from '@/lib/night-hours';

// ── Fallback polling — aktivan SAMO kad Ably nije 'connected' I nije
// namjerno u noćnom režimu ('night-sleep' — vidi lib/ably-client.ts).
// Bez ovog razlikovanja, fallback bi pollovao na 20s cijelu noć na svih
// 41 kiosku čim bismo počeli namjerno zatvarati konekciju noću —
// poništilo bi cijelu uštedu.
// FIX (po zahtjevu — isti razlog i računica kao u
// hooks/useRealtimeAssignments.ts, vidi opširan komentar tamo).
const FALLBACK_POLL_INTERVAL_MS = 5_000;
// FIX (po zahtjevu — dodatno smanjenje Edge Requests, isti razlog kao
// hooks/useRealtimeAssignments.ts, vidi opširan komentar tamo).
const FALLBACK_POLL_MAX_MS = 60_000;

export function useRealtimeFlightData(role: AblyClientRole) {
  const [data, setData] = useState<FlightData | null>(null);
  const [connectionState, setConnectionState] = useState<'connecting' | 'connected' | 'disconnected' | 'night-sleep'>('connecting');
  const mountedRef = useRef(true);

  const fetchSnapshot = useCallback(() => {
    // cache: 'no-store' — vidi napomenu u useRealtimeAssignments.ts.
    // Sprečava browser HTTP keš da servira stale flight podatke pri
    // remount-u komponente (npr. admin logout/login).
    fetch('/api/flights/snapshot', { cache: 'no-store' })
      .then(res => res.json())
      .then((snapshot: FlightData) => {
        if (!mountedRef.current) return;
        // Ne prepisuj noviji podatak (npr. onaj koji je upravo stigao
        // preko Ably-ja) starijim REST snapshot-om koji je mrežno kasnio.
        setData(prev => {
          if (prev?.lastUpdated && snapshot?.lastUpdated && snapshot.lastUpdated < prev.lastUpdated) {
            return prev;
          }
          return snapshot;
        });
        saveEmergencyCache(snapshot);
        // FIX (po zahtjevu — dinamički noćni režim): javi ably-client.ts
        // najnoviju server-računatu vrijednost (statička ILI dinamička,
        // vidi computeDynamicNightMode u lib/flight-data-service.ts) —
        // nightWatcherTick() je koristi da zna da li da zatvori
        // konekciju i PRIJE fiksnog sezonskog prozora.
        reportDynamicNightMode(!!snapshot?.isNightMode);
      })
      .catch(() => {
        const cached = loadEmergencyCache();
        if (cached && mountedRef.current) setData(cached);
      });
  }, []);

  useEffect(() => {
    mountedRef.current = true;

    // ── 1. Snapshot odmah (ne čekaj prvu Ably poruku) ──────────
    fetchSnapshot();

    // ── 2. Ably konekcija za sve buduće promjene ────────────────
    const ably = getSharedAbly(role);

    const onConnected    = () => {
      if (!mountedRef.current) return;
      setConnectionState('connected');
      // ── v4 FIX: re-fetch snapshot nakon (re)connect-a ──
      fetchSnapshot();
    };
    const onDisconnected = () => mountedRef.current && setConnectionState('disconnected');
    const onSuspended    = () => mountedRef.current && setConnectionState('disconnected');
    // ── Noćni režim: 'closed' event pokriva i namjerni night-close
    // (lib/ably-client.ts nightWatcherTick) i bilo koji drugi razlog da se
    // konekcija zatvori. Ako JESTE noć, tretiraj kao night-sleep (ne
    // budi fallback polling); ako NIJE noć (neočekivan close van noćnog
    // prozora), tretiraj kao disconnected da fallback i dalje štiti.
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
    // useRealtimeAssignments, ne želimo ostati zaglavljeni na 'connecting').
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
      // Tab otvoren usred noći (ili remount dok je konekcija u night-sleep) —
      // odmah prikaži night-sleep umjesto da ostane zaglavljen na 'connecting'
      // (što bi pogrešno pokrenulo 20s fallback polling cijelu noć).
      queueMicrotask(() => {
        if (mountedRef.current) setConnectionState('night-sleep');
      });
    }

    const channel = ably.channels.get('flights:combined');
    const handler = (msg: Ably.Message) => {
      if (!mountedRef.current) return;
      const newData = msg.data as FlightData;
      setData(newData);
      saveEmergencyCache(newData);
      // FIX (po zahtjevu — dinamički noćni režim, vidi opširan
      // komentar iznad kod fetchSnapshot).
      reportDynamicNightMode(!!newData?.isNightMode);
    };
    channel.subscribe('update', handler);

    return () => {
      mountedRef.current = false;
      channel.unsubscribe('update', handler);
      ably.connection.off('connected', onConnected);
      ably.connection.off('disconnected', onDisconnected);
      ably.connection.off('suspended', onSuspended);
      ably.connection.off('closed', onClosed);
      // Napomena: NE zatvaramo 'ably' konekciju ovdje jer je dijeljena
      // (sharedAbly) — druge komponente na istoj stranici je možda
      // i dalje koriste. Zatvara se samo kad se cijeli tab/prozor zatvori.
    };
  }, [role, fetchSnapshot]);

  // ── 3. Fallback polling kad Ably nije konektovan I nije night-sleep ──
  // FIX (po zahtjevu — eksponencijalni backoff, vidi opširan komentar
  // uz FALLBACK_POLL_MAX_MS): rekurzivan setTimeout lanac umjesto
  // fiksnog setInterval-a — svaki naredni poziv duplira čekanje.
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
  }, [connectionState, fetchSnapshot]);

  // FIX (po zahtjevu — letovi MORAJU se osvježavati svakih 3-4 minuta,
  // garantovano): fetchSnapshot je već postojala INTERNO (koristi se za
  // početni snapshot, re-fetch nakon reconnect-a, i fallback polling) —
  // sad se izlaže i SPOLJA kao 'refetch', da stranice koje koriste ovaj
  // hook mogu da pokrenu STVARAN, garantovan refresh (ne samo provjeru
  // dostupnosti) na sopstvenom, dodatnom rasporedu — bez obzira na Ably
  // stanje konekcije. Ne mijenja ništa za postojeće potrošače koji ovu
  // vrijednost ne koriste.
  return { data, connectionState, refetch: fetchSnapshot };
}