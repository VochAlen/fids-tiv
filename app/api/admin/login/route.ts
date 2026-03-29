import { NextResponse } from 'next/server';

// Hardcoded admin kredencijali (u produkciji koristite .env varijable)
const ADMIN_USERNAME = 'admin';
const ADMIN_PASSWORD = 'tivat2025';

export async function POST(request: Request) {
  try {
    const { username, password } = await request.json();

    // Proverite kredencijale
    if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
      // U stvarnoj aplikaciji ovde bi generisali JWT token
      return NextResponse.json({ 
        success: true, 
        message: 'Uspešna prijava' 
      });
    }

    return NextResponse.json(
      { success: false, message: 'Pogrešno korisničko ime ili lozinka' },
      { status: 401 }
    );
  } catch (error) {
    console.error('Login error:', error);
    return NextResponse.json(
      { success: false, message: 'Došlo je do greške pri prijavljivanju' },
      { status: 500 }
    );
  }
}