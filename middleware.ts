import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const BLOCKED_USER_AGENT_PATTERNS = [
  /GPTBot/i,
  /ChatGPT-User/i,
  /CCBot/i,
  /anthropic-ai/i,
  /ClaudeBot/i,
  /SemrushBot/i,
  /AhrefsBot/i,
  /MJ12bot/i,
  /DotBot/i,
  /PetalBot/i,
  /Bytespider/i,
];

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
    '/((?!_next/static|_next/image|favicon.ico|api/test/stats|api/flights/status).*)',
    '/api/:path*',
    '/admin/:path*',
    '/checkin/:path*',
    '/gate/:path*',      // ← DODAJ GATE
    '/ver2/:path*',
  ],
};