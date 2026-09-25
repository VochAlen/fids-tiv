// lib/assignment-merge.test.ts
import { describe, it, expect } from 'vitest';
import { mergeOne, mergeNewer, type AssignmentEntry } from './assignment-merge';

function entry(overrides: Partial<AssignmentEntry> = {}): AssignmentEntry {
  return { status: 'open', flightNumber: 'XY100', classType: null, setAt: Date.now(), seq: 1, ...overrides };
}

describe('mergeOne', () => {
  it('primjenjuje unos kad ključ još ne postoji', () => {
    const result = mergeOne({}, '7', entry({ seq: 1 }));
    expect(result['7'].seq).toBe(1);
  });

  it('primjenjuje unos sa VEĆIM seq (novija poruka)', () => {
    const prev = { '7': entry({ seq: 5, flightNumber: 'OLD' }) };
    const result = mergeOne(prev, '7', entry({ seq: 6, flightNumber: 'NEW' }));
    expect(result['7'].flightNumber).toBe('NEW');
  });

  it('primjenjuje unos sa JEDNAKIM seq (>=, ne samo >)', () => {
    const prev = { '7': entry({ seq: 5, flightNumber: 'OLD' }) };
    const result = mergeOne(prev, '7', entry({ seq: 5, flightNumber: 'REPUBLISHED' }));
    expect(result['7'].flightNumber).toBe('REPUBLISHED');
  });

  it('IGNORIŠE unos sa MANJIM seq (van-reda/zakašnjela poruka)', () => {
    // Ovo je tačno scenario koji ova zaštita sprečava: Ably poruka
    // koja je poslata RANIJE, ali mrežno stigne KASNIJE od novije.
    const prev = { '7': entry({ seq: 10, flightNumber: 'CURRENT' }) };
    const result = mergeOne(prev, '7', entry({ seq: 3, flightNumber: 'STALE' }));
    expect(result['7'].flightNumber).toBe('CURRENT');
  });

  it('ne dira druge ključeve', () => {
    const prev = { '7': entry({ seq: 1 }), '8': entry({ seq: 1, flightNumber: 'AB222' }) };
    const result = mergeOne(prev, '7', entry({ seq: 2, flightNumber: 'CD333' }));
    expect(result['8'].flightNumber).toBe('AB222');
  });

  it('tretira nedostajući seq kao 0 (najstariji mogući)', () => {
    const prev = { '7': entry({ seq: 5 }) };
    // @ts-expect-error - namjerno testiramo nedostajuće polje iz stvarnog svijeta (npr. stari klijent)
    const result = mergeOne(prev, '7', { status: 'closed', flightNumber: '', classType: null, setAt: Date.now() });
    // seq nedostaje -> ?? 0 -> 0 >= 5 je false -> IGNORISANO
    expect(result['7'].seq).toBe(5);
  });
});

describe('mergeNewer', () => {
  it('primjenjuje sve unose kad prev prazan', () => {
    const result = mergeNewer({}, { '7': entry({ seq: 1 }), '8': entry({ seq: 1 }) });
    expect(Object.keys(result)).toHaveLength(2);
  });

  it('čuva stariji unos ako incoming ima manji seq, za SVAKI ključ nezavisno', () => {
    const prev = { '7': entry({ seq: 10, flightNumber: 'KEEP' }), '8': entry({ seq: 2, flightNumber: 'OLD8' }) };
    const incoming = { '7': entry({ seq: 3, flightNumber: 'STALE' }), '8': entry({ seq: 5, flightNumber: 'NEW8' }) };
    const result = mergeNewer(prev, incoming);
    expect(result['7'].flightNumber).toBe('KEEP');   // incoming je stariji, ignorisano
    expect(result['8'].flightNumber).toBe('NEW8');    // incoming je noviji, primijenjeno
  });

  it('zadržava ključeve iz prev koji nisu u incoming', () => {
    const prev = { '7': entry({ seq: 1 }), '9': entry({ seq: 1, flightNumber: 'UNTOUCHED' }) };
    const result = mergeNewer(prev, { '7': entry({ seq: 2 }) });
    expect(result['9'].flightNumber).toBe('UNTOUCHED');
  });
});
