import { NextResponse } from 'next/server';
import { getRedisClient } from '@/lib/redis';

export async function POST() {
  try {
    const redis = getRedisClient();
    
    // Ispravi key pattern - koristi isti kao u flight-override API
    const keys = await redis.keys('override:*');  // ← bio je 'flight-override:*'
    
    if (!keys.length) {
      return NextResponse.json({ 
        message: 'Nema override ključeva u Redisu', 
        deleted: 0 
      });
    }

    const today = new Date().toDateString();
    const deletedKeys: string[] = [];
    const keptKeys: string[] = [];

    for (const key of keys) {
      const data = await redis.hgetall(key);
      if (!data || Object.keys(data).length === 0) {
        await redis.del(key);
        deletedKeys.push(key + ' (prazan)');
        continue;
      }

      const flightNumber = key.replace('override:', '');
      const std = data.ScheduledDepartureTime;
      
      if (!std) {
        // Nema STD - obriši
        await redis.del(key);
        deletedKeys.push(`${key} (nema STD)`);
        continue;
      }

      let ovDate: Date | null = null;
      
      if (std.includes('T')) {
        ovDate = new Date(std);
      } else {
        const [h, m] = std.split(':').map(Number);
        if (!isNaN(h) && !isNaN(m)) {
          const d = new Date();
          d.setHours(h, m, 0, 0);
          // Ako je vrijeme prošlo danas, to je za jučer
          if (d.getTime() < Date.now() - 6 * 60 * 60 * 1000) {
            d.setDate(d.getDate() - 1);
          }
          ovDate = d;
        }
      }

      // Briši ako nije današnji datum
      if (ovDate && ovDate.toDateString() !== today) {
        await redis.del(key);
        deletedKeys.push(`${key} (STD: ${std}, datum: ${ovDate.toDateString()})`);
        console.log(`🧹 Obrisan zaostali override: ${key} (STD: ${std})`);
      } else {
        keptKeys.push(`${key} (STD: ${std})`);
      }
    }

    return NextResponse.json({
      message: `Cleanup završen`,
      deleted: deletedKeys.length,
      kept: keptKeys.length,
      deletedKeys,
      keptKeys,
    });

  } catch (error) {
    console.error('❌ Cleanup override error:', error);
    return NextResponse.json(
      { error: 'Greška pri čišćenju overridea', details: String(error) },
      { status: 500 }
    );
  }
}

export async function GET() {
  try {
    const redis = getRedisClient();
    const keys = await redis.keys('override:*');  // ← popravljeno

    if (!keys.length) {
      return NextResponse.json({ message: 'Nema override ključeva', stale: [], fresh: [] });
    }

    const today = new Date().toDateString();
    const stale: string[] = [];
    const fresh: string[] = [];

    for (const key of keys) {
      const data = await redis.hgetall(key);
      if (!data || Object.keys(data).length === 0) {
        stale.push(key + ' (prazan)');
        continue;
      }

      const std = data.ScheduledDepartureTime;
      if (!std) {
        fresh.push(key + ' (nema STD)');
        continue;
      }

      let ovDate: Date | null = null;
      if (std.includes('T')) {
        ovDate = new Date(std);
      } else {
        const [h, m] = std.split(':').map(Number);
        if (!isNaN(h) && !isNaN(m)) {
          const d = new Date();
          d.setHours(h, m, 0, 0);
          if (d.getTime() < Date.now() - 6 * 60 * 60 * 1000) {
            d.setDate(d.getDate() - 1);
          }
          ovDate = d;
        }
      }

      if (ovDate && ovDate.toDateString() !== today) {
        stale.push(`${key} — STD: ${std} (${ovDate.toDateString()})`);
      } else {
        fresh.push(`${key} — STD: ${std}`);
      }
    }

    return NextResponse.json({ 
      stale, 
      fresh, 
      totalStale: stale.length, 
      totalFresh: fresh.length 
    });

  } catch (error) {
    console.error('❌ GET cleanup error:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}