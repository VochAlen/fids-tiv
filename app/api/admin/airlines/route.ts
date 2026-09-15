// app/api/admin/airlines/route.ts
//
// FIX (migracija sa SQLite na Redis): vidi opširan kontekst u
// lib/business-class-store.ts. Cache-Control koristi isti obrazac kao
// app/api/weather/route.ts — podaci se mijenjaju rijetko (par puta
// mjesečno preko admin panela), pa dugačak CDN keš + revalidateTag() na
// svaku izmjenu eliminiše skoro sve Function Invocations za GET (koji
// javni kiosk ekrani čitaju preko lib/business-class-service.ts →
// lib/flight-service.ts za business class prikaz, bez logina).
import { NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import { getAllAirlinesFromStore, createAirlineInStore } from '@/lib/business-class-store';

const BUSINESS_CLASS_CACHE_CONTROL =
  'public, max-age=60, s-maxage=3600, stale-while-revalidate=600';

export async function GET() {
  try {
    const airlines = await getAllAirlinesFromStore();
    return NextResponse.json(airlines, {
      headers: {
        'Cache-Control': BUSINESS_CLASS_CACHE_CONTROL,
        'Cache-Tag': 'business-class',
        'Vercel-Cache-Tag': 'business-class',
      },
    });
  } catch (error) {
    console.error('Error fetching airlines:', error);
    return NextResponse.json(
      { error: 'Greška pri učitavanju avio kompanija' },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const result = await createAirlineInStore(body);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    revalidateTag('business-class');
    return NextResponse.json(result.airline);
  } catch (error) {
    console.error('Error creating airline:', error);
    return NextResponse.json(
      { error: 'Greška pri kreiranju avio kompanije' },
      { status: 500 }
    );
  }
}
