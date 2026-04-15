import { NextResponse } from 'next/server';
import { getRedisClient } from '@/lib/redis';

export async function POST(request: Request) {
  try {
    const { flightNumber, deskNumber } = await request.json();
    const redis = getRedisClient();
    
    // Provjeri da li let ima aktivni override
    const overrideKey = `override:${flightNumber}`;
    const overrideData = await redis.hgetall(overrideKey);
    
    if (!overrideData || Object.keys(overrideData).length === 0) {
      return NextResponse.json({ 
        success: true, 
        message: `Nema aktivnih override-ova za let ${flightNumber}` 
      });
    }
    
    const resetActions = [];
    
    // Reset CheckInDesk ako postoji
    if (overrideData.CheckInDesk) {
      await redis.hdel(overrideKey, 'CheckInDesk');
      resetActions.push('CheckInDesk');
      
      // Ako je i desk status override-ovan, resetuj i njega
      if (deskNumber) {
        const deskStatusKey = `desk-status:${deskNumber}`;
        await redis.del(deskStatusKey);
        resetActions.push(`desk-status:${deskNumber}`);
      }
    }
    
    // Ako nema više polja, obriši cijeli ključ
    const remaining = await redis.hlen(overrideKey);
    if (remaining === 0) {
      await redis.del(overrideKey);
    }
    
    console.log(`🔄 Auto-reset for departed flight ${flightNumber}: ${resetActions.join(', ')}`);
    
    return NextResponse.json({
      success: true,
      message: `Auto-resetovan let ${flightNumber}`,
      resetActions
    });
    
  } catch (error) {
    console.error('Auto-reset error:', error);
    return NextResponse.json(
      { error: 'Greška pri auto-resetu' },
      { status: 500 }
    );
  }
}