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
