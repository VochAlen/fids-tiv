// app/sitemap.ts
//
// NOVO (po zahtjevu — AI/GEO optimizacija, 2026-10-05): sitemap sa
// JEDINOM javnom stranicom (landing). Kiosk i admin rute su namjerno
// izostavljene — zabranjene su u public/robots.txt i imaju
// X-Robots-Tag: noindex (vidi middleware.ts).
import type { MetadataRoute } from 'next';
import { SITE_URL, SITE_LAST_UPDATED } from '@/lib/site-content';

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: SITE_URL,
      lastModified: SITE_LAST_UPDATED,
      changeFrequency: 'monthly',
      priority: 1,
    },
  ];
}
