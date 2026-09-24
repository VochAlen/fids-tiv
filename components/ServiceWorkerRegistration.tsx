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

    navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.warn('[ServiceWorkerRegistration] Registracija nije uspjela (aplikacija nastavlja normalno, bez ovog sloja keširanja):', err);
    });
  }, []);

  return null;
}
