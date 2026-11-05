// lib/admin-auth.ts
//
// v4 FIX (Grupa A — Sigurnost):
// ─────────────────────────────────────────────────────────────
// Sve /api/admin/* rute su do sada bile javno dostupne — middleware
// preskače /api/* prefiks. Bilo ko sa URL-om je mogao:
//   - POST /api/admin/flight-override → mijenjati Gate/Desk
//   - POST /api/admin/init → reinicijalizirati bazu
//   - POST /api/admin/specific-flights → kreirati/brisati letove
//
// Ovaj helper provjerava `admin-session` cookie (JWT potpisan sa
// ADMIN_SESSION_SECRET) i vraća 401 ako nije validan.
// ─────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { verifySessionToken, SESSION_COOKIE_NAME } from '@/lib/auth-session';
import { roleAtLeast, type Role } from '@/lib/roles';
import { getAuthState } from '@/lib/users';

export interface AdminSession {
  username: string;
  role: Role;
}

/**
 * Provjerava da li je zahtjev autentifikovan kao admin.
 * Vraća `{ session }` ako jeste, ili `{ error }` (NextResponse 401) ako nije.
 *
 * Koristi se na vrhu svakog /api/admin/* handler-a:
 *
 *   const auth = await requireAdmin(request);
 *   if (auth.error) return auth.error;
 *   // ... nastavi sa admin logikom, auth.session.username dostupan
 */
export async function requireAdmin(_request?: Request, minRole: Role = 'operator'): Promise<{ session: AdminSession | null; error: NextResponse | null }> {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;

    if (!token) {
      return {
        session: null,
        error: NextResponse.json(
          { error: 'Unauthorized — admin session required' },
          { status: 401 }
        ),
      };
    }

    const payload = await verifySessionToken(token);
    if (!payload) {
      return {
        session: null,
        error: NextResponse.json(
          { error: 'Unauthorized — invalid or expired session' },
          { status: 401 }
        ),
      };
    }

    // Stanje korisnika u Redis-u (keš u memoriji ~60 s): deaktiviran korisnik, reset lozinke ili
    // promjena uloge djeluju u roku od minute, iako je JWT sam po sebi važio do 24 h.
    // Nedostupan Redis ili korisnik bez zapisa (env rezerva) → važi uloga iz tokena.
    let role: Role = payload.role;
    const st = await getAuthState(payload.username);
    if (st.kind === 'record') {
      if (!st.active || st.ver !== payload.ver) {
        return {
          session: null,
          error: NextResponse.json({ error: 'Unauthorized — session revoked' }, { status: 401 }),
        };
      }
      role = st.role;
    }

    if (!roleAtLeast(role, minRole)) {
      return {
        session: null,
        error: NextResponse.json({ error: 'Forbidden — insufficient role' }, { status: 403 }),
      };
    }

    return { session: { username: payload.username, role }, error: null };
  } catch (err) {
    console.error('[admin-auth] requireAdmin error:', err instanceof Error ? err.message : err);
    return {
      session: null,
      error: NextResponse.json(
        { error: 'Unauthorized — auth check failed' },
        { status: 401 }
      ),
    };
  }
}

/**
 * Provjerava Authorization: Bearer ${CRON_SECRET} header.
 * Koristi se na /api/cron/* i /api/admin/cleanup-overrides rutama.
 *
 * Vercel Cron automatski šalje ovaj header na svakom okidanju.
 * Spriječava javno okidanje cron ruta sa bilo kojeg URL-a.
 */
export function requireCronSecret(request: Request): NextResponse | null {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    // Ako CRON_SECRET nije konfigurisan, odbij sve — ne dozvoljavamo
    // javne cron rute ni u kom slučaju.
    console.error('[cron-auth] CRON_SECRET env var is not set — refusing request');
    return NextResponse.json(
      { error: 'Cron authentication not configured' },
      { status: 503 }
    );
  }

  const auth = request.headers.get('authorization');
  if (auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json(
      { error: 'Unauthorized — invalid cron secret' },
      { status: 401 }
    );
  }

  return null; // autorizovan
}
