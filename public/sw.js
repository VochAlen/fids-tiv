// public/sw.js
//
// NOVO (po zahtjevu — inovativno smanjenje Edge Requests, bez
// ugrožavanja funkcionalnosti): mjereno stanje pokazuje KONSTANTNU
// (ne opadajuću, ne jednokratnu) stopu ponovljenih zahtjeva ka
// /_next/static/chunks/*.js — 3.5K/6h se tačno poklapa sa 14K/24h,
// što znači da kiosk browseri (Windows 7, Chrome 109) NE koriste
// standardni HTTP disk keš pouzdano između reload-ova, bez obzira na
// Cache-Control: immutable header koji server šalje. Umjesto da se
// oslanjamo na taj nepouzdan mehanizam, ovaj Service Worker uvodi
// SOPSTVEN, nezavisan sloj keširanja (Cache Storage API) — jednom
// registrovan u browseru, servira sve buduće zahtjeve za statičke
// fajlove BEZ ijednog mrežnog poziva, nezavisno od razloga zašto
// obični disk keš ne pomaže.
//
// KRITIČNA BEZBJEDNOSNA GRANICA — ŠTA SE NE KEŠIRA: ISKLJUČIVO
// /_next/static/* putanje se diraju ovdje. To su content-hash
// imenovani fajlovi (svaka izmjena koda dobija NOVO ime) — zauvijek
// bezbjedni za agresivno keširanje, isti princip kao
// "Cache-Control: immutable" koji server već šalje. Sve ostalo
// (HTML stranice, /api/* rute, Ably real-time podaci) NIKAD ne prolazi
// kroz ovaj keš — ostaje 100% isto ponašanje kao danas, uvijek svježe
// sa mreže. Ovo NIJE opšti "offline mod" — to bi bilo opasno za sistem
// koji MORA uvijek prikazivati stvarno, trenutno stanje.
const CACHE_VERSION = 'fids-static-v1';

self.addEventListener('install', (event) => {
  // skipWaiting: nova verzija service worker-a preuzima odmah, ne čeka
  // da se svi otvoreni tab-ovi zatvore (kiosk tab se nikad ne zatvara
  // sam od sebe, pa bi čekanje značilo da nova verzija nikad ne
  // preuzme kontrolu bez ručnog restarta browsera).
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  // Očisti STARE verzije keša (npr. nakon što se CACHE_VERSION broj
  // promijeni u budućem deploy-u) — sprečava neograničen rast Cache
  // Storage-a na kiosk disku tokom vremena.
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key.startsWith('fids-static-') && key !== CACHE_VERSION)
          .map((key) => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Dirati ISKLJUČIVO /_next/static/* — sve ostalo prolazi kroz
  // normalno, neizmijenjeno browser ponašanje (mreža, prati sve
  // postojeće Cache-Control header-e sa servera kao i do sada).
  if (!url.pathname.startsWith('/_next/static/')) {
    return;
  }

  event.respondWith(
    caches.open(CACHE_VERSION).then(async (cache) => {
      const cached = await cache.match(event.request);
      if (cached) {
        // Pogodak — servirano iz Cache Storage-a, NULA mrežnih poziva,
        // nula Edge Requests za ovaj konkretan zahtjev.
        return cached;
      }
      // Promašaj (prvi put da se ovaj tačan fajl traži na ovom
      // uređaju) — povuci sa mreže KAO I OBIČNO, ali sačuvaj kopiju za
      // SVAKI naredni zahtjev za isti fajl.
      try {
        const response = await fetch(event.request);
        if (response.ok) {
          cache.put(event.request, response.clone());
        }
        return response;
      } catch (err) {
        // Mreža nedostupna I nema keširane kopije — nema šta drugo da
        // se vrati, propagiraj grešku kao i bez service worker-a.
        throw err;
      }
    })
  );
});
