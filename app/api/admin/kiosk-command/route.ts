// app/api/admin/kiosk-command/route.ts
//
// Daljinski restart monitora sa /admin/health. Samo admin sesija. Komanda je JEDNA Ably poruka ('kiosk-cmd') na postojećem
// kanalu flights:combined — kiosci tu poruku ignorišu osim ciljanog monitora (po id-u) i ne mogu je lažirati (imaju samo
// subscribe). Trošak nastaje samo pri kliku (jedan poziv ove rute + jedna Ably poruka); nikakvog periodičnog troška nema.
import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';
import { publishToChannel } from '@/lib/ably-server';
import { KIOSK_CMD_CHANNEL, KIOSK_CMD_EVENT, isValidKioskId, type KioskCommand } from '@/lib/kiosk-beacon';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const { error: authError } = await requireAdmin(request);
  if (authError) return authError;

  let body: { id?: unknown; cmd?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Neispravan JSON' }, { status: 400 });
  }
  const id = typeof body.id === 'string' ? body.id.toLowerCase() : '';
  if (!isValidKioskId(id) || body.cmd !== 'restart') {
    return NextResponse.json({ error: 'Neispravan id monitora ili komanda' }, { status: 400 });
  }

  const command: KioskCommand = { id, cmd: 'restart', ts: Date.now(), nonce: Math.random().toString(36).slice(2, 10) };
  try {
    await publishToChannel(KIOSK_CMD_CHANNEL, KIOSK_CMD_EVENT, command);
  } catch (err) {
    console.error('[admin/kiosk-command] Ably publish nije uspio:', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'Komanda nije poslana (Ably nedostupan)' }, { status: 502 });
  }
  return NextResponse.json({ ok: true, id, sentAt: command.ts }, { headers: { 'Cache-Control': 'no-store' } });
}
