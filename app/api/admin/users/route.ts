// app/api/admin/users/route.ts
//
// Upravljanje korisnicima admin panela (samo uloga "admin"). Korisnici su u Redis-u
// (lib/users.ts); lozinke se čuvaju isključivo kao scrypt hash i NIKAD se ne vraćaju
// niti loguju.

import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';
import { hashPassword } from '@/lib/password';
import { createUserIfAbsent, getUser, listUsers, saveUser, toPublic, type UserRecord } from '@/lib/users';
import { isRole } from '@/lib/roles';
import { normalizeUsername, planUserChange, validatePassword, validateUsername } from '@/lib/user-rules';

export const dynamic = 'force-dynamic';

function envUsernames(): { username: string; password: string }[] {
  try {
    const parsed = JSON.parse(process.env.ADMIN_USERS || '[]');
    return Array.isArray(parsed)
      ? parsed.filter((u): u is { username: string; password: string } => typeof u?.username === 'string' && typeof u?.password === 'string')
      : [];
  } catch {
    return [];
  }
}

export async function GET(request: Request) {
  const { error } = await requireAdmin(request, 'admin');
  if (error) return error;
  const users = await listUsers();
  if (!users) return NextResponse.json({ error: 'Redis nije dostupan' }, { status: 503 });
  const present = new Set(users.map((u) => u.username));
  const envPending = envUsernames().map((u) => normalizeUsername(u.username)).filter((n) => n && !present.has(n));
  return NextResponse.json({ users: users.map(toPublic), envPending }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(request: Request) {
  const { session, error } = await requireAdmin(request, 'admin');
  if (error || !session) return error!;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Neispravan zahtjev' }, { status: 400 });
  }
  const action = body.action;
  const now = Date.now();

  // ── novi korisnik ────────────────────────────────────────────────────
  if (action === 'create') {
    const username = normalizeUsername(body.username);
    const bad = validateUsername(username) ?? validatePassword(body.password, username);
    if (bad) return NextResponse.json({ error: bad }, { status: 400 });
    if (!isRole(body.role)) return NextResponse.json({ error: 'Uloga mora biti admin ili operator' }, { status: 400 });
    const rec: UserRecord = {
      username, role: body.role, active: true, created: now, lastLogin: null,
      mustChange: true, hash: await hashPassword(body.password as string), ver: 0,
    };
    const r = await createUserIfAbsent(rec);
    if (r === 'exists') return NextResponse.json({ error: 'Korisnik već postoji' }, { status: 409 });
    if (r === 'error') return NextResponse.json({ error: 'Redis nije dostupan' }, { status: 503 });
    return NextResponse.json({ ok: true });
  }

  // ── uvoz iz ADMIN_USERS (jednom, pri prelasku) ─────────────────────────
  if (action === 'import-env') {
    const env = envUsernames();
    if (env.length === 0) return NextResponse.json({ error: 'ADMIN_USERS nije postavljen' }, { status: 400 });
    let imported = 0;
    const skipped: string[] = [];
    for (const u of env) {
      const username = normalizeUsername(u.username);
      if (validateUsername(username)) { skipped.push(u.username); continue; }
      const rec: UserRecord = {
        // Uvoz zadržava postojeće lozinke i NE traži promjenu (korisnik može sam kasnije na /admin/account).
        username, role: 'admin', active: true, created: now, lastLogin: null,
        mustChange: false, hash: await hashPassword(u.password), ver: 0,
      };
      const r = await createUserIfAbsent(rec);
      if (r === 'created') imported++;
      else if (r === 'error') return NextResponse.json({ error: 'Redis nije dostupan', imported }, { status: 503 });
    }
    return NextResponse.json({ ok: true, imported, skipped });
  }

  // ── izmjena uloge / aktivnosti ────────────────────────────────────────
  if (action === 'update') {
    const username = normalizeUsername(body.username);
    const patch: { role?: 'admin' | 'operator'; active?: boolean } = {};
    if (body.role !== undefined) {
      if (!isRole(body.role)) return NextResponse.json({ error: 'Uloga mora biti admin ili operator' }, { status: 400 });
      patch.role = body.role;
    }
    if (body.active !== undefined) {
      if (typeof body.active !== 'boolean') return NextResponse.json({ error: 'Neispravno stanje' }, { status: 400 });
      patch.active = body.active;
    }
    const all = await listUsers();
    if (!all) return NextResponse.json({ error: 'Redis nije dostupan' }, { status: 503 });
    const plan = planUserChange(all.map(toPublic), session.username, username, patch);
    if (!plan.ok) return NextResponse.json({ error: plan.error }, { status: 400 });
    const cur = all.find((u) => u.username === username)!;
    const next: UserRecord = {
      ...cur,
      role: patch.role ?? cur.role,
      active: patch.active ?? cur.active,
      // deaktivacija ili promjena uloge poništava postojeće sesije tog korisnika (nova prijava nosi novu ulogu)
      ver: (patch.active === false && cur.active) || (patch.role !== undefined && patch.role !== cur.role) ? cur.ver + 1 : cur.ver,
    };
    if (!(await saveUser(next))) return NextResponse.json({ error: 'Redis nije dostupan' }, { status: 503 });
    return NextResponse.json({ ok: true });
  }

  // ── reset lozinke (admin postavlja privremenu; korisnik je mora promijeniti) ─
  if (action === 'reset') {
    const username = normalizeUsername(body.username);
    const bad = validatePassword(body.password, username);
    if (bad) return NextResponse.json({ error: bad }, { status: 400 });
    const g = await getUser(username);
    if (!g.ok) return NextResponse.json({ error: 'Redis nije dostupan' }, { status: 503 });
    if (!g.user) return NextResponse.json({ error: 'Korisnik ne postoji' }, { status: 404 });
    const next: UserRecord = { ...g.user, hash: await hashPassword(body.password as string), mustChange: true, ver: g.user.ver + 1 };
    if (!(await saveUser(next))) return NextResponse.json({ error: 'Redis nije dostupan' }, { status: 503 });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: 'Nepoznata akcija' }, { status: 400 });
}
