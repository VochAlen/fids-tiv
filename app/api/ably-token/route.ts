// // app/api/ably-token/route.ts
// import { NextResponse } from 'next/server';
// import { getAblyRest } from '@/lib/ably-server';

// export const dynamic = 'force-dynamic';

// // app/api/ably-token/route.ts
// // app/api/ably-token/route.ts
// export async function GET() {
//   try {
//     const client = getAblyRest();
//     const tokenRequest = await client.auth.createTokenRequest({
//       capability: {
//         'flights:*': ['subscribe'],
//         'assignments:*': ['subscribe'],
//         'checkin-assignments': ['subscribe'],
//       },
//       ttl: 60 * 60 * 1000,
//     });
//     return NextResponse.json(tokenRequest);
//   } catch (err) {
//     console.error('[ably-token] error:', err);
//     return NextResponse.json({ error: 'Token generation failed' }, { status: 500 });
//   }
// }
// app/api/ably-token/route.ts
import { NextResponse } from 'next/server';
import type { capabilityOp } from 'ably';
import { getAblyRest } from '@/lib/ably-server';
import { getRedisClient } from '@/lib/redis';

export const dynamic = 'force-dynamic';

// ─────────────────────────────────────────────────────────────
// RATE LIMITING — zaštita od eksplozije troškova
//
// Očekivano ponašanje: 50 kioska, svaki traži novi token ~1x/h
// (TTL tokena) + par puta pri mountu/reconnectu. To je ~50-150
// zahtjeva/h ukupno. Limiti ispod su namjerno dosta iznad tog
// realnog broja (da ne blokiraju legitimne burst-ove — npr. svih
// 50 kioska istovremeno reconnect-uje nakon kratkog mrežnog ispada
// na aerodromu, ili dijele isti javni IP iza NAT-a), ali dovoljno
// niski da zaustave runaway petlju (bug u reconnect logici, loop
// bez backoff-a i sl.) prije nego što napravi realnu štetu na
// Ably/Vercel računu.
//
// Fail-open: ako Redis nije dostupan, dozvoljavamo zahtjev (bolje
// da kiosk radi bez rate-limita nego da svi kiosci ostanu bez
// realtime podataka zbog Redis hiccupa).
// ─────────────────────────────────────────────────────────────

const PER_IP_LIMIT = 100;      // zahtjeva po IP-u u prozoru
const PER_IP_WINDOW_SEC = 60;  // 1 minut

const GLOBAL_LIMIT = 400;      // ukupno zahtjeva svih klijenata u prozoru
const GLOBAL_WINDOW_SEC = 60;  // 1 minut
// 400/min = 24.000/h — i dalje ~150-200x iznad očekivanog realnog
// prometa (50-150/h), ali dovoljno nisko da zaustavi bug prije nego
// generiše ozbiljan trošak, čak i ako više kioska dijeli isti IP.

// ── INTERNI timeout za rate-limit provjeru, NEZAVISAN od stvarnog
// Redis command timeout-a. Bez ovoga, ako Redis "visi" (spor, ali ne
// odmah baca grešku), fail-open logika u catch bloku se ne aktivira
// dok se ne desi stvarni Redis timeout — koji može biti 10-ak sekundi
// ili više. Ovaj wrapper garantuje da rate-limit provjera NIKAD ne
// doda više od RATE_LIMIT_TIMEOUT_MS kašnjenja na kritičan put izdavanja
// tokena, bez obzira koliko dugo Redis stvarno "visi". ─────────────
const RATE_LIMIT_TIMEOUT_MS = 300;

// ─────────────────────────────────────────────────────────────
// SCOPING PO ULOZI KLIJENTA — bezbjednosno poboljšanje.
//
// Ranije: SVAKI token (bez obzira ko ga traži) je dobijao wildcard
// pristup ('flights:*', 'assignments:*', 'checkin-assignments') —
// gate-3 kiosk je mogao da čita i tuđe gate-ove, sve check-in
// šaltere, čak i neiskorišćen 'checkin-assignments' kanal. Pošto su
// ovi kiosci fizički izloženi na javnom dijelu aerodroma, širi opseg
// tokena znači veći "blast radius" ako neko pročita token iz
// browser dev-tools-a.
//
// Sad: svaki tip ekrana traži token sa ?role=X, i dobija SAMO
// kanale koje taj tip ekrana stvarno koristi (mapirano direktno na
// ono što hooks/useRealtimeAssignments.ts i
// hooks/useRealtimeFlightData.ts stvarno pretplaćuju za svaki
// ekran — vidi pozive u GatePageClient/CheckInPageClient/
// CombinedPageClientV2/departures/split-board/border/assign-checkin).
//
// VAŽNO: hooks/useRealtimeAssignments.ts MORA se pretplatiti SAMO na
// kanale koje uloga smije čitati (uslovno, na osnovu role) — inače
// Ably vraća "Channel denied access based on given capability" čim
// hook pokuša da dotakne kanal koji token ne dozvoljava.
//
// 'checkin-assignments' je izbačen iz svih uloga — provjereno da ga
// nijedan klijent nigdje ne sluša (mrtav kanal iz ranije iteracije).
// ─────────────────────────────────────────────────────────────
const ROLE_CAPABILITIES: Record<string, Record<string, capabilityOp[]>> = {
  // Gate ekrani: useRealtimeFlightData('gate') + useRealtimeAssignments('gate')
  gate: {
    'flights:combined': ['subscribe'],
    'assignments:gates': ['subscribe'],
  },
  // Check-in ekrani: useRealtimeFlightData('checkin') + useRealtimeAssignments('checkin')
  checkin: {
    'flights:combined': ['subscribe'],
    'assignments:desks': ['subscribe'],
  },
  // Combined / departures / split-board / admin assign-checkin — trebaju i gate i desk info
  board: {
    'flights:combined': ['subscribe'],
    'assignments:desks': ['subscribe'],
    'assignments:gates': ['subscribe'],
  },
  // Border (arrivals-only) — ne treba mu nijedan assignments kanal
  arrivals: {
    'flights:combined': ['subscribe'],
  },
  // ── PA / Razglas (v5.8) — ekran u operativnom centru koji čita
  // tekst najava i pušta ih preko Web Speech API-ja (TTS) na
  // pojačalo. Namjerno NAJUŽI mogući capability — subscribe SAMO
  // na 'announcements:pa', ništa od flight/assignments podataka
  // (ova uloga ih ne prikazuje, nema razloga da ih i može čitati).
  pa: {
    'announcements:pa': ['subscribe'],
    // v5.9: 'flights:combined' subscribe dodat — PA sad sam evaluira
    // letove (checkin/boarding/final pozivi, kašnjenja, otkazivanja,
    // promjene izlaza) i automatski najavljuje, ne samo ono što admin
    // ručno pošalje. Vidi app/pa/PaPageClient.tsx + lib/pa-announcements.ts.
    'flights:combined': ['subscribe'],
  },
};

const VALID_ROLES = Object.keys(ROLE_CAPABILITIES);

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>(resolve => setTimeout(() => resolve(fallback), ms)),
  ]);
}

function getClientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return request.headers.get('x-real-ip') || 'unknown';
}

/**
 * Fiksni-prozor brojač u Redisu. Vraća { allowed, count, retryAfterSec }.
 * Fail-open ako Redis baci grešku.
 */
async function checkRateLimit(
  key: string,
  limit: number,
  windowSec: number
): Promise<{ allowed: boolean; count: number; retryAfterSec: number }> {
  try {
    const client = getRedisClient();
    const count = await client.incr(key);
    if (count === 1) {
      await client.expire(key, windowSec);
    }
    if (count > limit) {
      const ttl = await client.ttl(key);
      return { allowed: false, count, retryAfterSec: ttl > 0 ? ttl : windowSec };
    }
    return { allowed: true, count, retryAfterSec: 0 };
  } catch (err) {
    console.error('[ably-token] rate limit check failed, failing open:', err);
    return { allowed: true, count: 0, retryAfterSec: 0 };
  }
}

export async function GET(request: Request) {
  const ip = getClientIp(request);
  const nowMinuteBucket = Math.floor(Date.now() / (PER_IP_WINDOW_SEC * 1000));

  // ── Validacija uloge — PRIJE rate-limit provjera, da nevažeći
  // zahtjevi ne troše budžet rate-limitera namijenjen legitimnom
  // saobraćaju. 400 je jeftin (nema Redis poziva), pa ovo ne otvara
  // novi vektor za trošak. ──
  const { searchParams } = new URL(request.url);
  const role = searchParams.get('role') ?? '';
  const capability = ROLE_CAPABILITIES[role];

  if (!capability) {
    console.warn(`[ably-token] Nevažeća ili nedostajuća uloga: "${role}" (očekivano jedno od: ${VALID_ROLES.join(', ')})`);
    return NextResponse.json(
      { error: `Nedostaje ili je nevažeći ?role= parametar. Očekivano jedno od: ${VALID_ROLES.join(', ')}` },
      { status: 400 }
    );
  }

  try {
    // ── 1. Globalni hard cap — posljednja linija odbrane ──────
    const globalKey = `ratelimit:ably-token:global:${Math.floor(Date.now() / (GLOBAL_WINDOW_SEC * 1000))}`;
    const globalCheck = await checkRateLimit(globalKey, GLOBAL_LIMIT, GLOBAL_WINDOW_SEC);

    if (!globalCheck.allowed) {
      console.warn(
        `🚨 [ably-token] GLOBAL rate limit hit: ${globalCheck.count} req/min (limit ${GLOBAL_LIMIT}). ` +
        `Moguć bug u reconnect logici na klijentu — provjeri Ably/Vercel dashboard.`
      );
      return NextResponse.json(
        { error: 'Too many requests, try again shortly' },
        {
          status: 429,
          headers: { 'Retry-After': String(globalCheck.retryAfterSec) },
        }
      );
    }

    // ── 2. Per-IP limit ────────────────────────────────────────
    const ipKey = `ratelimit:ably-token:ip:${ip}:${nowMinuteBucket}`;
    const ipCheck = await checkRateLimit(ipKey, PER_IP_LIMIT, PER_IP_WINDOW_SEC);

    if (!ipCheck.allowed) {
      console.warn(`⚠️ [ably-token] Per-IP rate limit hit for ${ip}: ${ipCheck.count} req/min (limit ${PER_IP_LIMIT})`);
      return NextResponse.json(
        { error: 'Too many requests from this network, try again shortly' },
        {
          status: 429,
          headers: { 'Retry-After': String(ipCheck.retryAfterSec) },
        }
      );
    }

    // ── 3. Normalna izrada tokena — SAMO kanali koje ova uloga smije ──
    //
    // TTL FIX — Edge Requests optimizacija (2026-08): TTL podignut sa 60min
    // na 12h. Ably Realtime klijent (lib/ably-client.ts) automatski obnavlja
    // token PRIJE isteka preko authUrl-a, i pošto Ably konekcija na kiosku
    // NIKAD ne zatvara (sharedAbly.close() se zove samo na beforeunload —
    // kiosk tab se nikad ne zatvara), stariji TTL od 60min je značio
    // 24 token-renew zahtjeva/dan PO KIOSKU, 24/7, bez obzira na noć —
    // NightClock gasi samo REST polling na combined/departures/split-board,
    // ne i samu Ably konekciju. Sa 41 kioskom to je bilo ~29.500
    // Edge Requests/mjesec SAMO za token-renew.
    //
    // 12h TTL -> 2 renew/dan/kiosk (12x manje) -> ~2.460/mjesec.
    // Trade-off: kompromitovan token (fizički izložen kiosk, neko pročita
    // iz dev-tools-a) je "živ" duže. Prihvatljivo jer je capability već
    // role-scoped na read-only + specifične kanale (vidi ROLE_CAPABILITIES
    // iznad) — duži TTL ne proširuje ŠTA token može, samo KOLIKO DUGO.
    // Ako želiš agresivnije (24h, Ably-jev maksimum -> ~1 renew/dan/kiosk,
    // ~1.230/mjesec), promijeni na 24 * 60 * 60 * 1000.
    const TOKEN_TTL_MS = 12 * 60 * 60 * 1000;

    const client = getAblyRest();
    const tokenRequest = await client.auth.createTokenRequest({
      capability,
      ttl: TOKEN_TTL_MS,
    });

    return NextResponse.json(tokenRequest);
  } catch (err) {
    console.error('[ably-token] error:', err);
    return NextResponse.json({ error: 'Token generation failed' }, { status: 500 });
  }
}