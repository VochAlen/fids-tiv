// lib/redis.ts
import Redis from 'ioredis';

// ─────────────────────────────────────────────────────────────
// Singleton instance — nikad se ne nullira na error,
// ioredis interno reconnektuje
// ─────────────────────────────────────────────────────────────
let redis: Redis | null = null;

// Circuit breaker — ako Redis pada, ne šaljemo nove komande
// dok se ne stabilizuje
let circuitOpen = false;
let circuitOpenedAt = 0;
const CIRCUIT_COOLDOWN_MS = 10_000; // 10s pauza nakon pada

// ═════════════════════════════════════════════════════════════
// SIGURNOSNA IZOLACIJA — LOKALNO/PREVIEW TESTIRANJE NIKAD NE
// SMIJE DIRATI PRAVE PRODUKCIJSKE PODATKE
// ═════════════════════════════════════════════════════════════
// KONTEKST: FIDS_REDIS_URL u .env.local je ISTA konekciona niska koju
// koristi i prava produkcija (nema posebne test baze). Ranije testiranje
// na localhost-u je paralelno sa live sistemom obrisalo sve dodijeljene
// letove — jer su OBA sistema pisala/čitala IDENTIČNE Redis ključeve
// (npr. "test:gate-status:all"), pa je svaki lokalni test-klik odmah bio
// vidljiv (i mogao biti prepisan/obrisan) na pravim, live monitorima.
//
// FIX: svaka Redis komanda koja NIJE pokrenuta na pravom Vercel
// PRODUCTION deployment-u automatski dobija prefiks "dev:" ispred SVAKOG
// ključa (ioredis-ova ugrađena "keyPrefix" opcija — primjenjuje se na
// svaku komandu, iz svakog fajla koji koristi getRedisClient(), bez
// izuzetka, bez mogućnosti da se neko mjesto u kodu "zaboravi" prefiksirati
// jer se prefiks dodaje na najnižem nivou, u samom ioredis klijentu).
//
// Rezultat: lokalni `npm run dev` i Vercel Preview deployment-i AUTOMATSKI
// čitaju/pišu u potpuno IZOLOVAN skup ključeva (npr. "dev:test:gate-status:all")
// — čak i kad pokazuju na ISTU Redis instancu kao produkcija. Nema šanse
// da lokalni test slučajno obriše ili prepiše bilo šta live.
//
// KAKO SE PREPOZNAJE "prava produkcija": Vercel AUTOMATSKI postavlja
// VERCEL_ENV=production isključivo na pravom production deployment-u —
// ovo NIJE nešto što se može slučajno pokrenuti sa localhost-a ili iz
// Preview deployment-a. Sve ostalo (localhost, `next build && next start`
// lokalno, Vercel Preview) NEMA VERCEL_ENV=production, pa automatski
// dobija sigurnosni prefiks — bez potrebe da se bilo šta ručno podešava
// ili pamti pri svakom testiranju.
function getRedisKeyPrefix(): string {
  const isRealProduction = process.env.VERCEL_ENV === 'production';
  return isRealProduction ? '' : 'dev:';
}

export function getRedisClient(): Redis {
  if (!redis) {
    const redisUrl = process.env.FIDS_REDIS_URL;
    if (!redisUrl) {
      throw new Error('FIDS_REDIS_URL environment variable is not defined');
    }

    const keyPrefix = getRedisKeyPrefix();

    // Vrlo vidljiva poruka pri startu — nemoguće je propustiti u kojem
    // režimu aplikacija trenutno radi.
    if (keyPrefix) {
      console.log(`🔒 [Redis] DEV/PREVIEW režim — svi ključevi izolovani prefiksom "${keyPrefix}". Produkcijski (live) podaci NISU dostupni niti mogu biti izmijenjeni odavde.`);
    } else {
      console.log('🔴 [Redis] PRODUCTION režim — koriste se PRAVI produkcijski ključevi.');
    }

    redis = new Redis(redisUrl, {
      // ── Izolacija ključeva (vidi opširan komentar iznad) ───
      keyPrefix,

      // ── Timeouts ──────────────────────────────────────────
      connectTimeout: 4_000,      // Maks 4s za uspostavljanje konekcije
      commandTimeout: 3_000,      // Maks 3s čekanja na odgovor komande — ovo je bio problem!

      // ── Retry logika ──────────────────────────────────────
      maxRetriesPerRequest: 1,    // Samo 1 retry (ne 2) — smanjuje ukupno čekanje
      enableReadyCheck: true,
      lazyConnect: true,

      retryStrategy(times) {
        // Eksponencijalni backoff, maks 8s između pokušaja
        // Vraća null nakon 5 pokušaja — ioredis tada emituje error i staje
        if (times > 5) return null;
        return Math.min(times * 500, 8_000);
      },
    });
redis.on('error', (err: Error) => {
  console.error(`[Redis] Error: ${err.message} — circuit breaker OPEN for ${CIRCUIT_COOLDOWN_MS}ms`);
  circuitOpen = true;
  circuitOpenedAt = Date.now();
});

    redis.on('connect', () => {
      console.log('[Redis] Connected');
      // Zatvori circuit breaker čim se konekcija uspostavi
      circuitOpen = false;
    });

    redis.on('ready', () => {
      console.log('[Redis] Ready');
      circuitOpen = false;
    });

    redis.on('reconnecting', (delay: number) => {
      console.log(`[Redis] Reconnecting in ${delay}ms...`);
    });
  }

  return redis;
}

// ─────────────────────────────────────────────────────────────
// safeRedisGet — koristi se u svim GET API rutama umjesto
// direktnog client.get(). Vraća null na svaki problem.
// ─────────────────────────────────────────────────────────────
export async function safeRedisGet(key: string): Promise<string | null> {
  // Provjeri circuit breaker
  if (circuitOpen) {
    const elapsed = Date.now() - circuitOpenedAt;
    if (elapsed < CIRCUIT_COOLDOWN_MS) {
      // Circuit je otvoren i cooldown nije prošao — odmah vrati null
      return null;
    }
    // Cooldown je prošao — pokušaj ponovo (circuit se zatvara na 'ready')
    circuitOpen = false;
  }

  try {
    const client = getRedisClient();
    return await client.get(key);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[Redis] safeRedisGet("${key}") failed: ${msg}`);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────
// safeRedisHGetAll — za hash komande (override:* ključevi)
//
// FIX (WRONGTYPE greška u produkciji): ključevi test:gate-status:all i
// test:desk-status:all su u produkciji već postojali kao JEDAN JSON STRING
// (stara, pre-migracije verzija koda — vidi komentar iznad safeRedisHSet).
// Kad je kod prešao na HGETALL, Redis je za takav "stari" ključ vratio
// grešku "WRONGTYPE Operation against a key holding the wrong kind of
// value" — jer ključ i dalje fizički drži STRING tip u samom Redis-u, a
// HGETALL radi samo nad HASH tipom. Migracija koda nije automatski
// migrirala i POSTOJEĆE podatke u Redis-u.
//
// Ovo se sad rješava TRANSPARENTNO, na prvom sledećem čitanju: ako HGETALL
// vrati WRONGTYPE, pretpostavljamo da je ključ zaostali JSON string,
// pročitamo ga (GET), parsiramo, i "preselimo" svako polje u pravi HASH
// (HSET po polju), pa obrišemo stari string ključ (DEL) da se greška ne
// ponavlja na sledećem pozivu. Ako paralelno stigne drugi zahtjev i uradi
// istu migraciju istovremeno — bezopasno, oba pišu identične vrijednosti,
// nema gubitka/korupcije podataka. Ako stari string nije validan JSON
// (oštećen), samo obrišemo ključ i vratimo prazan hash (isto ponašanje kao
// da ključ nikad nije ni postojao — gate/desk statusi jednostavno kreću
// iz praznog stanja, ne rušimo aplikaciju).
// ─────────────────────────────────────────────────────────────
export async function safeRedisHGetAll(key: string): Promise<Record<string, string> | null> {
  if (circuitOpen && Date.now() - circuitOpenedAt < CIRCUIT_COOLDOWN_MS) {
    return null;
  }
  circuitOpen = false;

  try {
    const client = getRedisClient();
    const result = await client.hgetall(key);
    // ioredis vraća {} kad ključ ne postoji — normalizuj u null
    return Object.keys(result).length > 0 ? result : null;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);

    if (msg.includes('WRONGTYPE')) {
      console.warn(`[Redis] safeRedisHGetAll("${key}") — WRONGTYPE detektovan, pokrećem jednokratnu migraciju string→hash...`);
      const migrated = await migrateStringKeyToHash(key);
      if (migrated) return Object.keys(migrated).length > 0 ? migrated : null;
      // Migracija nije uspjela (npr. i GET je pao) — nastavi na normalan
      // error-log ispod, vrati null kao i za bilo koju drugu grešku.
    } else {
      console.error(`[Redis] safeRedisHGetAll("${key}") failed: ${msg}`);
    }
    return null;
  }
}

// Jednokratna samoisceljujuća migracija: stari JSON string ključ → pravi
// Redis HASH, isto ime ključa. Vidi opširan komentar iznad safeRedisHGetAll.
async function migrateStringKeyToHash(key: string): Promise<Record<string, string> | null> {
  try {
    const client = getRedisClient();
    const raw = await client.get(key);

    if (!raw) {
      // Ključ je u međuvremenu nestao (npr. istekao TTL) — nema šta da
      // se migrira, samo javi "prazno", normalno stanje.
      return {};
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(raw);
    } catch {
      console.error(`[Redis] migrateStringKeyToHash("${key}") — stari string nije validan JSON, brišem ključ i krećem iz praznog stanja`);
      await client.del(key);
      return {};
    }

    const entries = Object.entries(parsed);
    // KRITIČNO: Redis NIKAD ne dozvoljava HSET na ključu koji i dalje
    // fizički drži STRING vrijednost — takav HSET bi i sam bacio
    // WRONGTYPE (identična greška, samo pomjerena za jedan korak). Zato
    // MORAMO prvo eksplicitno obrisati stari string ključ, pa TEK ONDA
    // (ako ima šta) upisati hash polja. Prozor između DEL i pipeline HSET
    // je izuzetno kratak (jedan Redis round-trip); i kad bi neki paralelni
    // zahtjev tu "upao", najgori ishod je da privremeno vidi prazan hash
    // umjesto starog stanja — bezopasno za ovaj tip prolaznih statusnih
    // podataka, i dešava se samo jednom, dok se stari ključ ne migrira.
    await client.del(key);
    if (entries.length > 0) {
      const pipeline = client.pipeline();
      for (const [field, value] of entries) {
        pipeline.hset(key, field, typeof value === 'string' ? value : JSON.stringify(value));
      }
      await pipeline.exec();
    }

    console.log(`[Redis] migrateStringKeyToHash("${key}") — migrirano ${entries.length} polja string→hash`);

    const out: Record<string, string> = {};
    for (const [field, value] of entries) {
      out[field] = typeof value === 'string' ? value : JSON.stringify(value);
    }
    return out;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[Redis] migrateStringKeyToHash("${key}") failed: ${msg}`);
    return null;
  }
}

// lib/redis.ts – dodati nakon safeRedisHGetAll

export async function safeRedisSet(key: string, value: string, ttlSeconds?: number): Promise<boolean> {
  if (circuitOpen && Date.now() - circuitOpenedAt < CIRCUIT_COOLDOWN_MS) {
    return false;
  }
  circuitOpen = false;

  try {
    const client = getRedisClient();
    if (ttlSeconds) {
      await client.setex(key, ttlSeconds, value);
    } else {
      await client.set(key, value);
    }
    return true;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[Redis] safeRedisSet("${key}") failed: ${msg}`);
    return false;
  }
}

export async function safeRedisDel(key: string): Promise<boolean> {
  if (circuitOpen && Date.now() - circuitOpenedAt < CIRCUIT_COOLDOWN_MS) {
    return false;
  }
  circuitOpen = false;

  try {
    const client = getRedisClient();
    await client.del(key);
    return true;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[Redis] safeRedisDel("${key}") failed: ${msg}`);
    return false;
  }
}

// ─────────────────────────────────────────────────────────────
// FIX — RACE CONDITION u gate/desk assignment-ima:
// Ranije su test:gate-status:all i test:desk-status:all bili JEDAN JSON
// string (čitan preko safeRedisGet, pisan preko safeRedisSet). POST handler
// je radio: pročitaj CIJELI objekat → izmijeni SAMO svoj gate/desk →
// upiši CIJELI objekat nazad ("read-modify-write"). To NIJE atomarno:
// ako dva zahtjeva (dva različita gate-a, ili dva člana osoblja na
// različitim uređajima) stignu skoro istovremeno, oba pročitaju ISTI
// stari snapshot, oba upišu svoju izmjenu NA VRH tog istog snapshot-a —
// i drugi write tiho prepiše (obriše) izmjenu koju je upisao prvi,
// iako se ticala SASVIM DRUGOG gate-a/deska. Otud prijava "ne mogu da
// dodijelim let određenom gate-u" — dodjela je kratko "prošla", pa je
// nestala kad je stigao sljedeći, nepovezani write.
//
// FIX: umjesto jednog JSON blob-a, koristimo Redis HASH — jedno polje
// (HSET) po gate-u/desku. HSET je ATOMARAN na nivou pojedinačnog polja:
// dva istovremena zahtjeva za RAZLIČITE gate-ove/deskove više uopšte ne
// mogu da se sudare, jer svaki upisuje samo svoje polje, ne cijelu mapu.
// (Dva istovremena zahtjeva za ISTI gate i dalje važe "zadnji upis
// pobjeđuje" — to je očekivano i ispravno ponašanje za isti resurs, ne
// bug.) HDEL, HGETALL i HGET su takođe atomarni.
// ─────────────────────────────────────────────────────────────
export async function safeRedisHGet(key: string, field: string): Promise<string | null> {
  if (circuitOpen && Date.now() - circuitOpenedAt < CIRCUIT_COOLDOWN_MS) {
    return null;
  }
  circuitOpen = false;

  try {
    const client = getRedisClient();
    return await client.hget(key, field);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);

    // FIX (WRONGTYPE, vidi opširan komentar iznad safeRedisHGetAll): ovo
    // je čest ULAZNI poziv za POST akcije (open/close/assign) — AKO se
    // ne migrira i ovdje, dodjela gate-a/šaltera bi tiho pucala na
    // zaostalom string ključu prije nego što ijedan GET/HGETALL stigne da
    // ga migrira. Migriraj, pa POKUŠAJ PONOVO isti HGET jednom.
    if (msg.includes('WRONGTYPE')) {
      console.warn(`[Redis] safeRedisHGet("${key}") — WRONGTYPE, migriram i ponavljam...`);
      const migrated = await migrateStringKeyToHash(key);
      if (migrated) return migrated[field] ?? null;
    } else {
      console.error(`[Redis] safeRedisHGet("${key}", "${field}") failed: ${msg}`);
    }
    return null;
  }
}

export async function safeRedisHSet(key: string, field: string, value: string): Promise<boolean> {
  if (circuitOpen && Date.now() - circuitOpenedAt < CIRCUIT_COOLDOWN_MS) {
    return false;
  }
  circuitOpen = false;

  try {
    const client = getRedisClient();
    await client.hset(key, field, value);
    return true;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);

    if (msg.includes('WRONGTYPE')) {
      console.warn(`[Redis] safeRedisHSet("${key}") — WRONGTYPE, migriram i ponavljam upis...`);
      await migrateStringKeyToHash(key);
      // Migracija je (ako je uspjela) već obrisala stari string ključ i
      // upisala postojeća polja kao hash — sad je ključ pravog tipa,
      // ponovi ORIGINALNI upis da se izmjena koju je pozivalac tražio
      // stvarno i primijeni (migracija sama po sebi ne zna za NOVU
      // vrijednost koju POST handler upravo pokušava da postavi).
      try {
        const client = getRedisClient();
        await client.hset(key, field, value);
        return true;
      } catch (retryErr: unknown) {
        const retryMsg = retryErr instanceof Error ? retryErr.message : String(retryErr);
        console.error(`[Redis] safeRedisHSet("${key}", "${field}") failed nakon migracije: ${retryMsg}`);
        return false;
      }
    }

    console.error(`[Redis] safeRedisHSet("${key}", "${field}") failed: ${msg}`);
    return false;
  }
}

export async function safeRedisHDel(key: string, field: string): Promise<boolean> {
  if (circuitOpen && Date.now() - circuitOpenedAt < CIRCUIT_COOLDOWN_MS) {
    return false;
  }
  circuitOpen = false;

  try {
    const client = getRedisClient();
    await client.hdel(key, field);
    return true;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);

    if (msg.includes('WRONGTYPE')) {
      console.warn(`[Redis] safeRedisHDel("${key}") — WRONGTYPE, migriram (brisanje polja postaje no-op ako polje nakon migracije ne postoji)...`);
      const migrated = await migrateStringKeyToHash(key);
      if (migrated && field in migrated) {
        try {
          const client = getRedisClient();
          await client.hdel(key, field);
        } catch {
          // najbolji pokušaj — migracija je svakako uklonila WRONGTYPE stanje
        }
      }
      return true;
    }

    console.error(`[Redis] safeRedisHDel("${key}", "${field}") failed: ${msg}`);
    return false;
  }
}

// Postavlja TTL na CIJELI hash ključ (Redis nema per-field TTL van
// Redis 7.4+ HEXPIRE, a ne oslanjamo se na to jer nije garantovano na
// svim managed Redis provajderima). TTL se samo "osvježava" na cijeli
// ključ pri svakoj promjeni — dovoljno, jer je svrha samo da ključ ne
// živi zauvijek ako aplikacija prestane da ga čisti (postoji i eksplicitno
// GET-time čišćenje starih polja u obje override rute).
export async function safeRedisExpire(key: string, ttlSeconds: number): Promise<boolean> {
  if (circuitOpen && Date.now() - circuitOpenedAt < CIRCUIT_COOLDOWN_MS) {
    return false;
  }
  circuitOpen = false;

  try {
    const client = getRedisClient();
    await client.expire(key, ttlSeconds);
    return true;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[Redis] safeRedisExpire("${key}") failed: ${msg}`);
    return false;
  }
}