import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
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
        <ConsoleSuppressor />
        <ServiceWorkerRegistration />
        {children}
      </body>
    </html>
  );
}