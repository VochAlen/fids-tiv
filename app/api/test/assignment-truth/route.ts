// app/api/test/assignment-truth/route.ts
//
// NOVO (2026-10-16): NEKEŠIRAN izvor istine za JEDAN šalter/gate. Čita Redis direktno (bez in-process
// keša iz assignments-service, bez CDN keša) i vraća tačno ono što u ovom trenutku piše u bazi.
// Kiosk ga koristi kao nezavisnu provjeru svog prikaza (vidi `verifyKey` u hooks/useRealtimeAssignments.ts)
// — ako se iz BILO kog razloga lokalno stanje razilazi od servera (izgubljena poruka, zastarjeli
// snapshot, greška u merge-u), ovaj odgovor ga ispravlja. Jedan Redis GET po pozivu; kiosk ga zove rijetko
// (događajno + povremeno dok je inactive).
import { NextResponse } from 'next/server';
import { safeRedisGetStrict } from '@/lib/redis';

export const dynamic = 'force-dynamic';

const KEYS = {
  desk: 'ably-fids:desk-status:all',
  gate: 'ably-fids:gate-status:all',
} as const;

const NO_STORE = { 'Cache-Control': 'no-store, max-age=0' };

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const type = searchParams.get('type');
  const key = searchParams.get('key') ?? '';
  if ((type !== 'desk' && type !== 'gate') || !/^[A-Za-z0-9_-]{1,12}$/.test(key)) {
    return NextResponse.json({ ok: false, error: 'bad-params' }, { status: 400, headers: NO_STORE });
  }
  try {
    const { ok, value } = await safeRedisGetStrict(KEYS[type]);
    if (!ok) return NextResponse.json({ ok: false }, { headers: NO_STORE }); // nepouzdano — klijent ignoriše
    let all: Record<string, unknown> = {};
    if (value) {
      try { all = JSON.parse(value); } catch { return NextResponse.json({ ok: false }, { headers: NO_STORE }); }
    }
    return NextResponse.json({ ok: true, entry: all[key] ?? null, readAt: Date.now() }, { headers: NO_STORE });
  } catch {
    return NextResponse.json({ ok: false }, { headers: NO_STORE });
  }
}
