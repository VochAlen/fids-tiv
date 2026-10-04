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

import { useCallback, useEffect, useRef, useState } from 'react';
import * as Ably from 'ably';

// NOVO — izdvojeno u lib/assignment-merge.ts (vidi opširan komentar
// tamo za pun kontekst) da bi bilo testabilno; hook uvozi ISTI kod.
// Re-eksportovano ispod (export type { AssignmentEntry }) da
// app/admin/assign-checkin/page.tsx i dalje može uvoziti tip odavde,
// bez izmjene tog fajla.
import { mergeNewer, mergeOne, type AssignmentEntry } from '@/lib/assignment-merge';
export type { AssignmentEntry };

type AssignmentsResponse = {
  deskEntries?: Record<string, AssignmentEntry>;
  gateEntries?: Record<string, AssignmentEntry>;
  // NOVO (KRITIČNO — vidi opširan komentar uz `ok` polje u
  // lib/assignments-service.ts): `false` znači da server NIJE uspio
  // pouzdano pročitati stanje (Redis/circuit-breaker problem) — ovaj
  // odgovor NIJE punopravan snapshot i NE SMIJE se koristiti za merge.
  ok?: boolean;
};

import { getSharedAbly, type AblyClientRole } from '@/lib/ably-client';
import { isNightHours } from '@/lib/night-hours';

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
// NOVO (KRITIČNO — treći, arhitektonski uzrok prijavljenog "kiosk se
// ne može zatvoriti", pronađen NAKON dva ranija, uža fixa —
// auto-cleanup bez publish-a i admin panel bez .ok provjere — koji su
// oba bila ispravna i potrebna, ali NISU pokrivala ovaj scenario):
// fallback polling iznad radi ISKLJUČIVO dok connectionState nije
// 'connected' — ako je Ably konekcija STABILNA, a SAMO JEDNA,
// pojedinačna Ably poruka se izgubi (rijedak mrežni packet loss, Ably
// push je "best effort" po svakoj pojedinačnoj poruci, ne formalna
// garancija), kiosk NEMA nijedan drugi mehanizam da se ponovo
// sinhronizuje — ostaje ZAUVIJEK zaglavljen na starom stanju, jer
// misli da je "povezan" i nikad ne pokreće fallback fetch. Server i
// REST API su ISPRAVNI u tom trenutku (Redis je ažuran) — kiosk
// jednostavno nikad ne pita ponovo. Ovaj periodičan "reconciliation"
// fetch radi UVIJEK, nezavisno od connectionState-a, kao dodatna
// sigurnosna mreža — čak i u najgorem slučaju (izgubljena poruka),
// kiosk se sam ispravi u roku od najviše RECONCILE_INTERVAL_MS.
// 3 min je balans: dovoljno rijetko da ne dodaje značajan trošak
// (Edge Requests optimizacija ranije ove sesije), dovoljno često da
// "zaglavljeno" stanje nikad ne traje predugo u praksi.
const RECONCILE_INTERVAL_MS = 3 * 60_000;

// NOVO (po predlogu — 2026-10-04): `fetchSnapshot` ranije nije imao
// nikakav timeout/prekid — na flaky kiosk mreži, `fetch()` bez
// `AbortController`-a može visjeti znatno duže od browser-TCP nivoa
// (desetinama sekundi do par minuta, zavisno od OS-a), a ISTI endpoint
// (`/api/test/assignments`) se poziva iz VIŠE nezavisnih mehanizama
// odjednom (initial mount, Ably reconnect, fallback poll, 3-min
// reconciliation, i "zatvoreno u 20s" watchdog u CheckInPageClient.tsx
// preko `refetch`-a) — bez gornje granice, na degradiranoj mreži se
// mogu nagomilati višestruki paralelni "zaglavljeni" zahtjevi,
// trošeći ograničen broj paralelnih konekcija ka istom originu (što bi
// moglo usporiti/odgoditi i DRUGE, kritičnije mrežne pozive, npr. Ably
// token fetch). 10s je namjerno KRAĆE od najkraćeg redovnog razmaka
// između poziva (fallback poll na 5s je izuzetak — ali se poziva samo
// dok veza NIJE 'connected', kad kašnjenje ionako nije kritično) —
// tako da se zaglavljen pokušaj stigne prekinuti i osloboditi
// `inFlightRef` PRIJE nego što sledeći redovni ciklus (checkin
// watchdog na 12-15s) i onako pokuša ponovo.
const FETCH_SNAPSHOT_TIMEOUT_MS = 10_000;

export function useRealtimeAssignments(role: AblyClientRole) {
  const [deskEntries, setDeskEntries] = useState<Record<string, AssignmentEntry>>({});
  const [gateEntries, setGateEntries] = useState<Record<string, AssignmentEntry>>({});
  const [connectionState, setConnectionState] = useState<'connecting' | 'connected' | 'disconnected' | 'night-sleep'>('connecting');
  const mountedRef = useRef(true);

  // NOVO (po zahtjevu — prijavljen ponavljajući bug "check-in display
  // se zaglavi na jednom letu i ne može se zatvoriti", jutro 2026-09-27):
  // svi mehanizmi ispod (Ably poruke, fallback poll, 3min reconciliation)
  // TREBALO BI da spriječe ovo — ali ako Ably kanal postane "zombie"
  // (connectionState i dalje javlja 'connected', ali transport tiho ne
  // isporučuje poruke — poznata WebSocket pojava na dugotrajnim
  // kiosk/Electron webview sesijama), NIŠTA od gornjeg to ne detektuje
  // samo po sebi. lastSyncAtRef bilježi vrijeme SVAKOG uspješnog "znaka
  // života" podataka — bilo koji Ably poruka (bez obzira mijenja li
  // ijedan desk/gate) ILI bilo koji uspješan fetchSnapshot round-trip
  // (bez obzira vratio li promjenu). Stranica (npr.
  // CheckInPageClient.tsx) ovo čita preko watchdog-a: ako lastSyncAtRef
  // ne bude dotaknut duže od nekoliko minuta, kanal je zaglavljen bez
  // obzira šta connectionState tvrdi — vrijeme je za kontrolisan reload.
  // FIX (greška — Date.now() se ranije pozivao direktno u useRef
  // inicijalizatoru, što se izvršava TOKOM render-a — React (i React
  // Compiler) ovo prijavljuje kao "Cannot call impure function during
  // render", 2026-10-04): inicijalizuje se na 0 (bezopasno — efekat
  // ispod ga odmah, u prvom "tick"-u nakon mount-a, postavlja na
  // stvaran Date.now(), a prvi uspješan fetchSnapshot/Ably poruka ga
  // i onako postavlja ponovo koji trenutak kasnije). Stvarna vremenska
  // oznaka se sad postavlja ISKLJUČIVO unutar useEffect-a, nikad
  // direktno tokom render-a — isti princip kao `nowMs`/`queueMicrotask`
  // obrazac koji se već koristi na više mjesta u projektu (npr.
  // CheckInPageClient.tsx).
  const lastSyncAtRef = useRef<number>(0);
  useEffect(() => {
    if (lastSyncAtRef.current === 0) lastSyncAtRef.current = Date.now();
  }, []);

  // NOVO (po predlogu — 2026-10-04, vidi opširan komentar uz
  // FETCH_SNAPSHOT_TIMEOUT_MS): sprečava da dva poziva fetchSnapshot-a
  // (npr. reconciliation interval i checkin "zatvoreno u 20s" watchdog)
  // budu istovremeno "u letu" — drugi poziv se tiho preskače dok prvi
  // ne završi (uspješno, grеškom, ili timeout-om). Ovo je ČISTO
  // optimizacija mrežnog saobraćaja — mergeNewer/seq mehanizam već
  // ispravno podnosi i da dva odgovora stignu van reda, pa ovo ne
  // mijenja nikakvu postojeću logiku zatvaranja/otvaranja šaltera.
  const inFlightRef = useRef(false);

  // FIX (po zahtjevu — garantovano zatvaranje check-in šaltera u 20s,
  // 2026-09-29): umotano u useCallback (isti obrazac kao
  // hooks/useRealtimeFlightData.ts) tako da funkcija ima STABILAN
  // identitet kroz rendere — potrebno da bi se mogla bezbjedno izložiti
  // kao `refetch` i koristiti u dependency nizu efekta na strani
  // stranice (npr. brzi "zatvoren u 20s" watchdog u
  // CheckInPageClient.tsx), bez ponovnog kreiranja intervala pri svakom
  // re-renderu.
  const fetchSnapshot = useCallback(() => {
    // Preskoči ako je prethodni poziv i dalje u letu (vidi komentar uz
    // inFlightRef iznad) — izbjegava gomilanje paralelnih zahtjeva ka
    // istom endpoint-u kad se više mehanizama poklopi u vremenu.
    if (inFlightRef.current) return;
    inFlightRef.current = true;

    // NOVO (po predlogu — 2026-10-04, vidi opširan komentar uz
    // FETCH_SNAPSHOT_TIMEOUT_MS): AbortController osigurava da zahtjev
    // koji visi na flaky mreži bude prekinut najkasnije nakon 10s,
    // umjesto da se osloni na (znatno duži, nepredvidiv) OS/browser
    // TCP timeout — i oslobađa inFlightRef da naredni pokušaj ne mora
    // čekati taj duži rok.
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_SNAPSHOT_TIMEOUT_MS);

    // cache: 'no-store' je NAMJERNO — ruta /api/test/assignments ima
    // kratak Cache-Control (max-age=2, s-maxage=2, stale-while-revalidate=3)
    // koji je ispravan za CDN/kioske, ali bez ovoga bi admin panel
    // mogao dobiti stale podatak iz browser HTTP keša pri svakom
    // remount-u (npr. nakon logout/login), umjesto svježeg stanja.
    fetch('/api/test/assignments', { cache: 'no-store', signal: controller.signal })
      .then(res => {
        // NOVO (po predlogu): eksplicitna provjera HTTP statusa —
        // ranije se `res.json()` pozivao bezuslovno, pa bi npr. 500
        // odgovor sa praznim/neočekivanim tijelom mogao tiho "proći"
        // umjesto da završi u catch-u ispod.
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<AssignmentsResponse>;
      })
      .then((data: AssignmentsResponse) => {
        if (!mountedRef.current) return;
        // NOVO (KRITIČNO — vidi opširan komentar uz `ok` polje u
        // lib/assignments-service.ts i AssignmentsResponse iznad):
        // `ok === false` znači server NIJE uspio pouzdano pročitati
        // stanje (Redis/circuit-breaker problem) — ovo NIJE punopravan
        // snapshot. mergeNewer ispravno tretira "ključ nedostaje" kao
        // "obrisano na serveru" (vidi lib/assignment-merge.ts), pa bi
        // primjena OVOG odgovora obrisala baš SVE trenutno aktivne
        // dodjele na SVIM kioscima odjednom — samo zato što je Redis
        // bio privremeno nedostupan. Tretiraj identično kao mrežni
        // fetch fail ispod (catch): zadrži trenutno stanje, probaj
        // ponovo na sledećem ciklusu (fallback poll / 3min reconcile).
        if (data.ok === false) return;
        // Uspješan round-trip — dotakni sync bez obzira da li je
        // sadržaj promijenjen (dokazuje da fetch/mreža/API rade).
        lastSyncAtRef.current = Date.now();
        setDeskEntries(prev => mergeNewer(prev, data.deskEntries ?? {}));
        setGateEntries(prev => mergeNewer(prev, data.gateEntries ?? {}));
      })
      .catch(() => { /* ostani na trenutnom stanju (uklj. AbortError od
        timeout-a iznad) — NE dodirujemo lastSyncAtRef ovdje: neuspio
        fetch NIJE znak života. */ })
      .finally(() => {
        clearTimeout(timeoutId);
        inFlightRef.current = false;
      });
  }, []);

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
      // Bilo koja primljena Ably poruka dokazuje da kanal ŽIVI —
      // dotakni sync PRIJE merge-a, bez obzira mijenja li ova poruka
      // baš ovaj desk ili nešto drugo na kanalu.
      lastSyncAtRef.current = Date.now();
      const { deskNumber, entry } = msg.data as { deskNumber: string; entry: AssignmentEntry };
      // FIX (po zahtjevu — memory leak / optimizacija, 2026-09-29): uklonjen
      // privremeni dijagnostički console.log/JSON.stringify (vidi napomenu
      // uz fetchSnapshot iznad). Ovaj je bio i najskuplji od svih uklonjenih —
      // izvršavao se na SVAKU Ably poruku na `assignments:desks` kanalu, koja
      // je BROADCAST ka SVIM check-in/board ekranima odjednom (ne samo ka
      // ekranu na koji se poruka odnosi) — svaka promjena BILO KOG šaltera na
      // cijelom aerodromu je značila po jedan JSON.stringify + console.log na
      // SVAKOM check-in kiosku istovremeno, non-stop, 24/7.
      setDeskEntries(prev => mergeOne(prev, deskNumber, entry));
    };
    const onGateMsg = (msg: Ably.Message) => {
      if (!mountedRef.current) return;
      lastSyncAtRef.current = Date.now();
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
  }, [role, fetchSnapshot]);

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
  }, [connectionState, fetchSnapshot]);

  // ── 4. Periodičan "reconciliation" fetch — RADI UVIJEK, nezavisno
  // od connectionState-a (vidi opširan komentar uz
  // RECONCILE_INTERVAL_MS): dodatna sigurnosna mreža protiv rijetkog,
  // ali stvarnog slučaja gdje se pojedinačna Ably poruka izgubi dok je
  // konekcija naizgled stabilna. Server ostaje "istinit izvor" —
  // fetchSnapshot poziva isti /api/test/assignments koji admin panel i
  // sam čita, pa se kiosk samostalno usklađuje ako je ikad "zaostao"
  // bez ijedne izgubljene poruke koja bi ga upozorila.
  useEffect(() => {
    const id = setInterval(fetchSnapshot, RECONCILE_INTERVAL_MS);
    return () => clearInterval(id);
  }, [fetchSnapshot]);

  // NOVO — vidi komentar uz lastSyncAtRef iznad. Vraćamo REF (ne state)
  // namjerno: watchdog na strani stranice čita .current preko sopstvenog
  // setInterval-a, ne treba mu re-render pri svakom dodiru.
  //
  // FIX (po zahtjevu — garantovano zatvaranje check-in šaltera u 20s,
  // 2026-09-29): `refetch` izložen spolja (isti obrazac kao
  // hooks/useRealtimeFlightData.ts) da stranice mogu pokrenuti STVARAN,
  // dodatan resync na sopstvenom, kraćem rasporedu — vidi novi
  // "zatvoreno u 20s" watchdog u CheckInPageClient.tsx, koji ovo koristi
  // dok je šalter aktivno otvoren.
  return { deskEntries, gateEntries, connectionState, lastSyncAtRef, refetch: fetchSnapshot };
}