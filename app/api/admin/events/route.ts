// app/api/admin/events/route.ts
//
// Istorija događaja za /admin/health: zadnji događaji + sažetak po monitoru (7 dana) + da li je Telegram podešen.
// GET se poziva samo kad neko otvori sekciju istorije (1 Redis komanda: LRANGE). POST {action:'test'} šalje probnu poruku na Telegram.
import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';
import { readKioskEvents } from '@/lib/kiosk-events-server';
import { summarizeEvents } from '@/lib/kiosk-events';
import { getTelegramConfig, sendTelegram } from '@/lib/telegram';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const { error: authError } = await requireAdmin(request);
  if (authError) return authError;
  const events = await readKioskEvents();
  return NextResponse.json(
    { events: events.slice(0, 80), summary: summarizeEvents(events, Date.now(), 7), telegram: { configured: !!getTelegramConfig() } },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

export async function POST(request: Request) {
  const { error: authError } = await requireAdmin(request);
  if (authError) return authError;
  let body: { action?: unknown } = {};
  try { body = await request.json(); } catch { /* prazno tijelo */ }
  if (body.action !== 'test') return NextResponse.json({ error: 'Nepoznata akcija' }, { status: 400 });
  if (!getTelegramConfig()) return NextResponse.json({ ok: false, error: 'Telegram nije podešen (TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID)' }, { status: 200 });
  const ok = await sendTelegram('✅ FIDS: probna poruka — obavještenja su ispravno podešena.');
  return NextResponse.json({ ok, ...(ok ? {} : { error: 'Telegram nije prihvatio poruku (provjeri token i chat id)' }) }, { headers: { 'Cache-Control': 'no-store' } });
}
