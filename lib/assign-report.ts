// lib/assign-report.ts — dnevni izvještaj dodjela kao PDF dokument (čista funkcija, testirana).
import { buildPdf, type PdfDoc } from '@/lib/simple-pdf';
import { END_REASON_LABEL, fmtClock, fmtDuration, openState, summarize, type AssignEvent, type AssignInterval } from '@/lib/assign-log';

const fmtDate = (d: string) => { const [y, m, day] = d.split('-'); return `${day}.${m}.${y}.`; };

export function buildAssignReportDoc(date: string, intervals: readonly AssignInterval[], events: readonly AssignEvent[], now: number): PdfDoc {
  const s = summarize(intervals, events);
  const rows = (type: 'd' | 'g') => intervals.filter((i) => i.y === type).map((i) => [
    i.id,
    i.flight || '-',
    fmtClock(i.start),
    i.end !== null ? fmtClock(i.end) : openState(i, now) === 'open' ? 'jos otvoreno' : 'nije zabiljezeno',
    i.end === null ? '-' : fmtDuration(Math.max(0, (i.end - i.start) / 60_000)),
    i.endReason ? END_REASON_LABEL[i.endReason] : i.end === null && openState(i, now) === 'unknown' ? 'kraj nije zabiljezen' : '-',
    i.openedBy ?? '',
  ]);
  const columns = (first: string) => [
    { title: first, width: 60 }, { title: 'Let', width: 70 }, { title: 'Otvoreno', width: 70 }, { title: 'Zatvoreno', width: 80 },
    { title: 'Trajanje', width: 70 }, { title: 'Kraj', width: 110 }, { title: 'Korisnik', width: 60 },
  ];
  return {
    title: `FIDS Tivat - istorija dodjela ${fmtDate(date)}`,
    subtitle: `Check-in: ${s.desks} dodjela | Gate: ${s.gates} dodjela | Letova: ${s.flights} | Vrijeme je po aerodromskom satu`,
    sections: [
      { heading: 'Check-in salteri', columns: columns('Salter'), rows: rows('d'), emptyText: 'Nema zabiljezenih dodjela.' },
      { heading: 'Gate-ovi', columns: columns('Gate'), rows: rows('g'), emptyText: 'Nema zabiljezenih dodjela.' },
    ],
    footer: `Generisano ${fmtDate(new Date(now).toISOString().slice(0, 10))} ${fmtClock(now)} | FIDS Tivat`,
  };
}

export const buildAssignReportPdf = (date: string, intervals: readonly AssignInterval[], events: readonly AssignEvent[], now: number) =>
  buildPdf(buildAssignReportDoc(date, intervals, events, now));
