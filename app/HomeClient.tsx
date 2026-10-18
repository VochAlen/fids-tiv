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
// v5b (2026-10-11): sekcija "Naša priča" (#history) — istorija sistema od VB6 do danas.
//
// v5 (po zahtjevu — 2026-10-11): nova sekcija "Pametni prijedlozi dodjele"
// (#smart) sa svim mogućnostima planera šaltera/gate-ova: pravila
// (otvaranje po avio kompaniji iz settings.ini, pauza, uzastopni šalteri,
// isti terminal, zimi T1), učenje iz ručnih dodjela u pregledniku (bez
// plaćenog AI-a), napomene običnim tekstom, nezavisna provjera plana,
// stabilnost prijedloga i štampani A4 PDF plan. Hero/features/about/FAQ
// dopunjeni. Tvrdnje namjerno odgovaraju onome što kod stvarno radi.
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
  Brain, ShieldAlert, FileText, MessageSquareText, Building, Layers,
  History, Megaphone, Terminal, FileCode2, Cloud, Hourglass, PlaneTakeoff,
  Bus, TrainFront, Ship, Monitor, Copy, Wrench, Anchor,
} from 'lucide-react';
import { useTheme } from '@/hooks/use-theme';
import { FAQ, SITE_URL } from '@/lib/site-content';

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
    heroBoardTitle: 'Odlasci',
    heroBoardNote: 'Ilustracija prikaza — stvarni ekrani su ispod',
    heroBoardCols: ['Vrijeme', 'Destinacija', 'Šalter', 'Gate', 'Status'],
    heroStatus: { onTime: 'Na vrijeme', checkin: 'Check-in', boarding: 'Ukrcavanje', closing: 'Zadnji poziv', delayed: 'Kasni' },
    heroStats: [
      { value: '{liveYears}', label: 'godina u radu' },
      { value: '24/7', label: 'uživo, cijele godine' },
      { value: '6', label: 'tipova ekrana' },
      { value: '2', label: 'jezika razglasa' },
    ],
    heroSubtitle: 'Isti sistem koji svakodnevno vodi Aerodrom Tivat — uživo raspored letova, upravljanje gate-ovima i check-in šalterima uz pametne prijedloge dodjele, i automatski razglas terminala. Bez cijene i složenosti tradicionalnih FIDS rješenja.',
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
    smartBadge: 'Pametni prijedlozi',
    smartTitle: 'Sistem predlaže koje šaltere i gate-ove otvoriti',
    smartSubtitle: 'Planer za dispečere: za svaki let predlaže check-in šaltere i gate, vodi računa o svim letovima zajedno i uči iz navika vašeg osoblja. Bez plaćenog AI servisa i bez troška po upitu.',
    smartItems: [
      { title: 'Pravila koja poštuju operativu', description: 'Vrijeme otvaranja check-ina po kompaniji (iz settings.ini), zatvaranje 30 min prije polaska, pauza od 1 min između letova, uzastopni šalteri u istom terminalu i gate u terminalu šaltera.' },
      { title: 'Planira sve letove zajedno', description: 'Ne dodjeljuje letove jedan po jedan: isprobava više redoslijeda i bira plan sa najmanje nestašica, rupa i miješanja terminala. Zimi prednost ima Terminal 1.' },
      { title: 'Uči iz ručnih dodjela', description: 'Model se trenira u pregledniku iz dodjela vašeg osoblja (bez troška servera). Prvih 7 dana samo uči; u prijedloge ulazi tek kad dokaže da pogađa bolje od jednostavnih brojača, a objašnjava zašto je izabrao baš te resurse.' },
      { title: 'Napomene običnim tekstom', description: 'Napišite „šalter 3 ne radi do 14:00“, „T1 ne radi“ ili „LY na 4, 5“ — razumije se bez LLM-a, direktno u pregledniku, i odmah mijenja plan.' },
      { title: 'Nezavisna provjera plana', description: 'Prije prikaza, poseban validator provjerava preklapanja, blokirane resurse, uzastopnost šaltera i terminale. Neispravan prijedlog se ne prikazuje kao važeći, a čekanje na zatvaranje drugog leta je eksplicitno stanje.' },
      { title: 'Stabilni prijedlozi i PDF plan', description: 'Prijedlog se ne mijenja zbog sitnih razlika, ali operativne promjene (kašnjenje, kvar šaltera) uvijek pobjeđuju. Cijeli dan se izvozi kao štampani A4 PDF plan šaltera i gate-ova.' },
    ],
    smartFootnote: 'Prijedlog je pomoć dispečeru, ne zamjena: osoblje uvijek odlučuje i može sve promijeniti ručno.',
    historyBadge: 'Naša priča',
    historyTitle: 'Od VB6 projekta iz {devSince}. do cloud sistema — {liveYears} godina uživo',
    historySubtitle: 'TIV FIDS nije nastao preko noći niti iz prezentacije. Rastao je godinama, uz stvarne letove, stvarno osoblje i stvarne greške iz kojih se učilo.',
    historySteps: [
      { year: '2009', title: 'Visual Basic 6', text: 'Razvoj počinje 2009. kao jednostavan VB6 projekat — prvi pokušaj da se informacije o letovima prikazuju putnicima bez skupog gotovog rješenja.' },
      { year: '2012', title: 'Javni rad počinje', text: 'Nakon tri godine razvoja sistem izlazi u javni rad i počinje da radi na Aerodromu Tivat, sa stvarnim letovima i stvarnim ekranima u terminalu.' },
      { year: '2015', title: 'Automatski razglas', text: 'Dodaje se razglas: sistem sam najavljuje letove, umjesto da to radi osoblje ručno.' },
      { year: '2017–2020', title: 'Node.js i JavaScript', text: 'Sistem prelazi na Node i JavaScript — ekrani rade u običnom browseru, bez posebnog hardvera i desktop aplikacija.' },
      { year: '2023', title: 'TypeScript i moderna cloud arhitektura', text: 'Kod prelazi na TypeScript (Next.js, React), a podaci uživo na Redis i Ably realtime, na standardnom cloud hostingu.' },
      { year: 'Danas', title: 'Pametno planiranje', text: 'Planer šaltera i gate-ova koji uči iz navika osoblja i nezavisno provjerava svaki plan.' },
    ],
    historyFootnote: 'Strpljiva evolucija umjesto prepisivanja od nule: svaka faza je ostala u radu dok se gradila sljedeća.',
    beyondBadge: 'Ne samo aerodromi',
    beyondTitle: 'Isti sistem za svako mjesto na kome se čeka polazak',
    beyondSubtitle: 'Tabla polazaka, dodjela mjesta, razglas i ekrani u realnom vremenu nisu vezani za avione. Mijenja se izvor podataka i terminologija — ostatak sistema ostaje isti.',
    beyondItems: [
      { title: 'Autobuske stanice', description: 'Polasci i dolasci autobusa, dodjela perona umjesto gate-ova, kašnjenja, i razglas na dva jezika. Odgovara i manjim stanicama bez skupog sistema.' },
      { title: 'Željezničke stanice', description: 'Vozni red uživo, kolosijeci i peroni, izmjene i kašnjenja voza na svim ekranima u stanici, uz automatsku najavu.' },
      { title: 'Luke i trajektni terminali', description: 'Polasci trajekata i brodova, dodjela vezova i ukrcavanja, informacije o kašnjenjima zbog vremena i najave putnicima.' },
    ],
    beyondNote: 'Radi se o prilagođavanju konektora i naziva (peron, kolosijek, vez) — ne o novom proizvodu. Javite nam vaš izvor podataka i procijenićemo šta je potrebno.',
    setupBadge: 'Podešavanje klijenta',
    setupTitle: 'Kiosk režim u Chrome-u: ekran spreman za par minuta',
    setupSubtitle: 'Svaki ekran je obična web adresa. Dovoljan je običan računar ili mini-PC sa Chrome-om koji se sam pokrene preko cijelog ekrana i ostane tako — bez miša, tastature i prijave.',
    setupTabs: { win: 'Windows', linux: 'Linux / Raspberry Pi' },
    setupAddrTitle: '1. Odaberite adresu ekrana',
    setupAddrText: 'Zamijenite osnovnu adresu vašom, ako koristite sopstveni domen.',
    setupAddrs: [
      ['Odlasci', '/departures'], ['Dolasci', '/arrivals'], ['Split Board', '/split-board'],
      ['Kombinovani prikaz', '/combined'], ['Prtljag (traka 1)', '/baggage/1'],
      ['Check-in šalter 3', '/ver2/ver2/checkin/3'], ['Gate 2', '/ver2/ver2/gate/2'], ['Razglas (zvuk)', '/pa'],
    ],
    setupStepsWin: [
      { title: '2. Napravite prečicu', text: 'Desni klik na radnu površinu → Novo → Prečica. U polje lokacije zalijepite komandu ispod (po potrebi promijenite putanju do chrome.exe i adresu ekrana).' },
      { title: '3. Pokretanje uz paljenje računara', text: 'Pritisnite Win+R, upišite shell:startup i prebacite prečicu u taj folder. Uključite i automatsku prijavu na Windows (netplwiz), da ekran krene bez ikoga.' },
      { title: '4. Zabranite gašenje ekrana i spavanje', text: 'U PowerShell-u ili Command Prompt-u (kao administrator) pokrenite komande ispod.' },
    ],
    setupStepsLinux: [
      { title: '2. Skripta za pokretanje', text: 'Sačuvajte skriptu ispod kao ~/fids-kiosk.sh i omogućite je (chmod +x). Ona gasi štednju ekrana i pokreće Chrome/Chromium preko cijelog ekrana.' },
      { title: '3. Pokretanje uz paljenje računara', text: 'Dodajte stavku u autostart (fajl ispod, ~/.config/autostart/fids.desktop). Uključite automatsku prijavu korisnika u postavkama sistema. Na novijim Raspberry Pi OS (Wayland) autostart ide kroz labwc/autostart.' },
    ],
    setupCommandLabel: 'Komanda',
    setupCopy: 'Kopiraj',
    setupCopied: 'Kopirano',
    setupExitTitle: 'Kako izaći iz kiosk režima',
    setupExitText: 'Pritisnite Alt+F4 (zatvara Chrome). Za održavanje spojite tastaturu ili se povežite daljinski.',
    setupTipsTitle: 'Provjera prije predaje ekrana',
    setupTips: [
      'Razlučivost ekrana na preporučenu, a skaliranje na 100% — tekst se tada tačno uklapa.',
      'Za ekran sa zvukom (razglas /pa) obavezno koristite zastavicu --autoplay-policy, inače browser blokira zvuk.',
      'Isključite obavještenja i automatska ažuriranja sistema u radnom vremenu aerodroma.',
      'Chrome 109 je zadnja verzija za Windows 7/8.1 — sistem radi i na njoj.',
      'Ako se poslije restarta ništa ne prikaže: provjerite automatsku prijavu i prečicu u startup folderu. Dok se stranica učitava ili veza obnavlja, ekran prikazuje neaktivni ekran sa pozadinom aerodroma i satom, ne crn ekran.',
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
      'Osim javnih ekrana, sistem uključuje i operativni dio za osoblje aerodroma: ručnu dodjelu gate-ova i check-in šaltera letovima, konfiguraciju avio kompanija, i automatski razglas terminala koji sam najavljuje registraciju, ukrcavanje i kašnjenja letova, na dva jezika. Planer predlaže šaltere i gate-ove za cijeli dan, uči iz ručnih dodjela osoblja, nezavisno provjerava plan i izvozi ga kao štampani PDF.',
      'Sistem je napravljen da radi pouzdano, cijele godine, bez prekida — prateći stvarni ritam rada aerodroma, uključujući noćni režim kada nema letova.',
    ],
    footerRights: 'Sistem informisanja o letovima',
    footerLive: 'Uživo letovi',
    footerPricing: 'Cjenovnik',
    footerSmart: 'Pametni prijedlozi',
    footerHistory: 'Naša priča',
    footerSetup: 'Podešavanje ekrana',
    footerAdmin: 'Admin',
  },
  en: {
    tagline: 'Tivat Airport',
    heroBadge: 'Live at Tivat Airport · 24/7',
    heroTitle1: 'Modern FIDS',
    heroTitle2: 'for small and regional airports',
    heroTitleSuffix: '',
    heroBoardTitle: 'Departures',
    heroBoardNote: 'Illustration of a display — real screens are below',
    heroBoardCols: ['Time', 'Destination', 'Desk', 'Gate', 'Status'],
    heroStatus: { onTime: 'On time', checkin: 'Check-in', boarding: 'Boarding', closing: 'Final call', delayed: 'Delayed' },
    heroStats: [
      { value: '{liveYears}', label: 'years in operation' },
      { value: '24/7', label: 'live, all year round' },
      { value: '6', label: 'screen types' },
      { value: '2', label: 'announcement languages' },
    ],
    heroSubtitle: 'The same system that runs Tivat Airport every day — live flight schedules, gate and check-in desk management with smart assignment suggestions, and automated terminal announcements. Without the cost and complexity of traditional FIDS solutions.',
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
    smartBadge: 'Smart suggestions',
    smartTitle: 'The system proposes which desks and gates to open',
    smartSubtitle: 'A planner for dispatchers: for every flight it proposes check-in desks and a gate, plans all flights together, and learns from your staff’s habits. No paid AI service and no per-query cost.',
    smartItems: [
      { title: 'Rules that respect operations', description: 'Check-in opening time per airline (from settings.ini), closing 30 min before departure, a 1-minute turnover pause, consecutive desks in one terminal, and the gate in the same terminal as the desks.' },
      { title: 'Plans all flights together', description: 'It does not assign flights one by one: it tries several orderings and picks the plan with the fewest shortages, gaps and terminal mix-ups. Terminal 1 is preferred in winter.' },
      { title: 'Learns from manual assignments', description: 'A model trains in the browser from your staff’s assignments (no server cost). It only learns for the first 7 days, enters suggestions only after it proves better than simple counters, and explains why it picked those resources.' },
      { title: 'Plain-text notes', description: 'Type “desk 3 out of order until 14:00”, “T1 closed” or “LY on 4, 5” — understood without an LLM, right in the browser, and the plan updates immediately.' },
      { title: 'Independent plan check', description: 'Before it is shown, a separate validator checks overlaps, blocked resources, desk consecutiveness and terminals. An invalid suggestion is never shown as valid, and waiting for another flight to close is an explicit state.' },
      { title: 'Stable suggestions & PDF plan', description: 'Suggestions do not flip over tiny differences, but operational changes (a delay, a broken desk) always win. The whole day exports as a printable A4 PDF plan of desks and gates.' },
    ],
    smartFootnote: 'Suggestions assist the dispatcher, they do not replace them: staff always decide and can change anything manually.',
    historyBadge: 'Our story',
    historyTitle: 'From a {devSince} VB6 project to a cloud system — {liveYears} years live',
    historySubtitle: 'TIV FIDS did not appear overnight or from a slide deck. It grew over the years, alongside real flights, real staff, and real mistakes to learn from.',
    historySteps: [
      { year: '2009', title: 'Visual Basic 6', text: 'Development started in 2009 as a simple VB6 project — a first attempt to show flight information to passengers without an expensive off-the-shelf product.' },
      { year: '2012', title: 'Public operation begins', text: 'After three years of development the system went live and started running at Tivat Airport, with real flights and real screens in the terminal.' },
      { year: '2015', title: 'Automated announcements', text: 'Public address was added: the system announces flights on its own instead of staff doing it by hand.' },
      { year: '2017–2020', title: 'Node.js and JavaScript', text: 'The system moved to Node and JavaScript — screens run in an ordinary browser, with no special hardware or desktop applications.' },
      { year: '2023', title: 'TypeScript and modern cloud architecture', text: 'The code moved to TypeScript (Next.js, React), with live data on Redis and Ably realtime, on standard cloud hosting.' },
      { year: 'Today', title: 'Smart planning', text: 'A desk and gate planner that learns from staff habits and independently checks every plan.' },
    ],
    historyFootnote: 'Patient evolution instead of a rewrite from scratch: every phase stayed in operation while the next one was being built.',
    beyondBadge: 'Not only airports',
    beyondTitle: 'The same system for any place where people wait for a departure',
    beyondSubtitle: 'Departure boards, resource assignment, announcements and realtime screens are not tied to aircraft. The data source and terminology change — the rest of the system stays the same.',
    beyondItems: [
      { title: 'Bus stations', description: 'Bus departures and arrivals, platform assignment instead of gates, delays, and announcements in two languages. Fits smaller stations without an expensive system.' },
      { title: 'Railway stations', description: 'A live timetable, tracks and platforms, train changes and delays on every station screen, with automatic announcements.' },
      { title: 'Ports & ferry terminals', description: 'Ferry and ship departures, berth and boarding assignment, weather-delay information and passenger announcements.' },
    ],
    beyondNote: 'This is adapting the connector and terminology (platform, track, berth) — not building a new product. Tell us your data source and we will assess what is needed.',
    setupBadge: 'Client setup',
    setupTitle: 'Chrome kiosk mode: a screen ready in minutes',
    setupSubtitle: 'Every screen is an ordinary web address. All you need is a regular PC or mini-PC with Chrome that starts full-screen on its own and stays that way — no mouse, keyboard or sign-in.',
    setupTabs: { win: 'Windows', linux: 'Linux / Raspberry Pi' },
    setupAddrTitle: '1. Pick the screen address',
    setupAddrText: 'Replace the base address with yours if you use your own domain.',
    setupAddrs: [
      ['Departures', '/departures'], ['Arrivals', '/arrivals'], ['Split Board', '/split-board'],
      ['Combined view', '/combined'], ['Baggage (belt 1)', '/baggage/1'],
      ['Check-in desk 3', '/ver2/ver2/checkin/3'], ['Gate 2', '/ver2/ver2/gate/2'], ['Announcements (audio)', '/pa'],
    ],
    setupStepsWin: [
      { title: '2. Create a shortcut', text: 'Right-click the desktop → New → Shortcut. Paste the command below into the location field (adjust the path to chrome.exe and the screen address if needed).' },
      { title: '3. Start with the computer', text: 'Press Win+R, type shell:startup and move the shortcut into that folder. Also enable Windows auto sign-in (netplwiz) so the screen starts unattended.' },
      { title: '4. Block screen-off and sleep', text: 'In PowerShell or Command Prompt (as administrator) run the commands below.' },
    ],
    setupStepsLinux: [
      { title: '2. Launch script', text: 'Save the script below as ~/fids-kiosk.sh and make it executable (chmod +x). It disables screen blanking and launches Chrome/Chromium full-screen.' },
      { title: '3. Start with the computer', text: 'Add an autostart entry (file below, ~/.config/autostart/fids.desktop). Enable automatic user sign-in in system settings. On newer Raspberry Pi OS (Wayland), autostart goes through labwc/autostart.' },
    ],
    setupCommandLabel: 'Command',
    setupCopy: 'Copy',
    setupCopied: 'Copied',
    setupExitTitle: 'How to exit kiosk mode',
    setupExitText: 'Press Alt+F4 (closes Chrome). Plug in a keyboard for maintenance, or connect remotely.',
    setupTipsTitle: 'Checklist before handing over a screen',
    setupTips: [
      'Set the display to its recommended resolution and scaling to 100% so text fits exactly.',
      'For a screen with audio (announcements, /pa) always use the --autoplay-policy flag, otherwise the browser blocks sound.',
      'Turn off notifications and automatic system updates during operating hours.',
      'Chrome 109 is the last version for Windows 7/8.1 — the system works on it too.',
      'If nothing appears after a restart: check auto sign-in and the shortcut in the startup folder. While the page loads or the connection recovers, the screen shows an inactive screen with the airport background and a clock, never a black screen.',
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
      'Beyond the public displays, the system includes an operational layer for airport staff: manual assignment of gates and check-in desks to flights, airline configuration, and an automated terminal announcement system that calls check-in, boarding, and delays on its own, in two languages. A planner proposes desks and gates for the whole day, learns from staff’s manual assignments, independently checks the plan, and exports it as a printable PDF.',
      'The system is built to run reliably, all year round, without interruption — following the airport’s real operating rhythm, including a night mode when there are no flights.',
    ],
    footerRights: 'Flight Information Display System',
    footerLive: 'Live flights',
    footerPricing: 'Pricing',
    footerSmart: 'Smart suggestions',
    footerHistory: 'Our story',
    footerSetup: 'Screen setup',
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
const SMART_ICONS = [Layers, Building, Brain, MessageSquareText, ShieldAlert, FileText];
// Istorija: unesi samo početne godine — trajanje se računa automatski.
const DEV_SINCE_YEAR = 2009;   // početak razvoja (VB6)
const LIVE_SINCE_YEAR = 2012;  // početak javnog rada
const fillHistory = (str: string) =>
  str
    .replace('{devSince}', String(DEV_SINCE_YEAR))
    .replace('{liveYears}', String(new Date().getFullYear() - LIVE_SINCE_YEAR))
    .replace('{devYears}', String(new Date().getFullYear() - DEV_SINCE_YEAR));
// Hero "tabla": ilustrativni primjer prikaza (NIJE živi feed — nula API poziva).
type HeroStatus = 'onTime' | 'checkin' | 'boarding' | 'closing' | 'delayed';
const HERO_BOARD: { time: string; dest: { me: string; en: string }; desk: string; gate: string; seq: HeroStatus[] }[] = [
  { time: '09:40', dest: { me: 'Beograd', en: 'Belgrade' }, desk: '3–4', gate: '2', seq: ['boarding', 'closing', 'boarding', 'checkin', 'checkin', 'boarding'] },
  { time: '10:05', dest: { me: 'London', en: 'London' }, desk: '5–7', gate: '3', seq: ['checkin', 'checkin', 'boarding', 'boarding', 'closing', 'checkin'] },
  { time: '10:30', dest: { me: 'Beč', en: 'Vienna' }, desk: '—', gate: '4', seq: ['onTime', 'checkin', 'checkin', 'boarding', 'onTime', 'onTime'] },
  { time: '10:55', dest: { me: 'Tel Aviv', en: 'Tel Aviv' }, desk: '21–23', gate: '21', seq: ['delayed', 'delayed', 'checkin', 'delayed', 'checkin', 'checkin'] },
  { time: '11:20', dest: { me: 'Istanbul', en: 'Istanbul' }, desk: '—', gate: '5', seq: ['onTime', 'onTime', 'onTime', 'checkin', 'onTime', 'delayed'] },
];
const HERO_STATUS_STYLE: Record<HeroStatus, string> = {
  onTime: 'text-emerald-300',
  checkin: 'text-sky-300',
  boarding: 'text-amber-300',
  closing: 'text-rose-300',
  delayed: 'text-orange-300',
};
const BEYOND_ICONS = [Bus, TrainFront, Ship];
// Kiosk komande (jezički neutralne). `{URL}` se zamjenjuje adresom ekrana.
const KIOSK_FLAGS = '--kiosk --noerrdialogs --disable-infobars --disable-session-crashed-bubble --no-first-run --disable-pinch --overscroll-history-navigation=0 --autoplay-policy=no-user-gesture-required --check-for-update-interval=31536000 --user-data-dir="C:\\fids-kiosk"';
const kioskWinShortcut = (url: string) => `"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" ${KIOSK_FLAGS} ${url}`;
const KIOSK_WIN_POWER = `powercfg /change monitor-timeout-ac 0
powercfg /change monitor-timeout-dc 0
powercfg /change standby-timeout-ac 0
powercfg /change standby-timeout-dc 0`;
const kioskLinuxScript = (url: string) => `#!/bin/bash
# ~/fids-kiosk.sh — ekran uvijek upaljen, Chromium preko cijelog ekrana
xset s off; xset -dpms; xset s noblank
unclutter -idle 0.5 -root &   # sakrij miš (sudo apt install unclutter)
chromium-browser --kiosk --noerrdialogs --disable-infobars \\
  --disable-session-crashed-bubble --no-first-run --disable-pinch \\
  --overscroll-history-navigation=0 \\
  --autoplay-policy=no-user-gesture-required \\
  --check-for-update-interval=31536000 ${url}`;
const KIOSK_LINUX_AUTOSTART = `[Desktop Entry]
Type=Application
Name=FIDS Kiosk
Exec=/home/pi/fids-kiosk.sh
X-GNOME-Autostart-enabled=true`;
const HISTORY_ICONS = [FileCode2, Hourglass, Megaphone, Terminal, Cloud, Brain];
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

function CodeBlock({ code, label, copyLabel, copiedLabel, isDark }: { code: string; label: string; copyLabel: string; copiedLabel: string; isDark: boolean }) {
  const [copied, setCopied] = useState(false);
  const copy = useCallback(async () => {
    try { await navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch {}
  }, [code]);
  return (
    <div className="rounded-xl border border-white/10 bg-[#050B16] overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 border-b border-white/10 bg-white/[0.03]">
        <span className="text-[10px] uppercase tracking-widest text-slate-400">{label}</span>
        <button onClick={copy} className={`flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-md transition-colors ${isDark ? 'text-sky-300 hover:bg-white/10' : 'text-sky-300 hover:bg-white/10'}`}>
          {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />} {copied ? copiedLabel : copyLabel}
        </button>
      </div>
      <pre className="p-4 text-xs leading-relaxed text-slate-200 overflow-x-auto whitespace-pre font-mono"><code>{code}</code></pre>
    </div>
  );
}

export default function HomeClient() {
  // FIX (po zahtjevu — default tema je sad LIGHT, bila je dark)
  const { isDark, toggle } = useTheme(THEME_STORAGE_KEY, false);
  const { isAdmin, setIsAdmin } = useAdminAuthHint();
  const [lang, setLang] = useLang();
  const [clock, setClock] = useState('');
  const [heroTick, setHeroTick] = useState(0);
  const [setupTab, setSetupTab] = useState<'win' | 'linux'>('win');
  const [setupAddr, setSetupAddr] = useState(0);
  const t = T[lang];

  useEffect(() => {
    const tick = () => setClock(new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  // Hero tabla: mijenja statuse svakih ~3.5 s (samo vizuelno, bez mreže); poštuje prefers-reduced-motion.
  useEffect(() => {
    let reduce = false;
    try { reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch {}
    if (reduce) return;
    const id = setInterval(() => setHeroTick((n) => n + 1), 3500);
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

      {/* ── Hero (v6, 2026-10-11): tamna "aerodromska" scena (navy + amber
          tabla), uvijek tamna u obje teme radi kontrasta. Lijevo poruka i
          CTA, desno ilustrativna tabla odlazaka sa statusima koji se
          smjenjuju; dolje pista sa pokretnom središnjom linijom i
          statistika. Sve je CSS/SVG — bez slika, bez mrežnih poziva. ── */}
      <section className="relative overflow-hidden bg-[#06101F] text-white">
        <style>{`
          @keyframes hero-fly { 0% { transform: translate3d(-20vw, 0, 0); opacity: 0; } 8% { opacity: .9; } 92% { opacity: .9; } 100% { transform: translate3d(120vw, -60px, 0); opacity: 0; } }
          @keyframes hero-flip { 0% { transform: rotateX(90deg); opacity: 0; } 100% { transform: rotateX(0); opacity: 1; } }
          @keyframes hero-runway { to { background-position: -160px 0; } }
          @keyframes hero-pulse { 0%,100% { opacity: .35; } 50% { opacity: 1; } }
          .hero-plane { animation: hero-fly 26s linear infinite; }
          .hero-flip { animation: hero-flip .45s ease-out; transform-origin: center bottom; }
          .hero-runway { background-image: repeating-linear-gradient(90deg, rgba(251,191,36,.85) 0 56px, transparent 56px 112px); background-size: 112px 100%; animation: hero-runway 2.2s linear infinite; }
          .hero-dot { animation: hero-pulse 1.8s ease-in-out infinite; }
          @media (prefers-reduced-motion: reduce) { .hero-plane, .hero-flip, .hero-runway, .hero-dot { animation: none !important; } .hero-plane { opacity: .5; transform: translate3d(60vw,0,0); } }
        `}</style>

        {/* pozadina: sjaj + mreža */}
        <div className="absolute inset-0 pointer-events-none" aria-hidden
          style={{ background: 'radial-gradient(55% 60% at 15% 0%, rgba(56,189,248,.22), transparent), radial-gradient(45% 50% at 90% 30%, rgba(251,191,36,.12), transparent), linear-gradient(180deg, #06101F 0%, #0B1B33 100%)' }} />
        <div className="absolute inset-0 pointer-events-none opacity-[0.07]" aria-hidden
          style={{ backgroundImage: 'linear-gradient(rgba(255,255,255,.9) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.9) 1px, transparent 1px)', backgroundSize: '56px 56px', maskImage: 'radial-gradient(70% 70% at 50% 30%, #000, transparent)', WebkitMaskImage: 'radial-gradient(70% 70% at 50% 30%, #000, transparent)' }} />

        {/* avion koji preleti */}
        <div className="hero-plane absolute top-14 left-0 pointer-events-none text-sky-200/80" aria-hidden>
          <PlaneTakeoff className="w-8 h-8" />
        </div>

        <div className="relative max-w-6xl mx-auto px-6 pt-16 sm:pt-20 pb-10 grid grid-cols-1 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] gap-12 items-center">
          {/* ── lijevo: poruka ── */}
          <div className="min-w-0">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-bold uppercase tracking-widest mb-6 bg-emerald-400/10 text-emerald-300 border border-emerald-400/25">
              <span className="hero-dot w-1.5 h-1.5 rounded-full bg-emerald-400" /> {t.heroBadge}
            </div>
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-black tracking-tight leading-[1.05] mb-6">
              {t.heroTitle1}
              <br />
              <span className="bg-gradient-to-r from-sky-300 via-sky-400 to-amber-300 bg-clip-text text-transparent">{t.heroTitle2}</span>
            </h1>
            <p className="text-lg text-slate-300 max-w-xl mb-9 leading-relaxed">{t.heroSubtitle}</p>
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
              <a
                href="#pricing"
                className="group flex items-center justify-center gap-2 px-7 py-3.5 rounded-xl bg-sky-500 hover:bg-sky-400 text-white font-bold whitespace-nowrap shadow-lg shadow-sky-500/30 transition-all"
              >
                {t.ctaLive}
                <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
              </a>
              <a
                href="#showcase"
                className="flex items-center justify-center text-center px-6 py-3.5 rounded-xl font-bold border border-white/20 hover:bg-white/10 transition-colors"
              >
                {t.ctaDepartures}
              </a>
            </div>
          </div>

          {/* ── desno: ilustrativna tabla odlazaka ── */}
          <div className="relative min-w-0">
            <div className="absolute -inset-4 rounded-[2rem] bg-sky-500/10 blur-2xl pointer-events-none" aria-hidden />
            <div className="relative rounded-2xl border border-white/10 bg-[#050B16]/90 shadow-2xl shadow-black/40 overflow-hidden backdrop-blur" role="img" aria-label={t.heroBoardNote}>
              <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/10 bg-white/[0.03]">
                <div className="flex items-center gap-2.5">
                  <PlaneTakeoff className="w-4 h-4 text-amber-300" />
                  <span className="font-black tracking-wide uppercase text-sm text-amber-300">{t.heroBoardTitle}</span>
                </div>
                <span className="font-mono text-sm tabular-nums text-amber-200/90">{clock || '--:--'}</span>
              </div>
              <div className="grid grid-cols-[3.2rem_minmax(0,1fr)_2rem_6.4rem] sm:grid-cols-[3.6rem_minmax(0,1fr)_4rem_2.6rem_7rem] gap-x-2 px-5 py-2 text-[10px] uppercase tracking-widest text-slate-500 border-b border-white/5">
                {t.heroBoardCols.map((c, ci) => <span key={c} className={ci === 2 ? 'hidden sm:block' : undefined}>{c}</span>)}
              </div>
              <div className="divide-y divide-white/5 font-mono">
                {HERO_BOARD.map((row, ri) => {
                  const st = row.seq[(heroTick + ri) % row.seq.length];
                  return (
                    <div key={row.time} className="grid grid-cols-[3.2rem_minmax(0,1fr)_2rem_6.4rem] sm:grid-cols-[3.6rem_minmax(0,1fr)_4rem_2.6rem_7rem] gap-x-2 items-center px-5 py-3 text-sm">
                      <span className="text-amber-300 tabular-nums">{row.time}</span>
                      <span className="text-white font-semibold truncate">{row.dest[lang]}</span>
                      <span className="hidden sm:block text-slate-300 tabular-nums">{row.desk}</span>
                      <span className="text-slate-300 tabular-nums">{row.gate}</span>
                      <span key={st} className={`hero-flip text-xs font-bold uppercase tracking-wide truncate ${HERO_STATUS_STYLE[st]}`}>{t.heroStatus[st]}</span>
                    </div>
                  );
                })}
              </div>
              <div className="px-5 py-2.5 text-[11px] text-slate-500 border-t border-white/5 bg-white/[0.02]">{t.heroBoardNote}</div>
            </div>
          </div>
        </div>

        {/* statistika */}
        <div className="relative max-w-6xl mx-auto px-6 pb-12">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-px rounded-2xl overflow-hidden border border-white/10 bg-white/10">
            {t.heroStats.map((st) => (
              <div key={st.label} className="bg-[#08142A]/95 px-5 py-5 text-center">
                <div className="text-3xl font-black tracking-tight text-white tabular-nums">{fillHistory(st.value)}</div>
                <div className="text-xs uppercase tracking-widest text-slate-400 mt-1">{st.label}</div>
              </div>
            ))}
          </div>
        </div>

        {/* pista */}
        <div className="relative h-8 bg-[#030811] border-t border-white/10" aria-hidden>
          <div className="hero-runway absolute left-0 right-0 top-1/2 -translate-y-1/2 h-[3px]" />
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

      {/* ── Pametni prijedlozi dodjele — NOVO (2026-10-11): planer
          šaltera/gate-ova (lib/assignment-suggestions.ts + model +
          validator + stabilnost + PDF). ─────────────────────────── */}
      <section id="smart" className="max-w-6xl mx-auto px-6 py-20 scroll-mt-20">
        <div className="text-center mb-14">
          <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-bold uppercase tracking-widest mb-4 ${
            isDark ? 'bg-violet-400/10 text-violet-300 border border-violet-400/20' : 'bg-violet-500/10 text-violet-700 border border-violet-500/20'
          }`}>
            <Brain className="w-3.5 h-3.5" /> {t.smartBadge}
          </div>
          <h2 className="text-3xl font-black tracking-tight mb-3">{t.smartTitle}</h2>
          <p className={`max-w-2xl mx-auto ${textMuted}`}>{t.smartSubtitle}</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {t.smartItems.map((f, i) => {
            const Icon = SMART_ICONS[i];
            return (
              <div key={f.title} className={`rounded-2xl border ${border} p-6 ${isDark ? 'bg-white/[0.03]' : 'bg-white'}`}>
                <div className={`w-11 h-11 rounded-xl flex items-center justify-center mb-4 ${
                  isDark ? 'bg-violet-400/15 text-violet-300' : 'bg-violet-500/10 text-violet-700'
                }`}>
                  <Icon className="w-5 h-5" />
                </div>
                <h3 className="font-bold mb-1.5">{f.title}</h3>
                <p className={`text-sm leading-relaxed ${textMuted}`}>{f.description}</p>
              </div>
            );
          })}
        </div>
        <p className={`text-xs text-center max-w-xl mx-auto mt-8 ${textMuted}`}>{t.smartFootnote}</p>
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

      {/* ── Ne samo aerodromi — NOVO (2026-10-11): autobuske/željezničke
          stanice i luke. ─────────────────────────────────────────── */}
      <section id="beyond" className="max-w-6xl mx-auto px-6 py-20 scroll-mt-20">
        <div className="text-center mb-14">
          <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-bold uppercase tracking-widest mb-4 ${
            isDark ? 'bg-sky-500/10 text-sky-300 border border-sky-500/20' : 'bg-sky-500/10 text-sky-700 border border-sky-500/20'
          }`}>
            <Anchor className="w-3.5 h-3.5" /> {t.beyondBadge}
          </div>
          <h2 className="text-3xl font-black tracking-tight mb-3">{t.beyondTitle}</h2>
          <p className={`max-w-2xl mx-auto ${textMuted}`}>{t.beyondSubtitle}</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
          {t.beyondItems.map((it, i) => {
            const Icon = BEYOND_ICONS[i];
            return (
              <div key={it.title} className={`rounded-2xl border ${border} p-6 ${isDark ? 'bg-white/[0.03]' : 'bg-white'}`}>
                <div className={`w-11 h-11 rounded-xl flex items-center justify-center mb-4 ${isDark ? 'bg-sky-500/15 text-sky-400' : 'bg-[#0B2545]/8 text-[#0B2545]'}`}>
                  <Icon className="w-5 h-5" />
                </div>
                <h3 className="font-bold mb-1.5">{it.title}</h3>
                <p className={`text-sm leading-relaxed ${textMuted}`}>{it.description}</p>
              </div>
            );
          })}
        </div>
        <p className={`text-xs text-center max-w-xl mx-auto mt-8 ${textMuted}`}>{t.beyondNote}</p>
      </section>

      {/* ── Naša priča (istorija sistema) — NOVO (2026-10-11): VB6 →
          live 2012 → razglas 2015 → Node/JS → TypeScript/cloud. ───── */}
      <section id="history" className={`${bgAlt} border-y ${border} py-20 scroll-mt-20`}>
        <div className="max-w-4xl mx-auto px-6">
          <div className="text-center mb-14">
            <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-bold uppercase tracking-widest mb-4 ${
              isDark ? 'bg-amber-400/10 text-amber-300 border border-amber-400/20' : 'bg-amber-500/10 text-amber-700 border border-amber-500/20'
            }`}>
              <History className="w-3.5 h-3.5" /> {t.historyBadge}
            </div>
            <h2 className="text-3xl font-black tracking-tight mb-3">{fillHistory(t.historyTitle)}</h2>
            <p className={`max-w-2xl mx-auto ${textMuted}`}>{t.historySubtitle}</p>
          </div>
          <ol className="relative">
            <div className={`absolute left-5 top-2 bottom-2 w-px ${isDark ? 'bg-white/10' : 'bg-[#0B2545]/15'}`} aria-hidden />
            {t.historySteps.map((step, i) => {
              const Icon = HISTORY_ICONS[i];
              return (
                <li key={step.title} className="relative pl-16 pb-8 last:pb-0">
                  <div className={`absolute left-0 top-0 w-10 h-10 rounded-xl flex items-center justify-center ${
                    isDark ? 'bg-sky-500/15 text-sky-400' : 'bg-[#0B2545]/10 text-[#0B2545]'
                  }`}>
                    <Icon className="w-4 h-4" />
                  </div>
                  <div className={`text-xs font-black uppercase tracking-widest mb-1 ${isDark ? 'text-sky-400' : 'text-sky-600'}`}>{step.year}</div>
                  <h3 className="font-bold mb-1">{step.title}</h3>
                  <p className={`text-sm leading-relaxed ${textMuted}`}>{step.text}</p>
                </li>
              );
            })}
          </ol>
          <p className={`text-xs text-center max-w-xl mx-auto mt-10 ${textMuted}`}>{t.historyFootnote}</p>
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

      {/* ── Podešavanje klijenta (Chrome kiosk) — NOVO (2026-10-11). ── */}
      <section id="setup" className={`${bgAlt} border-y ${border} py-20 scroll-mt-20`}>
        <div className="max-w-4xl mx-auto px-6">
          <div className="text-center mb-12">
            <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-bold uppercase tracking-widest mb-4 ${
              isDark ? 'bg-emerald-400/10 text-emerald-300 border border-emerald-400/20' : 'bg-emerald-500/10 text-emerald-700 border border-emerald-500/20'
            }`}>
              <Monitor className="w-3.5 h-3.5" /> {t.setupBadge}
            </div>
            <h2 className="text-3xl font-black tracking-tight mb-3">{t.setupTitle}</h2>
            <p className={`max-w-2xl mx-auto ${textMuted}`}>{t.setupSubtitle}</p>
          </div>

          {/* 1. adresa ekrana */}
          <div className={`rounded-2xl border ${border} p-6 mb-6 ${isDark ? 'bg-white/[0.03]' : 'bg-[#F7F9FC]'}`}>
            <h3 className="font-bold mb-1">{t.setupAddrTitle}</h3>
            <p className={`text-sm mb-4 ${textMuted}`}>{t.setupAddrText}</p>
            <div className="flex flex-wrap gap-2 mb-3">
              {t.setupAddrs.map(([label], i) => (
                <button
                  key={label}
                  onClick={() => setSetupAddr(i)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors ${
                    setupAddr === i
                      ? 'bg-sky-500 border-sky-500 text-white'
                      : `${border} ${isDark ? 'hover:bg-white/5' : 'hover:bg-white'}`
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <code className={`block text-xs sm:text-sm font-mono break-all rounded-lg px-3 py-2 ${isDark ? 'bg-black/30 text-sky-200' : 'bg-white border border-[#0B2545]/10 text-[#0B2545]'}`}>
              {SITE_URL}{t.setupAddrs[setupAddr][1]}
            </code>
          </div>

          {/* OS tabovi */}
          <div className={`inline-flex rounded-lg border overflow-hidden mb-6 ${border}`}>
            {(['win', 'linux'] as const).map((k) => (
              <button
                key={k}
                onClick={() => setSetupTab(k)}
                className={`px-4 py-2 text-sm font-bold transition-colors ${
                  setupTab === k ? (isDark ? 'bg-sky-500/20 text-sky-300' : 'bg-[#0B2545] text-white') : textMuted
                }`}
              >
                {t.setupTabs[k]}
              </button>
            ))}
          </div>

          {(() => {
            const url = `${SITE_URL}${t.setupAddrs[setupAddr][1]}`;
            const steps = setupTab === 'win' ? t.setupStepsWin : t.setupStepsLinux;
            const blocks: { label: string; code: string }[][] = setupTab === 'win'
              ? [[{ label: t.setupCommandLabel, code: kioskWinShortcut(url) }], [], [{ label: 'PowerShell / CMD', code: KIOSK_WIN_POWER }]]
              : [[{ label: '~/fids-kiosk.sh', code: kioskLinuxScript(url) }], [{ label: '~/.config/autostart/fids.desktop', code: KIOSK_LINUX_AUTOSTART }]];
            return (
              <div className="space-y-5">
                {steps.map((st, i) => (
                  <div key={st.title} className={`rounded-2xl border ${border} p-6 ${isDark ? 'bg-white/[0.03]' : 'bg-[#F7F9FC]'}`}>
                    <h3 className="font-bold mb-1">{st.title}</h3>
                    <p className={`text-sm leading-relaxed mb-4 ${textMuted}`}>{st.text}</p>
                    <div className="space-y-3">
                      {(blocks[i] ?? []).map((b) => (
                        <CodeBlock key={b.label} code={b.code} label={b.label} copyLabel={t.setupCopy} copiedLabel={t.setupCopied} isDark={isDark} />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            );
          })()}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 mt-6">
            <div className={`rounded-2xl border ${border} p-6 ${isDark ? 'bg-white/[0.03]' : 'bg-[#F7F9FC]'}`}>
              <h3 className="font-bold mb-1 flex items-center gap-2"><Wrench className="w-4 h-4" /> {t.setupExitTitle}</h3>
              <p className={`text-sm leading-relaxed ${textMuted}`}>{t.setupExitText}</p>
            </div>
            <div className={`rounded-2xl border ${border} p-6 ${isDark ? 'bg-white/[0.03]' : 'bg-[#F7F9FC]'}`}>
              <h3 className="font-bold mb-2 flex items-center gap-2"><Check className="w-4 h-4" /> {t.setupTipsTitle}</h3>
              <ul className={`text-sm leading-relaxed space-y-1.5 list-disc pl-5 ${textMuted}`}>
                {t.setupTips.map((tip) => <li key={tip}>{tip}</li>)}
              </ul>
            </div>
          </div>
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
            <a href="#smart" className="hover:underline">{t.footerSmart}</a>
            <a href="#history" className="hover:underline">{t.footerHistory}</a>
            <a href="#setup" className="hover:underline">{t.footerSetup}</a>
            <a href="#pricing" className="hover:underline">{t.footerPricing}</a>
            <Link href="/admin/login" className="hover:underline">{t.footerAdmin}</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
