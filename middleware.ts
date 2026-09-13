import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const BLOCKED_USER_AGENT_PATTERNS = [
  // AI / LLM scraperi
  /GPTBot/i, /ChatGPT-User/i, /CCBot/i, /anthropic-ai/i, /ClaudeBot/i,
  /Google-Extended/i, /PerplexityBot/i, /Diffbot/i, /Applebot-Extended/i,
  /Amazonbot/i, /YouBot/i, /Meta-ExternalAgent/i, /FacebookBot/i,

  // SEO / marketing scraperi
  /SemrushBot/i, /AhrefsBot/i, /MJ12bot/i, /DotBot/i, /PetalBot/i,
  /Bytespider/i, /SeznamBot/i, /BLEXBot/i, /DataForSeoBot/i,

  // Generički scraperi
  /scrapy/i, /wget\//i, /libwww-perl/i,

  // Vulnerability skeneri / pentest alati
  /nikto/i, /sqlmap/i, /nmap/i, /masscan/i, /zgrab/i, /Nuclei/i,

  // Ostali agresivni crawleri
  /SiteAuditBot/i, /Barkrowler/i, /serpstatbot/i, /DataBot/i,
];

export function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname;

  // ── BOT BLOKIRANJE (SAMO za admin i glavne rute) ──
  // Kiosk ekrani (ver2/ver2/checkin, ver2/ver2/gate, combined, departures,
  // border, split-board) NE trebaju bot provjeru — to su fizički displeji
  // na aerodromu. Lista ažurirana nakon audita: /border i /split-board su
  // potvrđeno u upotrebi (ranije nisu bili na listi, pa su nepotrebno
  // prolazili kroz bot-check); /arrivals-small NIJE u upotrebi i obrisan
  // je (vidi redirect ispod).
  const isKioskRoute = 
    path.startsWith('/ver2/ver2/checkin') ||
    path.startsWith('/ver2/ver2/gate') ||
    path === '/ver2/ver2' ||
    path === '/combined' ||
    path === '/departures' ||
    path === '/border' ||
    path === '/split-board';

  // Bot provjeru primjenjuj SAMO na admin i ostale rute (ne na kiosk)
  if (!isKioskRoute) {
    const userAgent = request.headers.get('user-agent') || '';
    if (BLOCKED_USER_AGENT_PATTERNS.some((pattern) => pattern.test(userAgent))) {
      return new NextResponse('Blocked', { status: 403 });
    }
  }

  // ── REDIRECT: /arrivals-small → /combined ──
  // Stranica obrisana (potvrđeno nekorišćena). Defanzivan redirect za
  // slučaj da neki uređaj/bookmark i dalje pokazuje na ovu rutu.
  if (path === '/arrivals-small') {
    const url = request.nextUrl.clone();
    url.pathname = '/combined';
    return NextResponse.redirect(url, 301);
  }

  // ── REDIRECT: /checkin/[deskNumber] → /ver2/ver2/checkin/[deskNumber] ──
  const checkinMatch = path.match(/^\/checkin\/(.+)$/);
  if (checkinMatch) {
    const deskNumber = checkinMatch[1];
    const url = request.nextUrl.clone();
    url.pathname = `/ver2/ver2/checkin/${deskNumber}`;
    return NextResponse.redirect(url, 301);
  }

  // ── REDIRECT: /gate/[gateNumber] → /ver2/ver2/gate/[gateNumber] ──
  const gateMatch = path.match(/^\/gate\/(.+)$/);
  if (gateMatch) {
    const gateNumber = gateMatch[1];
    const url = request.nextUrl.clone();
    url.pathname = `/ver2/ver2/gate/${gateNumber}`;
    return NextResponse.redirect(url, 301);
  }

  // ── REDIRECT: /ver2/checkin/[deskNumber] → /ver2/ver2/checkin/[deskNumber] ──
  // Ovo je "srednja generacija" ekrana (app/ver2/checkin/[deskNumber]/page.tsx)
  // koja je do sad bila LIVE i NEREDIREKTOVANA — ima svoj nezavisan polling
  // ciklus, potpuno odvojen od zvaničnog ver2/ver2 ekrana. Ako je ijedan
  // fizički šalter (ili zaboravljen browser tab) i dalje pokazivao na ovu
  // rutu, radio je potpuno redundantan, dupli polling. Redirect zatvara tu
  // rupu bez obzira da li je trenutno neko na nju pokazuje.
  const ver2CheckinMatch = path.match(/^\/ver2\/checkin\/(.+)$/);
  if (ver2CheckinMatch) {
    const deskNumber = ver2CheckinMatch[1];
    const url = request.nextUrl.clone();
    url.pathname = `/ver2/ver2/checkin/${deskNumber}`;
    return NextResponse.redirect(url, 301);
  }

  // ── REDIRECT: /ver2/gate/[gateNumber] → /ver2/ver2/gate/[gateNumber] ──
  // Isti razlog kao gore, za srednju generaciju gate ekrana
  // (app/ver2/gate/[gateNumber]/page.tsx).
  const ver2GateMatch = path.match(/^\/ver2\/gate\/(.+)$/);
  if (ver2GateMatch) {
    const gateNumber = ver2GateMatch[1];
    const url = request.nextUrl.clone();
    url.pathname = `/ver2/ver2/gate/${gateNumber}`;
    return NextResponse.redirect(url, 301);
  }

  // ── PA AUTENTIFIKACIJA (po zahtjevu — potpuno ODVOJENA od opšte admin
  // autentifikacije, sopstveni cookie `pa-authenticated`, sopstvena
  // login stranica /pa/login) ──
  // Prije ove izmjene: /pa (sam ekran koji izgovara najave) NIJE imao
  // NIKAKVU zaštitu — bilo ko sa URL-om je mogao otvoriti stranicu i
  // aktivirati razglas na fizičkom aerodromskom pojačalu. /admin/pa
  // JESTE bio zaštićen, ali OPŠTIM admin cookie-jem (dijeljenim sa
  // dodjelom gate-ova/business-class konfiguracijom) — ne namjenskom
  // zaštitom za sam razglas. Vidi app/api/pa/login/route.ts za pun
  // kontekst i env varijable (PA_USERNAME/PA_PASSWORD).
  const isPaPage = path === '/pa' || path === '/admin/pa';
  const isPaLoginPage = path === '/pa/login';
  const isPaAuthenticated = request.cookies.get('pa-authenticated')?.value === 'true';

  if (isPaLoginPage && isPaAuthenticated) {
    const dest = request.nextUrl.searchParams.get('next') === 'admin' ? '/admin/pa' : '/pa';
    return NextResponse.redirect(new URL(dest, request.url));
  }

  if (isPaPage && !isPaAuthenticated) {
    const loginUrl = new URL('/pa/login', request.url);
    if (path === '/admin/pa') loginUrl.searchParams.set('next', 'admin');
    return NextResponse.redirect(loginUrl);
  }

  // ── ADMIN AUTENTIFIKACIJA ──
  // FIX: /admin/pa je NAMJERNO izuzet odavde (`path !== '/admin/pa'`) —
  // ima sopstvenu PA-specifičnu zaštitu iznad, ne opšti admin login.
  const isAdminRoute = path.startsWith('/admin') && path !== '/admin/pa';
  const isLoginPage = path === '/admin/login';
  const isAuthenticated = request.cookies.get('admin-authenticated')?.value === 'true';

  if (isLoginPage && isAuthenticated) {
    return NextResponse.redirect(new URL('/admin', request.url));
  }

  if (isAdminRoute && !isLoginPage && !isAuthenticated) {
    return NextResponse.redirect(new URL('/admin/login', request.url));
  }

  // FIX (problematičan scenario — 15 /api/admin/* ruta bilo je potpuno
  // BEZ autentifikacije): provjera iznad (`isAdminRoute`) štiti SAMO
  // stranice pod /admin/* (redirektuje na login) — nikad nije pokrivala
  // API rute pod /api/admin/* (drugačiji prefiks, `startsWith('/admin')`
  // ne pogađa `/api/admin/...`). Ni same rute (gate-status-override,
  // desk-status-override, flight-override, stats, checkin-toggle,
  // auto-reset-departed, desk-class-override, init, i mutacije na
  // airlines/specific-flights/destinations) nisu imale SOPSTVENU provjeru
  // cookie-ja — bilo ko sa URL-om ih je mogao pozvati direktno, bez ikad
  // se prijavivši.
  //
  // VAŽAN IZUZETAK (umalo pokvario javne kiosk ekrane!): GET pozivi na
  // /api/admin/airlines, /api/admin/specific-flights i
  // /api/admin/destinations NISU admin-only u praksi — lib/flight-service.ts
  // (koji koriste combined/departures/border/gate/baggage/security stranice,
  // SVE javne, bez logina) ih čita preko lib/business-class-service.ts da
  // odredi business/economy klasu za prikaz. Blanket blokiranje ovih 
  // GET poziva bi pokvarilo prikaz klase na SVIM kiosk ekranima. Samo
  // POST/PUT/DELETE na te rute (stvarne izmjene, koje radi JEDINO
  // app/admin/business-class/page.tsx — prava admin stranica) treba
  // zaštititi.
  //
  // /api/admin/login je sama prijava (mora biti javna). /api/admin/logout
  // je namjerno idempotentan bez obzira na sesiju. /api/admin/cleanup-overrides
  // ima SOPSTVENU CRON_SECRET provjeru (vidi tu rutu) — MORA ostati
  // dostupna Vercel cron sistemu koji nema admin-authenticated cookie.
  // /api/admin/pa-announcement je NAMJERNO izuzet — ima sopstvenu
  // PA-specifičnu zaštitu ispod (isti princip kao /admin/pa iznad).
  const PUBLIC_ADMIN_GET_PREFIXES = [
    '/api/admin/airlines',
    '/api/admin/specific-flights',
    '/api/admin/destinations',
  ];
  const isPublicAdminGet = request.method === 'GET'
    && PUBLIC_ADMIN_GET_PREFIXES.some(p => path === p || path.startsWith(p + '/'));

  const isAdminApiRoute = path.startsWith('/api/admin')
    && path !== '/api/admin/login'
    && path !== '/api/admin/logout'
    && path !== '/api/admin/cleanup-overrides'
    && path !== '/api/admin/pa-announcement'
    && !isPublicAdminGet;

  if (isAdminApiRoute && !isAuthenticated) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // ── PA API ZAŠTITA ──
  // /api/pa-announcements (GET, poll-uje ga sam /pa ekran) i
  // /api/admin/pa-announcement (POST, zove ga /admin/pa panel) —
  // OBOJE sad zahtijevaju pa-authenticated, NE admin-authenticated.
  // Pošto /pa i /admin/pa stranice već zahtijevaju ovaj isti cookie
  // (vidi provjeru iznad), njihovi VLASTITI fetch() pozivi automatski
  // nose taj cookie (isti-origin) — legitimnim korisnicima se ništa ne
  // mijenja, ovo samo zatvara direktan-URL zaobilazak za sve ostale.
  // /api/pa/login i /api/pa/logout su namjerno izuzeti (login mora
  // biti javan, logout je idempotentan).
  const isPaApiRoute = path === '/api/pa-announcements' || path === '/api/admin/pa-announcement';
  if (isPaApiRoute && !isPaAuthenticated) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  return NextResponse.next();
}

export const config = {
  // FIX ("Error handling upgrade request TypeError: Cannot read properties
  // of undefined (reading 'bind')" u `next dev` terminalu): matcher je
  // isključivao `_next/static` i `_next/image`, ali NE i
  // `_next/webpack-hmr` — WebSocket rutu koju Next.js dev server koristi
  // za Hot Module Reload. Middleware nije napravljen da presreće upgrade
  // (WebSocket) zahtjeve, pa kad ovaj matcher pusti `_next/webpack-hmr`
  // kroz middleware chain, Next-ov interni dev-server router (koji
  // hendluje 'upgrade' event odvojeno od običnih HTTP zahtjeva) ne uspije
  // da sastavi handler lanac i puca na `.bind()` poziva undefined
  // funkcije — poznat Next.js problem kad middleware matcher ne isključi
  // ovu putanju (vidi vercel/next.js diskusije o "Error handling upgrade
  // request" + middleware matcher). Ovo je ČISTO dev-mode šum (HMR
  // websocket ne postoji u produkciji, `next build`/`next start` ovo
  // nikad ne pogađaju) — ne ruši stranicu, ali može praviti spor/isprekidan
  // hot-reload i zatrpavati terminal. Dodao `_next/webpack-hmr` u
  // isključenja da middleware prestane da ga presreće.
  matcher: [
    '/((?!_next/static|_next/image|_next/webpack-hmr|favicon\\.ico|airlines|city-images|british|reklame|wallpaper|wallpaper-landscape|dgr-gate\\.png|api/test|api/flights).*)',
  ],
};