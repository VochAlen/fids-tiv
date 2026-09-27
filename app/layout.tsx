import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Script from "next/script";
import "./globals.css";
import { ConsoleSuppressor } from "@/components/ConsoleSuppressor";
import { ServiceWorkerRegistration } from "@/components/ServiceWorkerRegistration";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
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
  setTimeout(function () {
    if (!window.__CHECKIN_APP_MOUNTED__) {
      console.warn('[checkin-hydration-watchdog] Stranica se nije hidrirala za ' + (DEADLINE_MS / 1000) + 's (vjerovatno spora/prekinuta mreza) — reload.');
      location.reload();
    }
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
      <head>
        <Script
          id="checkin-hydration-watchdog"
          strategy="beforeInteractive"
        >
          {CHECKIN_HYDRATION_WATCHDOG_SCRIPT}
        </Script>
      </head>
      <body className="min-h-full flex flex-col">
        <ConsoleSuppressor />
        <ServiceWorkerRegistration />
        {children}
      </body>
    </html>
  );
}