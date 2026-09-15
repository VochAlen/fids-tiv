// app/api/weather/route.ts
//
// ── FIX (previše Open-Meteo zahtjeva → 429 Too Many Requests) ──
// Problem: hooks/use-weather.ts je do sad gađao api.open-meteo.com/v1/forecast
// DIREKTNO iz browsera, sa keš-om koji živi SAMO kao JS Map unutar TE JEDNE
// stranice/taba (weatherCache modul-level varijabla u use-weather.ts).
// Na aerodromu postoji više fizičkih monitora (combined, departures, gate-ovi,
// checkin ekrani) — svaki je ODVOJEN browser proces, pa svaki ima SVOJ
// nezavisan in-memory keš. Rezultat: N monitora × M jedinstvenih destinacija
// = N×M poziva ka Open-Meteo umjesto M, i to sinhronizovano (svi monitori su
// se upalili otprilike u isto vrijeme, pa im keš ističe u isto vrijeme, na
// svaka 3h) — klasičan "thundering herd" koji lako probije Open-Meteo
// free-tier rate limit.
//
// Rješenje: ova ruta je JEDINO mjesto koje smije zvati Open-Meteo. Rezultat
// se čuva u Redis-u (dijeljen između SVIH monitora i svih Vercel instanci),
// sa TTL usklađenim sa CACHE_DURATION u use-weather.ts (3h). Sad je,
// bez obzira na broj monitora, tačno 1 stvaran Open-Meteo poziv po
// jedinstvenoj lokaciji na svaka 3h — svi ostali zahtjevi (sa bilo kog
// monitora) pogode Redis keš i nikad ne stignu do Open-Meteo.
import { NextResponse } from 'next/server';
import { safeRedisGet, safeRedisSet } from '@/lib/redis';

// FIX: lib/redis.ts koristi ioredis (TCP klijent) — NIJE kompatibilan sa
// Edge Runtime-om (nema raw TCP socket podršku). Mora ostati Node.js
// runtime (default), inače build/runtime puca čim ova ruta pokuša da
// pozove getRedisClient(). Cold start je ovdje zanemarljiv trošak jer se
// ruta poziva rijetko (keš pogodak je čest slučaj).

const CACHE_TTL_SECONDS = 3 * 60 * 60; // 3h — MORA biti usklađeno sa
// CACHE_DURATION u hooks/use-weather.ts. Ne diraj jedno bez drugog.
const WEATHER_CACHE_CONTROL =
  'public, s-maxage=10800, stale-while-revalidate=1800';

type WeatherPayload = { temperature: number; weatherCode: number };

// Zaokruživanje koordinata na 2 decimale (~1.1km preciznost na ovoj
// geografskoj širini) — normalizuje cache key tako da sitne razlike u
// izvornim koordinatama (npr. zaokruživanje na klijentu) ne prave
// duplirane cache zapise za istu destinaciju.
function roundCoord(n: number): string {
  return n.toFixed(2);
}

// ── DEDUP UNUTAR ISTE INSTANCE ──────────────────────────────────
// Ako je keš upravo istekao i 10-20 zahtjeva (po jedan po letu na combined
// boardu) stigne u istom trenutku na ISTU Vercel/Edge instancu, svi dijele
// JEDAN in-flight Promise umjesto da svaki pojedinačno zove Open-Meteo.
// Ovo NE pokriva slučaj gdje dvije RAZLIČITE instance istovremeno promaše
// Redis keš (rijetko, i posljedica je najviše 2-3 dupla poziva umjesto
// N×M) — potpuno rješavanje toga bi tražilo distribuirani lock (kao
// FETCH_LOCK_KEY u lib/flight-data-service.ts), što za weather nije
// vrijedno dodatne kompleksnosti.
const inFlight = new Map<string, Promise<WeatherPayload>>();

async function fetchFromOpenMeteo(lat: number, lon: number): Promise<WeatherPayload> {
  const params = new URLSearchParams({
    latitude: lat.toString(),
    longitude: lon.toString(),
    current: 'temperature_2m,weather_code',
    timezone: 'auto',
  });
  const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`);
  if (!res.ok) {
    if (res.status === 429) {
      throw new Error('Rate limit exceeded - too many requests');
    }
    throw new Error(`Weather API request failed: ${res.status}`);
  }
  const data = await res.json();
  return {
    temperature: data.current.temperature_2m,
    weatherCode: data.current.weather_code,
  };
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const lat = parseFloat(searchParams.get('lat') || '');
  const lon = parseFloat(searchParams.get('lon') || '');

  if (isNaN(lat) || isNaN(lon)) {
    return NextResponse.json({ error: 'lat i lon su obavezni' }, { status: 400 });
  }

  const cacheKey = `weather:${roundCoord(lat)},${roundCoord(lon)}`;

  // ── 1. REDIS KEŠ (dijeljen između svih monitora/instanci) ──
  try {
    const cachedRaw = await safeRedisGet(cacheKey);
    if (cachedRaw) {
      const cached = JSON.parse(cachedRaw) as WeatherPayload;
      return NextResponse.json(cached, { headers: { 'Cache-Control': WEATHER_CACHE_CONTROL } });
    }
  } catch {
    // Oštećen zapis ili Redis nedostupan — nastavi na fresh fetch ispod,
    // ne ruši odgovor zbog keš problema.
  }

  // ── 2. FRESH FETCH (sa dedup-om unutar instance) ──
  let promise = inFlight.get(cacheKey);
  if (!promise) {
    promise = fetchFromOpenMeteo(lat, lon).finally(() => {
      inFlight.delete(cacheKey);
    });
    inFlight.set(cacheKey, promise);
  }

  try {
    const data = await promise;
    // Upiši u Redis — ne čekamo da se write završi da bismo brže odgovorili
    // pozivaocu (weather nije kritičan podatak, best-effort keširanje).
    safeRedisSet(cacheKey, JSON.stringify(data), CACHE_TTL_SECONDS).catch(() => {});
    return NextResponse.json(data, { headers: { 'Cache-Control': WEATHER_CACHE_CONTROL } });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Weather fetch failed';
    const status = message.includes('Rate limit') ? 429 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
