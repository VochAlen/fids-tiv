import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { verifySessionToken } from '@/lib/auth-session';
import { getClientIp } from '@/lib/get-client-ip';

// const BLOCKED_USER_AGENT_PATTERNS = [
//   /GPTBot/i,
//   /ChatGPT-User/i,
//   /CCBot/i,
//   /anthropic-ai/i,
//   /ClaudeBot/i,
//   /SemrushBot/i,
//   /AhrefsBot/i,
//   /MJ12bot/i,
//   /DotBot/i,
//   /PetalBot/i,
//   /Bytespider/i,
// ];

const BLOCKED_USER_AGENT_PATTERNS = [
  // AI / LLM scraperi
  /GPTBot/i, /ChatGPT-User/i, /CCBot/i, /anthropic-ai/i, /ClaudeBot/i,
  /Google-Extended/i, /PerplexityBot/i, /Diffbot/i, /Applebot-Extended/i,
  /Amazonbot/i, /YouBot/i, /Meta-ExternalAgent/i, /FacebookBot/i,

  // SEO / marketing scraperi
  /SemrushBot/i, /AhrefsBot/i, /MJ12bot/i, /DotBot/i, /PetalBot/i,
  /Bytespider/i, /SeznamBot/i, /BLEXBot/i, /DataForSeoBot/i,

  // Generički scraperi (bez curl, python-requests, Go-http-client, HeadlessChrome — koristiš ih)
  /scrapy/i, /wget\//i, /libwww-perl/i,

  // Vulnerability skeneri / pentest alati (nemaju posla na kiosk ekranima)
  /nikto/i, /sqlmap/i, /nmap/i, /masscan/i, /zgrab/i, /Nuclei/i,

  // Ostali agresivni crawleri
  /SiteAuditBot/i, /Barkrowler/i, /serpstatbot/i, /DataBot/i,
];

// Napomena za budućnost: ako ikad počneš koristiti i wget, scrapy, ili libwww-perl za svoje interne alate (monitoring, health-checks, testing), izbaci ih isto iz liste prije deploy-a — princip je isti kao kod prethodna četiri: bilo šta što ti legitimno koristiš za pristup sajtu ne smije biti u ovoj listi, jer middleware ne pravi razliku između tvog poziva i identičnog poziva nekog trećeg.
// Ostatak ranijih preporuka (Vercel WAF Bot Protection u dashboardu, prazan/kratak User-Agent check, method whitelisting) ostaje nepromijenjen — ovo je samo korekcija liste pattern-a.


//Najveći, najbrži dobitak od svega ovoga je definitivno (1) — uključivanje Vercel WAF Bot Protection i AI Bots ruleset u dashboardu, jer je besplatno, zero-config, i radi prije nego što tvoj middleware uopšte primi zahtjev. Preporučujem da to uradiš prvo, ostaviš par dana u Log Only modu, pa mi javiš šta si vidio u Firewall → Traffic dashboardu — mogu ti pomoći protumačiti nalaze i odlučiti da li prelaziš na Challenge mod.

// ════════════════════════════════════════════════════════════
// IP DOZVOLJENA LISTA — sprečava da treći (hoteli, itd.) koriste
// kiosk linkove (gate, check-in, i ostale monitor stranice) sa svojih
// ekrana. NULA promjena na fizičkim monitorima — oni nastavljaju da
// koriste ISTE URL-ove, server samo odlučuje da li da odgovori na
// osnovu IP adrese sa koje zahtjev stvarno dolazi.
//
// PODEŠAVANJE (jednom, u Vercel dashboard-u → Project → Settings →
// Environment Variables, ne u kodu):
//   AIRPORT_ALLOWED_IPS = "203.0.113.5"
// ili, ako aerodrom ima uzak opseg umjesto jedne fiksne IP adrese:
//   AIRPORT_ALLOWED_IPS = "203.0.113.5,203.0.113.0/24"
// (zarezom odvojeno — podržane su i pojedinačne IP adrese i CIDR opsezi)
//
// Kako naći pravu IP adresu: na BILO KOM kiosk računaru (npr. onom za
// gate 02), otvori browser i idi na https://www.whatismyip.com — to je
// javna IP adresa preko koje aerodrom izlazi na internet. Ako imaš
// više izlaznih linkova/ISP-ova, provjeri na par različitih kiosk
// računara da uhvatiš sve.
//
// FAIL-OPEN dok promjenljiva nije postavljena (po zahtjevu — trenutno
// aerodrom NEMA fiksnu IP adresu, planirano za budućnost): ako
// AIRPORT_ALLOWED_IPS nije definisana (ili je prazna), provjera se
// PRESKAČE u potpunosti, NIŠTA se ne blokira — kod ostaje spreman,
// neaktivan, dok se stvarno ne unese IP adresa u Vercel dashboard.
// Upozorenje se ispisuje u server log da se ovo stanje ne zaboravi.
//
// IZUZECI (šta ova provjera NE štiti, namjerno):
// - /admin/* — već zaštićeno sopstvenom lozinkom, osoblje mora moći
//   da pristupi i van aerodroma (putovanje, hitna izmjena)
// - / (landing stranica) — namjerno javna/B2B stranica (vidi
//   app/HomeClient.tsx), treba da bude dostupna svima. Ako ovo ne
//   želiš (npr. odlučiš da landing stranica ipak treba da bude
//   privatna), ukloni "path !== '/' &&" iz uslova ispod.
// FIX (izdvojeno u lib/get-client-ip.ts — vidi opširan komentar tamo
// za pun kontekst; sad ga koristi i middleware.ts i login rate
// limiter, umjesto duplirane logike na dva mjesta).

function ipv4ToInt(ip: string): number | null {
  const m = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return null;
  const parts = [m[1], m[2], m[3], m[4]].map(Number);
  if (parts.some(n => n < 0 || n > 255)) return null;
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

function ipMatchesEntry(ip: string, entry: string): boolean {
  // Podržava i golu IP adresu ("203.0.113.5") i CIDR opseg
  // ("203.0.113.0/24") — samo IPv4, dovoljno za ovu namjenu.
  if (entry.includes('/')) {
    const [rangeIp, bitsStr] = entry.split('/');
    const bits = parseInt(bitsStr, 10);
    const ipInt = ipv4ToInt(ip);
    const rangeInt = ipv4ToInt(rangeIp);
    if (ipInt === null || rangeInt === null || isNaN(bits) || bits < 0 || bits > 32) return false;
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return (ipInt & mask) === (rangeInt & mask);
  }
  return ip === entry;
}

function isAllowedAirportIp(request: NextRequest): boolean {
  const allowList = (process.env.AIRPORT_ALLOWED_IPS || '')
    .split(',').map(s => s.trim()).filter(Boolean);

  if (allowList.length === 0) {
    // Fail-open — vidi opširan komentar iznad. Upozorenje samo
    // jednom po hladnom startu funkcije, ne po svakom zahtjevu.
    console.warn('[middleware] AIRPORT_ALLOWED_IPS nije podešena — IP zaštita kiosk stranica je NEAKTIVNA.');
    return true;
  }

  const clientIp = getClientIp(request.headers);
  if (!clientIp) return false; // nema x-forwarded-for uopšte — sumnjivo, ne propuštaj

  return allowList.some(entry => ipMatchesEntry(clientIp, entry));
}

export async function middleware(request: NextRequest) {
  // Ne obrađuj API rute u middleware-u
if (request.nextUrl.pathname.startsWith('/api/')) {
  return NextResponse.next();
}
  const path = request.nextUrl.pathname;

  // ── BOT BLOKIRANJE ──
  const userAgent = request.headers.get('user-agent') || '';
  if (BLOCKED_USER_AGENT_PATTERNS.some((pattern) => pattern.test(userAgent))) {
    return new NextResponse('Blocked', { status: 403 });
  }

  // ── IP ZAŠTITA KIOSK STRANICA — vidi opširan komentar uz
  // isAllowedAirportIp iznad. NAMJERNO PRIJE redirect pravila ispod —
  // neovlašćen zahtjev se odbija odmah na staroj putanji, bez
  // nepotrebnog 301 skoka na novu. ──
  if (path !== '/' && !path.startsWith('/admin') && !isAllowedAirportIp(request)) {
    return new NextResponse('Access denied', { status: 403 });
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

  // ── ADMIN AUTENTIFIKACIJA ──
  const isAdminRoute = path.startsWith('/admin');
  const isLoginPage = path === '/admin/login';

  // Provjera potpisanog sesijskog tokena (httpOnly kolačić, JWT preko 'jose')
  // umjesto stare provere "admin-authenticated=true" koja se mogla falsifikovati
  // ručno u browser konzoli.
  const sessionCookie = request.cookies.get('admin-session')?.value;
  const session = sessionCookie ? await verifySessionToken(sessionCookie) : null;
  const isAuthenticated = session !== null;

  if (isLoginPage && isAuthenticated) {
    return NextResponse.redirect(new URL('/admin', request.url));
  }

  if (isAdminRoute && !isLoginPage && !isAuthenticated) {
    return NextResponse.redirect(new URL('/admin/login', request.url));
  }

  // NOVO (po zahtjevu — bezbjednost + kontrola troška, vidi
  // public/robots.txt za pun kontekst): X-Robots-Tag je OBAVEZUJUĆA
  // instrukcija za search-engine crawlere (za razliku od robots.txt,
  // koji je samo "molba" koju dobronamjerni crawleri poštuju) — sprečava
  // indeksiranje kiosk/admin ruta čak i ako ih neki crawler ipak posjeti.
  // Landing stranica (/) NAMJERNO izuzeta — ona treba da ostane indeksirana.
  const response = NextResponse.next();
  if (path !== '/') {
    response.headers.set('X-Robots-Tag', 'noindex, nofollow');
  }
  return response;
}


export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon\\.ico|airlines|city-images|british|reklame|wallpaper|wallpaper-landscape|dgr-gate\\.png|api/test|api/flights).*)',
  ],
}