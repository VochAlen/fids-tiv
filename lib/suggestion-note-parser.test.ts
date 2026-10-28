import { describe, it, expect } from 'vitest';
import { parseSuggestionNote } from './suggestion-note-parser';

const FL = ['LY1234', 'TK1085', 'JU681'];

describe('parseSuggestionNote', () => {
  it('šalter ne radi (sa i bez vremena)', () => {
    expect(parseSuggestionNote('šalter 12 ne radi', FL).constraints.blocked).toEqual([{ type: 'desk', id: '12' }]);
    expect(parseSuggestionNote('Šalter 12 ne radi do 14:00', FL).constraints.blocked).toEqual([{ type: 'desk', id: '12', toMin: 840 }]);
    expect(parseSuggestionNote('šalteri 10, 11 ne rade od 9:30 do 11', FL).constraints.blocked).toEqual([
      { type: 'desk', id: '10', fromMin: 570, toMin: 660 }, { type: 'desk', id: '11', fromMin: 570, toMin: 660 },
    ]);
  });
  it('gate u kvaru i raspon', () => {
    expect(parseSuggestionNote('gate 5 u kvaru', FL).constraints.blocked).toEqual([{ type: 'gate', id: '5' }]);
    expect(parseSuggestionNote('šalter 10-12 ne radi', FL).constraints.blocked.map(b => b.id)).toEqual(['10', '11', '12']);
  });
  it('pin leta na šaltere i gate', () => {
    expect(parseSuggestionNote('LY1234 na šalter 10 i 11', FL).constraints.pins).toEqual([{ type: 'desk', flight: 'LY1234', resources: ['10', '11'] }]);
    expect(parseSuggestionNote('tk1085 gate 6', FL).constraints.pins).toEqual([{ type: 'gate', flight: 'TK1085', resources: ['6'] }]);
  });
  it('broj šaltera za let', () => {
    expect(parseSuggestionNote('LY1234 2 šaltera', FL).constraints.counts).toEqual([{ flight: 'LY1234', count: 2 }]);
    expect(parseSuggestionNote('JU681 jedan šalter', FL).constraints.counts).toEqual([{ flight: 'JU681', count: 1 }]);
  });
  it('više fraza odjednom; "do 14" se ne čita kao let', () => {
    const r = parseSuggestionNote('šalter 12 ne radi do 14, LY1234 na 10 i 11; gate 5 u kvaru', FL);
    expect(r.constraints.blocked).toHaveLength(2);
    expect(r.constraints.pins).toHaveLength(1);
    expect(r.unparsed).toEqual([]);
  });
  it('nepoznato ide u unparsed; nepostojeći šalter se odbacuje; nepoznat let nije pin', () => {
    expect(parseSuggestionNote('danas je gužva', FL).unparsed).toEqual(['danas je gužva']);
    expect(parseSuggestionNote('šalter 99 ne radi', FL).constraints.blocked).toEqual([]);
    expect(parseSuggestionNote('šalter 99 ne radi', FL).unparsed.length).toBeGreaterThan(0);
    expect(parseSuggestionNote('ZZ999 na 10', FL).unparsed).toEqual(['ZZ999 na 10']);
  });
});

describe('terminal u napomeni', () => {
  it('"T1 ne radi do 14:00" blokira sve šaltere i gate-ove T1 do tada', () => {
    const r = parseSuggestionNote('T1 ne radi do 14:00');
    const desks = r.constraints.blocked.filter(b => b.type === 'desk');
    const gates = r.constraints.blocked.filter(b => b.type === 'gate');
    expect(desks.map(b => b.id)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12']);
    expect(gates.map(b => b.id)).toEqual(['2', '3', '4', '5', '6']);
    expect(desks[0].toMin).toBe(14 * 60);
    expect(r.unparsed).toEqual([]);
  });
  it('"radovi u terminalu 1" blokira T1; "T2 radi" postavlja t2', () => {
    expect(parseSuggestionNote('radovi u terminalu 1').constraints.blocked.length).toBe(17);
    const r = parseSuggestionNote('T2 radi');
    expect(r.constraints.t2).toBe(true);
    expect(r.constraints.blocked).toEqual([]);
    expect(r.unparsed).toEqual([]);
  });
});

describe('nejasne fraze se ne pogađaju (idu u unparsed)', () => {
  const none = (r: ReturnType<typeof parseSuggestionNote>) =>
    r.constraints.blocked.length + r.constraints.pins.length + r.constraints.counts.length;
  it.each([
    'šalter 5 ne radi, ali 6 radi',
    'šalter 5 ne radi prije 10',
    'šalter 5 ne radi poslije 10',
    'šalter 5 ne radi do podne',
    'LY1234 ne na 10',
    'LY1234 bez šaltera 10',
    'LY1234 kasni 40 min',
    'LY1234 na 10 a TK1085 na 11',
  ])('%s', (txt) => {
    const r = parseSuggestionNote(txt, FL);
    expect(none(r)).toBe(0);
    expect(r.unparsed.length).toBeGreaterThan(0);
  });
});

describe('unapređenja parsera', () => {
  it('miješani tipovi: "šalter 5 i gate 3 ne rade"', () => {
    const b = parseSuggestionNote('šalter 5 i gate 3 ne rade', FL).constraints.blocked;
    expect(b).toEqual(expect.arrayContaining([{ type: 'desk', id: '5' }, { type: 'gate', id: '3' }]));
    expect(b).toHaveLength(2);
  });
  it('miješani tipovi razdvojeni zarezom + vrijeme', () => {
    const b = parseSuggestionNote('šalter 5, gate 3 ne rade do 14:00', FL).constraints.blocked;
    expect(b).toEqual(expect.arrayContaining([{ type: 'desk', id: '5', toMin: 840 }, { type: 'gate', id: '3', toMin: 840 }]));
    expect(b).toHaveLength(2);
  });
  it('različita vremena za različite šaltere u jednoj rečenici', () => {
    const b = parseSuggestionNote('šalter 5 ne radi do 14:00, 6 ne radi od 15:00', FL).constraints.blocked;
    expect(b).toEqual([{ type: 'desk', id: '5', toMin: 840 }, { type: 'desk', id: '6', fromMin: 900 }]);
  });
  it('trajanje od sada: "ne radi još 30 min" / "2 sata" / "pola sata"', () => {
    expect(parseSuggestionNote('šalter 5 ne radi još 30 min', FL, 600).constraints.blocked).toEqual([{ type: 'desk', id: '5', toMin: 630 }]);
    expect(parseSuggestionNote('gate 3 kvar 2 sata', FL, 600).constraints.blocked).toEqual([{ type: 'gate', id: '3', toMin: 720 }]);
    expect(parseSuggestionNote('šalter 5 ne radi pola sata', FL, 600).constraints.blocked).toEqual([{ type: 'desk', id: '5', toMin: 630 }]);
  });
  it('trajanje bez poznatog sata ide u unparsed (ne pogađa)', () => {
    const r = parseSuggestionNote('šalter 5 ne radi još 30 min', FL);
    expect(r.constraints.blocked).toEqual([]);
    expect(r.unparsed.length).toBe(1);
  });
  it('nerazumljivo vrijeme ("u 14:00", "14h") se ne pretvara u trajnu blokadu', () => {
    for (const t of ['šalter 5 ne radi u 14:00', 'šalter 5 ne radi 14h']) {
      const r = parseSuggestionNote(t, FL);
      expect(r.constraints.blocked).toEqual([]);
      expect(r.unparsed.length).toBe(1);
    }
  });
  it('slovne greške u ključnim riječima', () => {
    expect(parseSuggestionNote('slater 5 ne radi', FL).constraints.blocked).toEqual([{ type: 'desk', id: '5' }]);
    expect(parseSuggestionNote('šalter 5 zatvroen', FL).constraints.blocked).toEqual([{ type: 'desk', id: '5' }]);
    expect(parseSuggestionNote('terminl 1 ne radi').constraints.blocked.length).toBe(17);
  });
  it('broj leta u frazi ne ometa vrijeme-provjeru', () => {
    expect(parseSuggestionNote('LY1234 na 10 i 11', FL).constraints.pins).toHaveLength(1);
  });
});
