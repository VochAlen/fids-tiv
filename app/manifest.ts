// app/manifest.ts
//
// PWA manifest — Next.js route konvencija (automatski servira na
// /manifest.webmanifest). Omogućava "Dodaj na početni ekran" na
// tabletima/mobilnim uređajima (npr. osoblje koje pristupa
// /admin/assign-checkin sa tableta u operativnom centru) — otvara se
// u fullscreen/standalone modu, bez browser adresne trake, ugodnije za
// svakodnevnu upotrebu. Nula troška — statičan JSON, servira se sa CDN-a.
import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'TIV FIDS — Aerodrom Tivat',
    short_name: 'TIV FIDS',
    description: 'Sistem informisanja o letovima za Aerodrom Tivat',
    start_url: '/',
    display: 'standalone',
    background_color: '#0B1220',
    theme_color: '#0B2545',
    icons: [
      {
        src: '/icon.svg',
        sizes: 'any',
        type: 'image/svg+xml',
      },
    ],
  };
}
