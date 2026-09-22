// app/api/cron/redis-cleanup/route.ts
import { NextResponse } from 'next/server';
import { cleanupRedisTTLs } from '@/lib/redis-cleanup';
import { requireCronSecret } from '@/lib/admin-auth';

export async function GET(request: Request) {
  try {
    // ── v4: Cron secret check ──
    const cronAuth = requireCronSecret(request);
    if (cronAuth) return cronAuth;

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