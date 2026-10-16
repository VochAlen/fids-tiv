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


describe('mergeNewer — zaštita od zakasnjelog snapshot-a (trka Ably poruka vs. REST)', () => {
  const open = (seq: number) => ({ status: 'open' as const, flightNumber: 'LY5468', classType: null, setAt: 1000 + seq, seq });

  it('BEZ zaštite: zakasnjeli snapshot bez ključa briše svježe otvoren šalter (regresioni dokaz uzroka)', () => {
    const afterAbly = { '3': open(20) };
    const afterStale = mergeNewer(afterAbly, {});
    expect(afterStale['3'].status).toBeNull();
    // ...a sljedeći pravi snapshot (seq 20) biva odbijen zbog lažnog seq 21:
    const afterReal = mergeNewer(afterStale, { '3': open(20) });
    expect(afterReal['3'].status).toBeNull();
  });

  it('SA zaštitom: ključ dirnut Ably porukom poslije zahtjeva se NE čisti', () => {
    const afterAbly = { '3': open(20) };
    const afterStale = mergeNewer(afterAbly, {}, new Set(['3']));
    expect(afterStale['3'].status).toBe('open');
    expect(afterStale).toBe(afterAbly);
  });

  it('zaštita važi samo za navedene ključeve — ostali se i dalje čiste', () => {
    const prev = { '3': open(20), '4': open(18) };
    const out = mergeNewer(prev, {}, new Set(['3']));
    expect(out['3'].status).toBe('open');
    expect(out['4'].status).toBeNull();
  });

  it('zaštićen ključ koji snapshot SADRŽI i dalje prolazi kroz seq poređenje', () => {
    const prev = { '3': open(20) };
    expect(mergeNewer(prev, { '3': open(25) }, new Set(['3']))['3'].seq).toBe(25);
    expect(mergeNewer(prev, { '3': open(19) }, new Set(['3']))['3'].seq).toBe(20);
  });
});

describe('mergeNewer — snapshot pročitan PRIJE postavljanja unosa (server keš)', () => {
  const e = (seq: number, setAt: number, flightNumber = 'JU123'): AssignmentEntry =>
    ({ status: 'open', flightNumber, classType: null, setAt, seq });

  it('Ably poruka stigla prije zahtjeva, ali snapshot je iz keša starijeg od unosa → NE briše', () => {
    const prev = { '5': e(20, 100_000) };
    const out = mergeNewer(prev, {}, undefined, 90_000); // readAt < setAt
    expect(out['5'].status).toBe('open');
    expect(out['5'].seq).toBe(20);
  });

  it('ispravan kasniji snapshot (seq 20) i dalje prolazi — nema zaglavljivanja', () => {
    let st: Record<string, AssignmentEntry> = { '5': e(20, 100_000) };
    st = mergeNewer(st, {}, undefined, 90_000);            // star snapshot
    st = mergeNewer(st, { '5': e(20, 100_000) }, undefined, 110_000); // svjež snapshot
    expect(st['5'].status).toBe('open');
  });

  it('snapshot pročitan POSLIJE unosa koji ga ne sadrži → briše (stvarno obrisano)', () => {
    const prev = { '5': e(20, 100_000) };
    const out = mergeNewer(prev, {}, undefined, 120_000);
    expect(out['5'].status).toBeNull();
  });

  it('tolerancija sata: readAt unutar 2 s ispred setAt-a ne briše', () => {
    const prev = { '5': e(20, 100_000) };
    expect(mergeNewer(prev, {}, undefined, 101_500)['5'].status).toBe('open');
    expect(mergeNewer(prev, {}, undefined, 103_000)['5'].status).toBeNull();
  });

  it('bez readAt (stari server) ponašanje je nepromijenjeno', () => {
    expect(mergeNewer({ '5': e(20, 100_000) }, {})['5'].status).toBeNull();
  });
});

describe('mergeNewer — oživljavanje lažno očišćenog unosa (sigurnosna mreža)', () => {
  const open = (seq: number, setAt: number): AssignmentEntry =>
    ({ status: 'open', flightNumber: 'JU1', classType: null, setAt, seq });

  it('snapshot pročitan poslije brisanja vraća otvoren unos istog seq-a', () => {
    let st: Record<string, AssignmentEntry> = { '3': open(20, 1_000) };
    st = mergeNewer(st, {}, undefined, 50_000);              // obrisano snapshotom (readAt 50 000)
    expect(st['3'].status).toBeNull();
    st = mergeNewer(st, { '3': open(20, 1_000) }, undefined, 60_000); // noviji snapshot kaže otvoren
    expect(st['3'].status).toBe('open');
  });

  it('stariji/isti snapshot (readAt ≤ readAt brisanja) NE oživljava', () => {
    let st: Record<string, AssignmentEntry> = { '3': open(20, 1_000) };
    st = mergeNewer(st, {}, undefined, 50_000);
    st = mergeNewer(st, { '3': open(20, 1_000) }, undefined, 40_000);
    expect(st['3'].status).toBeNull();
  });
});

import { applyTruth } from './assignment-merge';

describe('applyTruth — nekeširan odgovor servera', () => {
  const open = (seq: number, fn = 'JU1'): AssignmentEntry => ({ status: 'open', flightNumber: fn, classType: null, setAt: 5_000, seq });

  it('server ima otvoren unos, klijent nema → otvara', () => {
    expect(applyTruth({}, '5', open(30), 9_000)['5'].status).toBe('open');
  });
  it('zaglavljen lažni clear sa višim seq-om → ispravlja se bezuslovno', () => {
    const stuck: Record<string, AssignmentEntry> = { '5': { status: null, flightNumber: '', classType: null, setAt: 1, seq: 31, clearedReadAt: 1 } };
    const out = applyTruth(stuck, '5', open(30), 9_000);
    expect(out['5'].status).toBe('open');
    expect(out['5'].seq).toBe(30);
  });
  it('server nema unos, klijent prikazuje otvoren → čisti', () => {
    expect(applyTruth({ '5': open(30) }, '5', null, 9_000)['5'].status).toBeNull();
  });
  it('Ably poruka stigla poslije početka zahtjeva (zaštićen ključ) → odgovor se ignoriše', () => {
    const prev = { '5': open(40) };
    expect(applyTruth(prev, '5', open(30), 9_000, new Set(['5']))).toBe(prev);
  });
  it('isto stanje → vraća istu referencu (bez re-rendera)', () => {
    const prev = { '5': open(30) };
    expect(applyTruth(prev, '5', open(30), 9_000)).toBe(prev);
  });
  it('server vraća closed sa letom → closed', () => {
    const closed: AssignmentEntry = { status: 'closed', flightNumber: 'JU1', classType: null, setAt: 5_000, seq: 31 };
    expect(applyTruth({ '5': open(30) }, '5', closed, 9_000)['5'].status).toBe('closed');
  });
});
