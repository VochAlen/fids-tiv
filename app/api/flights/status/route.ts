import { NextResponse } from 'next/server';
import { getRedisClient } from '@/lib/redis';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  try {
    const client = getRedisClient();
    
    const [hash, count, lastModified, source] = await Promise.all([
      client.get('cache:flights:hash'),
      client.get('cache:flights:count'),
      client.get('cache:flights:last_modified'),
      client.get('cache:flights:source'),
    ]);
    
    return NextResponse.json({
      hash: hash || null,
      count: parseInt(count || '0', 10),
      lastModified: lastModified || null,
      source: source || 'unknown',
      timestamp: new Date().toISOString(),
    }, {
      headers: {
        'Cache-Control': 'public, s-maxage=10, stale-while-revalidate=30',
      }
    });
    
  } catch (error) {
    console.error('Status endpoint error:', error);
    
    return NextResponse.json({
      hash: null,
      count: 0,
      lastModified: null,
      source: 'error',
      timestamp: new Date().toISOString(),
    }, {
      status: 200,
      headers: { 'Cache-Control': 'no-cache' }
    });
  }
}