// public/sw.js
//
// Keš SAMO za /_next/static/* (content-hash imenovani fajlovi) — HTML, /api/* i Ably nikad ne prolaze kroz ovaj sloj.
//
// v2 (2026-10-20) — ISPRAVKE (kiosk računari na kojima se stranica nije otvarala ni poslije restarta aplikacije):
//  1) Ranije se KEŠIRAO SVAKI `response.ok`, bez provjere sadržaja. Cache-first + "ok" = ako je u jednom trenutku
//     (deploy/rollback, mrežni proxy, privremeni kvar) na URL JS fajla stigao 200 sa drugačijim sadržajem (npr. HTML),
//     taj odgovor je ostajao u kešu ZAUVIJEK i rušio stranicu na tom računaru, bez obzira na restart aplikacije.
//     Sad se kešira samo odgovor čiji je Content-Type očekivan za statički resurs (nikad text/html).
//  2) CACHE_VERSION je podignut na v2: čim browser preuzme ovaj sw.js (provjerava ga sam pri navigaciji, i bez
//     izvršavanja JS-a stranice), `activate` BRIŠE sve starije keševe (fids-static-v1 i sl.) — dakle i već
//     zatrovane unose — bez ikakvog fizičkog čišćenja keša na računaru. Za buduće čišćenje dovoljno je podići broj.
const CACHE_VERSION = 'fids-static-v2';

const OK_TYPE = /(javascript|ecmascript|css|font|woff|image\/|octet-stream|wasm|json)/i;

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('fids-static-') && k !== CACHE_VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (!url.pathname.startsWith('/_next/static/')) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_VERSION);
    const cached = await cache.match(event.request);
    if (cached) return cached;

    const response = await fetch(event.request);
    try {
      const type = response.headers.get('content-type') || '';
      if (response.status === 200 && response.type === 'basic' && OK_TYPE.test(type) && !/text\/html/i.test(type)) {
        await cache.put(event.request, response.clone());
      }
    } catch (e) { /* keširanje je best-effort — odgovor se svejedno vraća */ }
    return response;
  })());
});
