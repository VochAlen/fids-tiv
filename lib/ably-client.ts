// lib/ably-client.ts
'use client';

import * as Ably from 'ably';

// ── PRAVA dijeljena Ably konekcija po tabu ───────────────────────
// Ovo je JEDINO mjesto gdje se instancira Ably.Realtime na klijentu.
// Svi hookovi (useRealtimeAssignments, useRealtimeFlightData, i bilo
// koji budući realtime hook) MORAJU importovati getSharedAbly() odavde,
// nikad kreirati vlastitu 'let sharedAbly' varijablu u svom fajlu —
// module-scoped varijabla je jedinstvena PO FAJLU, ne globalno, pa bi
// svaki fajl sa vlastitom kopijom otvorio SVOJU Ably konekciju (bug
// koji je ranije udvostručio broj konekcija: dva /api/ably-token
// zahtjeva umjesto jednog po tabu).
//
// AŽURIRANO — role-based token scoping: getSharedAbly() sad prima
// ulogu ekrana ('gate' | 'checkin' | 'board' | 'arrivals') i
// prosljeđuje je kao ?role= na /api/ably-token, koji zauzvrat izdaje
// token ograničen SAMO na kanale koje ta uloga stvarno koristi (vidi
// app/api/ably-token/route.ts, ROLE_CAPABILITIES). Ranije je svaki
// kiosk dobijao isti token sa wildcard pristupom SVIM kanalima — ako
// bi neko pročitao token sa jednog fizičkog (javno dostupnog) kioska,
// mogao je da prisluškuje sve gate-ove i sve check-in šaltere, ne
// samo svoje. Sad je "blast radius" kompromitovanog tokena ograničen
// na tačno ono što taj tip ekrana i onako prikazuje.
//
// Pošto je konekcija dijeljena PO TABU (ne po ulozi), i fizički kiosk
// tokom svoje sesije nikad ne mijenja tip ekrana (gate ostaje gate,
// checkin ostaje checkin — nema navigacije unutar iste sesije), prva
// uloga koja pozove getSharedAbly() određuje token-scope za CIJELU
// sesiju tog taba. To je namjerno i ispravno ponašanje za kiosk
// deployment.
export type AblyClientRole = 'gate' | 'checkin' | 'board' | 'arrivals' | 'pa';

import { isNightHours } from '@/lib/night-hours';

let sharedAbly: Ably.Realtime | null = null;
let sharedAblyRole: AblyClientRole | null = null;

// FIX (po zahtjevu — portovano iz glavnog/polling sistema, prilagođeno
// Ably arhitekturi): dinamički noćni signal koji SERVER računa
// (lib/flight-data-service.ts, computeDynamicNightMode — vidi opširan
// komentar tamo) i šalje ugrađen u data.isNightMode preko flights:combined
// kanala. nightWatcherTick() ispod ga koristi kao DODATNI uslov za
// zatvaranje konekcije, uz postojeću lokalnu isNightHours() proveru —
// omogućava da se konekcija zatvori i PRIJE fiksnog sezonskog prozora,
// ako je hronološki poslednji let danas stvarno dobio departed/landed
// status prije 15+ minuta. hooks/useRealtimeFlightData.ts poziva
// reportDynamicNightMode() svaki put kad primi svjež podatak (Ably
// poruka ILI REST snapshot) — NAMJERNO nije sub-sekundno precizno
// (cilj je da se konekcija zatvori ranije na danima sa malo letova, ne
// da reaguje trenutno na promjenu).
let lastKnownDynamicNightMode = false;

// FIX (KRITIČNO — dodatni sloj zaštite, uz popravku pravog uzroka u
// lib/flight-data-service.ts computeDynamicNightMode): jedan pogrešan
// signal (bilo kog uzroka — trenutna popravka, ili bilo koji budući,
// još neotkriven rubni slučaj) NIKAD ne smije sam da zatvori konekciju
// za sve ekrane. Zahtijeva DVA UZASTOPNA "noć" izvještaja (razmaknuta
// najmanje ~3 min, jer hooks/useRealtimeFlightData.ts poziva
// reportDynamicNightMode svaki put kad primi svjež podatak preko Ably
// poruke ili REST snapshot-a, što se dešava mnogo češće od 3 min u
// normalnom radu) prije nego što se dinamički signal STVARNO uzme u
// obzir — ali se ODMAH resetuje na "nije noć" čim stigne SAMO JEDAN
// "nije noć" izvještaj (brz oporavak, spor okidač — namjerno
// asimetrično). Ovo ne mijenja normalno ponašanje (kad je let stvarno
// gotov, dinamički signal ostaje dosljedno "noć" kroz višestruke
// izvještaje, pa dva-uzastopna-zahtjeva prolazi prirodno za par
// minuta) — samo štiti od TRENUTNOG zatvaranja na osnovu jednog,
// potencijalno pogrešnog očitavanja.
let dynamicNightConsecutiveCount = 0;
const DYNAMIC_NIGHT_MIN_CONSECUTIVE_REPORTS = 2;

export function reportDynamicNightMode(value: boolean): void {
  if (!value) {
    dynamicNightConsecutiveCount = 0;
    lastKnownDynamicNightMode = false;
    return;
  }
  dynamicNightConsecutiveCount += 1;
  lastKnownDynamicNightMode = dynamicNightConsecutiveCount >= DYNAMIC_NIGHT_MIN_CONSECUTIVE_REPORTS;
}

// FIX (po zahtjevu — prijavljeno "ekran povremeno postane crn"):
// izloženo da kiosk stranice (combined/departures/border/arrivals)
// mogu koristiti ISTU, već dokazanu hysterezu za VIZUELAN prikaz
// noćnog ekrana, umjesto da direktno primjenjuju sirov
// liveFlightData.isNightMode flag (koji je RANIJE bio primjenjivan
// BEZ ikakve zaštite od jednog, prolaznog pogrešnog/zastarjelog
// signala — npr. ako fallback REST snapshot vrati kratkotrajno
// zastarjeli podatak). Isti princip kao nightWatcherTick iznad:
// jedan "noć" izvještaj nikad sam ne mijenja prikaz, potrebna su dva
// uzastopna — ali povratak na "nije noć" je odmah, čim stigne samo
// jedan ispravan izvještaj (brz oporavak, spor okidač).
export function getLastKnownDynamicNightMode(): boolean {
  return lastKnownDynamicNightMode;
}

// ── NOĆNI REŽIM (Edge Requests optimizacija, 2026-08) ──────────────────
//
// Problem: Ably konekcija se ranije NIKAD nije gasila osim na
// beforeunload (zatvaranje taba) — pošto kiosk tab fizički nikad ne
// zatvara, to je značilo da hourly token-renew (i sama WebSocket
// konekcija) rade identično 24/7, bez obzira na isNightHours().
// NightClock (combined/departures/split-board) gasi samo REST polling
// na TIM stranicama, ne i Ably konekciju, i gate/checkin/border/arrivals
// stranice ga uopšte nemaju.
//
// Rješenje: watcher svakih 60s provjerava isNightHours() (Europe/Podgorica,
// IATA sezonski prozori — vidi lib/night-hours.ts) i:
//   - na ULAZAK u noć: eksplicitno zatvara konekciju (connection.close())
//   - na IZLAZAK iz noći (jutro): ponovo je otvara (connection.connect())
//
// Garancija tačnih jutarnjih podataka: hookovi (useRealtimeFlightData,
// useRealtimeAssignments) VEĆ imaju onConnected -> fetchSnapshot() resync
// logiku (v4 fix, postojala i prije ovoga, za obični reconnect nakon
// mrežnog ispada). Pošto connection.connect() nakon close() ponovo
// emituje 'connected' event kad se uspostavi, isti resync mehanizam se
// AUTOMATSKI okine i ujutro — nema potrebe za posebnom "morning refresh"
// putanjom, dovoljno je da se konekcija ponovo otvori. Ovo je namjerno:
// jedan mehanizam pokriva i obični reconnect i noć->dan prelaz.
//
// Fallback polling (20s REST) u hookovima MORA prepoznati da je ovo
// NAMJERNO gašenje (night-sleep), ne mrežni ispad — inače bi svih 41
// kioska pollovalo na 20s tokom cijele noći, što bi poništilo uštedu.
// Zato hookovi sad slušaju i 'closed'/'initialized' stanja i mapiraju ih
// u connectionState='night-sleep' kad je isNightHours() true, a fallback
// polling efekat eksplicitno preskače taj state (vidi hooks/*.ts).
let nightWatcherStarted = false;

function nightWatcherTick() {
  if (!sharedAbly) return;

  // v5.9: PA izuzetak UKLONJEN — razglas NE smije raditi noću, nakon
  // zadnjeg leta (eksplicitan zahtjev). 'pa' uloga sad prati identično
  // noćno gašenje kao i svih 41 FIDS ekrana ispod.
  //
  // FIX (po zahtjevu — dinamički noćni režim): kombinovan uslov —
  // statička (sezonska, lokalna, besplatna) provjera ILI dinamički
  // signal koji je server poslednji put javio (vidi opširan komentar
  // uz reportDynamicNightMode iznad). Statička provjera ostaje
  // sigurnosna mreža koja NIKAD ne otkazuje — dinamička samo MOŽE
  // zatvoriti konekciju RANIJE, nikad kasnije.
  const night = isNightHours() || lastKnownDynamicNightMode;
  const state = sharedAbly.connection.state;

  if (night) {
    // Sve što nije već 'closed'/'closing'/'initialized' treba zatvoriti.
    if (state === 'connected' || state === 'connecting' || state === 'disconnected' || state === 'suspended') {
      try { sharedAbly.connection.close(); } catch {}
    }
  } else {
    // Dan je — ako je konekcija ugašena (noćni close ili nikad ni
    // pokrenuta jer je tab otvoren usred noći), ponovo je pokreni.
    if (state === 'closed' || state === 'initialized') {
      try { sharedAbly.connection.connect(); } catch {}
    }
  }
}

function startNightWatcher() {
  if (nightWatcherStarted || typeof window === 'undefined') return;
  nightWatcherStarted = true;
  nightWatcherTick(); // odmah provjeri (tab se možda otvara usred noći)
  setInterval(nightWatcherTick, 60_000);
}

export function getSharedAbly(role: AblyClientRole): Ably.Realtime {
  if (!sharedAbly) {
    sharedAblyRole = role;
    // autoConnect: false ako je trenutno noć — ne trošimo token-fetch
    // i WebSocket handshake na konekciju koju ćemo odmah zatvoriti.
    // Watcher (startNightWatcher) će je otvoriti čim/ako svane dan.
    // v5.9: 'pa' više NEMA izuzetak — razglas ne smije raditi noću.
    const night = isNightHours();
    sharedAbly = new Ably.Realtime({
      authUrl: `/api/ably-token?role=${encodeURIComponent(role)}`,
      autoConnect: !night,
      // v5.1: httpRequestTimeout 30s (default 10s) sprečava "Token request
      // did not complete within the configured timeout" kad Redis rate-limit
      // check na /api/ably-token potraje duže (cold start, Redis reconnect).
      httpRequestTimeout: 30_000,
      httpOpenTimeout: 15_000,
      httpMaxRetryCount: 3,
      disconnectedRetryTimeout: 2_000,
      suspendedRetryTimeout: 5_000,
    });
  } else if (sharedAblyRole !== role) {
    console.warn(
      `[ably-client] getSharedAbly() pozvan sa role="${role}" ali konekcija je već ` +
      `inicijalizovana sa role="${sharedAblyRole}" — token ostaje ograničen na prvobitnu ulogu ` +
      `za cijelu sesiju ovog taba.`
    );
  }
  startNightWatcher();
  return sharedAbly;
}
// v5: Ably connection cleanup na beforeunload
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    if (sharedAbly) {
      try { sharedAbly.close(); } catch {}
      sharedAbly = null;
    }
  });
}
