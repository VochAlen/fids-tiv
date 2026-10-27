import { describe, it, expect } from 'vitest';
import { decideAlerts, markSendFailed, formatAlertMessage, CONFIRM_RUNS, REMIND_MS, GAP_RESET_MS, type AlertState, type Problem } from '@/lib/alerts';

const MIN = 60_000;
const silent = (id: string, since?: number): Problem => ({ key: `silent:${id}`, kind: 'silent', id, since });
const T0 = 1_700_000_000_000;

describe('decideAlerts', () => {
  it('prvi put viđen problem NE šalje poruku (čeka potvrdu)', () => {
    const r = decideAlerts(null, [silent('checkin-5')], T0);
    expect(r.messages).toEqual([]);
    expect(r.events).toEqual([]);
    expect(r.next.items['silent:checkin-5'].confirmed).toBe(false);
  });

  it('drugi uzastopni put: šalje "new" i upisuje start sa stvarnim početkom', () => {
    const since = T0 - 17 * MIN;
    const a = decideAlerts(null, [silent('checkin-5', since)], T0);
    const b = decideAlerts(a.next, [silent('checkin-5', since)], T0 + 3 * MIN);
    expect(CONFIRM_RUNS).toBe(2);
    expect(b.messages).toHaveLength(1);
    expect(b.messages[0]).toMatchObject({ kind: 'new', id: 'checkin-5' });
    expect(b.messages[0].durationMin).toBe(20);
    expect(b.events).toEqual([{ t: since, k: 'silent', id: 'checkin-5', e: 'start' }]);
  });

  it('treći put: nema ponovne poruke; podsjetnik tek poslije REMIND_MS', () => {
    let s: AlertState | null = null;
    let t = T0;
    const sends: number[] = [];
    for (let i = 0; i < 80; i++) {
      const r = decideAlerts(s, [silent('gate-3')], t);
      if (r.messages.length) sends.push(i);
      s = r.next;
      t += 3 * MIN;
    }
    // i=1 (nova), pa tek poslije 2 h (40 provjera po 3 min) podsjetnik
    expect(sends[0]).toBe(1);
    expect(sends[1]).toBe(1 + REMIND_MS / (3 * MIN));
    expect(sends).toHaveLength(2);
  });

  it('riješeno: poruka + end sa trajanjem, samo ako je bilo obavještenja', () => {
    let s: AlertState | null = null;
    s = decideAlerts(s, [silent('checkin-1')], T0).next;
    s = decideAlerts(s, [silent('checkin-1')], T0 + 3 * MIN).next;
    const r = decideAlerts(s, [], T0 + 30 * MIN);
    expect(r.messages).toEqual([{ kind: 'resolved', problemKind: 'silent', id: 'checkin-1', durationMin: 30 }]);
    expect(r.events).toEqual([{ t: T0 + 30 * MIN, k: 'silent', id: 'checkin-1', e: 'end', d: 30 }]);
    expect(r.next.items).toEqual({});
  });

  it('kratkotrajna smetnja (nikad potvrđena) nema ni poruke ni događaja', () => {
    const a = decideAlerts(null, [silent('checkin-2')], T0);
    const b = decideAlerts(a.next, [], T0 + 3 * MIN);
    expect(b.messages).toEqual([]);
    expect(b.events).toEqual([]);
  });

  it('pauza duža od GAP_RESET_MS (noć) odbacuje staro stanje bez poruka', () => {
    let s: AlertState | null = null;
    s = decideAlerts(s, [silent('checkin-1')], T0).next;
    s = decideAlerts(s, [silent('checkin-1')], T0 + 3 * MIN).next;
    const r = decideAlerts(s, [], T0 + 3 * MIN + GAP_RESET_MS + MIN);
    expect(r.messages).toEqual([]);
    expect(r.events).toEqual([]);
  });

  it('više monitora odjednom = jedna poruka, grupisano', () => {
    const ids = ['checkin-1', 'checkin-2', 'checkin-3'];
    const a = decideAlerts(null, ids.map((i) => silent(i)), T0);
    const b = decideAlerts(a.next, ids.map((i) => silent(i)), T0 + 3 * MIN);
    const text = formatAlertMessage(b.messages, '12:35');
    expect(text.match(/🔴/g)).toHaveLength(1);
    expect(text).toContain('checkin-1');
    expect(text).toContain('checkin-3');
    expect(text.split('\n').filter((l) => l.startsWith('•'))).toHaveLength(1);
  });

  it('neuspjelo slanje: problem se vraća u "nije obaviješteno" pa se ponovo pokušava', () => {
    const a = decideAlerts(null, [silent('checkin-5')], T0);
    const b = decideAlerts(a.next, [silent('checkin-5')], T0 + 3 * MIN);
    const failed = markSendFailed(b.next, b.messages);
    const c = decideAlerts(failed, [silent('checkin-5')], T0 + 6 * MIN);
    expect(c.messages).toHaveLength(1);
    expect(c.messages[0].kind).toBe('new');
    expect(c.events).toEqual([]);   // start je već upisan, ne duplira se
  });
});
