// app/robots.ts
//
// Next.js route konvencija — automatski servira na /robots.txt.
// Landing (/) je NAMJERNO jedina javna, indeksirana stranica (ranije
// su i /demo/* rute bile javne — uklonjene su, vidi app/HomeClient.tsx
// i app/sitemap.ts, showcase kartice sad vode direktno na statične
// slike u public/ umjesto na posebne stranice). Sve kiosk (gate/
// checkin/departures/combined/border/baggage/split-board), admin i PA
// rute su isključene iz indeksiranja — nemaju smisla u rezultatima
// pretrage, a njihovo pojavljivanje bi samo otkrivalo unutrašnju
// strukturu aplikacije nezainteresovanoj javnosti.
import type { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: ['/'],
      disallow: [
        '/admin/', '/api/',
        '/gate/', '/checkin/', '/departures', '/arrivals', '/arrivals-small',
        '/combined', '/border/', '/baggage/', '/split-board', '/security',
        '/pa', '/ver2/',
      ],
    },
    sitemap: 'https://fids-tiv.vercel.app/sitemap.xml',
  };
}
