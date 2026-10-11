import { describe, it, expect } from 'vitest';
import { sanitizeConstraints, mergeConstraints, describeConstraints, isEmptyConstraints } from './suggestion-constraints';

describe('sanitizeConstraints', () => {
  it('odbacuje nepoznate resurse, letove i loše vrijednosti', () => {
    const c = sanitizeConstraints({
      blocked: [
        { type: 'desk', id: '12', from: null, to: '14:00' },
        { type: 'desk', id: '99' },
        { type: 'spaceship', id: '1' },
        { type: 'gate', id: 5, from: '25:00' },
      ],
      pins: [
        { type: 'desk', flight: 'ly 1234', resources: ['10', '11', 'zz', '10'] },
        { type: 'desk', flight: 'NEMA1', resources: ['10'] },
        { type: 'gate', flight: 'LY1234', resources: [] },
      ],
      counts: [{ flight: 'LY1234', count: 3 }, { flight: 'LY1234', count: 40 }, { flight: 'ZZ', count: 2 }],
    }, ['LY1234']);
    expect(c.blocked).toEqual([{ type: 'desk', id: '12', toMin: 840 }, { type: 'gate', id: '5' }]);
    expect(c.pins).toEqual([{ type: 'desk', flight: 'LY1234', resources: ['10', '11'] }]);
    expect(c.counts).toEqual([{ flight: 'LY1234', count: 3 }]);
  });
  it('smeće → prazno; merge bez duplikata; opis za čipove', () => {
    expect(isEmptyConstraints(sanitizeConstraints('x'))).toBe(true);
    expect(isEmptyConstraints(sanitizeConstraints({ blocked: 'x' }))).toBe(true);
    const a = sanitizeConstraints({ blocked: [{ type: 'desk', id: '12', to: '14:00' }] });
    const m = mergeConstraints(a, a);
    expect(m.blocked).toHaveLength(1);
    expect(describeConstraints(m)[0].text).toBe('šalter 12 ne radi do 14:00');
  });
});
