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

  it('PRIHVATA drastičan pad u seq-u (reset brojača) kad je setAt noviji', () => {
    // Scenario: Redis SEQ_KEY je eviktovan/resetovan (restart, memorijski
    // pritisak, redeploy) — brojač kreće ponovo od 1. Bez zaštite, ovaj
    // update bi bio ZAUVIJEK odbačen jer 2 < 487.
    const oldTime = Date.now() - 60_000;
    const newTime = Date.now();
    const prev = { '7': entry({ seq: 487, flightNumber: 'STALE_PRE_RESETA', setAt: oldTime }) };
    const result = mergeOne(prev, '7', entry({ seq: 2, flightNumber: 'NOVI_LET', setAt: newTime }));
    expect(result['7'].flightNumber).toBe('NOVI_LET');
  });

  it('i dalje IGNORIŠE mali pad u seq-u čak i sa novijim setAt (normalno van-reda)', () => {
    // Mali pad (ispod praga) ostaje tretiran kao obično kašnjenje u
    // isporuci, ne kao reset — poredi se i dalje po seq, ne po setAt.
    const prev = { '7': entry({ seq: 10, flightNumber: 'CURRENT', setAt: Date.now() - 1000 }) };
    const result = mergeOne(prev, '7', entry({ seq: 3, flightNumber: 'STALE', setAt: Date.now() }));
    expect(result['7'].flightNumber).toBe('CURRENT');
  });

  it('GC/render optimizacija — vraća ISTU prev referencu kad je incoming sadržajno identičan (isti seq, iste vrijednosti)', () => {
    const sharedSetAt = Date.now();
    const prev = { '7': entry({ seq: 5, flightNumber: 'XY100', setAt: sharedSetAt }) };
    const result = mergeOne(prev, '7', entry({ seq: 5, flightNumber: 'XY100', setAt: sharedSetAt }));
    expect(result).toBe(prev);
  });

  it('KRITIČNO — nakon clear-a (mergeNewer), DUPLICIRANA/redeliverovana Ably poruka sa STARIM (pre-clear) seq-om ne smije "uskrsnuti" već zatvoren šalter', () => {
    // Ably garantuje "at-least-once" isporuku — poruka koja je VEĆ
    // obrađena prije clear-a može, u rijetkim slučajevima (reconnect/
    // resume), stići JOŠ JEDNOM. Clear-ovan unos mora imati seq STROGO
    // veći od zadnjeg poznatog, ne isti — inače bi ta stara, ponovljena
    // poruka prošla isIncomingNewer() (>=) i vratila zatvoren šalter na
    // staro (otvoreno) stanje.
    const prev = { '9': entry({ seq: 500, flightNumber: 'XY999', status: 'open' }) };
    const cleared = mergeNewer(prev, {}); // server snapshot više ne sadrži '9' -> clear
    expect(cleared['9'].status).toBeNull();

    const resurrected = mergeOne(cleared, '9', entry({ seq: 500, flightNumber: 'XY999', status: 'open' }));
    expect(resurrected['9'].status).toBeNull(); // duplikat ODBIJEN — šalter ostaje zatvoren
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

  it('KRITIČNO — čisti ključ iz prev koji nedostaje u punom incoming snapshot-u (server ga je obrisao/zatvorio)', () => {
    // Ovo je tačan scenario prijavljenog bug-a: šalter '9' je bio
    // otvoren u prev (lokalni state kioska), ali ga server (nakon
    // 'clear' akcije) više uopšte ne vraća u punom snapshot-u — mora
    // se tretirati kao zatvoren, ne kao "netaknut".
    const prev = { '7': entry({ seq: 1 }), '9': entry({ seq: 1, flightNumber: 'STALE_STILL_SHOWN' }) };
    const result = mergeNewer(prev, { '7': entry({ seq: 2 }) });
    expect(result['9'].status).toBeNull();
    expect(result['9'].flightNumber).toBe('');
  });

  it('ne dira ključ koji nedostaje u incoming ako je već lokalno status: null (izbjegava nepotreban update)', () => {
    const prev = { '9': entry({ seq: 1, status: null, flightNumber: '' }) };
    const result = mergeNewer(prev, {});
    expect(result['9']).toBe(prev['9']); // ISTA referenca — nema nepotrebne izmjene
  });

  it('GC/render optimizacija — vraća ISTU top-level referencu kad je incoming sadržajno identičan (isti seq, iste vrijednosti)', () => {
    // Ovo je scenario koji korisnik prijavio: periodični snapshot fetch
    // (reconciliation, watchdog, fallback poll) koji ne nosi nikakvu
    // stvarnu promjenu ne smije izazvati setState → re-render.
    const prev = { '7': entry({ seq: 5, flightNumber: 'XY100' }), '8': entry({ seq: 2, flightNumber: 'AB222' }) };
    const incoming = { '7': entry({ seq: 5, flightNumber: 'XY100' }), '8': entry({ seq: 2, flightNumber: 'AB222' }) };
    const result = mergeNewer(prev, incoming);
    expect(result).toBe(prev);
    expect(result['7']).toBe(prev['7']);
    expect(result['8']).toBe(prev['8']);
  });

  it('GC/render optimizacija — i dalje mijenja SAMO ključeve koji su stvarno drugačiji, ostale vraća po referenci', () => {
    const prev = { '7': entry({ seq: 5, flightNumber: 'XY100' }), '8': entry({ seq: 2, flightNumber: 'AB222' }) };
    const incoming = { '7': entry({ seq: 6, flightNumber: 'XY999' }), '8': entry({ seq: 2, flightNumber: 'AB222' }) };
    const result = mergeNewer(prev, incoming);
    expect(result).not.toBe(prev);
    expect(result['7'].flightNumber).toBe('XY999');
    expect(result['8']).toBe(prev['8']); // nepromijenjen ključ — ista referenca
  });
});