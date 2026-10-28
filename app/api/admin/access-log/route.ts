// app/api/admin/access-log/route.ts
//
// GET: istorija pristupa admin dijelu (zadnjih 30 dana, najnovije prvo). POST {event:'open', path}: zapis da je admin stranica otvorena
// (šalje ga admin layout JEDNOM po kartici preglednika — ne pri svakom osvježavanju podataka).
import { NextResponse, after } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';
import { ACCESS_LOG_TTL_SEC, buildAccessEvent } from '@/lib/access-log';
import { logAccessEvent, readAccessEvents } from '@/lib/access-log-server';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const { error: authError } = await requireAdmin(request);
  if (authError) return authError;
  const cutoff = Date.now() - ACCESS_LOG_TTL_SEC * 1000 + 86_400_000;
  const events = (await readAccessEvents()).filter((e) => e.t >= cutoff);
  return NextResponse.json({ events, now: Date.now() }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(request: Request) {
  const { session, error: authError } = await requireAdmin(request);
  if (authError) return authError;
  let body: { path?: unknown } = {};
  try { body = await request.json(); } catch { /* prazno tijelo je u redu */ }
  const path = typeof body.path === 'string' && body.path.startsWith('/admin') ? body.path : '/admin';
  const ev = buildAccessEvent(request.headers, 'open', { u: session?.username, p: path });
  after(() => logAccessEvent(ev));
  return NextResponse.json({ ok: true });
}
