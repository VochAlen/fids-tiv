// app/api/admin/history/pdf/route.ts
//
// Preuzimanje dnevnog izvještaja dodjela kao PDF (?date=YYYY-MM-DD). Generiše se na zahtjev iz sačuvane istorije (7 dana);
// nema zakazivanja ni stalnog troška — jedan poziv + jedan LRANGE pri kliku na "Preuzmi PDF".
import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';
import { buildIntervals, isValidLogDate } from '@/lib/assign-log';
import { buildAssignReportPdf } from '@/lib/assign-report';
import { readAssignDay, recentLogDates } from '@/lib/assign-log-server';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const { error: authError } = await requireAdmin(request);
  if (authError) return authError;

  const date = new URL(request.url).searchParams.get('date');
  if (!isValidLogDate(date) || !recentLogDates().includes(date)) {
    return NextResponse.json({ error: 'Datum nije dostupan (čuva se zadnjih 7 dana)' }, { status: 400 });
  }
  const events = await readAssignDay(date);
  const pdf = buildAssignReportPdf(date, buildIntervals(events), events, Date.now());
  return new NextResponse(Buffer.from(pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="fids-dodjele-${date}.pdf"`,
      'Cache-Control': 'no-store',
    },
  });
}
