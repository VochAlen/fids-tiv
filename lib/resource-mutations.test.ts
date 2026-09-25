// lib/resource-mutations.test.ts
import { describe, it, expect } from 'vitest';
import { applyResourceAction, computeCleanup, type ResourceEntry } from './resource-mutations';

const NOW = 1_700_000_000_000;

describe('applyResourceAction — open', () => {
  it('otvara šalter/gate sa novim letom', () => {
    const all: Record<string, ResourceEntry> = {};
    const result = applyResourceAction(all, '7', 'open', 'XY456', null, NOW);
    expect(result.changed).toBe(true);
    expect(result.publishedEntry?.entry.status).toBe('open');
    expect(result.publishedEntry?.entry.flightNumber).toBe('XY456');
    expect(all['7'].flightNumber).toBe('XY456'); // upisano u `all`
  });

  it('čuva postojeći classType pri otvaranju', () => {
    const all: Record<string, ResourceEntry> = {
      '7': { status: null, flightNumber: '', classType: 'business', setAt: NOW, seq: 1 },
    };
    const result = applyResourceAction(all, '7', 'open', 'XY456', null, NOW);
    expect(result.publishedEntry?.entry.classType).toBe('business');
  });

  it('ne mijenja ništa ako nema flightNumber-a', () => {
    const all: Record<string, ResourceEntry> = {};
    const result = applyResourceAction(all, '7', 'open', undefined, null, NOW);
    expect(result.changed).toBe(false);
  });
});

describe('applyResourceAction — clear (KRITIČNO — ranije popravljen bug)', () => {
  it('uklanja postojeći zapis i objavljuje "closed" entry', () => {
    const all: Record<string, ResourceEntry> = {
      '7': { status: 'open', flightNumber: 'XY456', classType: null, setAt: NOW, seq: 1 },
    };
    const result = applyResourceAction(all, '7', 'clear', undefined, undefined, NOW);
    expect(result.changed).toBe(true);
    expect(result.publishedEntry?.entry.status).toBeNull();
    expect(result.publishedEntry?.entry.flightNumber).toBe('');
    expect(all['7']).toBeUndefined(); // stvarno obrisano iz `all`
  });

  it('vraća changed:false BEZ publishedEntry kad zapis već ne postoji', () => {
    // Ovo je namjerno, ispravno ponašanje — "nema šta da se ukloni".
    // Zaštita za slučaj "auto-cleanup ga je već tiho obrisao" je u
    // computeCleanup, NE ovdje.
    const all: Record<string, ResourceEntry> = {};
    const result = applyResourceAction(all, '7', 'clear', undefined, undefined, NOW);
    expect(result.changed).toBe(false);
    expect(result.publishedEntry).toBeUndefined();
  });
});

describe('applyResourceAction — closed', () => {
  it('postavlja status na closed bez obzira na prethodno stanje', () => {
    const all: Record<string, ResourceEntry> = {};
    const result = applyResourceAction(all, '7', 'closed', 'XY456', null, NOW);
    expect(result.changed).toBe(true);
    expect(result.publishedEntry?.entry.status).toBe('closed');
  });
});

describe('applyResourceAction — setClass', () => {
  it('mijenja classType postojećeg zapisa', () => {
    const all: Record<string, ResourceEntry> = {
      '7': { status: 'open', flightNumber: 'XY456', classType: null, setAt: NOW, seq: 1 },
    };
    const result = applyResourceAction(all, '7', 'setClass', undefined, 'economy', NOW);
    expect(result.publishedEntry?.entry.classType).toBe('economy');
    expect(result.publishedEntry?.entry.flightNumber).toBe('XY456'); // ostatak nepromijenjen
  });

  it('vraća changed:false ako zapis ne postoji', () => {
    const all: Record<string, ResourceEntry> = {};
    const result = applyResourceAction(all, '7', 'setClass', undefined, 'economy', NOW);
    expect(result.changed).toBe(false);
  });
});

describe('computeCleanup (KRITIČNO — ranije popravljen bug: cleanup nije objavljivao promjenu)', () => {
  const MAX_AGE_MS = 4 * 60 * 60 * 1000; // 4h, isto kao desk-status-override

  it('čisti unose starije od maxAgeMs i vraća ih za objavu', () => {
    const all: Record<string, ResourceEntry> = {
      '7': { status: 'open', flightNumber: 'XY456', classType: null, setAt: NOW - 5 * 60 * 60 * 1000, seq: 1 }, // 5h star
    };
    const cleaned = computeCleanup(all, NOW, MAX_AGE_MS);
    expect(cleaned).toHaveLength(1);
    expect(cleaned[0].key).toBe('7');
    expect(cleaned[0].entry.status).toBeNull();
    expect(all['7']).toBeUndefined(); // stvarno obrisano
  });

  it('ne dira unose mlađe od maxAgeMs', () => {
    const all: Record<string, ResourceEntry> = {
      '7': { status: 'open', flightNumber: 'XY456', classType: null, setAt: NOW - 1 * 60 * 60 * 1000, seq: 1 }, // 1h star
    };
    const cleaned = computeCleanup(all, NOW, MAX_AGE_MS);
    expect(cleaned).toHaveLength(0);
    expect(all['7']).toBeDefined(); // netaknuto
  });

  it('čisti više isteklih unosa odjednom, ostavlja svježe', () => {
    const all: Record<string, ResourceEntry> = {
      '7': { status: 'open', flightNumber: 'AA1', classType: null, setAt: NOW - 5 * 60 * 60 * 1000, seq: 1 },
      '8': { status: 'open', flightNumber: 'BB2', classType: null, setAt: NOW - 6 * 60 * 60 * 1000, seq: 1 },
      '9': { status: 'open', flightNumber: 'CC3', classType: null, setAt: NOW - 1 * 60 * 60 * 1000, seq: 1 },
    };
    const cleaned = computeCleanup(all, NOW, MAX_AGE_MS);
    expect(cleaned.map(c => c.key).sort()).toEqual(['7', '8']);
    expect(all['9']).toBeDefined();
  });

  it('ne dira unose bez setAt (nikad nije bio postavljen)', () => {
    const all: Record<string, ResourceEntry> = {
      '7': { status: null, flightNumber: '', classType: null, setAt: null, seq: 0 },
    };
    const cleaned = computeCleanup(all, NOW, MAX_AGE_MS);
    expect(cleaned).toHaveLength(0);
  });
});

describe('Integracioni scenario — puna sekvenca koja je izazvala prijavljen bug', () => {
  it('cleanup pa ručni clear na istom ključu: OBA moraju rezultovati objavom', () => {
    const MAX_AGE_MS = 4 * 60 * 60 * 1000;
    const all: Record<string, ResourceEntry> = {
      '7': { status: 'open', flightNumber: 'XY456', classType: null, setAt: NOW - 5 * 60 * 60 * 1000, seq: 1 },
    };

    // 1. Cleanup (automatski, unutar mutateAll, prije ručne akcije)
    const cleaned = computeCleanup(all, NOW, MAX_AGE_MS);
    expect(cleaned).toHaveLength(1); // MORA se objaviti (ranije se nije)

    // 2. Ručni 'clear' na već očišćenom zapisu
    const manualResult = applyResourceAction(all, '7', 'clear', undefined, undefined, NOW);
    expect(manualResult.changed).toBe(false); // ispravno — nema šta da se ukloni
    // Kiosk i dalje dobija ispravno stanje jer je CLEANUP već objavio poruku iznad.
  });
});
