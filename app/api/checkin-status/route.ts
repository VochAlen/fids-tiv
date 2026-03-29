import { NextResponse } from 'next/server';

// In-memory storage za ručno otvorene check-in-ove
const manuallyOpenedCheckIns: Record<string, { isOpen: boolean; openedAt: Date }> = {};

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const flightNumber = searchParams.get('flightNumber');
  const scheduledTime = searchParams.get('scheduledTime');

  if (!flightNumber) {
    return NextResponse.json({ error: 'Flight number is required' }, { status: 400 });
  }

  const key = `${flightNumber.toUpperCase()}_${scheduledTime}`;
  const isManuallyOpened = !!manuallyOpenedCheckIns[key]?.isOpen;

  return NextResponse.json({ isManuallyOpened });
}

export async function POST(request: Request) {
  const { flightNumber, scheduledTime, action } = await request.json();

  if (!flightNumber || !action) {
    return NextResponse.json(
      { error: 'Flight number and action are required' },
      { status: 400 }
    );
  }

  const key = `${flightNumber.toUpperCase()}_${scheduledTime}`;
  manuallyOpenedCheckIns[key] = { isOpen: action === 'open', openedAt: new Date() };

  return NextResponse.json(
    {
      success: true,
      message: `Check-in for ${flightNumber} is now ${action}`,
      isManuallyOpened: manuallyOpenedCheckIns[key].isOpen,
    },
    { status: 200 }
  );
}
