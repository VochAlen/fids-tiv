// app/api/flights/status/route.ts
import { NextResponse } from 'next/server';
import { getRedisClient } from '@/lib/redis';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const client = getRedisClient();
    
    const [hash, count, lastModified] = await Promise.all([
      client.get('cache:flights:hash'),
      client.get('cache:flights:count'),
      client.get('cache:flights:last_modified'),
    ]);
    
    return NextResponse.json({
      hash: hash || null,
      count: parseInt(count || '0', 10),
      lastModified: lastModified || null,
      timestamp: new Date().toISOString(),
    }, {
      headers: { 'Cache-Control': 'public, s-maxage=10' }
    });
  } catch {
    return NextResponse.json({ hash: null, count: 0 }, { status: 200 });
  }
}