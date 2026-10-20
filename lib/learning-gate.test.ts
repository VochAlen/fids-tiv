import { describe, it, expect } from 'vitest';
import { gateLearnedRaw, decideGate } from './learning-gate';
import { accuracyIncrement, fieldOf, isoWeekKey, type AccuracySource, type AccuracyOutcome } from './assignment-learning';

const TODAY = '2026-10-20';
const wk = isoWeekKey(TODAY);
function acc(kind: 'desk' | 'gate', source: AccuracySource, hit: number, miss: number, raw: Record<string, string> = {}) {
  for (const [outcome, n] of [['hit', hit], ['miss', miss]] as Array<[AccuracyOutcome, number]>) {
    const inc = accuracyIncrement({ kind, source, outcome, weekKey: wk });
    raw[inc.field] = String(n);
  }
  return raw;
}
const pool = (kind: string) => ({ [fieldOf(`${kind}:F:LY1234:W`, '5')]: '9', [fieldOf(`fb:${kind}:A:LY:W`, '5>6')]: '3' });

describe('gateLearnedRaw', () => {
  it('naučeno jasno gore od profila (≥20 uzoraka) → isključuje bazene tog tipa, ostalo ostaje', () => {
    const raw = { ...pool('desk'), ...pool('gate'), [fieldOf('deskcount:F:LY1234:W', '2')]: '5' };
    acc('desk', 'learned', 8, 22, raw); acc('desk', 'profile', 21, 9, raw);
    const g = gateLearnedRaw(raw, TODAY);
    expect(g.notes.desk).toMatch(/isključeni/);
    expect(g.notes.gate).toBeUndefined();
    const keys = Object.keys(g.raw!);
    expect(keys.some(k => k.startsWith('desk:'))).toBe(false);
    expect(keys.some(k => k.startsWith('fb:desk:'))).toBe(false);
    expect(keys.some(k => k.startsWith('gate:'))).toBe(true);
    expect(keys.some(k => k.startsWith('deskcount:'))).toBe(true);
    expect(keys.some(k => k.startsWith('acc:'))).toBe(true);
  });
  it('malo uzoraka ili mala razlika → ništa se ne mijenja', () => {
    const few = acc('desk', 'profile', 18, 2, acc('desk', 'learned', 3, 7, pool('desk')));
    expect(gateLearnedRaw(few, TODAY).raw).toBe(few);
    const close = acc('desk', 'profile', 21, 9, acc('desk', 'learned', 20, 10, pool('desk')));
    expect(gateLearnedRaw(close, TODAY).raw).toBe(close);
  });
  it('opšti raspored se računa uz profil; bez podataka / bez datuma → nepromijenjeno', () => {
    const raw = acc('desk', 'default', 15, 5, acc('desk', 'profile', 10, 0, acc('desk', 'learned', 5, 25, pool('desk'))));
    expect(decideGate(raw, 'desk', TODAY).baselineN).toBe(30);
    expect(decideGate(raw, 'desk', TODAY).distrust).toBe(true);
    expect(gateLearnedRaw(raw, null).raw).toBe(raw);
    expect(gateLearnedRaw(null, TODAY).raw).toBeNull();
    expect(gateLearnedRaw({}, TODAY).decisions.every(d => !d.distrust)).toBe(true);
  });
});
