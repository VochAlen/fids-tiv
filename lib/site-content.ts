// lib/site-content.ts
//
// NOVO (po zahtjevu — AI/GEO optimizacija, 2026-10-05): JEDINI izvor
// istine za javne, "činjenične" podatke o proizvodu koje čitaju
// MAŠINE (AI asistenti, pretraživači) — JSON-LD u app/page.tsx,
// app/llms.txt/route.ts, app/sitemap.ts, i vidljiva FAQ sekcija u
// app/HomeClient.tsx. Zašto jedno mjesto: AI sistemi porede ono što
// stranica KAŽE sa onim što strukturirani podaci TVRDE — ako se cijena
// u JSON-LD razlikuje od cijene u vidljivom tekstu, to je signal
// nepouzdanosti. FAQ ispod se renderuje i vidljivo (HomeClient) i kao
// FAQPage JSON-LD iz ISTIH stringova, pa ne mogu da se razilaze.
//
// NAPOMENA ZA ODRŽAVANJE: cijene paketa u HomeClient.tsx (T.me/T.en
// .pricingTiers) su i dalje zasebni stringovi — ako mijenjaš cijenu,
// promijeni je i u PRICING_TIERS ispod (jedna provjera: grep "249").

export const SITE_NAME = 'TIV FIDS';

// Produkcijski domen. Može se prebaciti bez izmjene koda postavljanjem
// NEXT_PUBLIC_SITE_URL u Vercel Environment Variables (npr. kad dobiješ
// sopstveni domen).
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || 'https://fids-tiv.vercel.app').replace(/\/+$/, '');

// Datum zadnje značajne izmjene javnog sadržaja — koristi se u
// sitemap-u i llms.txt (vidljiv datum ažuriranja je jedan od signala
// svježine koje AI pretraga uzima u obzir). Ažuriraj pri većim
// izmjenama landing stranice.
export const SITE_LAST_UPDATED = '2026-10-05';

export const SITE_DESCRIPTION_EN =
  'TIV FIDS is a cloud-based Flight Information Display System (FIDS) for small and regional airports: live departures and arrivals boards, gate and check-in desk displays, baggage displays, a staff admin panel for gate and desk assignment, and automated terminal announcements. In daily production use at Tivat Airport (TIV), Montenegro.';

export const PRICING_TIERS = [
  { name: 'Starter', screens: 'up to 15 screens', priceEur: 249, period: 'month' },
  { name: 'Growth', screens: 'up to 50 screens', priceEur: 790, period: 'month' },
] as const;

export const ENTERPRISE_NOTE_EN = 'Enterprise (50+ screens): custom pricing on request.';
export const IMPLEMENTATION_FROM_EUR = 990;

export type FaqItem = { q: string; a: string };

export const FAQ: { en: FaqItem[]; me: FaqItem[] } = {
  en: [
    {
      q: 'What is TIV FIDS?',
      a: 'TIV FIDS is a cloud-based Flight Information Display System (FIDS) for airports. It shows live departures, arrivals, gate, check-in, baggage and split-board screens, lets airport staff assign gates and check-in desks, and provides automated terminal announcements (PA). It runs Tivat Airport (TIV) in Montenegro every day.',
    },
    {
      q: 'Who is TIV FIDS for?',
      a: 'Small and regional airports that are too small for the multi-year contracts and pricing of large traditional FIDS vendors, but need far more than a TV showing a slideshow.',
    },
    {
      q: 'How much does TIV FIDS cost?',
      a: `Pricing is based on the number of active screens: Starter is €${PRICING_TIERS[0].priceEur} per month (up to 15 screens), Growth is €${PRICING_TIERS[1].priceEur} per month (up to 50 screens), and Enterprise (50+ screens) is priced on request. Hosting, realtime infrastructure and support are included. A one-time implementation, which covers connecting your flight data source and setting up branding, starts from €${IMPLEMENTATION_FROM_EUR}.`,
    },
    {
      q: 'Which flight data sources can it connect to?',
      a: 'REST APIs, XML feeds, CSV files or an airport’s own AODB. A matching connector is built for each airport, and the rest of the system stays the same.',
    },
    {
      q: 'How long does it take to go live?',
      a: 'Typically days to a few weeks, depending mainly on the format of your flight data source. The process is: share your data source format, we build the connector and set up branding, you test with your real data, then screens go live.',
    },
    {
      q: 'Does it require special hardware?',
      a: 'No. Screens run in a standard web browser on ordinary displays, on standard cloud infrastructure (Vercel and Redis), so there are no proprietary hardware costs.',
    },
    {
      q: 'Is it already used in production?',
      a: 'Yes. It is the system that runs flight information at Tivat Airport every day, 24/7, including an automatic night mode when there are no flights.',
    },
    {
      q: 'Which languages are supported?',
      a: 'Displays and announcements work in English and the local language. Additional languages are available on request.',
    },
  ],
  me: [
    {
      q: 'Šta je TIV FIDS?',
      a: 'TIV FIDS je cloud sistem za informisanje o letovima (FIDS) za aerodrome. Prikazuje uživo odlaske, dolaske, gate, check-in, prtljag i split-board ekrane, omogućava osoblju da dodjeljuje gate-ove i check-in šaltere, i nudi automatski razglas terminala (PA). Svakodnevno vodi Aerodrom Tivat (TIV) u Crnoj Gori.',
    },
    {
      q: 'Za koga je TIV FIDS?',
      a: 'Za male i regionalne aerodrome kojima su višegodišnji ugovori i cijene velikih tradicionalnih FIDS dobavljača preveliki, a treba im mnogo više od TV-a sa slideshow-om.',
    },
    {
      q: 'Koliko košta TIV FIDS?',
      a: `Cijena zavisi od broja aktivnih ekrana: Starter je €${PRICING_TIERS[0].priceEur} mjesečno (do 15 ekrana), Growth je €${PRICING_TIERS[1].priceEur} mjesečno (do 50 ekrana), a Enterprise (50+ ekrana) je po dogovoru. Hosting, realtime infrastruktura i podrška su uključeni. Jednokratna implementacija, koja obuhvata povezivanje vašeg izvora podataka o letovima i podešavanje brendiranja, počinje od €${IMPLEMENTATION_FROM_EUR}.`,
    },
    {
      q: 'Na koje izvore podataka o letovima se može povezati?',
      a: 'REST API, XML feed, CSV fajlove ili sopstveni AODB aerodroma. Za svaki aerodrom se gradi odgovarajući konektor, a ostatak sistema ostaje isti.',
    },
    {
      q: 'Koliko traje do lansiranja?',
      a: 'Obično od nekoliko dana do par nedjelja, zavisno uglavnom od formata vašeg izvora podataka. Postupak je: pošaljete format izvora podataka, mi gradimo konektor i podešavamo brendiranje, vi testirate sa stvarnim podacima, pa ekrani idu uživo.',
    },
    {
      q: 'Da li je potreban poseban hardver?',
      a: 'Ne. Ekrani rade u standardnom web browseru na običnim displejima, na standardnoj cloud infrastrukturi (Vercel i Redis), pa nema troškova vlasničkog hardvera.',
    },
    {
      q: 'Da li se već koristi u produkciji?',
      a: 'Da. To je sistem koji svakodnevno, 24/7, vodi informacije o letovima na Aerodromu Tivat, uključujući automatski noćni režim kada nema letova.',
    },
    {
      q: 'Koji jezici su podržani?',
      a: 'Prikazi i razglas rade na engleskom i lokalnom jeziku. Dodatni jezici su dostupni na zahtjev.',
    },
  ],
};

// ── JSON-LD (schema.org) ────────────────────────────────────────────
// Namjerno SAMO činjenice koje stranica i vidljivo tvrdi: nema
// izmišljenih adresa, telefona, ocjena (aggregateRating) ni recenzija —
// lažni strukturirani podaci su gori od nikakvih (i krše pravila
// Google-a i AI pretrage). Enterprise paket nema fiksnu cijenu, pa nije
// naveden kao Offer (opisan je u opisu aplikacije i FAQ-u).
export function buildJsonLd() {
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebSite',
        '@id': `${SITE_URL}/#website`,
        url: SITE_URL,
        name: SITE_NAME,
        inLanguage: ['en', 'cnr'],
      },
      {
        '@type': 'SoftwareApplication',
        '@id': `${SITE_URL}/#software`,
        name: SITE_NAME,
        url: SITE_URL,
        description: `${SITE_DESCRIPTION_EN} ${ENTERPRISE_NOTE_EN}`,
        applicationCategory: 'BusinessApplication',
        applicationSubCategory: 'Flight Information Display System (FIDS)',
        operatingSystem: 'Web browser',
        audience: {
          '@type': 'BusinessAudience',
          audienceType: 'Small and regional airports',
        },
        featureList: [
          'Live departures and arrivals boards',
          'Gate and check-in desk displays',
          'Baggage displays and split-board view',
          'Staff admin panel for gate and check-in desk assignment',
          'Automated terminal announcements (PA)',
          'Custom connector for the airport’s own flight data source (REST, XML, CSV, AODB)',
          'Automatic night mode following airport operating hours',
        ],
        offers: PRICING_TIERS.map((tier) => ({
          '@type': 'Offer',
          name: tier.name,
          description: `${tier.screens}, hosting, realtime infrastructure and support included`,
          url: `${SITE_URL}/#pricing`,
          price: String(tier.priceEur),
          priceCurrency: 'EUR',
          priceSpecification: {
            '@type': 'UnitPriceSpecification',
            price: String(tier.priceEur),
            priceCurrency: 'EUR',
            unitCode: 'MON',
          },
        })),
      },
      {
        '@type': 'FAQPage',
        '@id': `${SITE_URL}/#faq`,
        mainEntity: FAQ.en.map((item) => ({
          '@type': 'Question',
          name: item.q,
          acceptedAnswer: { '@type': 'Answer', text: item.a },
        })),
      },
    ],
  };
}

// <script type="application/ld+json"> sadržaj, sa escape-om '<' da
// string nikad ne može zatvoriti <script> tag.
export function jsonLdString(): string {
  return JSON.stringify(buildJsonLd()).replace(/</g, '\\u003c');
}

// ── llms.txt (community konvencija, vidi app/llms.txt/route.ts) ──────
export function buildLlmsTxt(): string {
  const faq = FAQ.en.map((item) => `### ${item.q}\n${item.a}`).join('\n\n');
  return `# ${SITE_NAME}

> ${SITE_DESCRIPTION_EN}

Last updated: ${SITE_LAST_UPDATED}

## Key facts

- Product: cloud-based Flight Information Display System (FIDS) for airports.
- Target customers: small and regional airports.
- Proven in production: runs flight information at Tivat Airport (TIV), Montenegro, 24/7.
- Screen types: departures, arrivals, split board, gate, check-in desk, baggage; plus a staff admin panel and automated PA announcements.
- Data sources: connector built per airport (REST, XML, CSV or the airport’s own AODB).
- Hardware: none proprietary; screens run in a standard web browser.
- Pricing: Starter €${PRICING_TIERS[0].priceEur}/month (up to 15 screens); Growth €${PRICING_TIERS[1].priceEur}/month (up to 50 screens); ${ENTERPRISE_NOTE_EN} One-time implementation from €${IMPLEMENTATION_FROM_EUR}.
- Languages: English and the local language; more on request.

## Pages

- [Home](${SITE_URL}/): overview, live screen examples from Tivat Airport, pricing, FAQ.
- [Pricing](${SITE_URL}/#pricing): plans and implementation fee.
- [Live screen examples](${SITE_URL}/#showcase): real departures, arrivals and split-board screens.
- [FAQ](${SITE_URL}/#faq): answers to common questions.

## FAQ

${faq}

## Notes

- The operational kiosk screens and the staff admin panel are private and are not intended for indexing.
`;
}
