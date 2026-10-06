'use client';

// app/HomeClient.tsx
//
// Glavna ("prodajna") landing stranica za fids-tiv.vercel.app.
//
// v2: dodato dvojezično sučelje (crnogorski/engleski, prekidač u
// header-u, pamti izbor po localStorage ključu, isti obrazac kao
// hooks/use-theme.ts), "O sistemu" sekcija iznad footer-a, i sekcija
// "Vodite drugi aerodrom?" za potencijalne B2B klijente.
//
// v3 (po zahtjevu): hero slika UKLONJENA (nazad na jednostavan,
// centriran tekstualni hero). Showcase kartice (Odlasci/Dolasci/Split
// Board — "Kombinovani prikaz" izbačen u potpunosti) sad vode DIREKTNO
// na statične slike u public/ (vidi DISPLAY_IMAGES ispod) umjesto na
// posebne /demo/* stranice — te stranice (i sav kod koji ih je jedino
// podržavao — components/demo/*, lib/demo-flights.ts) su obrisane.
// Default tema je sad LIGHT (bilo dark).
//
// v4 (po zahtjevu — 2026-10-05, pivot ka SaaS prodaji malim/regionalnim
// aerodromima): stranica je do sada bila PRVENSTVENO putnički/osoblje
// portal za Tivat, sa malom, skromnom B2B sekcijom na dnu. Cilj se
// promijenio — ovo sad treba da bude prodajna stranica koja PRIVLAČI I
// UBJEĐUJE potencijalne kupce (druge male/regionalne aerodrome), uz
// zadržavanje stvarne, uživo funkcije za Tivat (putnici i dalje mogu
// pogledati letove, osoblje i dalje ima prijavu). Dodato: sekcija
// pozicioniranja ("za koga je ovo" — kontrast sa skupim tradicionalnim
// FIDS rješenjima i sa DIY/PowerPoint pristupom), pun cjenovnik sa tri
// paketa (umjesto jedne linije ilustrativne cijene), i sekcija koraka
// implementacije ("kako počinjemo"). Hero je preformulisan da prvo
// govori proizvodu/kupcu (sa Tivtom kao dokazom da sistem stvarno radi
// uživo), dok je putnički CTA ("Pogledaj letove uživo") zadržan kao
// sekundarno dugme, ne obrisan — stranica i dalje mora da radi kao
// stvarna Tivat početna strana.
import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  Plane, DoorOpen, CheckSquare,
  Luggage, Radio, ShieldCheck, Zap, Clock3, MonitorSmartphone,
  Sun, Moon, LogIn, LogOut, ArrowRight, Sparkles, Info, Building2, Mail, Check,
  TrendingUp, Palette, Eye, Rocket, Scale,
} from 'lucide-react';
import { useTheme } from '@/hooks/use-theme';
import { FAQ } from '@/lib/site-content';

const THEME_STORAGE_KEY = 'theme:landing';
const LANG_STORAGE_KEY = 'lang:landing';

type Lang = 'me' | 'en';

// ════════════════════════════════════════════════════════════
// PREVODI
// ════════════════════════════════════════════════════════════
const T = {
  me: {
    tagline: 'Aerodrom Tivat',
    heroBadge: 'Uživo na Aerodromu Tivat · 24/7',
    heroTitle1: 'Moderan FIDS',
    heroTitle2: 'za male i regionalne aerodrome',
    heroTitleSuffix: '',
    heroSubtitle: 'Isti sistem koji svakodnevno vodi Aerodrom Tivat — uživo raspored letova, upravljanje gate-ovima i check-in šalterima, i automatski razglas terminala. Bez cijene i složenosti tradicionalnih FIDS rješenja.',
    ctaLive: 'Pogledajte cijene',
    ctaDepartures: 'Pogledaj uživo na Aerodromu Tivat',
    login: 'Prijava',
    adminPanel: 'Admin panel',
    logoutAria: 'Odjava',
    showcaseBadge: 'Uživo, ne mock-up',
    showcaseLead: 'Stvarni prikazi koji trenutno, u ovom trenutku, rade na Aerodromu Tivat.',
    showcase: [
      { title: 'Odlasci', description: 'Uživo raspored svih odlazećih letova' },
      { title: 'Dolasci', description: 'Uživo raspored svih dolazećih letova' },
      { title: 'Split Board', description: 'Podijeljen prikaz za velike terminale' },
    ],
    featuresTitle: 'Zašto TIV FIDS',
    featuresSubtitle: 'Moderna infrastruktura, napravljena za stvarne potrebe malih i regionalnih aerodroma.',
    features: [
      { title: 'Uživo, u realnom vremenu', description: 'Podaci o letovima se osvježavaju kontinuirano tokom cijelog dana — gate, šalter, status i vrijeme polaska/dolaska uvijek ažurni.' },
      { title: 'Upravljanje gate-ovima i šalterima', description: 'Operativno osoblje dodjeljuje izlaze i check-in šaltere letovima u par sekundi, sa trenutnim odrazom na svim ekranima terminala.' },
      { title: 'Automatski razglas (PA)', description: 'Sistem sam najavljuje registraciju, ukrcavanje i kašnjenja — na engleskom i lokalnom jeziku — bez ručnog čitanja poziva.' },
      { title: 'Prilagođeno svakom ekranu', description: 'Isti podaci, pravilno oblikovani za gate monitore, check-in table, prikaze prtljaga i velike terminalne panoe.' },
      { title: 'Sigurna administracija', description: 'Zaštićen admin panel za osoblje — ručne dodjele, konfiguraciju avio kompanija i kontrolu razglasa, odvojeno od javnih prikaza.' },
      { title: 'Pouzdano 24/7/365', description: 'Sistem prati radno vrijeme aerodroma i sam prelazi u noćni režim — bez nepotrebnog rada kad nema letova.' },
    ],
    diffBadge: 'Pozicioniranje',
    diffTitle: 'Napravljen za prazninu između dvije krajnosti',
    diffSubtitle: 'Veliki aerodromi imaju višegodišnje ugovore sa velikim FIDS dobavljačima. Mali aerodromi improvizuju sa TV-om i PowerPoint-om. TIV FIDS je za sve između.',
    diffLeftTitle: 'Tradicionalna FIDS rješenja',
    diffLeftPoints: [
      'Ugovori na više godina i duge tenderske procedure',
      'Cijena koja opravdava jedino velike aerodrome',
      'Implementacija mjesecima, uz dedikovan hardver',
    ],
    diffRightTitle: 'TIV FIDS',
    diffRightPoints: [
      'Mjesečna pretplata, bez dugoročnog ugovora',
      'Cijena po ekranu — manji aerodrom plaća manje',
      'Lansiranje za dane/nedjelje, standardna cloud infrastruktura',
    ],
    pricingBadge: 'Cjenovnik',
    pricingTitle: 'Jasna cijena, bez skrivenih troškova',
    pricingSubtitle: 'Plaćate po broju aktivnih ekrana. Sve cijene uključuju hosting, realtime infrastrukturu i podršku.',
    popularBadge: 'Najpopularniji',
    pricingTiers: [
      {
        name: 'Starter',
        screens: 'do 15 ekrana',
        price: '€249',
        priceNote: '/mjesečno',
        features: [
          'Svi tipovi ekrana (check-in, gate, odlasci, dolasci, prtljag)',
          'Konektor za vaš izvor podataka',
          'Email podrška',
          'Crnogorski/BHS + engleski jezik',
        ],
        cta: 'Zatražite ponudu',
      },
      {
        name: 'Growth',
        screens: 'do 50 ekrana',
        price: '€790',
        priceNote: '/mjesečno',
        features: [
          'Sve iz Starter paketa',
          'Prilagođeno brendiranje (logo, boje, slike gradova)',
          'Prioritetna podrška',
          'Dodatni jezici po dogovoru',
        ],
        cta: 'Zatražite ponudu',
      },
      {
        name: 'Enterprise',
        screens: '50+ ekrana',
        price: 'Po dogovoru',
        priceNote: '',
        features: [
          'Sve iz Growth paketa',
          'Dedikovana podrška i SLA',
          'Više izvora podataka / bekap konektori',
          'Prilagođen razvoj po potrebi',
        ],
        cta: 'Kontaktirajte nas',
      },
    ],
    pricingFootnote: 'Jednokratna implementacija (povezivanje vašeg izvora podataka o letovima i podešavanje brendiranja): od €990, zavisno od složenosti vašeg sistema.',
    onboardingBadge: 'Kako počinjemo',
    onboardingTitle: 'Od upita do ekrana koji rade uživo',
    onboardingSteps: [
      { title: 'Javite nam se', text: 'Pošaljite nam format vašeg izvora podataka o letovima — AODB, REST, XML, CSV, šta god trenutno koristite.' },
      { title: 'Konektor i brendiranje', text: 'Povezujemo vaš izvor podataka i podešavamo logo, boje i slike destinacija za vaš aerodrom.' },
      { title: 'Testiranje', text: 'Pregledate sistem uživo, sa vašim stvarnim podacima, prije punog lansiranja.' },
      { title: 'Lansiranje', text: 'Ekrani idu uživo — vi se fokusirate na aerodrom, mi na infrastrukturu i održavanje.' },
    ],
    faqBadge: 'FAQ',
    faqTitle: 'Često postavljana pitanja',
    ctaStaffTitle: 'Osoblje aerodroma?',
    ctaStaffText: 'Prijavi se na admin panel za dodjelu gate-ova i šaltera, upravljanje razglasom, i konfiguraciju sistema.',
    ctaStaffButtonLoggedIn: 'Idi na admin panel',
    ctaStaffButtonLoggedOut: 'Prijava osoblja',
    partnerBadge: 'Za aerodrome',
    partnerTitle: 'Vodite mali ili regionalni aerodrom?',
    partnerSubtitle: 'TIV FIDS je izgrađen da bude jednostavno prenosiv — isti sistem koji vidite na ovoj stranici, prilagođen vašem aerodromu.',
    partnerPoints: [
      { title: 'Već radi uživo', text: 'Nije prototip — ovo je isti sistem koji svakodnevno vodi Aerodrom Tivat.' },
      { title: 'Vaš izvor podataka', text: 'Bez obzira na format vašeg sistema (REST, XML, CSV, sopstveni AODB) — gradimo prilagođen konektor, ostatak sistema ostaje isti.' },
      { title: 'Bez zaključavanja kod jednog dobavljača', text: 'Radi na standardnoj cloud infrastrukturi (Vercel + Redis) — transparentno, bez skrivenih troškova hardvera.' },
    ],
    partnerPricingLabel: 'Cijene počinju od',
    partnerPricingLine1: '€249 / mjesečno',
    partnerPricingLine2: 'Pogledajte pun cjenovnik iznad ↑',
    partnerCta: 'Zatražite ponudu',
    aboutTitle: 'O sistemu',
    aboutParagraphs: [
      'TIV FIDS je sistem za informisanje putnika razvijen posebno za Aerodrom Tivat — prikazuje uživo raspored letova na svim ekranima terminala: gate monitorima, check-in šalterima, prikazima dolazaka i odlazaka, i prikazima prtljaga.',
      'Osim javnih ekrana, sistem uključuje i operativni dio za osoblje aerodroma: ručnu dodjelu gate-ova i check-in šaltera letovima, konfiguraciju avio kompanija, i automatski razglas terminala koji sam najavljuje registraciju, ukrcavanje i kašnjenja letova, na dva jezika.',
      'Sistem je napravljen da radi pouzdano, cijele godine, bez prekida — prateći stvarni ritam rada aerodroma, uključujući noćni režim kada nema letova.',
    ],
    footerRights: 'Sistem informisanja o letovima',
    footerLive: 'Uživo letovi',
    footerPricing: 'Cjenovnik',
    footerAdmin: 'Admin',
  },
  en: {
    tagline: 'Tivat Airport',
    heroBadge: 'Live at Tivat Airport · 24/7',
    heroTitle1: 'Modern FIDS',
    heroTitle2: 'for small and regional airports',
    heroTitleSuffix: '',
    heroSubtitle: 'The same system that runs Tivat Airport every day — live flight schedules, gate and check-in desk management, and automated terminal announcements. Without the cost and complexity of traditional FIDS solutions.',
    ctaLive: 'See pricing',
    ctaDepartures: 'See it live at Tivat Airport',
    login: 'Sign in',
    adminPanel: 'Admin panel',
    logoutAria: 'Sign out',
    showcaseBadge: 'Live, not a mock-up',
    showcaseLead: 'Real screens currently running, right now, at Tivat Airport.',
    showcase: [
      { title: 'Departures', description: 'Live schedule of all departing flights' },
      { title: 'Arrivals', description: 'Live schedule of all arriving flights' },
      { title: 'Split Board', description: 'Split-screen view for larger terminals' },
    ],
    featuresTitle: 'Why TIV FIDS',
    featuresSubtitle: 'Modern infrastructure, built for the real needs of small and regional airports.',
    features: [
      { title: 'Live, in real time', description: 'Flight data refreshes continuously throughout the day — gate, desk, status, and departure/arrival times always up to date.' },
      { title: 'Gate & desk management', description: 'Operations staff assign gates and check-in desks to flights within seconds, reflected instantly across every terminal screen.' },
      { title: 'Automated announcements (PA)', description: 'The system announces check-in, boarding, and delays on its own — in English and the local language — without manual calls.' },
      { title: 'Built for every screen', description: 'The same data, properly formatted for gate monitors, check-in boards, baggage displays, and large terminal panels.' },
      { title: 'Secure administration', description: 'A protected admin panel for staff — manual assignments, airline configuration, and PA control, separate from public displays.' },
      { title: 'Reliable 24/7/365', description: 'The system follows the airport’s operating hours and switches to night mode on its own — no unnecessary activity when there are no flights.' },
    ],
    diffBadge: 'Positioning',
    diffTitle: 'Built for the gap between two extremes',
    diffSubtitle: 'Large airports sign multi-year contracts with major FIDS vendors. Small airports improvise with a TV and a PowerPoint loop. TIV FIDS is for everything in between.',
    diffLeftTitle: 'Traditional FIDS vendors',
    diffLeftPoints: [
      'Multi-year contracts and long procurement processes',
      'Pricing that only makes sense for large airports',
      'Months-long rollout, with dedicated hardware',
    ],
    diffRightTitle: 'TIV FIDS',
    diffRightPoints: [
      'Monthly subscription, no long-term contract',
      'Priced per screen — smaller airports pay less',
      'Live in days/weeks, on standard cloud infrastructure',
    ],
    pricingBadge: 'Pricing',
    pricingTitle: 'Clear pricing, no hidden costs',
    pricingSubtitle: 'You pay by the number of active screens. Every plan includes hosting, realtime infrastructure, and support.',
    popularBadge: 'Most popular',
    pricingTiers: [
      {
        name: 'Starter',
        screens: 'up to 15 screens',
        price: '€249',
        priceNote: '/month',
        features: [
          'Every screen type (check-in, gate, departures, arrivals, baggage)',
          'Connector for your data source',
          'Email support',
          'Local language + English',
        ],
        cta: 'Request a quote',
      },
      {
        name: 'Growth',
        screens: 'up to 50 screens',
        price: '€790',
        priceNote: '/month',
        features: [
          'Everything in Starter',
          'Custom branding (logo, colors, destination images)',
          'Priority support',
          'Additional languages on request',
        ],
        cta: 'Request a quote',
      },
      {
        name: 'Enterprise',
        screens: '50+ screens',
        price: 'Custom',
        priceNote: '',
        features: [
          'Everything in Growth',
          'Dedicated support and SLA',
          'Multiple data sources / backup connectors',
          'Custom development on request',
        ],
        cta: 'Contact us',
      },
    ],
    pricingFootnote: 'One-time implementation (connecting your flight data source and setting up branding): from €990, depending on the complexity of your system.',
    onboardingBadge: 'How we start',
    onboardingTitle: 'From inquiry to screens running live',
    onboardingSteps: [
      { title: 'Reach out', text: 'Tell us the format of your flight data source — AODB, REST, XML, CSV, whatever you currently use.' },
      { title: 'Connector & branding', text: 'We connect your data source and set up your logo, colors, and destination images.' },
      { title: 'Testing', text: 'You review the system live, with your real data, before the full launch.' },
      { title: 'Launch', text: 'Screens go live — you focus on the airport, we focus on infrastructure and uptime.' },
    ],
    faqBadge: 'FAQ',
    faqTitle: 'Frequently asked questions',
    ctaStaffTitle: 'Airport staff?',
    ctaStaffText: 'Sign in to the admin panel to assign gates and desks, control the PA system, and configure the system.',
    ctaStaffButtonLoggedIn: 'Go to admin panel',
    ctaStaffButtonLoggedOut: 'Staff sign in',
    partnerBadge: 'For airports',
    partnerTitle: 'Running a small or regional airport?',
    partnerSubtitle: 'TIV FIDS was built to be easily portable — the same system you see on this page, adapted to your airport.',
    partnerPoints: [
      { title: 'Already running live', text: 'This isn’t a prototype — it’s the same system that runs Tivat Airport every day.' },
      { title: 'Your data source', text: 'Whatever format your system uses (REST, XML, CSV, your own AODB) — we build a matching connector, the rest of the system stays the same.' },
      { title: 'No vendor lock-in', text: 'Runs on standard cloud infrastructure (Vercel + Redis) — transparent, no hidden hardware costs.' },
    ],
    partnerPricingLabel: 'Pricing starts at',
    partnerPricingLine1: '€249 / month',
    partnerPricingLine2: 'See the full pricing table above ↑',
    partnerCta: 'Request a quote',
    aboutTitle: 'About the system',
    aboutParagraphs: [
      'TIV FIDS is a passenger information system built specifically for Tivat Airport — it displays live flight schedules across every terminal screen: gate monitors, check-in desks, arrivals and departures boards, and baggage claim displays.',
      'Beyond the public displays, the system includes an operational layer for airport staff: manual assignment of gates and check-in desks to flights, airline configuration, and an automated terminal announcement system that calls check-in, boarding, and delays on its own, in two languages.',
      'The system is built to run reliably, all year round, without interruption — following the airport’s real operating rhythm, including a night mode when there are no flights.',
    ],
    footerRights: 'Flight Information Display System',
    footerLive: 'Live flights',
    footerPricing: 'Pricing',
    footerAdmin: 'Admin',
  },
} as const;

// FIX (po zahtjevu — showcase kartice sad vode direktno na statične
// slike umjesto na posebne /demo/* stranice — te stranice, i sve što
// ih je jedino podržavalo (components/demo/*, lib/demo-flights.ts),
// su uklonjene): stavi ove tri slike u public/ folder projekta (ne u
// "public/public/", Next.js servira SADRŽAJ public/ foldera sa
// korijena sajta — public/departures-DEMO.jpg je dostupno na URL-u
// /departures-DEMO.jpg, BEZ "/public" prefiksa u samom URL-u). Nula
// pollinga, nula poziva ka /api/flights, nula Vercel troška bez obzira
// koliko puta neko posjeti — ovo je čist statičan <img>.
const DISPLAY_IMAGES = ['/departures-DEMO.jpg', '/arrivals-DEMO.jpg', '/splitboard-DEMO.jpg'];
const FEATURE_ICONS = [Zap, DoorOpen, Radio, MonitorSmartphone, ShieldCheck, Clock3];
// NOVO — ikone za nove sekcije (cjenovnik i koraci implementacije),
// dodato uz postojeći FEATURE_ICONS obrazac. Redoslijed mora pratiti
// redoslijed stavki u T.me/T.en.pricingTiers / onboardingSteps.
const PRICING_ICONS = [Zap, TrendingUp, Building2];
const ONBOARDING_ICONS = [Mail, Palette, Eye, Rocket];
// Indeks paketa koji se ističe kao "najpopularniji" — strukturno,
// nezavisno od jezika (ne treba duplirati po T.me/T.en).
const PRICING_HIGHLIGHT_INDEX = 1;

function useAdminAuthHint() {
  const [isAdmin, setIsAdmin] = useState(false);
  useEffect(() => {
    // NAPOMENA — isti obrazac i razlog kao u hooks/use-theme.ts (vidi
    // opširan komentar tamo): namjerna, bezbjedna sinhronizacija sa
    // localStorage pri mount-u.
    try {
      setIsAdmin(localStorage.getItem('adminAuthenticated') === 'true');
    } catch {
      // localStorage nedostupan — ponašaj se kao neprijavljen (sigurniji default).
    }
  }, []);
  return { isAdmin, setIsAdmin };
}

function useLang(): [Lang, (l: Lang) => void] {
  const [lang, setLangState] = useState<Lang>('me');
  useEffect(() => {
    // NAPOMENA — isti obrazac i razlog kao u hooks/use-theme.ts (vidi
    // opširan komentar tamo): namjerna, bezbjedna sinhronizacija sa
    // localStorage pri mount-u.
    try {
      const stored = localStorage.getItem(LANG_STORAGE_KEY);
      if (stored === 'en' || stored === 'me') setLangState(stored);
    } catch {}
  }, []);
  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try { localStorage.setItem(LANG_STORAGE_KEY, l); } catch {}
  }, []);
  return [lang, setLang];
}

export default function HomeClient() {
  // FIX (po zahtjevu — default tema je sad LIGHT, bila je dark)
  const { isDark, toggle } = useTheme(THEME_STORAGE_KEY, false);
  const { isAdmin, setIsAdmin } = useAdminAuthHint();
  const [lang, setLang] = useLang();
  const [clock, setClock] = useState('');
  const t = T[lang];

  useEffect(() => {
    const tick = () => setClock(new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  const handleLogout = useCallback(async () => {
    try {
      await fetch('/api/admin/logout', { method: 'POST' });
    } catch {
      // I ako mrežni poziv padne, lokalno stanje se ipak čisti ispod.
    }
    try { localStorage.removeItem('adminAuthenticated'); } catch {}
    setIsAdmin(false);
  }, [setIsAdmin]);

  const bg        = isDark ? 'bg-[#0B1220]' : 'bg-[#F7F9FC]';
  const bgAlt     = isDark ? 'bg-[#0F1A2E]' : 'bg-white';
  const text      = isDark ? 'text-white' : 'text-[#0B2545]';
  const textMuted = isDark ? 'text-slate-400' : 'text-slate-500';
  const border    = isDark ? 'border-white/10' : 'border-[#0B2545]/10';
  const cardBg    = isDark ? 'bg-white/[0.04] hover:bg-white/[0.07]' : 'bg-white hover:bg-[#F0F5FB]';

  return (
    <div className={`h-screen overflow-y-auto ${bg} ${text} transition-colors duration-300`}>
      {/* ── Header ──────────────────────────────────────────────── */}
      <header className={`sticky top-0 z-20 backdrop-blur-lg ${isDark ? 'bg-[#0B1220]/80' : 'bg-[#F7F9FC]/80'} border-b ${border}`}>
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${isDark ? 'bg-sky-500/15 text-sky-400' : 'bg-[#0B2545]/10 text-[#0B2545]'}`}>
              <Plane className="w-5 h-5" />
            </div>
            <div>
              <div className="font-black tracking-tight leading-none">TIV FIDS</div>
              <div className={`text-[10px] uppercase tracking-widest ${textMuted}`}>{t.tagline}</div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className={`hidden sm:block font-mono text-sm tabular-nums mr-2 ${textMuted}`}>{clock}</span>

            {/* FIX (po zahtjevu — EN/CG prekidač jezika) */}
            <div className={`flex rounded-lg border overflow-hidden ${border}`}>
              <button
                onClick={() => setLang('me')}
                className={`px-2.5 py-2 text-xs font-bold transition-colors ${
                  lang === 'me' ? (isDark ? 'bg-sky-500/20 text-sky-300' : 'bg-[#0B2545]/10 text-[#0B2545]') : `${textMuted} hover:${isDark ? 'text-white' : 'text-[#0B2545]'}`
                }`}
              >
                🇲🇪 CG
              </button>
              <button
                onClick={() => setLang('en')}
                className={`px-2.5 py-2 text-xs font-bold transition-colors ${
                  lang === 'en' ? (isDark ? 'bg-sky-500/20 text-sky-300' : 'bg-[#0B2545]/10 text-[#0B2545]') : `${textMuted} hover:${isDark ? 'text-white' : 'text-[#0B2545]'}`
                }`}
              >
                🇬🇧 EN
              </button>
            </div>

            <button
              onClick={toggle}
              aria-label="Theme"
              className={`p-2.5 rounded-lg border ${border} ${isDark ? 'hover:bg-white/5' : 'hover:bg-black/5'} transition-colors`}
            >
              {isDark ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4 text-[#0B2545]" />}
            </button>
            {isAdmin ? (
              <div className="flex items-center gap-2">
                <Link
                  href="/admin"
                  className="px-4 py-2.5 rounded-lg bg-[#0B2545] hover:bg-[#123a6b] text-white text-sm font-bold transition-colors"
                >
                  {t.adminPanel}
                </Link>
                <button
                  onClick={handleLogout}
                  className={`p-2.5 rounded-lg border ${border} ${isDark ? 'hover:bg-white/5 text-slate-300' : 'hover:bg-black/5 text-[#0B2545]'} transition-colors`}
                  aria-label={t.logoutAria}
                  title={t.logoutAria}
                >
                  <LogOut className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <Link
                href="/admin/login"
                className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[#0B2545] hover:bg-[#123a6b] text-white text-sm font-bold transition-colors"
              >
                <LogIn className="w-4 h-4" /> {t.login}
              </Link>
            )}
          </div>
        </div>
      </header>

      {/* ── Hero ────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden">
        <div
          className={`absolute inset-0 pointer-events-none ${isDark ? 'opacity-100' : 'opacity-60'}`}
          style={{
            background: isDark
              ? 'radial-gradient(60% 50% at 50% 0%, rgba(56,189,248,0.14), transparent), radial-gradient(40% 40% at 85% 20%, rgba(110,231,183,0.10), transparent)'
              : 'radial-gradient(60% 50% at 50% 0%, rgba(56,189,248,0.16), transparent), radial-gradient(40% 40% at 85% 20%, rgba(110,231,183,0.18), transparent)',
          }}
        />
        <div className="relative max-w-3xl mx-auto px-6 pt-16 pb-20 text-center">
          <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-bold uppercase tracking-widest mb-6 ${
            isDark ? 'bg-emerald-400/10 text-emerald-300 border border-emerald-400/20' : 'bg-emerald-500/10 text-emerald-700 border border-emerald-500/20'
          }`}>
            <Sparkles className="w-3.5 h-3.5" /> {t.heroBadge}
          </div>
          <h1 className="text-4xl sm:text-5xl font-black tracking-tight leading-[1.08] mb-6">
            {t.heroTitle1}
            <br />
            <span className={isDark ? 'text-sky-400' : 'text-sky-600'}>{t.heroTitle2}</span>
          </h1>
          <p className={`text-lg max-w-xl mx-auto mb-10 ${textMuted}`}>
            {t.heroSubtitle}
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            {/* NOVO (po zahtjevu — pivot ka SaaS prodaji): primarno dugme
                sad vodi na cjenovnik (#pricing), ne na showcase galeriju —
                primarni posjetilac koga ova stranica treba da ubijedi je
                potencijalni kupac (drugi aerodrom), ne putnik. Sekundarno
                dugme i dalje vodi na uživo showcase, zadržavajući
                postojeću, stvarnu Tivat funkciju stranice. */}
            <a
              href="#pricing"
              className="group flex items-center gap-2 px-7 py-3.5 rounded-xl bg-sky-500 hover:bg-sky-400 text-white font-bold shadow-lg shadow-sky-500/20 transition-all"
            >
              {t.ctaLive}
              <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
            </a>
            <a
              href="#showcase"
              className={`px-7 py-3.5 rounded-xl font-bold border transition-colors ${
                isDark ? 'border-white/15 hover:bg-white/5' : 'border-[#0B2545]/15 hover:bg-white'
              }`}
            >
              {t.ctaDepartures}
            </a>
          </div>
        </div>
      </section>

      {/* ── Showcase ekrana ─────────────────────────────────────── */}
      <section id="showcase" className="max-w-6xl mx-auto px-6 pb-20 scroll-mt-20">
        <div className="text-center mb-8">
          <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-bold uppercase tracking-widest mb-4 ${
            isDark ? 'bg-sky-500/10 text-sky-300 border border-sky-500/20' : 'bg-sky-500/10 text-sky-700 border border-sky-500/20'
          }`}>
            <Eye className="w-3.5 h-3.5" /> {t.showcaseBadge}
          </div>
          <p className={`text-sm max-w-lg mx-auto ${textMuted}`}>{t.showcaseLead}</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
          {t.showcase.map((item, i) => (
            <a
              key={item.title}
              href={DISPLAY_IMAGES[i]}
              target="_blank"
              rel="noopener noreferrer"
              className={`group rounded-2xl border ${border} ${cardBg} overflow-hidden transition-colors`}
            >
              {/* FIX (po zahtjevu — prava slika umjesto ikonice+teksta):
                  aspect-video daje predvidiv okvir dok se slika učitava
                  (bez "skoka" layout-a) — zamijeni datoteke u public/
                  folderu (vidi komentar uz DISPLAY_IMAGES iznad) za
                  stvarni sadržaj; dok ih ne dodaš, prikazaće se slomljena
                  slika-ikonica browsera (očekivano, nije bug u kodu). */}
              <div className={`aspect-video ${isDark ? 'bg-slate-800' : 'bg-slate-100'}`}>
                <img
                  src={DISPLAY_IMAGES[i]}
                  alt={item.title}
                  className="w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-300"
                  loading="lazy"
                />
              </div>
              <div className="p-4">
                <div className="font-bold mb-1">{item.title}</div>
                <div className={`text-xs ${textMuted}`}>{item.description}</div>
              </div>
            </a>
          ))}
        </div>
      </section>

      {/* ── Features ────────────────────────────────────────────── */}
      <section className={`${bgAlt} border-y ${border} py-20`}>
        <div className="max-w-6xl mx-auto px-6">
          <div className="text-center mb-14">
            <h2 className="text-3xl font-black tracking-tight mb-3">{t.featuresTitle}</h2>
            <p className={textMuted}>{t.featuresSubtitle}</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {t.features.map((f, i) => {
              const Icon = FEATURE_ICONS[i];
              return (
                <div key={f.title} className={`rounded-2xl border ${border} p-6 ${isDark ? 'bg-white/[0.03]' : 'bg-[#F7F9FC]'}`}>
                  <div className={`w-11 h-11 rounded-xl flex items-center justify-center mb-4 ${
                    isDark ? 'bg-sky-500/15 text-sky-400' : 'bg-[#0B2545]/8 text-[#0B2545]'
                  }`}>
                    <Icon className="w-5 h-5" />
                  </div>
                  <h3 className="font-bold mb-1.5">{f.title}</h3>
                  <p className={`text-sm leading-relaxed ${textMuted}`}>{f.description}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── Pozicioniranje (za koga je ovo) — NOVO (po zahtjevu,
          2026-10-05): prodajnoj stranici treba jasan odgovor na "zašto
          vama, a ne velikom dobavljaču ili sopstvenom DIY rješenju" —
          ovo je taj odgovor, prije nego što posjetilac uopšte stigne do
          cjenovnika. ───────────────────────────────────────────── */}
      <section className="max-w-6xl mx-auto px-6 py-20">
        <div className="text-center mb-14">
          <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-bold uppercase tracking-widest mb-4 ${
            isDark ? 'bg-amber-400/10 text-amber-300 border border-amber-400/20' : 'bg-amber-500/10 text-amber-700 border border-amber-500/20'
          }`}>
            <Scale className="w-3.5 h-3.5" /> {t.diffBadge}
          </div>
          <h2 className="text-3xl font-black tracking-tight mb-3">{t.diffTitle}</h2>
          <p className={`max-w-2xl mx-auto ${textMuted}`}>{t.diffSubtitle}</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          <div className={`rounded-2xl border ${border} p-7 ${isDark ? 'bg-white/[0.03]' : 'bg-[#F7F9FC]'}`}>
            <h3 className={`font-bold mb-4 ${textMuted}`}>{t.diffLeftTitle}</h3>
            <div className="space-y-3">
              {t.diffLeftPoints.map((p) => (
                <div key={p} className="flex items-start gap-3">
                  <div className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 ${isDark ? 'bg-rose-400/15 text-rose-300' : 'bg-rose-500/15 text-rose-600'}`}>
                    <span className="text-xs font-black leading-none">&times;</span>
                  </div>
                  <span className={`text-sm leading-relaxed ${textMuted}`}>{p}</span>
                </div>
              ))}
            </div>
          </div>
          <div className={`rounded-2xl border-2 p-7 ${isDark ? 'border-sky-500/40 bg-sky-500/[0.06]' : 'border-sky-500/30 bg-sky-50'}`}>
            <h3 className="font-bold mb-4">{t.diffRightTitle}</h3>
            <div className="space-y-3">
              {t.diffRightPoints.map((p) => (
                <div key={p} className="flex items-start gap-3">
                  <div className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 ${isDark ? 'bg-emerald-400/15 text-emerald-300' : 'bg-emerald-500/15 text-emerald-600'}`}>
                    <Check className="w-3 h-3" />
                  </div>
                  <span className="text-sm leading-relaxed">{p}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── Cjenovnik — NOVO (po zahtjevu, 2026-10-05): tri paketa
          umjesto jedne ilustrativne linije cijene, sa najpopularnijim
          paketom istaknutim (PRICING_HIGHLIGHT_INDEX). ──────────── */}
      <section id="pricing" className={`${bgAlt} border-y ${border} py-20 scroll-mt-20`}>
        <div className="max-w-6xl mx-auto px-6">
          <div className="text-center mb-14">
            <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-bold uppercase tracking-widest mb-4 ${
              isDark ? 'bg-emerald-400/10 text-emerald-300 border border-emerald-400/20' : 'bg-emerald-500/10 text-emerald-700 border border-emerald-500/20'
            }`}>
              <Sparkles className="w-3.5 h-3.5" /> {t.pricingBadge}
            </div>
            <h2 className="text-3xl font-black tracking-tight mb-3">{t.pricingTitle}</h2>
            <p className={`max-w-2xl mx-auto ${textMuted}`}>{t.pricingSubtitle}</p>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-stretch">
            {t.pricingTiers.map((tier, i) => {
              const Icon = PRICING_ICONS[i];
              const highlighted = i === PRICING_HIGHLIGHT_INDEX;
              return (
                <div
                  key={tier.name}
                  className={`relative rounded-2xl border flex flex-col p-7 ${
                    highlighted
                      ? isDark ? 'border-2 border-sky-500/50 bg-sky-500/[0.07]' : 'border-2 border-sky-500/40 bg-white shadow-xl shadow-sky-500/10'
                      : `${border} ${isDark ? 'bg-white/[0.03]' : 'bg-[#F7F9FC]'}`
                  }`}
                >
                  {highlighted && (
                    <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-sky-500 text-white text-[10px] font-bold uppercase tracking-widest whitespace-nowrap">
                      {t.popularBadge}
                    </div>
                  )}
                  <div className={`w-11 h-11 rounded-xl flex items-center justify-center mb-4 ${
                    isDark ? 'bg-sky-500/15 text-sky-400' : 'bg-[#0B2545]/8 text-[#0B2545]'
                  }`}>
                    <Icon className="w-5 h-5" />
                  </div>
                  <div className="font-bold text-lg mb-0.5">{tier.name}</div>
                  <div className={`text-xs mb-5 ${textMuted}`}>{tier.screens}</div>
                  <div className="flex items-baseline gap-1 mb-6">
                    <span className="text-3xl font-black tracking-tight">{tier.price}</span>
                    {tier.priceNote && <span className={`text-sm ${textMuted}`}>{tier.priceNote}</span>}
                  </div>
                  <div className="space-y-2.5 mb-7 flex-1">
                    {tier.features.map((f) => (
                      <div key={f} className="flex items-start gap-2.5">
                        <div className={`w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 ${isDark ? 'bg-emerald-400/15 text-emerald-300' : 'bg-emerald-500/15 text-emerald-600'}`}>
                          <Check className="w-2.5 h-2.5" />
                        </div>
                        <span className={`text-sm leading-relaxed ${textMuted}`}>{f}</span>
                      </div>
                    ))}
                  </div>
                  <a
                    href="mailto:info@fids-tiv.example?subject=Upit%20za%20TIV%20FIDS"
                    className={`flex items-center justify-center gap-2 w-full px-5 py-3 rounded-xl font-bold text-sm transition-colors ${
                      highlighted
                        ? 'bg-sky-500 hover:bg-sky-400 text-white'
                        : `${isDark ? 'bg-white/10 hover:bg-white/15' : 'bg-[#0B2545]/10 hover:bg-[#0B2545]/15 text-[#0B2545]'}`
                    }`}
                  >
                    {tier.cta}
                  </a>
                </div>
              );
            })}
          </div>
          <p className={`text-xs text-center max-w-xl mx-auto mt-8 ${textMuted}`}>{t.pricingFootnote}</p>
        </div>
      </section>

      {/* ── Implementacija ("kako počinjemo") — NOVO (po zahtjevu,
          2026-10-05): konkretizuje put od upita do uživo ekrana — važno
          za nekoga ko odlučuje a nikad nije vidio kako izgleda prelazak
          na novi FIDS sistem. ─────────────────────────────────────── */}
      <section className="max-w-6xl mx-auto px-6 py-20">
        <div className="text-center mb-14">
          <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-bold uppercase tracking-widest mb-4 ${
            isDark ? 'bg-sky-500/10 text-sky-300 border border-sky-500/20' : 'bg-sky-500/10 text-sky-700 border border-sky-500/20'
          }`}>
            <Rocket className="w-3.5 h-3.5" /> {t.onboardingBadge}
          </div>
          <h2 className="text-3xl font-black tracking-tight">{t.onboardingTitle}</h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {t.onboardingSteps.map((step, i) => {
            const Icon = ONBOARDING_ICONS[i];
            return (
              <div key={step.title} className="relative">
                <div className={`rounded-2xl border ${border} p-6 h-full ${isDark ? 'bg-white/[0.03]' : 'bg-[#F7F9FC]'}`}>
                  <div className="flex items-center gap-3 mb-3">
                    <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${
                      isDark ? 'bg-sky-500/15 text-sky-400' : 'bg-[#0B2545]/8 text-[#0B2545]'
                    }`}>
                      <Icon className="w-4 h-4" />
                    </div>
                    <div className={`text-xs font-black ${textMuted}`}>{String(i + 1).padStart(2, '0')}</div>
                  </div>
                  <h3 className="font-bold mb-1.5">{step.title}</h3>
                  <p className={`text-sm leading-relaxed ${textMuted}`}>{step.text}</p>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* ── FAQ — NOVO (AI/GEO, 2026-10-05): pitanja i odgovori su
          format koji AI asistenti najlakše citiraju, a ljudima
          odgovara na zadnje sumnje prije upita. Tekst dolazi iz
          lib/site-content.ts — ISTI stringovi se šalju i kao FAQPage
          JSON-LD u app/page.tsx, pa vidljivi sadržaj i strukturirani
          podaci ne mogu da se razilaze. Namjerno uvijek otvoreno (ne
          <details>) da je sadržaj vidljiv i čitaocima i crawlerima. ── */}
      <section id="faq" className={`${bgAlt} border-y ${border} py-20 scroll-mt-20`}>
        <div className="max-w-5xl mx-auto px-6">
          <div className="text-center mb-14">
            <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-bold uppercase tracking-widest mb-4 ${
              isDark ? 'bg-sky-500/10 text-sky-300 border border-sky-500/20' : 'bg-sky-500/10 text-sky-700 border border-sky-500/20'
            }`}>
              <Info className="w-3.5 h-3.5" /> {t.faqBadge}
            </div>
            <h2 className="text-3xl font-black tracking-tight">{t.faqTitle}</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {FAQ[lang].map((item) => (
              <div key={item.q} className={`rounded-2xl border ${border} p-6 ${isDark ? 'bg-white/[0.03]' : 'bg-[#F7F9FC]'}`}>
                <h3 className="font-bold mb-2">{item.q}</h3>
                <p className={`text-sm leading-relaxed ${textMuted}`}>{item.a}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Vodite drugi aerodrom? (B2B pitch — po zahtjevu) ──────
          v4: skraćeno na povjerenje + finalni poziv na akciju — pun
          cjenovnik je sad gore (#pricing), ova sekcija je zadnji "gurni
          preko linije" prije footer-a. ───────────────────────────── */}
      <section className="max-w-5xl mx-auto px-6 py-20">
        <div className={`rounded-3xl border ${border} p-10 sm:p-14 ${isDark ? 'bg-white/[0.03]' : 'bg-white'}`}>
          <div className="flex flex-col lg:flex-row gap-10 items-start">
            <div className="flex-1">
              <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-bold uppercase tracking-widest mb-5 ${
                isDark ? 'bg-sky-500/10 text-sky-300 border border-sky-500/20' : 'bg-sky-500/10 text-sky-700 border border-sky-500/20'
              }`}>
                <Building2 className="w-3.5 h-3.5" /> {t.partnerBadge}
              </div>
              <h2 className="text-2xl sm:text-3xl font-black tracking-tight mb-3">{t.partnerTitle}</h2>
              <p className={`text-sm leading-relaxed mb-6 ${textMuted}`}>{t.partnerSubtitle}</p>
              <div className="space-y-3">
                {t.partnerPoints.map((p) => (
                  <div key={p.title} className="flex items-start gap-3">
                    <div className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 ${isDark ? 'bg-emerald-400/15 text-emerald-300' : 'bg-emerald-500/15 text-emerald-600'}`}>
                      <Check className="w-3 h-3" />
                    </div>
                    <div>
                      <span className="font-bold">{p.title}.</span>{' '}
                      <span className={textMuted}>{p.text}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className={`w-full lg:w-72 flex-shrink-0 rounded-2xl border ${border} p-6 ${isDark ? 'bg-white/[0.03]' : 'bg-[#F7F9FC]'}`}>
              <div className={`text-xs font-bold uppercase tracking-wider mb-2 ${textMuted}`}>{t.partnerPricingLabel}</div>
              <div className="text-2xl font-black tracking-tight mb-1">{t.partnerPricingLine1}</div>
              <a href="#pricing" className={`text-xs mb-6 block hover:underline ${textMuted}`}>{t.partnerPricingLine2}</a>
              <a
                href="mailto:info@fids-tiv.example?subject=Upit%20za%20TIV%20FIDS"
                className="flex items-center justify-center gap-2 w-full px-5 py-3 rounded-xl bg-[#0B2545] hover:bg-[#123a6b] text-white font-bold text-sm transition-colors"
              >
                <Mail className="w-4 h-4" /> {t.partnerCta}
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* ── CTA traka (osoblje) ─────────────────────────────────── */}
      <section className="max-w-5xl mx-auto px-6 py-20 text-center">
        <div className={`rounded-3xl border ${border} p-10 sm:p-14 ${isDark ? 'bg-gradient-to-br from-sky-500/10 to-emerald-400/5' : 'bg-gradient-to-br from-sky-50 to-emerald-50'}`}>
          <Luggage className={`w-10 h-10 mx-auto mb-4 ${isDark ? 'text-emerald-300' : 'text-emerald-600'}`} />
          <h2 className="text-2xl sm:text-3xl font-black tracking-tight mb-3">{t.ctaStaffTitle}</h2>
          <p className={`mb-8 ${textMuted}`}>{t.ctaStaffText}</p>
          <Link
            href={isAdmin ? '/admin' : '/admin/login'}
            className="inline-flex items-center gap-2 px-7 py-3.5 rounded-xl bg-[#0B2545] hover:bg-[#123a6b] text-white font-bold transition-colors"
          >
            {isAdmin ? <><CheckSquare className="w-4 h-4" /> {t.ctaStaffButtonLoggedIn}</> : <><LogIn className="w-4 h-4" /> {t.ctaStaffButtonLoggedOut}</>}
          </Link>
        </div>
      </section>

      {/* ── O sistemu (About) ──────────────────────────────────── */}
      <section className={`${bgAlt} border-y ${border} py-20`}>
        <div className="max-w-3xl mx-auto px-6">
          <div className="flex items-center gap-2 mb-6 justify-center">
            <Info className={isDark ? 'w-5 h-5 text-sky-400' : 'w-5 h-5 text-sky-600'} />
            <h2 className="text-2xl font-black tracking-tight">{t.aboutTitle}</h2>
          </div>
          <div className="space-y-4">
            {t.aboutParagraphs.map((p, i) => (
              <p key={i} className={`text-sm leading-relaxed ${textMuted}`}>{p}</p>
            ))}
          </div>
        </div>
      </section>

      {/* ── Footer ──────────────────────────────────────────────── */}
      <footer className={`border-t ${border} py-8`}>
        <div className="max-w-6xl mx-auto px-6 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className={`text-xs ${textMuted}`}>&copy; {new Date().getFullYear()} {t.tagline} &middot; {t.footerRights}</div>
          <div className={`flex items-center gap-4 text-xs ${textMuted}`}>
            <a href="#showcase" className="hover:underline">{t.footerLive}</a>
            <a href="#pricing" className="hover:underline">{t.footerPricing}</a>
            <Link href="/admin/login" className="hover:underline">{t.footerAdmin}</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
