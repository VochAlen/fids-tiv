// app/api/admin/pa-announcement/route.ts
//
// Admin-only (zaštićeno preko middleware.ts, isti admin-authenticated
// cookie kao ostatak /api/admin/*) ruta za slanje RUČNE PA najave.
// Osoblje kuca tekst na /admin/pa, ovo ga upisuje u Redis LIST, a PA
// ekran (app/pa/PaPageClient.tsx) ga pokupi na sledećem pollu preko
// javne /api/pa-announcements rute.
//
// NOĆNI GEJT NA IZVORU: ako je noć (isNightHours()), ručna najava se
// ODBIJA ovdje — čak i ako neko na admin panelu pokuša da je pošalje,
// razglas se noću ne oglašava (aerodrom ne radi). IZUZETAK: hitne
// (emergency) poruke PROLAZE i noću — stvarna hitna situacija (npr.
// evakuacija) se ne smije ućutkati zato što je "van radnog vremena".
import { NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import { safeRedisGet, safeRedisSet } from '@/lib/redis';
import { isNightHours } from '@/lib/night-hours';

const PA_ANNOUNCEMENTS_KEY = 'pa:announcements';
const MAX_STORED = 15;
const TTL_SECONDS = 60 * 60; // 1h — nepokupljene najave (PA ekran ugašen?) ne žive vječno

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const text = typeof body?.text === 'string' ? body.text.trim() : '';
    const lang: 'en' | 'local' = body?.lang === 'local' ? 'local' : 'en';
    const priority: 'normal' | 'emergency' = body?.priority === 'emergency' ? 'emergency' : 'normal';

    if (priority !== 'emergency' && isNightHours()) {
      return NextResponse.json(
        { error: 'Razglas ne radi noću — najava odbijena.' },
        { status: 423 } // Locked
      );
    }

    if (!text) {
      return NextResponse.json({ error: 'Tekst najave je obavezan' }, { status: 400 });
    }
    if (text.length > 500) {
      return NextResponse.json({ error: 'Tekst najave je predugačak (max 500 karaktera)' }, { status: 400 });
    }

    const announcement = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      text,
      lang,
      priority,
      publishedAt: new Date().toISOString(),
    };

    // FIX: čitaj-izmijeni-piši nije atomarno kod konkurentnih upisa (dvoje
    // osoblja šalje najavu u istoj sekundi), ali za ovu svrhu (par
    // najava dnevno, sučelje sa jednim tekst poljem) rizik gubitka jedne
    // najave u rijetkoj trci je prihvatljiv — puna Redis transakcija
    // (WATCH/MULTI) bi bila nesrazmjerna komplikacija za ovu učestalost.
    const raw = await safeRedisGet(PA_ANNOUNCEMENTS_KEY);
    const existing = raw ? JSON.parse(raw) : [];
    const updated = [announcement, ...existing].slice(0, MAX_STORED);

    const wrote = await safeRedisSet(PA_ANNOUNCEMENTS_KEY, JSON.stringify(updated), TTL_SECONDS);
    if (!wrote) {
      return NextResponse.json({ error: 'Redis nedostupan — pokušajte ponovo' }, { status: 503 });
    }

    revalidateTag('pa-announcements');
    return NextResponse.json({ success: true, announcement });
  } catch (error) {
    console.error('Error publishing PA announcement:', error);
    return NextResponse.json({ error: 'Greška pri slanju najave' }, { status: 500 });
  }
}
