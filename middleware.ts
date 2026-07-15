import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

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

export function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname;

  // ── BOT BLOKIRANJE ──
  const userAgent = request.headers.get('user-agent') || '';
  if (BLOCKED_USER_AGENT_PATTERNS.some((pattern) => pattern.test(userAgent))) {
    return new NextResponse('Blocked', { status: 403 });
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
  const isAuthenticated = request.cookies.get('admin-authenticated')?.value === 'true';

  if (isLoginPage && isAuthenticated) {
    return NextResponse.redirect(new URL('/admin', request.url));
  }

  if (isAdminRoute && !isLoginPage && !isAuthenticated) {
    return NextResponse.redirect(new URL('/admin/login', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon\\.ico|airlines|city-images|british|reklame|wallpaper|wallpaper-landscape|dgr-gate\\.png|api/test|api/flights).*)',
  ],
}