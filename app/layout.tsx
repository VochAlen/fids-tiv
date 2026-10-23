import { BUILD_ID } from '@/lib/build-id';
import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { ConsoleSuppressor } from "@/components/ConsoleSuppressor";
import { ServiceWorkerRegistration } from "@/components/ServiceWorkerRegistration";
import { SITE_URL } from "@/lib/site-content";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  // NOVO (AI/GEO, 2026-10-05): bez metadataBase relativni og:image i
  // canonical URL-ovi (vidi app/page.tsx) ne bi imali apsolutni domen.
  metadataBase: new URL(SITE_URL),
  title: "FIDS TIV — Flight Information Display System",
  description: "Tivat Airport Flight Information Display System",
};

// NOVO (KRITIČNO — pravi uzrok prijavljenog "mobilna optimizacija ne radi,
// slika grada i narandžasta oznaka se i dalje prikazuju na telefonu",
// 2026-09-27): BEZ ovog exporta, Next.js NE ubacuje
// <meta name="viewport">, pa mobilni browseri (Chrome na Androidu)
// renderuju stranicu na fiksnoj "desktop" layout širini (~980px) i samo
// je vizuelno smanjuju da stane na ekran — CSS `sm:` (640px) breakpoint
// tad UVIJEK "misli" da je na širem ekranu, čak i na telefonu poput
// Motorola G34 5G / Redmi 13/14 (stvarna CSS širina ~360-412px). Dodavanje
// width=device-width tjera browser da prijavi STVARNU širinu ekrana, čime
// svi `sm:`-osjetljivi prikazi (checkin mobilni layout, i bilo koji budući)
// počinju ispravno da rade. Ovo NE utiče na kiosk ekrane — oni su fizički
// širi od 640px, pa `sm:` stilovi ostaju identični kao i do sad.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

// NOVO (po zahtjevu — prijavljen bug "pojedini check-in monitori tokom
// reload-a ostanu zauvijek na 'Loading check-in information...'",
// 2026-09-27): OVO NIJE bug u React logici same stranice — čim se
// CheckInPageClient.tsx uspješno "upali" (hidrira) u browseru, njen
// useEffect ODMAH gasi loading state (nezavisno od mreže/Ably/Redis).
// Pravi uzrok je korak PRIJE toga: kad je internet na kiosku spor ili
// isprekidan BAŠ u trenutku reload-a, browser stigne da isprenta
// server-renderovan HTML (koji uvijek prikazuje "Loading..." kao
// početno stanje), ali JS paket (chunk) koji hidrira/pokreće React
// se prekine/ne stigne da se preuzme (poznato kao "ChunkLoadError" ili
// prosto prekinut download). Rezultat: statičan HTML ostaje zauvijek
// na ekranu jer se React nikad nije ni upalio da promijeni stanje —
// stranica NIJE zaglavljena u logici, nego se hidratacija nikad nije
// dogodila.
//
// Rješenje: inline <script> sa strategy="beforeInteractive" — Next.js
// ovo ubacuje u <head> i pokreće PRIJE glavnog JS paketa, pa radi čak
// i kad se sam React bundle nikad ne preuzme. Postavlja rok (20s) za
// check-in stranice: ako se React do tada nije upalio (vidi
// `window.__CHECKIN_APP_MOUNTED__`, koji CheckInPageClient.tsx
// postavlja u svom prvom useEffect-u), radi tvrd `location.reload()`.
// Ako je mreža i dalje loša, ovo se samo ponavlja dok se ne popravi —
// isti "pokušavaj dok ne uspije" princip kao ostali watchdog-ovi u
// projektu (data-staleness, memory-pressure, itd.), samo pokriva korak
// PRIJE nego što oni uopšte mogu da se aktiviraju.
const CHECKIN_HYDRATION_WATCHDOG_SCRIPT = `
(function () {
  if (!/\\/checkin\\//.test(location.pathname)) return;
  var DEADLINE_MS = 20000;
  // DIJAGNOSTIKA (2026-10-18): kiosk nema dostupnu konzolu → greške se ispisuju sitnim crvenim tekstom
  // u donjem lijevom uglu (i pamte u sessionStorage preko watchdog reload-a). Ništa ne mijenja ako grešaka nema.
  try {
    var KEY = '__checkin_diag__';
    // 2026-10-22: zapis ostaje u sessionStorage (za dijagnostiku), ali se na ekranu prikazuju SAMO redovi mlađi od
    // SHOW_MS — ranije je sitni crveni tekst ostajao zauvijek vidljiv putnicima (i poslije reload-a, i kad je greška davno prošla).
    var SHOW_MS = 90000;
    var SHOW_DIAG = false;
    try {
      if (/[?&]diag=1/.test(location.search)) sessionStorage.setItem('__checkin_diag_on__', '1');
      SHOW_DIAG = sessionStorage.getItem('__checkin_diag_on__') === '1';
    } catch (e) {}
    var lines = [];
    try { lines = JSON.parse(sessionStorage.getItem(KEY) || '[]'); } catch (e) {}
    if (!Array.isArray(lines)) lines = [];
    // stari format (običan string, bez vremena) se odbacuje
    lines = lines.filter(function (l) { return l && typeof l === 'object' && typeof l.t === 'number'; });
    var box = null;
    var render = function () {
      try {
        if (!document.documentElement) return;
        // 2026-10-22: overlay se NE prikazuje putnicima. Uključuje se samo za dijagnostiku: dodati ?diag=1 u URL
        // (pamti se u sessionStorage do zatvaranja aplikacije). Zapis grešaka u sessionStorage radi uvijek.
        if (!SHOW_DIAG) return;
        var cutoff = Date.now() - SHOW_MS;
        var vis = lines.filter(function (l) { return l.t >= cutoff; });
        if (!vis.length) { if (box && box.parentNode) box.parentNode.removeChild(box); box = null; return; }
        if (!box) {
          box = document.createElement('div');
          box.style.cssText = 'position:fixed;left:6px;bottom:6px;z-index:2147483647;max-width:96vw;max-height:40vh;overflow:hidden;background:rgba(0,0,0,.85);color:#ff6b6b;font:12px/1.3 monospace;padding:6px;white-space:pre-wrap;word-break:break-all;pointer-events:none';
          // Izvan <body> (dijete <html>): React upravlja djecom body-ja, pa strani čvor tamo ne smije biti.
          document.documentElement.appendChild(box);
        }
        box.textContent = vis.slice(-6).map(function (l) { return l.s; }).join('\\n');
      } catch (e) {}
    };
    var add = function (t) {
      try {
        lines.push({ t: Date.now(), s: new Date().toLocaleTimeString('en-GB') + ' ' + String(t).slice(0, 520) });
        if (lines.length > 12) lines = lines.slice(-12);
        sessionStorage.setItem(KEY, JSON.stringify(lines));
        render();
      } catch (e) {}
    };
    window.addEventListener('error', function (ev) {
      var tg = ev && ev.target;
      if (tg && tg !== window && (tg.src || tg.href)) {
        add('LOAD FAIL: ' + (tg.src || tg.href));
        // Stranica učitana prije deploy-a traži JS dio (chunk) koji više ne postoji. Jedan reload (najviše na 5 min)
        // povlači svježi HTML sa novim imenima fajlova. Bez ovoga stara stranica ostaje polu-funkcionalna do sljedećeg swapa.
        try {
          if (tg.tagName === 'SCRIPT' && /\\/_next\\/static\\//.test(tg.src || '')) {
            var CK = '__chunk_reload_at__';
            var last = parseInt(sessionStorage.getItem(CK) || '0', 10) || 0;
            if (Date.now() - last > 300000) {
              sessionStorage.setItem(CK, String(Date.now()));
              add('chunk nedostupan — reload za 3s');
              setTimeout(function () { location.reload(); }, 3000);
            }
          }
        } catch (e2) {}
      }
      else add('ERR: ' + (ev && ev.message) + ' @' + (ev && ev.filename ? String(ev.filename).split('/').pop() : '') + ':' + (ev && ev.lineno));
    }, true);
    window.addEventListener('unhandledrejection', function (ev) {
      add('REJECT: ' + (ev && ev.reason && (ev.reason.message || ev.reason)));
    });
    // Čitljiv ispis argumenata: Error → poruka + prva 3 reda stack-a; objekat sa componentStack (React ErrorInfo)
    // → prvih 5 komponenti. (Ranije se ispisivalo "[object Object]" i uzrok se nije vidio.)
    var fmt = function (a) {
      try {
        if (a && a.stack) return String(a.name || 'Error') + ': ' + String(a.message || '') + ' | ' + String(a.stack).split('\\n').slice(1, 4).map(function (x) { return x.trim(); }).join(' < ');
        if (a && typeof a === 'object' && a.componentStack) return 'COMPONENTS: ' + String(a.componentStack).split('\\n').map(function (x) { return x.trim(); }).filter(Boolean).slice(0, 5).join(' < ');
      } catch (e) {}
      return String(a);
    };
    var ce = console.error;
    console.error = function () {
      try { add('console.error: ' + Array.prototype.slice.call(arguments).map(fmt).join(' ')); } catch (e) {}
      return ce.apply(console, arguments);
    };
    window.__CHECKIN_DIAG_ADD__ = add;
    document.addEventListener('DOMContentLoaded', render);
    setInterval(render, 10000); // sakrij box kad redovi ostare
  } catch (e) {}
  // 2026-10-20: SAMOLIJEČENJE bez fizičkog brisanja keša. 1. neuspjeh → običan reload. 2. uzastopni neuspjeh
  // (brojač u sessionStorage, preživljava reload) → odjavi service worker-e, obriši Cache Storage, pa učitaj
  // stranicu sa svježim parametrom. Skripta je inline u HTML-u, pa radi i kad JS paketi stranice ne mogu da se izvrše.
  var WD_KEY = '__checkin_wd_fail__';
  setTimeout(function () {
    var n = 0;
    try { n = parseInt(sessionStorage.getItem(WD_KEY) || '0', 10) || 0; } catch (e) {}
    if (window.__CHECKIN_APP_MOUNTED__) {
      try { sessionStorage.removeItem(WD_KEY); } catch (e) {}
      return;
    }
    n += 1;
    try { sessionStorage.setItem(WD_KEY, String(n)); } catch (e) {}
    console.warn('[checkin-hydration-watchdog] Stranica se nije hidrirala za ' + (DEADLINE_MS / 1000) + 's (pokusaj ' + n + ') — reload.');
    if (window.__CHECKIN_DIAG_ADD__) window.__CHECKIN_DIAG_ADD__('hydration watchdog: pokusaj ' + n);
    if (n < 2) { location.reload(); return; }
    var done = false;
    var go = function () {
      if (done) return; done = true;
      try { sessionStorage.setItem(WD_KEY, '0'); } catch (e) {}
      location.replace(location.pathname + '?cb=' + Date.now());
    };
    setTimeout(go, 4000); // sigurnosni rok ako cišcenje ne završi
    try {
      var p1 = (navigator.serviceWorker && navigator.serviceWorker.getRegistrations)
        ? navigator.serviceWorker.getRegistrations().then(function (rs) { return Promise.all(rs.map(function (r) { return r.unregister(); })); })
        : Promise.resolve();
      var p2 = (window.caches && caches.keys)
        ? caches.keys().then(function (ks) { return Promise.all(ks.map(function (k) { return caches.delete(k); })); })
        : Promise.resolve();
      Promise.all([p1, p2]).then(go, go);
    } catch (e) { go(); }
  }, DEADLINE_MS);
})();
`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {/* 2026-10-20: PRAVI inline <script> (prvi u <body>). Ranije je watchdog išao kroz next/script
            (beforeInteractive), a Next ga u App Router-u ne izvršava kao inline kod nego preko
            `self.__next_s.push(...)` koji tek obrađuje klijentski JS paket — pa kad se paketi ne učitaju
            (pokvaren keš, prekid mreže), watchdog NIKAD ne bi krenuo i stranica bi zauvijek ostala na
            "Loading...". Ovako je dio samog HTML-a i radi bez ijednog JS fajla. (U dev režimu React može
            upisati upozorenje o script tagu — u produkciji ga nema.) */}
        <script id="checkin-hydration-watchdog" suppressHydrationWarning dangerouslySetInnerHTML={{ __html: `window.__BUILD_ID__=${JSON.stringify(BUILD_ID)};` + CHECKIN_HYDRATION_WATCHDOG_SCRIPT }} />
        <ConsoleSuppressor />
        <ServiceWorkerRegistration />
        {children}
      </body>
    </html>
  );
}