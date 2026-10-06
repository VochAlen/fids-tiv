'use client';

import { useEffect } from 'react';

// components/ServiceWorkerRegistration.tsx
//
// NOVO (po zahtjevu — inovativno smanjenje Edge Requests): registruje
// public/sw.js — vidi opširan komentar tamo za pun kontekst i
// bezbjednosnu granicu (ISKLJUČIVO /_next/static/* se kešira, ništa
// dinamičko/real-time). Isti obrazac kao ConsoleSuppressor.tsx —
// zaseban Client Component, jer se registracija MORA izvršiti u
// browseru (window/navigator ne postoje na serveru), a app/layout.tsx
// je Server Component.
//
// Bezbjedno na SVAKOJ stranici (kiosk, admin, landing, PA) — service
// worker samo ubrzava učitavanje i smanjuje mrežni saobraćaj, ne
// mijenja nijedno ponašanje aplikacije. Ako browser ne podržava
// Service Worker API (izuzetno star browser), registracija tiho ne
// uspije i sve nastavlja raditi identično kao danas — nema
// funkcionalnog rizika.
export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;

    // NOVO (2026-10-06): u DEV režimu (next dev) fajlovi u /_next/static/
    // NISU content-hash imenovani — isto ime, novi sadržaj pri svakoj
    // izmjeni koda. Cache-first service worker bi tad servirao STARI JS uz
    // NOVI server HTML => hydration mismatch (viđeno na /combined). Zato u
    // developmentu SW ne registrujemo, a postojeće registracije i keševe
    // brišemo. Produkcija je nepromijenjena (tamo su imena hash-irana).
    if (process.env.NODE_ENV !== 'production') {
      navigator.serviceWorker.getRegistrations()
        .then((regs) => Promise.all(regs.map((reg) => reg.unregister())))
        .then(() => ('caches' in window ? caches.keys() : []))
        .then((keys) => Promise.all(keys.filter((k) => k.startsWith('fids-static-')).map((k) => caches.delete(k))))
        .catch(() => {});
      return;
    }

    navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.warn('[ServiceWorkerRegistration] Registracija nije uspjela (aplikacija nastavlja normalno, bez ovog sloja keširanja):', err);
    });
  }, []);

  return null;
}