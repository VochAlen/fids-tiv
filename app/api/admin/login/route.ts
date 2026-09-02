// app/api/admin/login/route.ts
import { NextResponse } from 'next/server';

// FIX (ubrzaj login): ova ruta radi samo poređenje dva stringa — nema
// nikakvu Node.js-specifičnu zavisnost (nema Redis, nema crypto biblioteke
// van onoga što Edge Runtime već ima). Kao Node.js serverless funkcija,
// prva prijava nakon perioda neaktivnosti (npr. početak smjene) trpi
// "cold start" koji na Vercel-u realno zna trajati i preko pola sekunde do
// sekundu. Edge Runtime nema taj problem — pokreće se u V8 izolatima koji
// su već topli na edge lokaciji najbliže korisniku, sa cold-start-om reda
// veličine par milisekundi. Za nešto što se dešava par puta dnevno (staff
// login), ovo direktno ubrzava upravo onaj slučaj koji se najviše osjeti
// kao "sporo".
export const runtime = 'edge';

const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'tivat2025';

// Apsolutni "hard cap" sesije — bez obzira na aktivnost, admin panel
// zahtijeva ponovnu prijavu nakon ove granice. Idle (neaktivnost) logout
// od 2-4 minuta je ODVOJEN mehanizam implementiran klijentski u
// components/admin-session-guard.tsx; ovaj cookie-maxAge je samo gornja
// sigurnosna granica (npr. ako neko fizički ostavi uređaj sa aktivnim
// mišem/dodirima koji sprečavaju idle-logout).
const SESSION_MAX_AGE_SECONDS = 8 * 60 * 60; // 8h (jedna smjena)

export async function POST(request: Request) {
  try {
    const { username, password } = await request.json();

    if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
      const res = NextResponse.json(
        { success: true, message: 'Uspešna prijava' },
        { headers: { 'Cache-Control': 'no-store, max-age=0' } },
      );

      // FIX (sigurnost + konzistentnost): cookie se sada postavlja NA
      // SERVERU, httpOnly. Ranije ga je postavljao KLIJENT
      // (document.cookie) NAKON što bi dobio { success: true } — što je
      // značilo da je bilo koji JS u browser konzoli (ili XSS) mogao
      // izvršiti tačno tu istu liniju i dobiti admin pristup BEZ ijedne
      // ispravne lozinke. httpOnly cookie se ne može čitati/pisati iz
      // JavaScript-a, pa taj zaobilazak više ne postoji. Middleware i
      // dalje čita cookie identično (request.cookies.get(...) radi na
      // HTTP nivou, httpOnly ne utiče na to).
      res.cookies.set('admin-authenticated', 'true', {
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
