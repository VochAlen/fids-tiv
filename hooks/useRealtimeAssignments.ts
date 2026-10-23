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
import { mergeNewer, mergeOne, applyTruth, protectedKeysSince, type AssignmentEntry } from '@/lib/assignment-merge';
export type { AssignmentEntry };

type AssignmentsResponse = {
  deskEntries?: Record<string, AssignmentEntry>;
  gateEntries?: Record<string, AssignmentEntry>;
  // NOVO (KRITIČNO — vidi opširan komentar uz `ok` polje u
  // lib/assignments-service.ts): `false` znači da server NIJE uspio
  // pouzdano pročitati stanje (Redis/circuit-breaker problem) — ovaj
  // odgovor NIJE punopravan snapshot i NE SMIJE se koristiti za merge.
  ok?: boolean;
  /** Sat servera kad je snapshot pročitan iz Redis-a (vidi mergeNewer). */
  readAt?: number;
};

import { getSharedAbly, type AblyClientRole } from '@/lib/ably-client';
import { isNightHours } from '@/lib/night-hours';
import { noteServerDate } from '@/lib/server-clock';

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
// 2026-10-18: 3 → 5 min (smanjenje Vercel poziva/CPU; Ably push + verifyKey i dalje pokrivaju promjene).
const RECONCILE_INTERVAL_MS = 5 * 60_000;

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

// ── TOPLI START (2026-10-21) ─────────────────────────────────────────────────────────────────────────
// Electron klijent svake ~3 min radi "swap": učita istu stranicu u DRUGOM (skrivenom) prozoru pa ga prikaže
// ~0.5 s poslije did-finish-load. Nova stranica tada još nema prvi sync (isSynced=false) → na ekranu se 1–2 s
// vidi "Loading check-in information..." (treptaj). Rješenje bez izmjene exe-a: zadnje POTVRĐENO stanje se čuva u
// localStorage (dijele ga oba prozora) i nova stranica ga odmah prikaže ("warm"), dok pravi sync ne stigne.
//   • važi samo ako je keš mlađi od WARM_MAX_AGE_MS i samo prvih WARM_MAX_SHOW_MS poslije učitavanja
//     (ako pravi sync tada ne stigne, vraća se na "Loading" — stanje je opet nepoznato);
//   • piše se samo poslije USPJEŠNOG sync-a (snapshot/Ably), nikad iz keša.
const WARM_CACHE_KEY = 'assign_warm_cache_v1';
const WARM_MAX_AGE_MS = 10 * 60_000;
const WARM_MAX_SHOW_MS = 20_000;

// Dijagnostika (samo check-in stranice imaju ovu funkciju — vidi inline skriptu u app/layout.tsx; vidljiva uz ?diag=1).
function diag(msg: string) {
  try { (window as unknown as { __CHECKIN_DIAG_ADD__?: (t: string) => void }).__CHECKIN_DIAG_ADD__?.(msg); } catch { /* ignore */ }
}

// 2026-10-23: poslije NEUSPJELOG snapshota (HTTP greška, timeout, ili server javi ok:false jer Redis nije pročitan)
// ponovi brzo sa backoff-om (5 s → 60 s) umjesto da čekaš sljedeći 5-min reconcile. Ranije je jedan neuspio
// pokušaj (npr. hladan start / Redis blip) ostavljao monitor na starom stanju do 5 min, iako je Ably 'connected'.
const FAIL_RETRY_START_MS = 5_000;
const FAIL_RETRY_MAX_MS = 60_000;

export function useRealtimeAssignments(role: AblyClientRole, opts?: { warmStart?: boolean }) {
  const warmStart = !!opts?.warmStart;
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
  const failRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const failRetryDelayRef = useRef(FAIL_RETRY_START_MS);
  const fetchSnapshotRef = useRef<() => void>(() => {});
  const [channelDegraded, setChannelDegraded] = useState(false);

  // NOVO (2026-10-12): kad je zadnji put ključ dirnut Ably porukom (ms). fetchSnapshot() ovo koristi da
  // zakasnjeli snapshot (zatražen PRIJE poruke) ne obriše svježe stigao unos — vidi komentar uz
  // `protectedKeys` u lib/assignment-merge.ts (uzrok "šalter ostane inactive iako je otvoren").
  const touchedDeskRef = useRef<Map<string, number>>(new Map());
  const touchedGateRef = useRef<Map<string, number>>(new Map());

  // NOVO (2026-10-12): true tek kad je stigao PRVI pouzdan podatak (uspješan snapshot ili Ably poruka).
  // Dok je false, stranica ne smije pogađati "inactive" — stvarno stanje šaltera joj je još nepoznato
  // (npr. prvih par sekundi poslije svakog reload-a/restarta Electron klijenta).
  const [isSynced, setIsSynced] = useState(false);
  // TOPLI START: true dok se prikazuje keširano (zadnje potvrđeno) stanje, prije prvog pravog sync-a.
  const [warm, setWarm] = useState(false);
  const [syncTick, setSyncTick] = useState(0);
  const latestRef = useRef<{ desk: Record<string, AssignmentEntry>; gate: Record<string, AssignmentEntry> }>({ desk: {}, gate: {} });
  useEffect(() => { latestRef.current = { desk: deskEntries, gate: gateEntries }; }, [deskEntries, gateEntries]);

  // Obnovi keš pri mount-u (samo klijent — izbjegava hydration neslaganje).
  useEffect(() => {
    if (!warmStart) return;
    try {
      const raw = localStorage.getItem(WARM_CACHE_KEY);
      if (!raw) return;
      const c = JSON.parse(raw) as { t?: number; role?: string; desk?: Record<string, AssignmentEntry>; gate?: Record<string, AssignmentEntry> };
      if (!c || typeof c.t !== 'number' || c.role !== role || !c.desk || !c.gate) return;
      if (Date.now() - c.t > WARM_MAX_AGE_MS) return;
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDeskEntries(prev => (Object.keys(prev).length ? prev : c.desk!));
      setGateEntries(prev => (Object.keys(prev).length ? prev : c.gate!));
      setWarm(true);
    } catch { /* bez keša → obično "Loading" */ }
  }, [warmStart, role]);
  // Topli prikaz traje najviše WARM_MAX_SHOW_MS; i čim stigne pravi sync, više ne treba.
  useEffect(() => {
    if (!warm) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (isSynced) { setWarm(false); return; }
    const id = setTimeout(() => setWarm(false), WARM_MAX_SHOW_MS);
    return () => clearTimeout(id);
  }, [warm, isSynced]);
  // Upis keša: poslije svake PROMJENE i svakog uspješnog snapshot-a (syncTick), samo kad je stanje pravo.
  useEffect(() => {
    if (!warmStart || !isSynced) return;
    const id = setTimeout(() => {
      try {
        localStorage.setItem(WARM_CACHE_KEY, JSON.stringify({ t: Date.now(), role, desk: latestRef.current.desk, gate: latestRef.current.gate }));
      } catch { /* quota */ }
    }, 1_000);
    return () => clearTimeout(id);
  }, [warmStart, isSynced, role, deskEntries, gateEntries, syncTick]);
  // FIX (po zahtjevu — garantovano zatvaranje check-in šaltera u 20s,
  // 2026-09-29): umotano u useCallback (isti obrazac kao
  // hooks/useRealtimeFlightData.ts) tako da funkcija ima STABILAN
  // identitet kroz rendere — potrebno da bi se mogla bezbjedno izložiti
  // kao `refetch` i koristiti u dependency nizu efekta na strani
  // stranice (npr. brzi "zatvoren u 20s" watchdog u
  // CheckInPageClient.tsx), bez ponovnog kreiranja intervala pri svakom
  // re-renderu.
  const scheduleFailRetry = useCallback((why: string) => {
    if (!mountedRef.current) return;
    diag(`assignments ${why} — ponovni pokušaj`);
    if (failRetryTimerRef.current) clearTimeout(failRetryTimerRef.current);
    const delay = failRetryDelayRef.current;
    failRetryDelayRef.current = Math.min(delay * 2, FAIL_RETRY_MAX_MS);
    failRetryTimerRef.current = setTimeout(() => {
      failRetryTimerRef.current = null;
      // sakriven prozor: resync pri povratku vidljivosti; noću: nema pollanja (namjerno gašenje)
      if (!mountedRef.current || document.hidden || isNightHours()) return;
      fetchSnapshotRef.current();
    }, delay);
  }, []);

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
    const startedAt = Date.now();
    const sentAt = startedAt;
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
        noteServerDate(res.headers.get('date'), sentAt, Date.now());
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
        if (data.ok === false) { scheduleFailRetry('server ok:false (Redis nije pročitan)'); return; }
        failRetryDelayRef.current = FAIL_RETRY_START_MS;
        // Uspješan round-trip — dotakni sync bez obzira da li je
        // sadržaj promijenjen (dokazuje da fetch/mreža/API rade).
        lastSyncAtRef.current = Date.now();
        // Ključevi dirnuti Ably porukom NAKON što je ovaj zahtjev krenuo: snapshot je stariji od njih.
        const protectedDesks = protectedKeysSince(touchedDeskRef.current, startedAt);
        const protectedGates = protectedKeysSince(touchedGateRef.current, startedAt);
        setDeskEntries(prev => mergeNewer(prev, data.deskEntries ?? {}, protectedDesks, data.readAt));
        setGateEntries(prev => mergeNewer(prev, data.gateEntries ?? {}, protectedGates, data.readAt));
        setIsSynced(true);
        setSyncTick(t => t + 1);
      })
      .catch((err: unknown) => {
        // ostani na trenutnom stanju (uklj. AbortError od timeout-a iznad) — NE dodirujemo lastSyncAtRef:
        // neuspio fetch NIJE znak života. Ali probaj ponovo uskoro (backoff).
        scheduleFailRetry(`snapshot: ${(err as Error)?.message || err}`);
      })
      .finally(() => {
        clearTimeout(timeoutId);
        inFlightRef.current = false;
      });
  }, [scheduleFailRetry]);
  useEffect(() => { fetchSnapshotRef.current = fetchSnapshot; }, [fetchSnapshot]);

  // NOVO (2026-10-16): nezavisna provjera JEDNOG ključa direktno u bazi (bez ikakvog keša) —
  // vidi app/api/test/assignment-truth/route.ts i applyTruth u lib/assignment-merge.ts.
  const verifyInFlightRef = useRef<Set<string>>(new Set());
  const verifyKey = useCallback((type: 'desk' | 'gate', key: string) => {
    const id = `${type}:${key}`;
    if (verifyInFlightRef.current.has(id)) return;
    verifyInFlightRef.current.add(id);
    const startedAt = Date.now();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_SNAPSHOT_TIMEOUT_MS);
    fetch(`/api/test/assignment-truth?type=${type}&key=${encodeURIComponent(key)}`, { cache: 'no-store', signal: controller.signal })
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        noteServerDate(res.headers.get('date'), startedAt, Date.now());
        return res.json() as Promise<{ ok?: boolean; entry?: AssignmentEntry | null; readAt?: number }>;
      })
      .then(data => {
        if (!mountedRef.current || data.ok !== true) return;
        lastSyncAtRef.current = Date.now();
        const touched = type === 'desk' ? touchedDeskRef.current : touchedGateRef.current;
        const prot = protectedKeysSince(touched, startedAt);
        const apply = (prev: Record<string, AssignmentEntry>) =>
          applyTruth(prev, key, data.entry ?? null, data.readAt ?? Date.now(), prot);
        if (type === 'desk') setDeskEntries(apply); else setGateEntries(apply);
        setIsSynced(true);
      })
      .catch(() => { /* ostani na trenutnom stanju */ })
      .finally(() => {
        clearTimeout(timeoutId);
        verifyInFlightRef.current.delete(id);
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
      touchedDeskRef.current.set(deskNumber, Date.now());
      setDeskEntries(prev => mergeOne(prev, deskNumber, entry));
      setIsSynced(true);
    };
    const onGateMsg = (msg: Ably.Message) => {
      if (!mountedRef.current) return;
      lastSyncAtRef.current = Date.now();
      const { gateNumber, entry } = msg.data as { gateNumber: string; entry: AssignmentEntry };
      touchedGateRef.current.set(gateNumber, Date.now());
      setGateEntries(prev => mergeOne(prev, gateNumber, entry));
      setIsSynced(true);
    };

    // NOVO (2026-10-06): subscribe() vraća Promise (čeka attach). Kad se
    // konekcija zatvori prije nego što attach završi (reload, tab promjena,
    // beforeunload -> ably.close()), Promise se odbija sa "Connection
    // closed" — bez .catch() to je unhandledRejection. Namjerno ga gutamo:
    // pokretanje/prekid konekcije već pokrivaju connectionState + watchdog.
    deskChannel?.subscribe(onDeskMsg)?.catch(() => {});
    gateChannel?.subscribe(onGateMsg)?.catch(() => {});

    // 2026-10-23: nadzor STANJA KANALA (do sada se pratilo samo stanje konekcije). Veza može biti 'connected', a
    // kanal pao/ponovo se pridružio uz prekid kontinuiteta (resumed=false) → poruke su propuštene, a nijedan
    // postojeći mehanizam to nije vidio (fallback poll radi samo kad konekcija NIJE connected). Besplatno: nema
    // dodatnih zahtjeva dok je sve u redu.
    const chans: Array<{ ch: Ably.RealtimeChannel; name: string; attachedOnce: boolean }> = [];
    if (deskChannel) chans.push({ ch: deskChannel, name: 'desks', attachedOnce: false });
    if (gateChannel) chans.push({ ch: gateChannel, name: 'gates', attachedOnce: false });
    const degradedSet = new Set<string>();
    const reattachTimers: Array<ReturnType<typeof setTimeout>> = [];
    const stateHandlers = chans.map(c => {
      const handler = (change: Ably.ChannelStateChange) => {
        if (!mountedRef.current) return;
        const cur = change.current;
        if (cur === 'attached') {
          if (degradedSet.delete(c.name) && degradedSet.size === 0) setChannelDegraded(false);
          // ponovno pridruživanje (ne prvo) ili 'update' bez nastavka (resumed=false) = moguće propuštene poruke
          if ((c.attachedOnce && !change.resumed) || (change.previous === 'attached' && !change.resumed)) {
            diag(`kanal ${c.name}: prekid kontinuiteta — resync`);
            fetchSnapshot();
          }
          c.attachedOnce = true;
          return;
        }
        // Noću se konekcija namjerno gasi pa kanali prelaze u 'detached' — to NIJE kvar.
        if (ably.connection.state !== 'connected') return;
        if (cur === 'failed' || cur === 'suspended' || cur === 'detached') {
          diag(`kanal ${c.name}: ${cur}${change.reason ? ' — ' + (change.reason.message || change.reason.code) : ''}`);
          degradedSet.add(c.name);
          setChannelDegraded(true);
          if (cur === 'failed' || cur === 'detached') {
            reattachTimers.push(setTimeout(() => {
              if (mountedRef.current && ably.connection.state === 'connected') c.ch.attach().catch(() => {});
            }, 5_000));
          }
        }
      };
      c.ch.on(handler);
      return handler;
    });

    return () => {
      mountedRef.current = false;
      if (failRetryTimerRef.current) { clearTimeout(failRetryTimerRef.current); failRetryTimerRef.current = null; }
      reattachTimers.forEach(clearTimeout);
      chans.forEach((c, i) => c.ch.off(stateHandlers[i]));
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

  // ── 2b. NOVO (2026-10-17): dok NIJE stigao prvi pouzdan podatak, ponavljaj snapshot ──────────
  // Ekrani ne smiju pogađati stanje prije prvog sync-a (isSynced), pa je neuspio PRVI fetch
  // (hladan start funkcije, timeout, kratak ispad mreže) ranije držao "Loading" do sljedećeg
  // reconcile-a (3 min). Sad retry sa backoff-om 3 s → 30 s — troši mrežu SAMO dok je u kvaru.
  useEffect(() => {
    if (isSynced) return;
    let cancelled = false;
    let delay = 3_000;
    let timeoutId: ReturnType<typeof setTimeout>;
    const tick = () => {
      if (cancelled) return;
      fetchSnapshot();
      delay = Math.min(delay * 2, 30_000);
      timeoutId = setTimeout(tick, delay);
    };
    timeoutId = setTimeout(tick, delay);
    return () => { cancelled = true; clearTimeout(timeoutId); };
  }, [isSynced, fetchSnapshot]);

  // ── 3. Fallback polling kad Ably nije konektovan I nije night-sleep ──
  // FIX (po zahtjevu — eksponencijalni backoff, vidi opširan komentar
  // uz FALLBACK_POLL_INTERVAL_MS/FALLBACK_POLL_MAX_MS): setInterval
  // (fiksan razmak) zamijenjen rekurzivnim setTimeout lancem — svaki
  // naredni poziv duplira čekanje, do plafona.
  useEffect(() => {
    // 2026-10-23: i kad je konekcija 'connected', ali je KANAL pao (channelDegraded) → fallback poll radi
    if (connectionState === 'night-sleep' || (connectionState === 'connected' && !channelDegraded)) return;

    let cancelled = false;
    let delay = FALLBACK_POLL_INTERVAL_MS;
    let timeoutId: ReturnType<typeof setTimeout>;

    const tick = () => {
      if (cancelled) return;
      // Skriven prozor (Electron "swap": stari prozor ostaje živ iza novog) ne treba polling — pri povratku u
      // fokus stranica sama radi resync (vidi CheckInPageClient). Prvi snapshot (mount) i retry do prvog sync-a nisu zahvaćeni.
      if (!document.hidden) fetchSnapshot();
      delay = Math.min(delay * 2, FALLBACK_POLL_MAX_MS);
      timeoutId = setTimeout(tick, delay);
    };
    timeoutId = setTimeout(tick, delay);

    return () => { cancelled = true; clearTimeout(timeoutId); };
  }, [connectionState, channelDegraded, fetchSnapshot]);

  // ── 4. Periodičan "reconciliation" fetch — RADI UVIJEK, nezavisno
  // od connectionState-a (vidi opširan komentar uz
  // RECONCILE_INTERVAL_MS): dodatna sigurnosna mreža protiv rijetkog,
  // ali stvarnog slučaja gdje se pojedinačna Ably poruka izgubi dok je
  // konekcija naizgled stabilna. Server ostaje "istinit izvor" —
  // fetchSnapshot poziva isti /api/test/assignments koji admin panel i
  // sam čita, pa se kiosk samostalno usklađuje ako je ikad "zaostao"
  // bez ijedne izgubljene poruke koja bi ga upozorila.
  useEffect(() => {
    // Noću (isNightHours) ekrani prikazuju samo sat/prazno i Ably je zatvoren — periodični
    // reconcile je tada čist trošak (pozivi + CPU). Ujutro se stanje povlači na Ably 'connected'
    // (v4 fix) i na kraju noći (gate/check-in), pa preskakanje noću ne ostavlja zastarjele podatke.
    const id = setInterval(() => { if (!isNightHours() && !document.hidden) fetchSnapshot(); }, RECONCILE_INTERVAL_MS);
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
  return { deskEntries, gateEntries, connectionState, isSynced, warm, lastSyncAtRef, refetch: fetchSnapshot, verifyKey };
}
