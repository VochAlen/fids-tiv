// app/api/admin/announcement/route.ts
//
// v5.8 — Razglas (PA) integracija.
//
// Ova ruta NE radi TTS sama — samo objavljuje TEKST najave na Ably
// kanal 'announcements:pa'. Sam izgovor (Web Speech API, engleski
// female glas) radi ekran u operativnom centru (app/pa/PaPageClient.tsx)
// koji sluša taj kanal. Ovo je namjerno razdvojeno: TTS je 100%
// klijentski (Chrome-ov ugrađeni speechSynthesis, besplatan, bez
// mrežnog poziva ka bilo kom serveru), pa ova ruta ostaje jeftina
// (1 poziv po najavi, admin-triggered — ljudska akcija, ne
// automatizovan/rekurentan promet) i ne dodaje NIKAKAV Vercel trošak
// izvan onoga što već postoji za flight-override/gate-status-override.
//
// Isti obrazac kao ostale admin rute: requireAdmin() auth + after()
// fire-and-forget publish (v4 fix — garantuje da Vercel runtime ne
// prekine izvršavanje prije nego što publish stvarno završi).

import { NextResponse, after } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';
import { publishToChannel } from '@/lib/ably-server';
import { isNightHours } from '@/lib/night-hours';

export const dynamic = 'force-dynamic';

const MAX_TEXT_LENGTH = 500; // dovoljno za bilo koju realnu PA najavu

export async function POST(request: Request) {
  const auth = await requireAdmin(request);
  if (auth.error) return auth.error;

  // v5.9: Razglas eksplicitno NE smije raditi noću, nakon zadnjeg leta.
  // PA ekran (app/pa/PaPageClient.tsx) i onako gasi Ably konekciju noću
  // (isti mehanizam kao svih 41 FIDS ekrana — lib/ably-client.ts), pa
  // najava ionako ne bi stigla do zvučnika — ali odbijamo je OVDJE, na
  // izvoru, umjesto da tiho nestane, da admin dobije jasnu poruku zašto.
  if (isNightHours()) {
    return NextResponse.json(
      { error: 'Aerodrom je u noćnom režimu — razglas trenutno ne radi.' },
      { status: 409 }
    );
  }

  try {
    const body = await request.json().catch(() => null);
    const text = typeof body?.text === 'string' ? body.text.trim() : '';

    if (!text) {
      return NextResponse.json({ error: 'Nedostaje tekst najave' }, { status: 400 });
    }
    if (text.length > MAX_TEXT_LENGTH) {
      return NextResponse.json(
        { error: `Tekst je predugačak (max ${MAX_TEXT_LENGTH} karaktera)` },
        { status: 400 }
      );
    }

    // Jedinstven ID po najavi — PA ekran ga koristi da ne izgovori
    // istu poruku dvaput ako se, npr., reconnect desi tačno nakon
    // publish-a i Ably history vrati istu poruku ponovo.
    const announcementId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    after(async () => {
      try {
        await publishToChannel('announcements:pa', 'announce', {
          id: announcementId,
          text,
          publishedAt: new Date().toISOString(),
          publishedBy: auth.session?.username ?? 'unknown',
        });
      } catch (err) {
        console.error('[announcement] Ably publish (announcements:pa) failed:', err);
      }
    });

    return NextResponse.json({ success: true, id: announcementId });
  } catch (err) {
    console.error('[announcement] error:', err);
    return NextResponse.json({ error: 'Slanje najave nije uspjelo' }, { status: 500 });
  }
}
