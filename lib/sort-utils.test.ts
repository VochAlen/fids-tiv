// lib/sort-utils.test.ts
import { describe, it, expect } from 'vitest';
import { sortNumericStrings } from './sort-utils';

describe('sortNumericStrings', () => {
  it('sortira brojevno, NE leksikografski (10,11,9 -> 9,10,11)', () => {
    // Ovo je tačan scenario prijavljen ove sesije: šalteri otvoreni
    // redom 10, 11, pa 9 — JavaScript-ov goli .sort() bi dao "10,11,9"
    // (poređenje karakter-po-karakter: '1' < '9').
    expect(sortNumericStrings(['10', '11', '9'])).toEqual(['9', '10', '11']);
  });

  it('radi za jednocifrene brojeve', () => {
    expect(sortNumericStrings(['3', '1', '2'])).toEqual(['1', '2', '3']);
  });

  it('radi za već sortiran niz (no-op)', () => {
    expect(sortNumericStrings(['1', '2', '3'])).toEqual(['1', '2', '3']);
  });

  it('radi za prazan niz', () => {
    expect(sortNumericStrings([])).toEqual([]);
  });

  it('radi za jedan element', () => {
    expect(sortNumericStrings(['42'])).toEqual(['42']);
  });

  it('ne mutira originalni niz (vraća kopiju)', () => {
    const original = ['10', '2'];
    const result = sortNumericStrings(original);
    expect(original).toEqual(['10', '2']); // originalni niz netaknut
    expect(result).toEqual(['2', '10']);
  });

  it('fallback na tekstualno poređenje za ne-brojevne vrijednosti', () => {
    expect(sortNumericStrings(['B', 'A'])).toEqual(['A', 'B']);
  });

  it('vodeće nule se poredе konzistentno sa istim brojem bez nule', () => {
    const result = sortNumericStrings(['11', '05', '9', '2']);
    // Brojevna vrijednost odlučuje redoslijed: 2, 5(05), 9, 11
    expect(result).toEqual(['2', '05', '9', '11']);
  });
});
