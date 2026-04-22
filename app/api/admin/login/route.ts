// app/api/admin/login/route.ts
import { NextResponse } from 'next/server';

const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'tivat2025';

export async function POST(request: Request) {
  try {
    const { username, password } = await request.json();

    if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
      // Dodajte cache header da ubrza naredne zahteve
      return NextResponse.json(
        { success: true, message: 'Uspešna prijava' },
        {
          headers: {
            'Cache-Control': 'no-store, max-age=0',
          },
        }
      );
    }

    return NextResponse.json(
      { success: false, message: 'Pogrešno korisničko ime ili lozinka' },
      { status: 401 }
    );
  } catch (error) {
    return NextResponse.json(
      { success: false, message: 'Greška pri prijavljivanju' },
      { status: 500 }
    );
  }
}