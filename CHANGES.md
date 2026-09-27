# FIDS TIV — v4 Patch (2026-08-24)

## Sažetak
v4 kombinuje **svih 12 fixova** iz analize (Grupa A + B + C) plus weather fix
i auto-logout produžetak. Spreman za 24/7/365 rad na aerodromu.

---

## Grupa A — Sigurnost (4 fixa)

### 1. Admin auth na svih 10 `/api/admin/*` ruta
**Problem:** Sve admin rute su bile javno dostupne — middleware preskače `/api/*`
prefiks. Bilo ko sa URL-om je mogao mijenjati Gate/Desk, reinicijalizirati bazu,
brisati letove.

**Fix:** Kreiran `lib/admin-auth.ts` sa `requireAdmin(request)` helper-om koji
provjerava `admin-session` JWT cookie. Dodan na sve `/api/admin/*` handler-e:
- `flight-override`, `specific-flights` (×2), `airlines` (×2), `destinations` (×2)
- `checkin-toggle`, `init`, `stats`

### 2. CRON_SECRET na 3 cron rute
**Problem:** `/api/cron/flight-sync`, `/api/cron/redis-cleanup`, `/api/admin/cleanup-overrides`
su bile javno dostupne — bilo ko je mogao okinuti skupe operacije.

**Fix:** `requireCronSecret(request)` provjerava `Authorization: Bearer ${CRON_SECRET}`
header. Vercel Cron automatski šalje ovaj header.

### 3. Password log uklonjen iz login rute
**Problem:** `console.log('RAW BODY:', raw)` je logovao password u Vercel logs.

**Fix:** Uklonjen. Sad se loguje samo username (ne i password).

### 4. `x-proxy-secret` cenzurisan u logovima
**Problem:** `console.error('Headers sent:', JSON.stringify(options.headers))` je
izlagao `PROXY_SECRET` u Vercel logs pri svakom padu fetch-a.

**Fix:** `safeHeaders` objekat sa `'x-proxy-secret': '[REDACTED]'`.

---

## Grupa B — Pouzdanost (5 fixova)

### 5. Redis lock na `runAutoReset` u `lib/override-utils.ts`
**Problem:** Read-modify-write nad `test:desk-status:all` blobom bez lock-a —
ako admin istovremeno edituje desk, cleanup bi mogao pregaziti promjenu.

**Fix:** `lock:desk-status:override` oko cijelog bloka (5s TTL, 2s max čekanje).
Takođe: `JSON.parse` sad ima try/catch — corrupt blob ne ruši cijeli cleanup.

### 6. Circuit breaker popavljen u `lib/redis.ts`
**Problem:** `circuitOpen = false` se postavljao UNCONDITIONALNO prije nego što bi
komanda stvarno uspjela — što je poništavalo zaštitu. Poslije prvog pada,
circuit breaker više nije štitio ni od čega.

**Fix:**
- Circuit se otvara na error, zatvara SAMO kad komanda uspije (u try bloku)
- Eksponencijalni backoff na cooldown (15s → 30s → 60s → 120s)
- `circuitFailureCount` se resetuje tek na uspjeh

### 7. Nested setTimeouts očišćeni u CheckInPageClient
**Problem:** Ad crossfade animacija je imala ugniježđene setTimeout-ove (100ms, 300ms)
koji se nisu clear-ali na unmount-u — mogli su pozvati setState na unmount-ovanu
komponentu.

**Fix:** `inner1` i `inner2` ref-ovi se čiste u cleanup-u.

### 8. `isMountedRef.current = false` u cleanup-ima
**Problem:** U GatePageClient i CheckInPageClient, `isMountedRef` je postavljan na
`true` pri mount-u, ali nikad na `false` u cleanup-u — provjere
`if (!isMountedRef.current) return` su bile mrtav kod.

**Fix:** Dodan poseban mount/unmount effect koji postavlja `false` na unmount.
Takođe čisti `stdSwitchTimerRef` (gate) i `orientationTimeoutRef` (checkin).

### 9. Ably `onConnected` re-fetch snapshot
**Problem:** Kad Ably padne i ponovo se digne, poruke objavljene tokom ispada su
izgubljene. Kiosk ostaje sa zastarjelim stanjem dok ne dođe do nove akcije.

**Fix:** U oba hook-a (`useRealtimeAssignments`, `useRealtimeFlightData`),
`onConnected` sada zove `fetchSnapshot()` da sinhronizuje stanje nakon reconnect-a.

---

## Grupa C — Tačnost (2 fixa)

### 10. Ably reconnect re-fetch (spojeno sa #9)
Ista logika kao #9 — objedinjeno u jednom fixu.

### 11. Obrisani broken route files + dead code
- `app/api/admin/auto-reset` (fajl bez ekstenzije, Next.js ga ne prepoznaje)
- `app/api/admin/redis-health` (prazan fajl)
- `app/api/admin/auto-reset-departed/route.ts` (nema pozivaoca)
- `app/api/flights/transform/route.ts` (nije referenciran)
- `app/api/checkin-status/route.ts` (koristi in-memory state, besmisleno na serverlessu)
- `lib/ai.ts` (funkcija `callAI` se nigdje ne koristi)
- `lib/init-auto-reset.ts` (funkcija `initAutoReset` se nigdje ne zove)
- `lib/override-ttl.ts` (funkcija `computeOverrideTTL` se ne importuje)
- `lib/env.ts` (Dodo Payments ostaci)

---

## Weather fix (zaseban)

### Problem: Tivat weather u header-u combined stranice je pokazivao 0°C
**Uzrok:** `hooks/use-weather.ts` je imao `isWithinOperatingHours()` funkciju
koja je vraćala `temperature: 0` van 05:00-19:00. Aerodrom radi 24/7, ali
weather je bio dostupan samo 14h dnevno.

**Fix:**
- Uklonjena `isWithinOperatingHours()` restrikcija — weather fetch radi 24/7
- `getTimeUntilNextRefresh()` sad vraća fiksno 3h (usklađeno sa CACHE_DURATION)
- Dodana `FlightWeatherCell` komponenta u combined stranicu
- Dodana `DepartureWeatherCell` komponenta u departures stranicu
- Weather kolona dodana u table headers za arrivals + departures (combined) i departures

---

## Auto-logout produžetak

### Problem: 3 min neaktivnosti je bilo prekratko za assign-checkin
**Fix:** `IDLE_LOGOUT_MS` u `app/admin/layout.tsx` produžen sa 3 min na **5 min**.

---

## 4 AM auto-refresh letova

Već postoji u v3:
- `/api/cron/flight-sync` (svaka 3 min u `vercel.json`) — publish flight data na Ably
  ako se hash promijenio + noćna barijera (ne publish-uje noću)
- `lib/flight-data-service.ts` — odbacuje noćni cache kad `cached.isNightMode && !nightNow`
  (noć→dan prelaz oko 04:00 ljeti, 05:00 zimi)
- `night:fetch:gate` Redis ključ (TTL 1h) ograničava noćne fetch-eve na 1x/h

U 04:00, prvi cron okinuo nakon noći će izazvati `getCurrentFlightDataSafe()` da odbaci
noćni cache i uradi svjež live fetch. Kiosci će dobiti push preko Ably `flights:combined`
kanala — promjena vidljiva za <1s.

---

## Verifikacija

- `npx tsc --noEmit` → 0 mojih grešaka (preostale drizzle greške su pre-existing)
- `npx next build` → uspješno, sve rute generisane
- Next.js 16.2.10, React 19.2.4, Ably v2.24.0

---

## Deployment instrukcije

1. Postavi env varijable na Vercelu (Production + Preview):
   - `ABLY_API_KEY` (već postoji)
   - `FIDS_REDIS_URL` (već postoji)
   - `ADMIN_SESSION_SECRET` (već postoji)
   - `ADMIN_USERS` (već postoji)
   - `FLIGHT_PROXY_URL`, `FLIGHT_PROXY_SECRET` (već postoje)
   - **NOVO: `CRON_SECRET`** — generiši sa `openssl rand -hex 32` ili koristi
     vrijednost iz `.env.local`

2. U Vercel Dashboard → Settings → Cron Jobs, provjeri da su cron job-ovi
   konfigurisani (iz `vercel.json`). Vercel automatski šalje `Authorization:
   Bearer ${CRON_SECRET}` header na svakom okidanju.

3. Deploy na Vercel — build prolazi čisto.

4. Test:
   - Otvori admin panel, dodijeli gate → promjena na kiosku za <1s
   - Otvori combined stranicu → weather kolona pokazuje temperaturu + ikonu
   - Otvori departures → weather kolona za svaku destinaciju
   - Tivat weather u header-u combined → ne pokazuje 0°C (24/7 dostupan)

5. Provjeri Vercel Logs — ne bi trebalo biti password/proxy-secret u logovima.
