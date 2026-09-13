import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  try {
    const { flightNumber, deskNumber, action } = await request.json();

    // Validacija
    if (!flightNumber || !deskNumber || !action) {
      return NextResponse.json(
        { error: 'Nedostaju obavezna polja' },
        { status: 400 }
      );
    }

    // Simulacija uspješnog ažuriranja
    console.log(`Ažuriram check-in za let ${flightNumber}, desk ${deskNumber}: ${action}`);

    // Vraćanje odgovora
    return NextResponse.json(
      {
        success: true,
        message: `Check-in ${action === 'open' ? 'otvoren' : 'zatvoren'} za let ${flightNumber}`,
      },
      { status: 200 }
    );

  } catch (error) {
    console.error('Greška:', error);
    return NextResponse.json(
      { error: 'Greška na serveru' },
      { status: 500 }
    );
  }
}
