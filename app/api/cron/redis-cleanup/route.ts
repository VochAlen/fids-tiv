// app/api/cron/redis-cleanup/route.ts
import { NextResponse } from 'next/server';
import { cleanupRedisTTLs } from '@/lib/redis-cleanup';

export async function GET() {
  try {
    const result = await cleanupRedisTTLs(15_000); // duži timeout, cron nije pod pritiskom request-a
    return NextResponse.json({
      ok: true,
      timestamp: new Date().toISOString(),
      ...result,
    });
  } catch (e) {
    console.error('❌ Redis cleanup cron failed:', e);
    return NextResponse.json(
      {
        ok: false,
        timestamp: new Date().toISOString(),
        error: e instanceof Error ? e.message : String(e),
      },
      { status: 500 }
    );
  }
}