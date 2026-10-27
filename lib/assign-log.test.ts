import { describe, it, expect } from 'vitest';
import { buildIntervals, fmtDuration, parseAssignEvents, type AssignEvent } from '@/lib/assign-log';
import { buildAssignReportPdf } from '@/lib/assign-report';
import { toAscii } from '@/lib/simple-pdf';

const ev = (t: number, a: AssignEvent['a'], f = 'JU687', id = '5', y: 'd' | 'g' = 'd'): AssignEvent => ({ t, y, id, a, f });
const M = 60_000;

describe('buildIntervals', () => {
  it('otvaranje + zatvaranje = jedan interval', () => {
    const r = buildIntervals([ev(0, 'open'), ev(90 * M, 'close')]);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ flight: 'JU687', start: 0, end: 90 * M, endReason: 'closed' });
  });
  it('ponovno otvaranje istog leta se ignoriše; drugi let zatvara prethodni', () => {
    const r = buildIntervals([ev(0, 'open'), ev(5 * M, 'open'), ev(10 * M, 'open', 'LS1')]);
    expect(r).toHaveLength(2);
    expect(r[0]).toMatchObject({ flight: 'JU687', end: 10 * M, endReason: 'replaced' });
    expect(r[1]).toMatchObject({ flight: 'LS1', end: null, endReason: null });
  });
  it('clear i auto završavaju interval; šalter i gate sa istim brojem su odvojeni', () => {
    const r = buildIntervals([ev(0, 'open'), ev(1 * M, 'open', 'A', '5', 'g'), ev(20 * M, 'clear'), ev(30 * M, 'auto', 'A', '5', 'g')]);
    expect(r.find((i) => i.y === 'd')?.endReason).toBe('cleared');
    expect(r.find((i) => i.y === 'g')?.endReason).toBe('auto');
  });
  it('zatvaranje bez prethodnog otvaranja se ignoriše', () => {
    expect(buildIntervals([ev(0, 'close')])).toHaveLength(0);
  });
});

describe('ostalo', () => {
  it('parseAssignEvents preskače oštećene i sortira', () => {
    const r = parseAssignEvents(['{"t":5,"y":"d","id":"1","a":"open","f":"X"}', 'nije json', '{"t":2,"y":"g","id":"2","a":"close","f":""}']);
    expect(r.map((e) => e.t)).toEqual([2, 5]);
  });
  it('fmtDuration', () => { expect(fmtDuration(0.4)).toBe('<1 min'); expect(fmtDuration(95)).toBe('1 h 35 min'); });
  it('toAscii', () => { expect(toAscii('Šalter čćđž')).toBe('Salter cc' + 'dj' + 'z'); });
  it('PDF je validan po strukturi', () => {
    const iv = buildIntervals([ev(Date.UTC(2026, 9, 27, 8), 'open'), ev(Date.UTC(2026, 9, 27, 9), 'close')]);
    const bytes = buildAssignReportPdf('2026-10-27', iv, [], Date.UTC(2026, 9, 27, 12));
    const s = new TextDecoder().decode(bytes);
    expect(s.startsWith('%PDF-1.4')).toBe(true);
    expect(s.trimEnd().endsWith('%%EOF')).toBe(true);
    expect(s).toContain('/Count 1');
  });
});
