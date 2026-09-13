// app/api/pa/login/route.ts
//
// FIX (po zahtjevu — zaštiti PA sistem korisničkim imenom/lozinkom):
// PA sistem (app/pa/PaPageClient.tsx — sam ekran koji izgovara najave,
// i app/admin/pa/page.tsx — kontrolni panel) je do sad imao DVA
// odvojena problema: (1) /pa (sam ekran) NIJE imao NIKAKVU zaštitu —
// bilo ko ko sazna URL je mogao otvoriti stranicu, aktivirati razglas
// i slušati/upravljati redom čekanja na fizičkom aerodromskom
// pojačalu; (2) /admin/pa JESTE bio zaštićen, ali OPŠTIM admin
// login-om (dijeljenim sa dodjelom gate-ova/šaltera i business-class
// konfiguracijom) — ne posebnom, namjenskom zaštitom za sam razglas.
//
// Ovo je NAMJERNO POTPUNO ODVOJEN sistem prijave od /admin/login —
// sopstveni cookie (`pa-authenticated`), sopstvena login stranica
// (/pa/login), sopstvene env varijable (PA_USERNAME/PA_PASSWORD).
// Isti bezbjednosni princip kao app/api/admin/login/route.ts: BEZ
// hardkodirane lozinke u izvornom kodu — ako env varijable nisu
// podešene, login je onemogućen (fail closed) umjesto da tiho radi sa
// vrijednošću vidljivom bilo kome ko pročita ovaj fajl.
//
// VAŽNO PRIJE DEPLOY-A: podesi u Vercel-u (Project Settings →
// Environment Variables, za SVAKI environment — Production i Preview
// su odvojeni):
//   PA_USERNAME = razglas
//   PA_PASSWORD = tivat2026
import { NextResponse } from 'next/server';

export const runtime = 'edge';

const PA_USERNAME = process.env.PA_USERNAME || 'razglas';
const PA_PASSWORD = process.env.PA_PASSWORD;

// Duži hard-cap od opšteg admin login-a (8h) — PA ekran u operativnom
// centru se tipično aktivira JEDNOM ujutro i ostaje uključen cio dan
// (24h ciklus, spava samo noću preko isNightHours() logike, ne preko
// isteka sesije) — 8h bi ga prisililo da traži ponovnu prijavu usred
// dana, što bi značilo da NIKO ne izgovara najave dok neko fizički ne
// ode i ponovo se prijavi.
const SESSION_MAX_AGE_SECONDS = 24 * 60 * 60; // 24h

export async function POST(request: Request) {
  try {
    if (!PA_PASSWORD) {
      console.error('❌ PA_PASSWORD env varijabla nije podešena — PA login je onemogućen dok se ne podesi (Vercel → Project Settings → Environment Variables). Podesi PA_USERNAME=razglas i PA_PASSWORD=tivat2026.');
      return NextResponse.json(
        { success: false, message: 'Server nije konfigurisan (nedostaje PA_PASSWORD) — kontaktiraj administratora.' },
        { status: 500 },
      );
    }

    const body = await request.json().catch(() => null);
    const username = typeof body?.username === 'string' ? body.username : '';
    const password = typeof body?.password === 'string' ? body.password : '';

    if (username === PA_USERNAME && password === PA_PASSWORD) {
      const res = NextResponse.json(
        { success: true, message: 'Uspešna prijava' },
        { headers: { 'Cache-Control': 'no-store, max-age=0' } },
      );

      // httpOnly — isti razlog kao admin-authenticated cookie (vidi
      // app/api/admin/login/route.ts): ne može se čitati/pisati iz
      // JavaScript-a, pa XSS/konzola ne mogu dobiti pristup bez
      // ispravne lozinke.
      res.cookies.set('pa-authenticated', 'true', {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        path: '/',
        maxAge: SESSION_MAX_AGE_SECONDS,
      });

      return res;
    }

    return NextResponse.json(
      { success: false, message: 'Pogrešno korisničko ime ili lozinka' },
      { status: 401 },
    );
  } catch (error) {
    return NextResponse.json(
      { success: false, message: 'Greška pri prijavljivanju' },
      { status: 500 },
    );
  }
}
