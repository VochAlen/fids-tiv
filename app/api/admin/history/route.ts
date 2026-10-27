// app/api/admin/history/route.ts
//
// Istorija dodjela za jedan dan (?date=YYYY-MM-DD, zadano danas): intervali "od-do" za šaltere i gate-ove + lista dostupnih dana.
// 1 LRANGE po zahtjevu; poziva se samo kad admin otvori stranicu ili promijeni dan.
import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';
import { getPodgoricaDateString } from '@/lib/night-hours';
import { buildIntervals, isValidLogDate, summarize } from '@/lib/assign-log';
import { readAssignDay, recentLogDates } from '@/lib/assign-log-server';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const { error: authError } = await requireAdmin(request);
  if (authError) return authError;

  const dates = recentLogDates();
  const q = new URL(request.url).searchParams.get('date');
  const date = q === null ? getPodgoricaDateString() : q;
  if (!isValidLogDate(date) || !dates.includes(date)) {
    return NextResponse.json({ error: 'Datum nije dostupan (čuva se zadnjih 7 dana)', dates }, { status: 400 });
  }

  const events = await readAssignDay(date);
  const intervals = buildIntervals(events);
  return NextResponse.json(
    { date, dates, intervals, summary: summarize(intervals, events), now: Date.now() },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
