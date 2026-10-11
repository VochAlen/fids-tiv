// app/llms.txt/route.ts
//
// NOVO (po zahtjevu — AI/GEO optimizacija, 2026-10-05): /llms.txt je
// community konvencija (ne formalni standard) — kratak, čist markdown
// sažetak sajta namijenjen AI agentima, da preskoče navigaciju i dođu
// direktno do činjenica. Podrška velikih AI kompanija NIJE potvrđena,
// pa ovo treba shvatiti kao jeftin dodatak (statičan, nula troška), ne
// kao zamjenu za ono što stvarno radi: crawleri koji smiju da pročitaju
// landing stranicu (vidi middleware.ts) i čist, server-renderovan
// sadržaj sa strukturiranim podacima (app/page.tsx).
//
// Sadržaj dolazi iz lib/site-content.ts (jedan izvor istine).
import { buildLlmsTxt } from '@/lib/site-content';

export const dynamic = 'force-static';

export function GET() {
  return new Response(buildLlmsTxt(), {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=3600, s-maxage=86400',
    },
  });
}
