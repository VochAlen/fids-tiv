// app/sitemap.ts
// Next.js route konvencija — automatski servira na /sitemap.xml.
// Samo javne stranice (vidi app/robots.ts za isti princip).
//
// FIX (po zahtjevu — /demo/* stranice zamijenjene direktnim linkovima
// ka statičnim slikama): sve /demo/* rute su uklonjene (vidi
// app/HomeClient.tsx) — uklonjeno i odavde da sitemap ne referencira
// rute koje više ne postoje (bio bi 404 za bilo koga ko klikne sa
// Google rezultata pretrage).
import type { MetadataRoute } from 'next';

export default function sitemap(): MetadataRoute.Sitemap {
  const base = 'https://fids-tiv.vercel.app';
  return [
    { url: base, changeFrequency: 'monthly', priority: 1 },
  ];
}
