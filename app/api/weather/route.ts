// app/api/weather/route.ts
//
// v5.11 — Centralizovan weather proxy. RAZLOG: hooks/use-weather.ts je
// ranije svaki od 41 kioska pozivao Open-Meteo DIREKTNO iz browsera —
// čak i sa client-side kešom (30 min, po tabu/localStorage), 41 fizički
// odvojenih uređaja i dalje znači do 41 nezavisnih poziva ka istom
// besplatnom API-ju svakih 30 min, po destinaciji. To je put ka
// "Too Many Requests" (429) sa Open-Meteo strane.
//
// Rješenje: SVI kiosci sad zovu OVU rutu (/api/weather?lat=..&lon=..)
// umjesto Open-Meteo direktno. Ova ruta drži Redis keš sa 3h TTL-om —
// Open-Meteo se stvarno pozove NAJVIŠE jednom u 3 sata PO LOKACIJI,
// bez obzira koliko kiosaka u tom periodu traži isti aerodrom.
//
// Single-flight brava (isti NX-lock pattern kao FETCH_LOCK_KEY u
// lib/flight-data-service.ts) sprečava da više kiosaka koji promaše
// keš TAČNO u istom trenutku (na granici isteka) svi paralelno okinu
// Open-Meteo za istu lokaciju.

import { NextResponse } from 'next/server';
import { getRedisClient, safeRedisGet, safeRedisSet } from '@/lib/redis';

export const dynamic = 'force-dynamic';

const CACHE_TTL_SECONDS = 3 * 60 * 60;   // 3h — tačno traženo, svježi podaci
const STALE_TTL_SECONDS = 48 * 60 * 60;  // 48h — fallback ako Open-Meteo odbije i nakon retry-a
const LOCK_TTL_SECONDS = 20;             // koliko dugo brava traje dok jedan request radi fetch
const LOCK_WAIT_MS = 1500;               // koliko čekaju ostali prije nego i sami probaju
const RETRY_DELAYS_MS = [1500, 3000, 5000]; // kratak retry na 429 (server-side, jednom po lokaciji)

interface OpenMeteoWeather {
  temperature: number;
  weatherCode: number;
  windSpeed: number;
  windDirection: number;
}

async function fetchFromOpenMeteo(lat: number, lon: number): Promise<OpenMeteoWeather> {
  const params = new URLSearchParams({
    latitude: lat.toString(),
    longitude: lon.toString(),
    current: 'temperature_2m,weather_code,wind_speed_10m,wind_direction_10m',
    timezone: 'auto',
  });

  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    if (attempt > 0) {
      await new Promise(r => setTimeout(r, RETRY_DELAYS_MS[attempt - 1]));
    }
    const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`, {
      cache: 'no-store',
    });
    if (res.status === 429) {
      lastError = new Error('Open-Meteo 429 rate limit');
      continue;
    }
    if (!res.ok) throw new Error(`Open-Meteo HTTP ${res.status}`);
    const data = await res.json();
    return {
      temperature: data.current?.temperature_2m ?? 0,
      weatherCode: data.current?.weather_code ?? 0,
      windSpeed: data.current?.wind_speed_10m ?? 0,
      windDirection: data.current?.wind_direction_10m ?? 0,
    };
  }
  throw lastError ?? new Error('Open-Meteo failed after retries');
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const latStr = searchParams.get('lat');
  const lonStr = searchParams.get('lon');
  const lat = parseFloat(latStr || '');
  const lon = parseFloat(lonStr || '');

  if (!latStr || !lonStr || isNaN(lat) || isNaN(lon)) {
    return NextResponse.json({ error: 'lat i lon su obavezni query parametri' }, { status: 400 });
  }

  // Zaokruži na 2 decimale (~1.1km preciznost na ovim geografskim
  // širinama) — sprečava da sitne float razlike naprave odvojene cache
  // ključeve za istu lokaciju.
  const roundedLat = lat.toFixed(2);
  const roundedLon = lon.toFixed(2);
  const cacheKey = `cache:weather:${roundedLat}:${roundedLon}`;
  const staleKey = `${cacheKey}:stale`;
  const lockKey = `${cacheKey}:lock`;

  try {
    const cached = await safeRedisGet(cacheKey);
    if (cached) {
      return NextResponse.json(JSON.parse(cached), {
        headers: { 'X-Weather-Cache': 'hit' },
      });
    }

    // Cache miss — pokušaj single-flight bravu prije nego što sam
    // pozoveš Open-Meteo, da ne bi 2+ kioska koji su promašili keš u
    // istom trenutku oba (svi) zvala Open-Meteo za istu lokaciju.
    const client = getRedisClient();
    const gotLock = await client.set(lockKey, '1', 'EX', LOCK_TTL_SECONDS, 'NX');

    if (!gotLock) {
      // Neko drugi (drugi kiosk/request) već radi fetch za ovu lokaciju
      // — sačekaj kratko i probaj keš ponovo umjesto da i sam pozoveš API.
      await new Promise(r => setTimeout(r, LOCK_WAIT_MS));
      const retryCache = await safeRedisGet(cacheKey);
      if (retryCache) {
        return NextResponse.json(JSON.parse(retryCache), {
          headers: { 'X-Weather-Cache': 'hit-after-wait' },
        });
      }
      // I dalje ništa u kešu (rijedak slučaj — onaj koji je držao
      // bravu je vjerovatno pao) — nastavi i sam uradi fetch. Bolje
      // povremeni duplirani poziv nego da kiosk ostane bez podataka.
    }

    const fresh = await fetchFromOpenMeteo(lat, lon);
    const freshJson = JSON.stringify(fresh);
    await safeRedisSet(cacheKey, freshJson, CACHE_TTL_SECONDS);
    // v5.12: STALE fallback — odvojen ključ, mnogo duži TTL (48h).
    // Ako sljedeći fetch (za 3h) ikad padne (Open-Meteo 429 čak i
    // nakon retry-a, mrežni ispad i sl.), ovo je ono što se vraća
    // umjesto greške/0°C — vidi catch blok ispod.
    await safeRedisSet(staleKey, freshJson, STALE_TTL_SECONDS);

    return NextResponse.json(fresh, { headers: { 'X-Weather-Cache': 'miss' } });
  } catch (err) {
    console.error('[api/weather] greška:', err);

    // v5.12: Prije nego što vratimo grešku/0°C, probaj STALE fallback
    // (do 48h star, ali i dalje neuporedivo bolji prikaz od 0°C ili
    // praznog ekrana). Ovo je namjerno ODVOJENO od glavnog 3h keša —
    // Redis EXPIRE briše ključ nakon isteka, pa bez posebnog stale
    // ključa ne bismo imali ŠTA da vratimo kad glavni keš istekne i
    // svježi fetch istovremeno padne.
    try {
      const stale = await safeRedisGet(staleKey);
      if (stale) {
        return NextResponse.json(JSON.parse(stale), {
          headers: { 'X-Weather-Cache': 'stale-fallback' },
        });
      }
    } catch { /* i stale fallback pao — nastavi na 502 ispod */ }

    // Fallback oblik identičan uspješnom odgovoru (temperature: 0, itd.)
    // da klijent ne mora posebno da parsuje error-shape — samo status
    // kod signalizira da je nešto pošlo po zlu. Do ovoga dolazi SAMO
    // ako i glavni fetch I stale fallback oba ne uspiju (npr. sasvim
    // nova lokacija koja nikad nije uspješno keširana).
    return NextResponse.json(
      { temperature: 0, weatherCode: 0, windSpeed: 0, windDirection: 0, error: 'Weather fetch failed' },
      { status: 502 }
    );
  }
}
