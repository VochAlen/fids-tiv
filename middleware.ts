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
  // Kiosk ekrani (ver2/ver2/checkin, ver2/ver2/gate, combined, departures)
  // NE trebaju bot provjeru — to su fizički displeji na aerodromu.
  const isKioskRoute = 
    path.startsWith('/ver2/ver2/checkin') ||
    path.startsWith('/ver2/ver2/gate') ||
    path === '/ver2/ver2' ||
    path === '/combined' ||
    path === '/departures';

  // Bot provjeru primjenjuj SAMO na admin i ostale rute (ne na kiosk)
  if (!isKioskRoute) {
    const userAgent = request.headers.get('user-agent') || '';
    if (BLOCKED_USER_AGENT_PATTERNS.some((pattern) => pattern.test(userAgent))) {
      return new NextResponse('Blocked', { status: 403 });
    }
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
};