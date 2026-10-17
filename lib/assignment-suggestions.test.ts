import { describe, it, expect } from 'vitest';
import { parseLearned, scopeResource, scopeCount, fieldOf } from './assignment-learning';
import {
  computeAssignmentSuggestions,
  getAirlineProfile,
  parseClockMinutes,
  resolveWantedGateTerminal,
  formatClockMinutes,
  type SuggestionFlight,
} from './assignment-suggestions';

const fl = (over: Partial<SuggestionFlight> & { FlightNumber: string; ScheduledDepartureTime: string }): SuggestionFlight => ({
  AirlineCode: over.FlightNumber.replace(/\d.*$/, ''),
  AirlineName: '',
  DestinationAirportCode: 'XXX',
  DestinationCityName: 'Test',
  StatusEN: 'Scheduled',
  ...over,
});

const NOW = 8 * 60; // 08:00
const run = (flights: SuggestionFlight[], extra: Partial<Parameters<typeof computeAssignmentSuggestions>[0]> = {}) =>
  computeAssignmentSuggestions({ flights, currentDesks: {}, currentGates: {}, nowMin: NOW, ...extra });

describe('profili kompanija', () => {
  it('prepoznaje kompanije po kodu, imenu i prefiksu leta', () => {
    expect(getAirlineProfile(fl({ FlightNumber: 'LY5111', ScheduledDepartureTime: '10:00' })).id).toBe('sundor-elal');
    expect(getAirlineProfile(fl({ FlightNumber: 'XX1', AirlineName: 'Sundor', ScheduledDepartureTime: '10:00' })).id).toBe('sundor-elal');
    expect(getAirlineProfile(fl({ FlightNumber: 'TK1085', ScheduledDepartureTime: '10:00' })).id).toBe('turkish');
    expect(getAirlineProfile(fl({ FlightNumber: 'U28812', AirlineCode: '', ScheduledDepartureTime: '10:00' })).id).toBe('easyjet');
    expect(getAirlineProfile(fl({ FlightNumber: 'JU681', ScheduledDepartureTime: '10:00' })).id).toBe('air-serbia');
    expect(getAirlineProfile(fl({ FlightNumber: '4O123', ScheduledDepartureTime: '10:00' })).id).toBe('air-montenegro');
    expect(getAirlineProfile(fl({ FlightNumber: 'DY1234', ScheduledDepartureTime: '10:00' })).id).toBe('norwegian');
    expect(getAirlineProfile(fl({ FlightNumber: 'FR100', ScheduledDepartureTime: '10:00' })).id).toBe('default');
  });
});

describe('šalteri', () => {
  it('Sundor/El Al/Turkish: 3 šaltera 10,11,12; check-in 180 min (LY) i zatvaranje 30 min prije', () => {
    const r = run([fl({ FlightNumber: 'LY5111', ScheduledDepartureTime: '14:00' })], { openLeadByIata: { LY: 180 } });
    expect(r.desks[0].resources).toEqual(['10', '11', '12']);
    expect(r.desks[0].openAt).toBe(14 * 60 - 180);
    expect(r.desks[0].closeAt).toBe(14 * 60 - 30);
    expect(r.desks[0].warnings).toEqual([]);
  });

  it('easyJet: 1,2,3; Air Serbia: 4,5; Air Montenegro: 2 šaltera iz 4-7; JU→KVO: 1 šalter', () => {
    const r = run([
      fl({ FlightNumber: 'U28812', ScheduledDepartureTime: '09:00' }),
      fl({ FlightNumber: 'JU681', ScheduledDepartureTime: '15:00' }),
      fl({ FlightNumber: 'JU655', ScheduledDepartureTime: '16:00', DestinationAirportCode: 'KVO' }),
    ]);
    const by = Object.fromEntries(r.desks.map(d => [d.flightNumber, d.resources]));
    expect(by['U28812']).toEqual(['1', '2', '3']);
    expect(by['JU681']).toEqual(['4', '5']);
    expect(by['JU655']).toHaveLength(1);
    const am = run([fl({ FlightNumber: '4O101', ScheduledDepartureTime: '12:00' })]);
    expect(am.desks[0].resources).toEqual(['4', '5']);
  });

  it('dva leta u isto vrijeme: drugi dobija najbliže slobodne šaltere uz upozorenje', () => {
    const r = run([
      fl({ FlightNumber: 'LY1', ScheduledDepartureTime: '14:00' }),
      fl({ FlightNumber: 'TK1', ScheduledDepartureTime: '14:10' }),
    ]);
    expect(r.desks[0].resources).toEqual(['10', '11', '12']);
    expect(r.desks[1].resources).toEqual(['7', '8', '9']);
    expect(r.desks[1].warnings.some(w => w.includes('nisu slobodni'))).toBe(true);
  });

  it('isti šalteri se ponovo koriste kad se intervali ne preklapaju (uz pauzu 1 min)', () => {
    // LY 08:30 → check-in 05:30-08:00 (nowMin=08:00 ne smeta, apsolutna vremena); TK 12:00 → 10:00-11:30
    const r = run([
      fl({ FlightNumber: 'LY1', ScheduledDepartureTime: '08:30' }),
      fl({ FlightNumber: 'TK1', ScheduledDepartureTime: '12:00' }),
    ]);
    expect(r.desks.find(d => d.flightNumber === 'TK1')!.resources).toEqual(['10', '11', '12']);
  });

  it('pauza: interval koji počinje prije isteka pauze (1 min) poslije zatvaranja je konflikt, a tačno 1 min poslije nije', () => {
    // LY zatvara u 14:00-30 = 13:30. TK sa lead 120 počinje 14:00-120... koristimo lead da dobijemo start.
    const a = fl({ FlightNumber: 'LY1', ScheduledDepartureTime: '14:00' });
    // TK start = lyEnd → konflikt; start = lyEnd + 1 → slobodno
    const conflictFlight = fl({ FlightNumber: 'TK1', ScheduledDepartureTime: '15:30' }); // 15:30 - 120 = 13:30 (=lyEnd)
    const okFlight = fl({ FlightNumber: 'TK2', ScheduledDepartureTime: '15:31' }); // 13:31 (=lyEnd+1)
    const r1 = run([a, conflictFlight], { openLeadByIata: { LY: 180, default: 120 } });
    // Sada: umjesto da se odbaci, nudi se isti blok "po zatvaranju" LY1 (čeka 1 min + pauza).
    const tk1 = r1.desks.find(d => d.flightNumber === 'TK1')!;
    expect(tk1.resources).toEqual(['10', '11', '12']);
    expect(tk1.waitNotes.join(' ')).toContain('LY1');
    expect(tk1.openAt).toBe(13 * 60 + 31);
    const r2 = run([a, okFlight], { openLeadByIata: { LY: 180, default: 120 } });
    expect(r2.desks.find(d => d.flightNumber === 'TK2')!.resources).toEqual(['10', '11', '12']);
  });

  it('ručno dodijeljeni šalteri se ne diraju, a let sa dodjelom se preskače', () => {
    const r = run(
      [
        fl({ FlightNumber: 'LY1', ScheduledDepartureTime: '14:00' }),
        fl({ FlightNumber: 'TK1', ScheduledDepartureTime: '14:00' }),
      ],
      { currentDesks: { '10': 'LY1', '11': 'LY1', '12': 'LY1' } },
    );
    expect(r.desks.map(d => d.flightNumber)).toEqual(['TK1']);
    expect(r.desks[0].resources).not.toContain('10');
  });

  it('otkazani i poletjeli letovi se ne predlažu', () => {
    const r = run([
      fl({ FlightNumber: 'LY1', ScheduledDepartureTime: '14:00', StatusEN: 'Cancelled' }),
      fl({ FlightNumber: 'LY2', ScheduledDepartureTime: '14:00', StatusEN: 'Departed' }),
    ]);
    expect(r.desks).toEqual([]);
    expect(r.gates).toEqual([]);
  });

  it('kašnjenje (procijenjeno vrijeme) produžava zauzeće', () => {
    const r = run([fl({ FlightNumber: 'LY1', ScheduledDepartureTime: '14:00', EstimatedDepartureTime: '14:40' })]);
    expect(r.desks[0].closeAt).toBe(14 * 60 + 40 - 30);
    expect(r.desks[0].std).toBe('14:00');
  });

  it('let poslije ponoći dok je sad prije ponoći ostaje poslije ostalih', () => {
    const r = run([fl({ FlightNumber: 'LY1', ScheduledDepartureTime: '00:30' })], { nowMin: 23 * 60 });
    expect(r.desks[0].closeAt).toBe(24 * 60 + 30 - 30); // 00:30 sljedećeg dana = 1470 min
    expect(r.desks[0].std).toBe('00:30');
  });

  it('upozorava kad nema dovoljno slobodnih šaltera', () => {
    const busy: Record<string, string> = {};
    // Zauzmi SVE šaltere nekim dugim letom.
    for (const id of ['1','2','3','4','5','6','7','8','9','10','11','12','21','22','23','24','25','26']) busy[id] = 'OTHER';
    // Zauzmi ih letom koji je takođe u listi (isti termin) — dodjela je zaključana.
    const r = run(
      [fl({ FlightNumber: 'LY1', ScheduledDepartureTime: '14:00' }), fl({ FlightNumber: 'OTHER', ScheduledDepartureTime: '14:00' })],
      { currentDesks: busy },
    );
    expect(r.desks).toHaveLength(1); // OTHER već ima dodjelu → preskočen
    expect(r.desks[0].flightNumber).toBe('LY1');
    expect(r.desks[0].resources).toEqual([]);
    expect(r.desks[0].warnings.length).toBeGreaterThan(0);
  });
});

describe('gate-ovi', () => {
  it('Sundor/Turkish/easyJet/Norwegian na 5,6; Air Serbia/Air Montenegro na 2,3,4', () => {
    const r = run([
      fl({ FlightNumber: 'LY1', ScheduledDepartureTime: '10:00' }),
      fl({ FlightNumber: 'JU1', ScheduledDepartureTime: '10:00' }),
      fl({ FlightNumber: '4O1', ScheduledDepartureTime: '10:00' }),
    ]);
    const g = Object.fromEntries(r.gates.map(x => [x.flightNumber, x.resources[0]]));
    expect(['5', '6']).toContain(g['LY1']);
    expect(['2', '3', '4']).toContain(g['JU1']);
    expect(['2', '3', '4']).toContain(g['4O1']);
    expect(g['JU1']).not.toBe(g['4O1']);
  });

  it('kad su 5 i 6 zauzeti, predlaže najbliži slobodan uz upozorenje', () => {
    const r = run(
      [
        fl({ FlightNumber: 'LY1', ScheduledDepartureTime: '10:00' }),
        fl({ FlightNumber: 'X1', ScheduledDepartureTime: '10:00' }),
        fl({ FlightNumber: 'X2', ScheduledDepartureTime: '10:00' }),
      ],
      { currentGates: { '5': 'X1', '6': 'X2' } },
    );
    r.gates = r.gates.filter(g => g.flightNumber === 'LY1');
    expect(r.gates[0].resources).toHaveLength(1);
    expect(r.gates[0].warnings.some(w => w.includes('nisu slobodni'))).toBe(true);
  });
});

describe('vrijeme', () => {
  it('parsira i formatira', () => {
    expect(parseClockMinutes('08:05')).toBe(485);
    expect(parseClockMinutes('--:--')).toBeNull();
    expect(formatClockMinutes(1500)).toBe('01:00');
  });
});

describe('ljetna sezona (1.6.–1.10.) — Sundor/El Al/Israir u T2', () => {
  const flights = [
    fl({ FlightNumber: 'LY5111', ScheduledDepartureTime: '14:00' }),
    fl({ FlightNumber: '6H123', ScheduledDepartureTime: '18:00' }),
    fl({ FlightNumber: 'TK1085', ScheduledDepartureTime: '16:00' }),
  ];
  it('ljeti: Sundor/El Al/Israir na šalterima 21–23 i gate-ovima T2; Turkish ostaje u T1', () => {
    const r = run(flights, { summer: true });
    const d = Object.fromEntries(r.desks.map(x => [x.flightNumber, x.resources]));
    expect(d['LY5111']).toEqual(['21', '22', '23']);
    expect(d['6H123']).toEqual(['21', '22', '23']); // 18:00 — nakon što se LY5111 zatvori
    expect(d['TK1085']).toEqual(['10', '11', '12']);
    const g = Object.fromEntries(r.gates.map(x => [x.flightNumber, Number(x.resources[0])]));
    expect(g['LY5111']).toBeGreaterThanOrEqual(21);
    expect(g['TK1085']).toBeLessThanOrEqual(6);
  });
  it('van sezone: ostaju T1 profili (10–12, gate 5/6)', () => {
    const r = run(flights, { summer: false });
    expect(r.desks.find(x => x.flightNumber === 'LY5111')!.resources).toEqual(['10', '11', '12']);
  });
});

describe('British Airways', () => {
  it('uvijek 3 susjedna šaltera u rasponu 7–12', () => {
    const r = run([fl({ FlightNumber: 'BA1234', ScheduledDepartureTime: '13:00' })]);
    expect(r.desks[0].resources).toHaveLength(3);
    const nums = r.desks[0].resources.map(Number);
    expect(Math.min(...nums)).toBeGreaterThanOrEqual(7);
    expect(Math.max(...nums)).toBeLessThanOrEqual(12);
    expect(nums[2] - nums[0]).toBe(2); // susjedni
  });
  it('kad je dio raspona zauzet, bira slobodan susjedni blok', () => {
    const r = run(
      [fl({ FlightNumber: 'BA1', ScheduledDepartureTime: '13:00' }), fl({ FlightNumber: 'X1', ScheduledDepartureTime: '13:00' })],
      { currentDesks: { '7': 'X1', '8': 'X1' } },
    );
    const ba = r.desks.find(d => d.flightNumber === 'BA1')!;
    expect(ba.resources.map(Number)).toEqual([9, 10, 11]);
  });
});

describe('naučeni šabloni', () => {
  const raw = (scope: string, counts: Record<string, number>) =>
    Object.fromEntries(Object.entries(counts).map(([id, n]) => [fieldOf(scope, id), String(n)]));

  it('naučeno po kompaniji pregazi ručni profil kad ima dovoljno uzoraka', () => {
    const learned = parseLearned(raw(scopeResource('desk', 'A', 'JU', 'W'), { '8': 10, '9': 9 }));
    const r = run([fl({ FlightNumber: 'JU681', ScheduledDepartureTime: '15:00' })], { learned });
    expect(r.desks[0].resources).toEqual(['8', '9']);
    expect(r.desks[0].reason).toContain('naučeno');
  });

  it('premalo uzoraka → ostaje ručni profil', () => {
    const learned = parseLearned(raw(scopeResource('desk', 'A', 'JU', 'W'), { '8': 1, '9': 1 }));
    const r = run([fl({ FlightNumber: 'JU681', ScheduledDepartureTime: '15:00' })], { learned });
    expect(r.desks[0].resources).toEqual(['4', '5']);
  });

  it('naučeni broj šaltera (3) za kompaniju', () => {
    const learned = parseLearned(raw(scopeCount('A', 'JU', 'W'), { '1': 10, '2': 10, '3': 9 }));
    const r = run([fl({ FlightNumber: 'JU681', ScheduledDepartureTime: '15:00' })], { learned });
    expect(r.desks[0].resources).toHaveLength(3);
  });

  it('naučeno po letu (1 šalter) pregazi naučeno po kompaniji', () => {
    const learned = parseLearned({
      ...raw(scopeCount('A', 'JU', 'W'), { '1': 10, '2': 10 }),
      ...raw(scopeCount('F', 'JU655', 'W'), { '1': 5 }),
    });
    const r = run([fl({ FlightNumber: 'JU655', ScheduledDepartureTime: '15:00' })], { learned });
    expect(r.desks[0].resources).toHaveLength(1);
  });

  it('ljetno učenje se ne primjenjuje zimi', () => {
    const learned = parseLearned(raw(scopeResource('desk', 'A', 'JU', 'S'), { '8': 10, '9': 9 }));
    const r = run([fl({ FlightNumber: 'JU681', ScheduledDepartureTime: '15:00' })], { learned, summer: false });
    expect(r.desks[0].resources).toEqual(['4', '5']);
  });

  it('naučeni gate', () => {
    const learned = parseLearned(raw(scopeResource('gate', 'A', 'FR', 'W'), { '23': 8 }));
    const r = run([fl({ FlightNumber: 'FR100', ScheduledDepartureTime: '15:00' })], { learned });
    expect(r.gates[0].resources).toEqual(['23']);
  });
});

// ── v2: dan u sedmici, naučena zamjena, ograničenja ─────────────────────
import { fieldOf as fOf, scopeFallback as scFb } from './assignment-learning';
import { sanitizeConstraints } from './suggestion-constraints';

describe('v2: dan, zamjena, ograničenja', () => {
  const LYF = fl({ FlightNumber: 'LY5111', ScheduledDepartureTime: '14:00' });

  it('izvor i bazen su vraćeni uz prijedlog', () => {
    const r = run([LYF]);
    expect(r.desks[0].source).toBe('profile');
    expect(r.desks[0].pool.length).toBeGreaterThan(0);
    expect(run([fl({ FlightNumber: 'FR100', ScheduledDepartureTime: '14:00' })]).desks[0].source).toBe('default');
  });

  it('naučeni šablon po danu ima prednost kad se dan poklapa', () => {
    const learned = parseLearned({
      [fOf(scopeResource('desk', 'F', 'LY5111', 'W'), '10')]: '5',
      [fOf(scopeResource('desk', 'F', 'LY5111', 'W', 0), '3')]: '3',
    });
    expect(run([LYF], { learned, dow: 0 }).desks[0].resources).toContain('3');
    expect(run([LYF], { learned, dow: 0 }).desks[0].reason).toContain('po letu i danu');
    expect(run([LYF], { learned, dow: 2 }).desks[0].resources).not.toContain('3');
  });

  it('naučena zamjena: kad su 4,5,6 zauzeti, nudi naučene 1,2 (susjedni blok), a ne najbliže', () => {
    const f = fl({ FlightNumber: 'JU681', ScheduledDepartureTime: '14:00' });
    const learned = parseLearned({
      [fOf(scFb('desk', 'JU', 'W'), '4>1')]: '3',
      [fOf(scFb('desk', 'JU', 'W'), '5>2')]: '3',
    });
    const holder = fl({ FlightNumber: 'XX100', ScheduledDepartureTime: '14:00' });
    const busyDesks = { '4': 'XX100', '5': 'XX100', '6': 'XX100' } as Record<string, string>;
    const withFb = run([f, holder], { currentDesks: busyDesks, learned });
    const without = run([f, holder], { currentDesks: busyDesks });
    expect(withFb.desks[0].resources).toEqual(['1', '2']);
    expect(without.desks[0].resources).not.toContain('1');
  });

  it('ograničenje "ne radi": blokirani šalter se preskače, uz vremenski prozor samo u tom prozoru', () => {
    const c = sanitizeConstraints({ blocked: [{ type: 'desk', id: '10' }] });
    const r = run([LYF], { constraints: c });
    expect(r.desks[0].resources).not.toContain('10');
    // prozor do 08:30 — let se otvara kasnije (14:00-120) pa blokada ne smeta
    const early = sanitizeConstraints({ blocked: [{ type: 'desk', id: '10', to: '08:30' }] });
    expect(run([LYF], { constraints: early }).desks[0].resources).toContain('10');
  });

  it('ograničenje "pin" i "broj šaltera"', () => {
    const c = sanitizeConstraints({
      pins: [{ type: 'desk', flight: 'LY5111', resources: ['1', '2'] }],
      counts: [{ flight: 'LY5111', count: 2 }],
    }, ['LY5111']);
    const r = run([LYF], { constraints: c });
    expect(r.desks[0].resources).toEqual(['1', '2']);
    expect(r.desks[0].source).toBe('note');
  });

  it('pin na zauzet šalter daje upozorenje i ostatak popunjava običnim postupkom', () => {
    const c = sanitizeConstraints({ pins: [{ type: 'desk', flight: 'LY5111', resources: ['1'] }], counts: [{ flight: 'LY5111', count: 2 }] });
    const holder = fl({ FlightNumber: 'XX100', ScheduledDepartureTime: '14:00' });
    const r = run([LYF, holder], { constraints: c, currentDesks: { '1': 'XX100' } });
    expect(r.desks[0].warnings.join(' ')).toContain('Traženi');
    expect(r.desks[0].resources).toHaveLength(2);
    expect(r.desks[0].resources).not.toContain('1');
  });
});

describe('v2: završeni letovi se ne nude', () => {
  it('check-in završen po rasporedu (STD−30) → nema prijedloga za šalter, čak i ako let kasni', () => {
    const late = fl({ FlightNumber: 'LY5111', ScheduledDepartureTime: '07:40', EstimatedDepartureTime: '10:30' }); // NOW=08:00
    const r = run([late]);
    expect(r.desks).toEqual([]);
    expect(r.gates).toHaveLength(1); // kasni → gate još treba
  });
  it('let koji je već otišao nema ni gate prijedlog; budući let ostaje', () => {
    const gone = fl({ FlightNumber: 'LY5111', ScheduledDepartureTime: '07:00' });
    const ok = fl({ FlightNumber: 'TK1085', ScheduledDepartureTime: '09:30' });
    const r = run([gone, ok]);
    expect(r.desks.map(d => d.flightNumber)).toEqual(['TK1085']);
    expect(r.gates.map(g => g.flightNumber)).toEqual(['TK1085']);
  });
});

describe('v2: svi šalteri leta u istom terminalu', () => {
  const holder = (n: string) => fl({ FlightNumber: n, ScheduledDepartureTime: '14:00' });
  const T1_OF = (id: string) => Number(id) < 20;

  it('nikad ne miješa T1 i T2 (npr. 7 + 21) kad T1 nema dovoljno slobodnih', () => {
    // 3 šaltera traži BA; zauzmi sve T1 osim 7 i 8. Zimi (T2 obično ne radi): 7,8 u T1 (makar 2 umjesto 3).
    // Kad osoblje javi "T2 radi": cijeli T2 (3 u nizu), nikad 7+8+21.
    const busy: Record<string, string> = {};
    ['1','2','3','4','5','6','9','10','11','12'].forEach(d => { busy[d] = 'XX100'; });
    const ba = fl({ FlightNumber: 'BA1234', ScheduledDepartureTime: '14:00' });
    const r = run([ba, holder('XX100')], { currentDesks: busy });
    const d = r.desks.find(x => x.flightNumber === 'BA1234')!;
    expect(d.resources).toEqual(['7', '8']);
    const t2 = run([ba, holder('XX100')], { currentDesks: busy, constraints: { blocked: [], pins: [], counts: [], t2: true } });
    const d2 = t2.desks.find(x => x.flightNumber === 'BA1234')!;
    expect(d2.resources).toHaveLength(3);
    expect(new Set(d2.resources.map(T1_OF)).size).toBe(1);
  });

  it('kad T1 ne može dati sve, a T2 može — cijeli let ide u T2; kad nijedan ne može — manje šaltera + upozorenje, ne miješanje', () => {
    const busyAllButTwo: Record<string, string> = {};
    ['1','2','3','4','5','6','9','10','11','12','22','23','24','25','26'].forEach(d => { busyAllButTwo[d] = 'XX100'; });
    // slobodni: 7, 8 (T1) i 21 (T2) → nijedan terminal nema 3
    const r = run([fl({ FlightNumber: 'LY5111', ScheduledDepartureTime: '14:00' }), holder('XX100')], { currentDesks: busyAllButTwo });
    const d = r.desks.find(x => x.flightNumber === 'LY5111')!;
    expect(new Set(d.resources.map(T1_OF)).size).toBeLessThanOrEqual(1);
    expect(d.warnings.join(' ')).toContain('Nema dovoljno');
  });

  it('naučena zamjena preko terminala se ignoriše', () => {
    const f = fl({ FlightNumber: 'JU681', ScheduledDepartureTime: '14:00' });
    const learned = parseLearned({ [fOf(scFb('desk', 'JU', 'W'), '4>21')]: '5' });
    const busy = { '4': 'XX100', '5': 'XX100' } as Record<string, string>;
    const r = run([f, holder('XX100')], { currentDesks: busy, learned });
    expect(r.desks.find(x => x.flightNumber === 'JU681')!.resources.every(T1_OF)).toBe(true);
  });
});

describe('v2: šalteri su uvijek susjedni (bez rupa)', () => {
  const holder = fl({ FlightNumber: 'XX100', ScheduledDepartureTime: '14:00' });
  it('WK415: slobodni 1,6,7,8 → 6,7 (ne 1,6)', () => {
    const busy: Record<string, string> = {};
    ['2','3','4','5','9','10','11','12'].forEach(d => { busy[d] = 'XX100'; });
    const r = run([fl({ FlightNumber: 'WK415', ScheduledDepartureTime: '14:00' }), holder], { currentDesks: busy });
    expect(r.desks.find(d => d.flightNumber === 'WK415')!.resources).toEqual(['6', '7']);
  });
  it('bazen sa rupom (4,6 slobodni uz 5 zauzet) ne daje 4,6 ako postoji susjedni blok', () => {
    const f = fl({ FlightNumber: 'JU681', ScheduledDepartureTime: '14:00' });
    const r = run([f, holder], { currentDesks: { '5': 'XX100' } });
    const res = r.desks.find(d => d.flightNumber === 'JU681')!.resources.map(Number);
    expect(res[1] - res[0]).toBe(1);
  });
  it('3 šaltera: uvijek 3 uzastopna kad postoje (2,3,4 a ne 2,3,5)', () => {
    const busy = { '1': 'XX100', '5': 'XX100', '6': 'XX100', '7': 'XX100', '8': 'XX100', '9': 'XX100', '10': 'XX100', '11': 'XX100', '12': 'XX100' };
    const r = run([fl({ FlightNumber: 'U28812', ScheduledDepartureTime: '14:00' }), holder], { currentDesks: busy });
    expect(r.desks.find(d => d.flightNumber === 'U28812')!.resources).toEqual(['2', '3', '4']);
  });
});

describe('v2: "po zatvaranju" — zauzeti šalteri koji se uskoro zatvaraju', () => {
  // NOW=08:00. XX100 (STD 08:55) drži 1,2,3 i zatvara se u 08:25 (+1 min pauze = 08:26).
  const occupant = fl({ FlightNumber: 'XX100', ScheduledDepartureTime: '08:55' });
  const ez = fl({ FlightNumber: 'U28812', ScheduledDepartureTime: '10:00' }); // easyJet, bazen 1–4, otvara 08:00

  it('nudi uobičajene šaltere koji se uskoro oslobađaju, sa porukom "po zatvaranju"', () => {
    const r = run([occupant, ez], { currentDesks: { '1': 'XX100', '2': 'XX100', '3': 'XX100' } });
    const d = r.desks.find(x => x.flightNumber === 'U28812')!;
    expect(d.resources.every(id => ['1', '2', '3', '4'].includes(id))).toBe(true);
    expect(d.waitNotes.length).toBeGreaterThan(0);
    expect(d.waitNotes[0]).toContain('XX100');
    expect(d.waitNotes[0]).toContain('po zatvaranju');
    expect(d.waitingUntil).toBe(8 * 60 + 26);
    expect(d.openAt).toBe(8 * 60 + 26);
  });

  it('ako se zauzeti šalteri zatvaraju tek za >30 min, ne čeka se — nudi se slobodan blok', () => {
    const late = fl({ FlightNumber: 'XX100', ScheduledDepartureTime: '09:30' }); // zatvara 09:00
    const r = run([late, ez], { currentDesks: { '1': 'XX100', '2': 'XX100', '3': 'XX100' } });
    const d = r.desks.find(x => x.flightNumber === 'U28812')!;
    expect(d.waitNotes).toEqual([]);
    expect(d.resources).not.toContain('1');
  });

  it('slobodni šalteri iz bazena imaju prednost nad onima koji čekaju (isti bazen)', () => {
    const r = run([occupant, ez], { currentDesks: { '1': 'XX100' } });
    const d = r.desks.find(x => x.flightNumber === 'U28812')!;
    expect(d.resources).toEqual(['2', '3', '4']);
    expect(d.waitNotes).toEqual([]);
  });

  it('ručno blokiran ("ne radi") šalter se nikad ne nudi uz čekanje', () => {
    const c = sanitizeConstraints({ blocked: [{ type: 'desk', id: '1' }] });
    const r = run([ez], { constraints: c });
    expect(r.desks[0].resources).not.toContain('1');
    expect(r.desks[0].waitNotes).toEqual([]);
  });
});

describe('v3: naučeni model utiče na prijedlog (samo kad je aktivan)', () => {
  const f = fl({ FlightNumber: 'JU681', ScheduledDepartureTime: '14:00' });
  it('bez modela: uobičajeni izbor; sa modelom: šalteri koje model favorizuje, source=model', () => {
    const base = run([f], { dow: 2 });
    const favored = (ctx: { flight: string }) => {
      void ctx;
      const o: Record<string, number> = {};
      for (let i = 1; i <= 12; i++) o[String(i)] = i === 9 || i === 10 ? 0.4 : 0.01;
      return o;
    };
    const m = run([f], { dow: 2, model: { desk: favored } });
    const d = m.desks.find(x => x.flightNumber === 'JU681')!;
    expect(d.resources).toEqual(['9', '10']);
    expect(d.source).toBe('model');
    expect(base.desks.find(x => x.flightNumber === 'JU681')!.source).not.toBe('model');
  });
  it('model ne smije predložiti zauzet šalter ni miješati terminale', () => {
    const holder = fl({ FlightNumber: 'XX100', ScheduledDepartureTime: '14:00' });
    const o: Record<string, number> = { '9': 0.5, '10': 0.4, '21': 0.45 };
    const m = run([f, holder], { dow: 2, currentDesks: { '9': 'XX100' }, model: { desk: () => o } });
    const res = m.desks.find(x => x.flightNumber === 'JU681')!.resources;
    expect(res).not.toContain('9');
    expect(new Set(res.map(r => (Number(r) >= 21 ? 'T2' : 'T1'))).size).toBe(1);
  });
});

describe('v4: planiranje redoslijeda (optimizeOrder)', () => {
  const mk = (flightNumber: string) => ({ flightNumber } as unknown as import('./assignment-suggestions').Suggestion);
  it('prihvata zamjenu samo ako strogo smanjuje cijenu i vraća izvorni (vremenski) redoslijed', async () => {
    const { optimizeOrder } = await import('./assignment-suggestions');
    // Cijena: 0 samo ako B ide PRIJE A; inače 1000.
    const plan = (order: string[]) => ({
      items: order.map(mk),
      cost: order.indexOf('B') < order.indexOf('A') ? 0 : 1000,
    });
    const out = optimizeOrder(['A', 'B', 'C'], plan, x => x);
    expect(out.map(s => s.flightNumber)).toEqual(['A', 'B', 'C']); // prikaz ostaje po vremenu
    let evals = 0;
    const counting = (order: string[]) => { evals++; return plan(order); };
    optimizeOrder(['A', 'B', 'C'], counting, x => x);
    expect(evals).toBeGreaterThan(1);
    expect(evals).toBeLessThanOrEqual(80);
  });
  it('ako je plan već savršen (cijena 0) ne traži dalje', async () => {
    const { optimizeOrder } = await import('./assignment-suggestions');
    let evals = 0;
    optimizeOrder(['A', 'B'], o => { evals++; return { items: o.map(mk), cost: 0 }; }, x => x);
    expect(evals).toBe(1);
  });
});

describe('v6: faza alternativnih resursa (zabrane) u optimizeOrder', () => {
  type S = import('./assignment-suggestions').Suggestion;
  const mk = (flightNumber: string, resources: string[], wanted = 1) =>
    ({ flightNumber, resources, wanted, reason: 'osnovni razlog' } as unknown as S);
  // A pohlepno uzme X (jedini koji B može); ako je X zabranjen A uzme Y i B dobije X. Cijena: A:Y=+5, B bez X = 100.
  const fakePlan = (_order: string[], bans?: Map<string, Set<string>>) => {
    const a = bans?.get('A')?.has('X') ? 'Y' : 'X';
    const b = a === 'X' ? [] : ['X'];
    return { items: [mk('A', [a]), mk('B', b)], cost: (a === 'Y' ? 5 : 0) + (b.length ? 0 : 100) };
  };
  const cost = (x: S) => (x.flightNumber === 'A' ? (x.resources[0] === 'Y' ? 5 : 0) : x.resources.length ? 0 : 100);

  it('zabrana se prihvata kad ukupna cijena padne, i razlog imenuje let kojem je pomogla', async () => {
    const { optimizeOrder } = await import('./assignment-suggestions');
    const out = optimizeOrder(['A', 'B'], fakePlan, x => x, cost);
    expect(out.find(s => s.flightNumber === 'A')!.resources).toEqual(['Y']);
    expect(out.find(s => s.flightNumber === 'B')!.resources).toEqual(['X']);
    const reason = out.find(s => s.flightNumber === 'A')!.reason;
    expect(reason).toContain('osnovni razlog');
    expect(reason).toMatch(/izbjegnuto X da B dobije bolji izbor \(ukupna ocjena plana −95\)/);
  });

  it('bez itemCost faza alternativa se ne pokreće (stari ugovor)', async () => {
    const { optimizeOrder } = await import('./assignment-suggestions');
    const out = optimizeOrder(['A', 'B'], fakePlan, x => x);
    expect(out.find(s => s.flightNumber === 'A')!.resources).toEqual(['X']);
  });

  it('zabrana koja povećava manjak resursa se odbija iako zbir bodova pada', async () => {
    const { optimizeOrder } = await import('./assignment-suggestions');
    // Zabrana A:X daje A prazan (manjak +1) ali "jeftiniji" zbir (npr. pogrešno nisko ocijenjen) → mora biti odbijena.
    const plan = (_o: string[], bans?: Map<string, Set<string>>) => {
      const banned = bans?.get('A')?.has('X');
      return { items: [mk('A', banned ? [] : ['X']), mk('B', ['Z'])], cost: banned ? 10 : 200 };
    };
    const out = optimizeOrder(['A', 'B'], plan, x => x, () => 0);
    expect(out.find(s => s.flightNumber === 'A')!.resources).toEqual(['X']);
  });

  it('ograničen broj probnih planova i na velikom danu (vrijeme)', async () => {
    const { computeAssignmentSuggestions } = await import('./assignment-suggestions');
    const flights = Array.from({ length: 40 }, (_, i) =>
      fl({ FlightNumber: `JU${100 + i}`, ScheduledDepartureTime: `${String(8 + Math.floor(i / 4)).padStart(2, '0')}:${String((i % 4) * 15).padStart(2, '0')}` }));
    const t0 = performance.now();
    const r = computeAssignmentSuggestions({ flights, currentDesks: {}, currentGates: {}, nowMin: 360 });
    expect(performance.now() - t0).toBeLessThan(3000);
    expect(r.desks.length).toBe(40);
  });
});

describe('v5: upozorenja imenuju tačno ono što je zauzeto + plan bez rupa/drugog terminala', () => {
  const mkf = (fn: string, t: string, air = 'X') => fl({ FlightNumber: fn, AirlineName: air, ScheduledDepartureTime: t });
  it('upozorenje ne tvrdi da je cijeli bazen zauzet: navodi samo zauzete i ko ih drži', () => {
    // LY (bazen 10,11,12) — 12 blokiran napomenom, 10 i 11 slobodni → poruka pominje samo 12.
    const r = run([mkf('LY5111', '10:20', 'El Al')], {
      constraints: { blocked: [{ type: 'desk', id: '12' }], pins: [], counts: [] },
    });
    const d = r.desks[0];
    const msg = d.warnings.join(' ');
    if (msg) {
      expect(msg).toContain('12');
      expect(msg).toContain('ne radi');
      expect(msg).not.toMatch(/\b10\b.*zauzet/);
    }
  });
  it('upozorenje navodi let koji drži šalter', () => {
    const holder = mkf('XX100', '14:00');
    const r = run([mkf('U28812', '10:00', 'easyJet'), holder], { currentDesks: { '1': 'XX100', '2': 'XX100', '3': 'XX100', '4': 'XX100' } });
    const d = r.desks.find(x => x.flightNumber === 'U28812')!;
    expect(d.warnings.join(' ')).toContain('XX100');
  });
  it('pretraga redoslijeda ne šalje let u drugi terminal niti pravi rupe kad to nije potrebno', () => {
    const list = [
      mkf('WK415', '09:40', 'Edelweiss'), mkf('U28812', '10:00', 'easyJet'), mkf('LY5111', '10:20', 'El Al'),
      mkf('TK1062', '10:45', 'Turkish Airlines'), mkf('BA2631', '11:15', 'British Airways'),
    ];
    const r = run(list, { dow: 0, currentDesks: { '1': 'JU680', '2': 'JU680', '3': 'JU680' }, constraints: { blocked: [{ type: 'desk', id: '12', fromMin: 0, toMin: 840 }], pins: [], counts: [] } });
    for (const d of r.desks) {
      const nums = d.resources.map(Number);
      expect(new Set(nums.map(n => (n >= 20 ? 'T2' : 'T1'))).size).toBe(1);
      expect(Math.max(...nums) - Math.min(...nums)).toBe(nums.length - 1); // bez rupa
    }
  });
});

describe('v5: vrijeme otvaranja iz settings.ini ([checkin])', () => {
  it('koristi minute po kompaniji, pa prefiks broja leta, pa default', () => {
    const f = (fn: string, code?: string) => fl({ FlightNumber: fn, AirlineCode: code, ScheduledDepartureTime: '14:00' });
    const open = (fn: string, code?: string) =>
      run([f(fn, code)], { openLeadByIata: { LY: 180, BA: 150, default: 120 } }).desks[0].openAt;
    expect(open('LY5111', 'LY')).toBe(14 * 60 - 180);
    expect(open('BA2631', 'BAW')).toBe(14 * 60 - 150); // AirlineCode troslovni → prefiks leta
    expect(open('XX100', 'XX')).toBe(14 * 60 - 120);   // nepoznata kompanija → default
  });
});

describe('v6: zimi prvenstveno T1, gate u istom terminalu kao šalteri', () => {
  const f = (fn: string, t: string, air = 'X') => fl({ FlightNumber: fn, AirlineName: air, ScheduledDepartureTime: t });
  it('zimi opšti let ide u T1 čak i kad optimizacija "štedi" na drugim letovima', () => {
    const list = ['A1', 'B2', 'C3', 'D4', 'E5', 'F6'].map((n, i) => f(`${n}10${i}`, `1${i}:00`));
    const r = run(list, { summer: false });
    for (const d of r.desks) expect(d.resources.every(id => Number(id) <= 12)).toBe(true);
    for (const g of r.gates) expect(g.resources.every(id => Number(id) <= 6)).toBe(true);
  });
  it('T2 se koristi kad T1 ne može (svih 12 šaltera zauzeto)', () => {
    const holder = f('XX100', '16:00');
    const busy: Record<string, string> = {};
    for (let i = 1; i <= 12; i++) busy[String(i)] = 'XX100';
    const r = run([f('YY200', '14:00'), holder], { currentDesks: busy });
    const d = r.desks.find(x => x.flightNumber === 'YY200')!;
    expect(d.resources.length).toBeGreaterThan(0);
    expect(d.resources.every(id => Number(id) >= 21)).toBe(true);
  });
  it('gate prati terminal šaltera: šalteri u T2 → gate u T2; T1 → gate u T1', () => {
    const holder = f('XX100', '16:00');
    const busy: Record<string, string> = {};
    for (let i = 1; i <= 12; i++) busy[String(i)] = 'XX100';
    const t2 = run([f('YY200', '14:00'), holder], { currentDesks: busy });
    expect(t2.gates.find(g => g.flightNumber === 'YY200')!.resources.every(id => Number(id) >= 21)).toBe(true);
    const t1 = run([f('YY200', '14:00')]);
    expect(t1.gates[0].resources.every(id => Number(id) <= 6)).toBe(true);
  });
  it('napomena "T2 radi" ukida zimsko pravilo (T2 se smije birati)', () => {
    const c = sanitizeConstraints({ t2: true });
    expect(c.t2).toBe(true);
  });
  it('ljeti pravilo ne važi: Sundor/El Al i dalje u T2', () => {
    const r = run([fl({ FlightNumber: 'LY5111', ScheduledDepartureTime: '14:00' })], { summer: true });
    expect(r.desks[0].resources.every(id => Number(id) >= 21)).toBe(true);
  });
});


describe('v7: samo uzastopni šalteri; easyJet standardno 2', () => {
  const f = (fn: string, t: string, air = 'X') => fl({ FlightNumber: fn, AirlineName: air, ScheduledDepartureTime: t });
  const holder = f('XX100', '16:00');
  const consecutive = (ids: string[]) => {
    const n = ids.map(Number).sort((a, b) => a - b);
    return n.every((v, i) => i === 0 || v === n[i - 1] + 1);
  };

  it('LY5468: slobodni su samo 1, 4 i 12 → ne predlaže 1,4,12 nego jedan šalter', () => {
    const busy: Record<string, string> = {};
    ['2', '3', '5', '6', '7', '8', '9', '10', '11'].forEach(d => { busy[d] = 'XX100'; });
    // T2 blokiran (zimi ionako nije u upotrebi), T1 ima samo 1, 4, 12 slobodno
    const blocked = ['21', '22', '23', '24', '25', '26'].map(id => ({ type: 'desk' as const, id }));
    const r = run([f('LY5468', '14:00', 'El Al'), holder], { currentDesks: busy, constraints: { blocked, pins: [], counts: [] } });
    const d = r.desks.find(x => x.flightNumber === 'LY5468')!;
    expect(consecutive(d.resources)).toBe(true);
    expect(d.resources.length).toBe(1);
    expect(d.warnings.join(' ')).toContain('Nema dovoljno');
  });

  it('nema 3 uzastopna ali ima 2 → daje 2 (makar 2 umjesto 3)', () => {
    const busy: Record<string, string> = {};
    ['1', '2', '3', '5', '6', '9', '10', '11', '12'].forEach(d => { busy[d] = 'XX100'; });
    const blocked = ['21', '22', '23', '24', '25', '26'].map(id => ({ type: 'desk' as const, id }));
    const r = run([f('LY5468', '14:00', 'El Al'), holder], { currentDesks: busy, constraints: { blocked, pins: [], counts: [] } });
    const d = r.desks.find(x => x.flightNumber === 'LY5468')!;
    expect(d.resources).toEqual(['7', '8']); // slobodni 4, 7, 8 → jedini uzastopni par
  });

  it('svi prijedlozi u većem rasporedu su uzastopni brojevi', () => {
    const list = ['LY5468', 'TK1062', 'BA2631', 'U28812', 'JU680', 'WK415', '4O201'].map((n, i) => f(n, `${10 + i}:30`, n.slice(0, 2)));
    const r = run(list, { dow: 1 });
    for (const d of r.desks) expect(consecutive(d.resources)).toBe(true);
  });

  it('easyJet je standardno na 2 šaltera kad je gužva, a na 3 kad ima dosta slobodnih', () => {
    const quiet = run([f('U28812', '10:00', 'easyJet')]);
    expect(quiet.desks[0].resources).toHaveLength(3);
    // gužva: sedam drugih letova istovremeno (default 2 šaltera svaki) → easyJet ostaje na 2
    const busyList = [f('U28812', '10:00', 'easyJet'), ...['AA1', 'BB2', 'CC3', 'DD4'].map((n, i) => f(`${n}0${i}`, '10:05'))];
    const crowded = run(busyList);
    expect(crowded.desks.find(d => d.flightNumber === 'U28812')!.resources).toHaveLength(2);
  });

  it('naučen/ručno zadan broj šaltera za easyJet se ne mijenja pravilom', () => {
    const r = run([f('U28812', '10:00', 'easyJet')], { constraints: { blocked: [], pins: [], counts: [{ flight: 'U28812', count: 2 }] } });
    expect(r.desks[0].resources).toHaveLength(2);
  });
});


describe('parseClockMinutes — regresija (obje grupe regexa)', () => {
  it('vraća prave minute, nikad NaN', () => {
    expect(parseClockMinutes('09:30')).toBe(570);
    expect(parseClockMinutes(' 9.05 ')).toBe(545);
    expect(parseClockMinutes('00:00')).toBe(0);
    expect(parseClockMinutes('23:59')).toBe(1439);
    expect(parseClockMinutes('24:00')).toBeNull();
    expect(parseClockMinutes('12:60')).toBeNull();
    for (const v of ['09:30', '14:05', '00:01', '23:59']) expect(Number.isNaN(parseClockMinutes(v))).toBe(false);
  });
});

describe('resolveWantedGateTerminal — bazen sa više terminala', () => {
  it('bazen 5,6,21 i traženi T2 → ostaje T2 (21 je u T2)', () => {
    expect(resolveWantedGateTerminal('T2', ['5', '6', '21'])).toBe('T2');
  });
  it('bazen samo T1 i traženi T2 → napušta se (navika osoblja)', () => {
    expect(resolveWantedGateTerminal('T2', ['5', '6'])).toBeUndefined();
  });
  it('prazan bazen / nema traženog terminala → bez promjene', () => {
    expect(resolveWantedGateTerminal('T2', [])).toBe('T2');
    expect(resolveWantedGateTerminal(undefined, ['5'])).toBeUndefined();
  });
});

describe('model + upozorenje "uobičajeni šalteri nisu slobodni"', () => {
  const f = fl({ FlightNumber: 'JU681', ScheduledDepartureTime: '14:00' });
  const favored = () => { const o: Record<string, number> = {}; for (let i = 1; i <= 12; i++) o[String(i)] = i === 9 || i === 10 ? 0.4 : 0.01; return o; };
  it('uobičajeni 4,5 zauzeti, model bira 9,10 van bazena → upozorenje se PRIKAZUJE', () => {
    const holder = fl({ FlightNumber: 'XX100', ScheduledDepartureTime: '14:00' });
    const r = run([f, holder], { dow: 2, currentDesks: { '4': 'XX100', '5': 'XX100', '6': 'XX100' }, model: { desk: favored } });
    const d = r.desks.find(x => x.flightNumber === 'JU681')!;
    expect(d.resources).toEqual(['9', '10']);
    expect(d.warnings.some(w => w.includes('Uobičajeni šalteri nisu slobodni'))).toBe(true);
  });
  it('uobičajeni slobodni, model ipak bira 9,10 (naučena navika) → bez upozorenja', () => {
    const r = run([f], { dow: 2, model: { desk: favored } });
    const d = r.desks.find(x => x.flightNumber === 'JU681')!;
    expect(d.resources).toEqual(['9', '10']);
    expect(d.warnings.some(w => w.includes('Uobičajeni šalteri nisu slobodni'))).toBe(false);
  });
});

describe('toAbsolute pretpostavka — Scheduled let u 06:00 u 22:00 je sutrašnji; poletjeli se odbacuje po statusu', () => {
  const at = (nowMin: number, flights: SuggestionFlight[]) =>
    computeAssignmentSuggestions({ flights, currentDesks: {}, currentGates: {}, nowMin });
  it('Scheduled 06:00 u 22:00 → planira se (sutra)', () => {
    expect(at(22 * 60, [fl({ FlightNumber: 'JU681', ScheduledDepartureTime: '06:00' })]).desks).toHaveLength(1);
  });
  it('Departed 06:00 u 22:00 → ne dobija šaltere', () => {
    expect(at(22 * 60, [fl({ FlightNumber: 'JU681', ScheduledDepartureTime: '06:00', StatusEN: 'Departed' })]).desks).toHaveLength(0);
  });
});
