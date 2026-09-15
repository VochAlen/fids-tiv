// app/api/test/gate-status-override/route.ts
import { NextResponse } from 'next/server';
import { safeRedisHGetAll, safeRedisHGet, safeRedisHSet, safeRedisHDel, safeRedisExpire } from '@/lib/redis';
import { invalidateRawAssignmentsCache } from '@/lib/assignments-service';
import { createHash } from 'crypto';
import { revalidateTag } from 'next/cache';

// ── FIX — RACE CONDITION (izvještaj: "ne mogu da dodijelim let određenom
// gate-u"): ALL_KEY je bio JEDAN JSON string. POST je radio readAll() →
// izmijeni SAMO svoj gate → writeAll(cijeli objekat) — nije atomarno. Dva
// istovremena zahtjeva za RAZLIČITE gate-ove su mogla da se sudare, jer oba
// čitaju isti stari snapshot pa drugi write tiho prepiše (obriše) izmjenu
// koju je upisao prvi, iako se ticala drugog gate-a. Sad je ALL_KEY Redis
// HASH — jedno polje (HSET) po gate-u, atomarno nezavisno od svih ostalih
// polja. Pun kontekst: vidi komentar u lib/redis.ts iznad safeRedisHSet.

//  export const dynamic = 'force-dynamic';

const MAX_AGE_MS = 6 * 60 * 60 * 1000; // 6 sati
const TTL_SECONDS = 21_600;            // 6h
const ALL_KEY = 'test:gate-status:all';
let cachedAll: Record<string, GateEntry> | null = null;
let cachedAllExpiry = 0;
let cacheRefreshing = false;
const CACHE_TTL_MS = 10_000;

// ── AŽURIRANO (optimizacija Edge Requests): klijentski "brzi poll"
// koji je gađao ovu rutu na svakih 2-4s je UKLONJEN iz
// GatePageClient.tsx (vidi komentar "UKLONJENO" u tom fajlu) — gate
// override podatak sad stiže isključivo kroz gateEntries polje u
// odgovoru glavnog /api/flights poziva. Ova GET ruta trenutno nema
// aktivnog klijenta (provjereno grep-om kroz cijeli repo), ali je
// ostavljena netaknuta funkcionalno (samo je keš prozor produžen sa
// 2s na 10s) za slučaj da se u budućnosti ponovo poveže neki
// dashboard/admin prikaz na nju. Ako se to desi, GATE_STATUS_CACHE_
// CONTROL treba uskladiti sa stvarnim interval-om tog novog klijenta,
// isto kao što je ranije bilo usklađeno sa FAST_POLL_BASE_MS.
// FIX (Vercel Edge Requests/Active CPU trošak na 12 gate monitora × 9-12s
// poll = ~2.96M poziva/mjesec, GOTOVO SVI stvarna izvršavanja funkcije):
// prethodni keš prozor (2-3s) je bio KRAĆI od poll intervala (9-12s), pa
// CDN keš NIKAD nije stigao da "pogodi" — svaki poll je bio garantovano
// stvarno izvršavanje funkcije, iako POST handler ispod već poziva
// `revalidateTag('flight-status')` + šalje Vercel-Cache-Tag header, što
// je dokumentovana Vercel funkcija (radi na SVIM planovima, uključujući
// Pro) za TRENUTNU invalidaciju keša čim se nešto stvarno promijeni —
// kratak TTL kao jedini mehanizam propagacije bio je nepotreban.
// Sad je s-maxage=20s (duplo duže od poll intervala) — kad se NIŠTA ne
// promijeni, CDN servira keširan odgovor umjesto da pokreće funkciju, pa
// stvarna izvršavanja padaju otprilike 2x. Kad se NEŠTO promijeni,
// revalidateTag() odmah invalidira keš — sledeći poll (isti 9-12s
// interval kao i prije) i dalje vidi promjenu, propagacija ostaje ista
// kao prije. stale-while-revalidate=20 je SAMO fallback ako iz bilo kog
// razloga tag-invalidacija ne bi radila (worst-case do ~40s umjesto ~5s)
// — nakon deploy-a provjeri Vercel dashboard (Functions → Invocations za
// ovu rutu) da potvrdiš stvaran pad, i prati par dana da li se dodjele/
// uklanjanja gate-ova i dalje vide u očekivanom roku. Ako se bilo šta
// vidi sporije nego prije, vrati na 'public, max-age=2, s-maxage=2,
// stale-while-revalidate=3' — to je jedina promjena za rollback.
const GATE_STATUS_CACHE_CONTROL =
  'public, max-age=2, s-maxage=20, stale-while-revalidate=20';


type GateEntry = {
  status: 'open' | 'closed' | null;
  flightNumber: string;
  classType: string | null;
  setAt: number | null;
};

function parseHashEntries(raw: Record<string, string> | null): Record<string, GateEntry> {
  if (!raw) return {};
  const out: Record<string, GateEntry> = {};
  for (const [field, json] of Object.entries(raw)) {
    try {
      out[field] = JSON.parse(json) as GateEntry;
    } catch {
      // izolovano oštećeno polje — preskoči, ne ruši ostatak
    }
  }
  return out;
}

async function readAll(): Promise<Record<string, GateEntry>> {
  const raw = await safeRedisHGetAll(ALL_KEY);
  return parseHashEntries(raw);
}

// ── 2) Dodaj ODMAH ISPOD postojeće readAll() funkcije ──
 
async function readAllCached(): Promise<Record<string, GateEntry>> {
  const now = Date.now();
 
  if (cachedAll && now < cachedAllExpiry) {
    return cachedAll;
  }
  if (cacheRefreshing && cachedAll) {
    return cachedAll;
  }
 
  cacheRefreshing = true;
  try {
    const fresh = await readAll();
    cachedAll = fresh;
    cachedAllExpiry = now + CACHE_TTL_MS;
    return fresh;
  } finally {
    cacheRefreshing = false;
  }
}
 

// Više se NE koristi za pisanje pojedinačnih izmjena (to sad ide preko
// writeOne/deleteOne ispod, atomarno po polju). Ostavljeno samo za GET-time
// batch čišćenje starih zapisa (gdje je već potreban cijeli snapshot da bi
// se znalo šta treba obrisati), i to preko individualnih HDEL poziva —
// vidi cleanupStale() ispod, ne prepisuje cijeli hash.
async function touchExpiry(): Promise<void> {
  await safeRedisExpire(ALL_KEY, TTL_SECONDS);
}

// Piše TAČNO JEDNO polje (jedan gate) — atomarno, ne dira ostale gate-ove.
// FIX (assign-checkin ne prikazuje dodijeljene gate-ove): vraća boolean iz
// safeRedisHSet — ako je Redis circuit breaker otvoren ili je došlo do
// greške, safeRedisHSet vraća false. Bez ovog check-a, POST handler bi
// vratio `{ success: true }` iako zapis NIJE upisan — admin vidi toast
// "Gate 21 → W61234 dodijeljen" ali zapis u Redis-u ne postoji, pa
// /api/test/assignments i gate monitor ne vide ništa. Sada vraćamo 500
// da admin zna da nešto nije u redu i da ponovi akciju.
async function writeOne(gateNumber: string, entry: GateEntry): Promise<boolean> {
  const ok = await safeRedisHSet(ALL_KEY, gateNumber, JSON.stringify(entry));
  if (!ok) return false;
  await safeRedisExpire(ALL_KEY, TTL_SECONDS);
  return true;
}

async function deleteOne(gateNumber: string): Promise<void> {
  await safeRedisHDel(ALL_KEY, gateNumber);
}

// Briše SAMO stara polja (identifikovana u pozivaocu) — pojedinačni HDEL po
// polju, ne prepisuje cijeli hash. Manji je rizik od namjerno prihvaćenog:
// ako se neko polje osvježi TAČNO između čitanja i ovog brisanja, obrisaće se
// ta (svježa) vrijednost — isti, zanemarljivo mali prozor koji je postojao i
// u staroj implementaciji, ali sad ograničen na POJEDINAČNO polje umjesto da
// cijeli hash rizikuje da bude prepisan.
async function cleanupStale(fields: string[]): Promise<void> {
  await Promise.all(fields.map(f => safeRedisHDel(ALL_KEY, f)));
}


export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const gateNumber = searchParams.get('gateNumber');
    const now = Date.now();

const all = await readAllCached();

    // ── ČIŠĆENJE STARIH ZAPISA — sad HDEL po polju (vidi cleanupStale) ──
    const staleFields: string[] = [];
    for (const key of Object.keys(all)) {
      const entry = all[key];
      if (entry.setAt && now - entry.setAt > MAX_AGE_MS) {
        delete all[key]; // ukloni i iz lokalne kopije koja se vraća/keš-uje
        staleFields.push(key);
      }
    }
    if (staleFields.length > 0) {
      await cleanupStale(staleFields);
      console.log(`[gate-cleanup] Total cleaned: ${staleFields.length} old gate-status keys`);
    }

    // ── IZRAČUNAVANJE ETag ──────────────────────────────────
    const payload = gateNumber
      ? { gateNumber, entry: all[gateNumber] ?? { status: null, flightNumber: null, classType: null, setAt: null } }
      : { all };
    const hash = createHash('md5')
      .update(JSON.stringify(payload))
      .digest('hex')
      .substring(0, 16);
    const etag = `"${hash}"`;

    // ── PROVJERA If-None-Match ──────────────────────────────
    const ifNoneMatch = request.headers.get('if-none-match');
    if (ifNoneMatch && ifNoneMatch === etag) {
      return new NextResponse(null, {
        status: 304,
        headers: {
          'ETag': etag,
          // I u 304 grani i u normalnom odgovoru, sve tri header linije:
          'Cache-Control': GATE_STATUS_CACHE_CONTROL,
          'CDN-Cache-Control': GATE_STATUS_CACHE_CONTROL,
          'Vercel-CDN-Cache-Control': GATE_STATUS_CACHE_CONTROL,
          // FIX (klasa/status vidljiviji na gate ekranu): bilo je samo
          // Cache-Control bez Cache-Tag-a. revalidateTag('flight-status')
          // koji POST handler poziva nakon dodjele/uklanjanja/klase NIJE
          // probijao CDN keš ove rute jer CDN nije znao da je ovaj odgovor
          // tagiran sa 'flight-status'. Dodajemo i 'Cache-Tag' i
          // 'Vercel-Cache-Tag' — Vercel-CDN-Cache-Tag je onaj koji Vercel
          // CDN stvarno prepoznaje za tag-based invalidaciju, 'Cache-Tag'
          // je ostavljen radi šire kompatibilnosti.
          'Cache-Tag': 'flight-status',
          'Vercel-Cache-Tag': 'flight-status',
        },
      });
    }

    // ── NORMALAN ODGOVOR ────────────────────────────────────
    const headers: Record<string, string> = {
      // I u 304 grani i u normalnom odgovoru, sve tri header linije:
      'Cache-Control': GATE_STATUS_CACHE_CONTROL,
      'CDN-Cache-Control': GATE_STATUS_CACHE_CONTROL,
      'Vercel-CDN-Cache-Control': GATE_STATUS_CACHE_CONTROL,

      'ETag': etag,
      // FIX (vidi komentar gore kod 304 grane): bez ovog tag-a,
      // revalidateTag('flight-status') koji POST handler poziva nije
      // probijao CDN keš ove rute — gate monitor čekao do 5s da vidi
      // novu dodjelu iako je server već znao za nju.
      'Cache-Tag': 'flight-status',
      'Vercel-Cache-Tag': 'flight-status',
    };

    if (gateNumber) {
      const entry = all[gateNumber] ?? { status: null, flightNumber: null, classType: null, setAt: null };
      return NextResponse.json(entry, { headers });
    }

    return NextResponse.json(all, { headers });
  } catch (err) {
    console.error('[gate-status-override] GET error:', err instanceof Error ? err.message : err);
    return NextResponse.json({}, { status: 200, headers: { 'Cache-Control': 'no-cache' } });
  }
}

export async function POST(request: Request) {
  const { gateNumber, action, flightNumber, classType } = await request.json();

  if (!gateNumber) {
    return NextResponse.json({ error: 'gateNumber required' }, { status: 400 });
  }

  // ── FIX (race condition): čitamo SAMO polje ovog gate-a (HGET), i pišemo
  // SAMO njega nazad (HSET) — ne cijeli objekat. Dva istovremena zahtjeva za
  // RAZLIČITE gate-ove sad ne mogu da se sudare, jer je svaki HSET izolovan
  // na svoje polje. Usput i jeftinije od HGETALL — prenosi se samo jedno
  // polje umjesto svih gate-ova pri svakom POST-u.
  const existingRaw = await safeRedisHGet(ALL_KEY, gateNumber);
  let existing: GateEntry | undefined;
  if (existingRaw) {
    try { existing = JSON.parse(existingRaw) as GateEntry; } catch { existing = undefined; }
  }

  if (action === 'open' && flightNumber) {
    const entry: GateEntry = {
      status: 'open',
      flightNumber,
      classType: existing?.classType ?? null,
      setAt: Date.now(),
    };
    if (!(await writeOne(gateNumber, entry))) {
      return NextResponse.json(
        { error: 'Redis write failed — pokušajte ponovo za nekoliko sekundi' },
        { status: 503 }
      );
    }
  } else if (action === 'closed') {
    const entry: GateEntry = {
      status: 'closed',
      flightNumber: flightNumber || '',
      classType: existing?.classType ?? null,
      setAt: Date.now(),
    };
    if (!(await writeOne(gateNumber, entry))) {
      return NextResponse.json(
        { error: 'Redis write failed — pokušajte ponovo za nekoliko sekundi' },
        { status: 503 }
      );
    }
  } else if (action === 'clear') {
    await deleteOne(gateNumber);
  } else if (action === 'setClass') {
    if (!existing) {
      return NextResponse.json({ error: 'No active assignment' }, { status: 400 });
    }
    const entry: GateEntry = { ...existing, classType: classType ?? null };
    if (!(await writeOne(gateNumber, entry))) {
      return NextResponse.json(
        { error: 'Redis write failed — pokušajte ponovo za nekoliko sekundi' },
        { status: 503 }
      );
    }
  } else {
    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  }

  // FIX (assign-checkin ne prikazuje dodijeljene gate-ove): bilo je
  // samo `cachedAll = null; cachedAllExpiry = 0;` — to čisti samo
  // OVU rutinu-local keš, NE i cachedRaw u lib/assignments-service.ts.
  // Posljedica: assign-checkin panel ne vidi novu dodjelu do 8s kasnije.
  // Sada invalidate i assignments-service modul-level keš — sledeći GET
  // /api/test/assignments ODMAH čita svježe iz Redisa.
  cachedAll = null;
  cachedAllExpiry = 0;
  invalidateRawAssignmentsCache();

  // ── Odmah probij CDN keš na /api/flights/status — isti razlog kao
  // kod desk-status-override.
  //
  // NAPOMENA: ovo NE utiče na CDN keš OVOG GET handlera (onaj koristi
  // sirova HTTP Cache-Control zaglavlja / Vercel Edge keš, ne Next-ov
  // Data Cache sistem tagova koji revalidateTag() cilja). To znači da
  // nakon admin akcije, /api/test/gate-status-override i dalje može
  // servirati keširan odgovor do isteka gornjeg GATE_STATUS_CACHE_CONTROL
  // prozora (sad ~4s) — to je namjerno i očekivano, ne bug. Ako ikad
  // zatreba INSTANT propagacija bez ikakvog čekanja, trebalo bi ili
  // dodatno pozvati Vercel-ov CDN purge API za ovu specifičnu putanju,
  // ili prebaciti ovaj GET na Next-ov tag-based cache (unstable_cache +
  // revalidateTag) umjesto sirovih headera — veća promjena, po potrebi.
  revalidateTag('flight-status');

  const ttl = action === 'clear' ? undefined : TTL_SECONDS;
  return NextResponse.json({ success: true, ...(ttl ? { ttl } : {}) });
}