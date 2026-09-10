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
import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  Plane, DoorOpen, CheckSquare,
  Luggage, Radio, ShieldCheck, Zap, Clock3, MonitorSmartphone,
  Sun, Moon, LogIn, LogOut, ArrowRight, Sparkles, Info, Building2, Mail, Check,
} from 'lucide-react';
import { useTheme } from '@/hooks/use-theme';

const THEME_STORAGE_KEY = 'theme:landing';
const LANG_STORAGE_KEY = 'lang:landing';

type Lang = 'me' | 'en';

// ════════════════════════════════════════════════════════════
// PREVODI
// ════════════════════════════════════════════════════════════
const T = {
  me: {
    tagline: 'Aerodrom Tivat',
    heroBadge: 'Uživo · 24/7',
    heroTitle1: 'Sistem informisanja',
    heroTitle2: 'o letovima',
    heroTitleSuffix: 'za Aerodrom Tivat',
    heroSubtitle: 'Uživo raspored letova, upravljanje gate-ovima i check-in šalterima, i automatski razglas terminala — sve na jednom mjestu, ažurirano u realnom vremenu.',
    ctaLive: 'Pogledaj letove uživo',
    ctaDepartures: 'Raspored odlazaka',
    login: 'Prijava',
    adminPanel: 'Admin panel',
    logoutAria: 'Odjava',
    showcase: [
      { title: 'Odlasci', description: 'Uživo raspored svih odlazećih letova' },
      { title: 'Dolasci', description: 'Uživo raspored svih dolazećih letova' },
      { title: 'Split Board', description: 'Podijeljen prikaz za velike terminale' },
    ],
    featuresTitle: 'Zašto TIV FIDS',
    featuresSubtitle: 'Moderna infrastruktura, napravljena za stvarne potrebe jednog aerodroma.',
    features: [
      { title: 'Uživo, u realnom vremenu', description: 'Podaci o letovima se osvježavaju kontinuirano tokom cijelog dana — gate, šalter, status i vrijeme polaska/dolaska uvijek ažurni.' },
      { title: 'Upravljanje gate-ovima i šalterima', description: 'Operativno osoblje dodjeljuje izlaze i check-in šaltere letovima u par sekundi, sa trenutnim odrazom na svim ekranima terminala.' },
      { title: 'Automatski razglas (PA)', description: 'Sistem sam najavljuje registraciju, ukrcavanje i kašnjenja — na engleskom i lokalnom jeziku — bez ručnog čitanja poziva.' },
      { title: 'Prilagođeno svakom ekranu', description: 'Isti podaci, pravilno oblikovani za gate monitore, check-in table, prikaze prtljaga i velike terminalne panoe.' },
      { title: 'Sigurna administracija', description: 'Zaštićen admin panel za osoblje — ručne dodjele, konfiguraciju avio kompanija i kontrolu razglasa, odvojeno od javnih prikaza.' },
      { title: 'Pouzdano 24/7/365', description: 'Sistem prati radno vrijeme aerodroma i sam prelazi u noćni režim — bez nepotrebnog rada kad nema letova.' },
    ],
    aboutTitle: 'O sistemu',
    aboutParagraphs: [
      'TIV FIDS je sistem za informisanje putnika razvijen posebno za Aerodrom Tivat — prikazuje uživo raspored letova na svim ekranima terminala: gate monitorima, check-in šalterima, prikazima dolazaka i odlazaka, i prikazima prtljaga.',
      'Osim javnih ekrana, sistem uključuje i operativni dio za osoblje aerodroma: ručnu dodjelu gate-ova i check-in šaltera letovima, konfiguraciju avio kompanija, i automatski razglas terminala koji sam najavljuje registraciju, ukrcavanje i kašnjenja letova, na dva jezika.',
      'Sistem je napravljen da radi pouzdano, cijele godine, bez prekida — prateći stvarni ritam rada aerodroma, uključujući noćni režim kada nema letova.',
    ],
    ctaStaffTitle: 'Osoblje aerodroma?',
    ctaStaffText: 'Prijavi se na admin panel za dodjelu gate-ova i šaltera, upravljanje razglasom, i konfiguraciju sistema.',
    ctaStaffButtonLoggedIn: 'Idi na admin panel',
    ctaStaffButtonLoggedOut: 'Prijava osoblja',
    partnerBadge: 'Za aerodrome',
    partnerTitle: 'Vodite drugi aerodrom?',
    partnerSubtitle: 'TIV FIDS je izgrađen da bude jednostavno prenosiv — isti sistem koji vidite ovdje, prilagođen vašem aerodromu, u znatno kraćem roku i po znatno nižoj cijeni od tradicionalnih FIDS rješenja.',
    partnerPoints: [
      { title: 'Već radi uživo', text: 'Nije prototip — ovo je isti sistem koji svakodnevno vodi Aerodrom Tivat.' },
      { title: 'Vaš izvor podataka', text: 'Bez obzira na format vašeg sistema (REST, XML, CSV, sopstveni AODB) — gradimo prilagođen konektor, ostatak sistema ostaje isti.' },
      { title: 'Bez zaključavanja kod jednog dobavljača', text: 'Radi na standardnoj cloud infrastrukturi (Vercel + Redis) — transparentno, bez skrivenih troškova hardvera.' },
    ],
    partnerPricingLabel: 'Ilustrativna cijena',
    partnerPricingLine1: 'od €20 / mjesečno po ekranu',
    partnerPricingLine2: 'Za aerodrom sa 40 ekrana: manje od €0,002 po putniku',
    partnerCta: 'Zatraži ponudu',
    footerRights: 'Sistem informisanja o letovima',
    footerLive: 'Uživo letovi',
    footerAdmin: 'Admin',
  },
  en: {
    tagline: 'Tivat Airport',
    heroBadge: 'Live · 24/7',
    heroTitle1: 'Flight Information',
    heroTitle2: '& Display System',
    heroTitleSuffix: 'for Tivat Airport',
    heroSubtitle: 'Live flight schedules, gate and check-in desk management, and automated terminal announcements — all in one place, updated in real time.',
    ctaLive: 'View live flights',
    ctaDepartures: 'Departures schedule',
    login: 'Sign in',
    adminPanel: 'Admin panel',
    logoutAria: 'Sign out',
    showcase: [
      { title: 'Departures', description: 'Live schedule of all departing flights' },
      { title: 'Arrivals', description: 'Live schedule of all arriving flights' },
      { title: 'Split Board', description: 'Split-screen view for larger terminals' },
    ],
    featuresTitle: 'Why TIV FIDS',
    featuresSubtitle: 'Modern infrastructure, built for the real needs of an airport.',
    features: [
      { title: 'Live, in real time', description: 'Flight data refreshes continuously throughout the day — gate, desk, status, and departure/arrival times always up to date.' },
      { title: 'Gate & desk management', description: 'Operations staff assign gates and check-in desks to flights within seconds, reflected instantly across every terminal screen.' },
      { title: 'Automated announcements (PA)', description: 'The system announces check-in, boarding, and delays on its own — in English and the local language — without manual calls.' },
      { title: 'Built for every screen', description: 'The same data, properly formatted for gate monitors, check-in boards, baggage displays, and large terminal panels.' },
      { title: 'Secure administration', description: 'A protected admin panel for staff — manual assignments, airline configuration, and PA control, separate from public displays.' },
      { title: 'Reliable 24/7/365', description: 'The system follows the airport\u2019s operating hours and switches to night mode on its own — no unnecessary activity when there are no flights.' },
    ],
    aboutTitle: 'About the system',
    aboutParagraphs: [
      'TIV FIDS is a passenger information system built specifically for Tivat Airport — it displays live flight schedules across every terminal screen: gate monitors, check-in desks, arrivals and departures boards, and baggage claim displays.',
      'Beyond the public displays, the system includes an operational layer for airport staff: manual assignment of gates and check-in desks to flights, airline configuration, and an automated terminal announcement system that calls check-in, boarding, and delays on its own, in two languages.',
      'The system is built to run reliably, all year round, without interruption — following the airport\u2019s real operating rhythm, including a night mode when there are no flights.',
    ],
    ctaStaffTitle: 'Airport staff?',
    ctaStaffText: 'Sign in to the admin panel to assign gates and desks, control the PA system, and configure the system.',
    ctaStaffButtonLoggedIn: 'Go to admin panel',
    ctaStaffButtonLoggedOut: 'Staff sign in',
    partnerBadge: 'For airports',
    partnerTitle: 'Running another airport?',
    partnerSubtitle: 'TIV FIDS was built to be easily portable — the same system you see here, adapted to your airport, deployed in far less time and at a fraction of the cost of traditional FIDS solutions.',
    partnerPoints: [
      { title: 'Already running live', text: 'This isn\u2019t a prototype — it\u2019s the same system that runs Tivat Airport every day.' },
      { title: 'Your data source', text: 'Whatever format your system uses (REST, XML, CSV, your own AODB) — we build a matching connector, the rest of the system stays the same.' },
      { title: 'No vendor lock-in', text: 'Runs on standard cloud infrastructure (Vercel + Redis) — transparent, no hidden hardware costs.' },
    ],
    partnerPricingLabel: 'Illustrative pricing',
    partnerPricingLine1: 'from €20 / month per screen',
    partnerPricingLine2: 'For a 40-screen airport: under €0.002 per passenger',
    partnerCta: 'Request a quote',
    footerRights: 'Flight Information Display System',
    footerLive: 'Live flights',
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

function useAdminAuthHint() {
  const [isAdmin, setIsAdmin] = useState(false);
  useEffect(() => {
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
            {' '}{t.heroTitleSuffix}
          </h1>
          <p className={`text-lg max-w-xl mx-auto mb-10 ${textMuted}`}>
            {t.heroSubtitle}
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            {/* FIX (po zahtjevu — /demo/combined uklonjeno u potpunosti):
                glavno dugme sad skroluje do showcase galerije (id="showcase"
                ispod) umjesto da vodi na obrisanu kombinovanu demo stranicu. */}
            <a
              href="#showcase"
              className="group flex items-center gap-2 px-7 py-3.5 rounded-xl bg-sky-500 hover:bg-sky-400 text-white font-bold shadow-lg shadow-sky-500/20 transition-all"
            >
              {t.ctaLive}
              <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
            </a>
            <a
              href={DISPLAY_IMAGES[0]}
              target="_blank"
              rel="noopener noreferrer"
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

      {/* ── CTA traka ────────────────────────────────────────────── */}
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

      {/* ── Vodite drugi aerodrom? (B2B pitch — po zahtjevu) ──────
          Namjerno KRATKO i skromno pozicionirano (ne dominira
          stranicom čiji je primarni auditorijum putnici i osoblje
          Tivat aerodroma) — ali dovoljno da neko ko odlučuje za DRUGI
          aerodrom, ako sleti na ovu stranicu, odmah vidi da je ovo i
          proizvod koji se može nabaviti, ne samo interni alat jednog
          aerodroma. mailto: link umjesto forme — nema pravog "lead"
          API-ja/servisa iza, pa je ovo najjednostavniji, nula-troška
          način da se stvarno primi upit. ──────────────────────── */}
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
              <div className={`text-xs mb-6 ${textMuted}`}>{t.partnerPricingLine2}</div>
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
            <Link href="/admin/login" className="hover:underline">{t.footerAdmin}</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
