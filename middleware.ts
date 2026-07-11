import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname;

  // ──────────────────────────────────────────────
  // 1. REDIRECT: /checkin/[deskNumber] → /ver2/ver2/checkin/[deskNumber]
  // ──────────────────────────────────────────────
  const checkinMatch = path.match(/^\/checkin\/(.+)$/);
  if (checkinMatch) {
    const deskNumber = checkinMatch[1];
    const url = request.nextUrl.clone();
    url.pathname = `/ver2/ver2/checkin/${deskNumber}`; // ← dupli ver2
    return NextResponse.redirect(url, 301);
  }

  // ──────────────────────────────────────────────
  // 2. ADMIN AUTENTIFIKACIJA (nepromijenjena)
  // ──────────────────────────────────────────────
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

// ──────────────────────────────────────────────
// 3. PROŠIRENI MATCHER
// ──────────────────────────────────────────────
export const config = {
  matcher: ['/admin/:path*', '/checkin/:path*'],
};