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
// NOVO (po zahtjevu — vidi opširan komentar uz RECONCILE_INTERVAL_MS u
// hooks/useRealtimeAssignments.ts za pun kontekst, isti razlog
// primijenjen ovdje): ovaj hook koriste SVI kiosk ekrani (checkin,
// gate, departures, arrivals, combined, border, baggage, split-board,
// pa), ali SAMO assign-checkin/page.tsx trenutno poziva izloženi
// `refetch` na sopstvenom rasporedu (3.5 min) — svi OSTALI potrošači
// (sami kiosk ekrani) NISU imali nijednu zaštitu od izgubljene Ably
// poruke o promjeni leta dok je konekcija naizgled stabilna. Ugrađeno
// direktno ovdje, bezuslovno, da SVI potrošači automatski dobiju istu
// sigurnosnu mrežu bez potrebe da svaki pojedinačno implementira
// sopstveni raspored.
const RECONCILE_INTERVAL_MS = 3 * 60_000;

// NOVO (po zahtjevu — "battle-ready" audit check-in stranice, 2026-10-04,
// portovano iz hooks/useRealtimeAssignments.ts, vidi opširan komentar uz
// FETCH_SNAPSHOT_TIMEOUT_MS tamo za pun kontekst): ovaj hook je RANIJE bio
// JEDINI od dva realtime hook-a bez timeout-a na fetch-u, iako ga koriste
// SVI kiosk ekrani (checkin, gate, departures, arrivals, combined, border,
// baggage, split-board, pa) i iako je /api/flights/snapshot teži endpoint
// (veći JSON payload — vidi Vercel Fast Data Transfer metriku) od
// /api/test/assignments. Bez gornje granice, na flaky kiosk mreži je ovaj
// `fetch()` mogao visjeti znatno duže od browser-TCP nivoa, trošeći jednu
// od ograničenog broja paralelnih konekcija ka istom originu dok traje —
// isti rizik je već bio prepoznat i otklonjen u useRealtimeAssignments.ts,
// ova izmjena samo zatvara identičnu rupu i ovdje.
const FETCH_SNAPSHOT_TIMEOUT_MS = 10_000;

export function useRealtimeFlightData(role: AblyClientRole) {
  const [data, setData] = useState<FlightData | null>(null);
  const [connectionState, setConnectionState] = useState<'connecting' | 'connected' | 'disconnected' | 'night-sleep'>('connecting');
  const mountedRef = useRef(true);
  // NOVO — isti razlog kao inFlightRef u useRealtimeAssignments.ts: ovaj
  // fetch se poziva iz više nezavisnih mehanizama (initial mount, Ably
  // reconnect, fallback poll, 3-min reconciliation, i eksplicitni
  // `refetch()` poziv sa strane stranice) — bez dedup-a bi se na
  // degradiranoj mreži mogli nagomilati paralelni pozivi ka istom
  // endpoint-u. Čisto optimizacija mrežnog saobraćaja, ne mijenja logiku
  // "ne prepisuj noviji podatak starijim" ispod.
  const inFlightRef = useRef(false);

  const fetchSnapshot = useCallback(() => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;

    // NOVO — AbortController osigurava da zahtjev koji visi na flaky
    // mreži bude prekinut najkasnije nakon 10s, umjesto da se osloni na
    // (znatno duži, nepredvidiv) OS/browser TCP timeout — vidi opširan
    // komentar uz FETCH_SNAPSHOT_TIMEOUT_MS iznad.
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_SNAPSHOT_TIMEOUT_MS);

    // cache: 'no-store' — vidi napomenu u useRealtimeAssignments.ts.
    // Sprečava browser HTTP keš da servira stale flight podatke pri
    // remount-u komponente (npr. admin logout/login).
    fetch('/api/flights/snapshot', { cache: 'no-store', signal: controller.signal })
      .then(res => {
        // NOVO — eksplicitna provjera HTTP statusa, isti razlog kao
        // useRealtimeAssignments.ts: bez ovoga bi npr. 500 odgovor sa
        // praznim/neočekivanim tijelom mogao tiho "proći" umjesto da
        // završi u catch-u (i aktivira emergency cache fallback) ispod.
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<FlightData>;
      })
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
        // Ne dirati emergency cache ovdje na AbortError od timeout-a
        // iznad niti na bilo koji drugi fail — isto ponašanje kao prije,
        // samo sad pokriva i timeout slučaj.
        const cached = loadEmergencyCache();
        if (cached && mountedRef.current) setData(cached);
      })
      .finally(() => {
        clearTimeout(timeoutId);
        inFlightRef.current = false;
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
      // FIX (KRITIČNO — pronađeno pri ponovnoj analizi osnovnog problema,
      // 2026-09-28): `fetchSnapshot` iznad VEĆ ima zaštitu od prepisivanja
      // novijeg podatka starijim REST snapshot-om koji je mrežno kasnio
      // (poređenje po `lastUpdated`) — ALI ovaj Ably handler je ISTU
      // vrstu podatka (cijeli `flights:combined` blob, uključujući
      // `StatusEN` za svaki let) primjenjivao BEZUSLOVNO, bez ikakvog
      // poređenja. Ably garantuje redoslijed poruka PO KANALU u normalnim
      // uslovima, ali NE i pri resume/reconnect ciklusima (vidi noćni
      // watcher u lib/ably-client.ts, koji namjerno zatvara/otvara ovu
      // istu konekciju) — ako bi ikad stigla ZASTARJELA poruka poslije
      // svježije (npr. isporuka odgođena tokom kratkog mrežnog prekida,
      // pa stigne tek nakon što je REST fetchSnapshot već primijenio
      // noviju verziju), let koji je u MEĐUVREMENU poletio bi se ovom
      // porukom vratio na stari status (npr. "Scheduled") — a upravo na
      // taj status/StatusEN se oslanja "sakrij let koji je poletio"
      // zaštita u CheckInPageClient.tsx/GatePageClient.tsx. Ista zaštita
      // kao kod fetchSnapshot: primijeni SAMO ako incoming nije stariji
      // od trenutno prikazanog stanja.
      setData(prev => {
        if (prev?.lastUpdated && newData?.lastUpdated && newData.lastUpdated < prev.lastUpdated) {
          return prev;
        }
        return newData;
      });
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
  // NOVO — periodičan reconciliation fetch, radi UVIJEK (vidi opširan
  // komentar uz RECONCILE_INTERVAL_MS).
  useEffect(() => {
    const id = setInterval(fetchSnapshot, RECONCILE_INTERVAL_MS);
    return () => clearInterval(id);
  }, [fetchSnapshot]);

  return { data, connectionState, refetch: fetchSnapshot };
}