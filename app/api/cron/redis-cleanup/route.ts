// app/api/cron/redis-cleanup/route.ts
import { NextResponse } from 'next/server';
import { cleanupRedisTTLs } from '@/lib/redis-cleanup';

// FIX (problematičan scenario — ruta bez ikakve autentifikacije): bilo
// koje bilo ko je znao ovaj URL je mogao ručno, ponovljeno pozivati ovu
// rutu. Ova konkretna ne radi ništa destruktivno (samo dodaje TTL
// ključevima koji ga nemaju), ali princip je pogrešan i vrijedi ga
// popraviti prije nego što se isti obrazac (bez provjere) kopira na neku
// rutu koja RADI nešto destruktivno (vidi app/api/admin/cleanup-overrides,
// koja je dobila isti fix).
//
// Vercel automatski šalje `Authorization: Bearer <CRON_SECRET>` na SVAKI
// poziv koji sam pokrene po `crons` rasporedu u vercel.json — ALI SAMO
// ako je env varijabla CRON_SECRET podešena u Vercel projektu. Ako nije
// podešena, provjera ispod je isključena (da se ne blokira sam cron), ali
// se glasno loguje upozorenje — VAŽNO: podesi CRON_SECRET (Project
// Settings → Environment Variables) da bi ova zaštita stvarno radila.
function isAuthorizedCronRequest(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.warn('⚠️ CRON_SECRET nije podešen — /api/cron/redis-cleanup je JAVNO dostupna ruta. Podesi CRON_SECRET env varijablu na Vercel-u.');
    return true;
  }
  return request.headers.get('authorization') === `Bearer ${secret}`;
}

export async function GET(request: Request) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const result = await cleanupRedisTTLs(15_000); // duži timeout, cron nije pod pritiskom request-a
    return NextResponse.json({
      ok: true,
      timestamp: new Date().toISOString(),
      ...result,
    });
  } catch (e) {
    console.error('❌ Redis cleanup cron failed:', e);
    return NextResponse.json(
      {
        ok: false,
        timestamp: new Date().toISOString(),
        error: e instanceof Error ? e.message : String(e),
      },
      { status: 500 }
    );
  }
}