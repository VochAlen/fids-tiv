// lib/override-utils.test.ts
//
// NOVO (po zahtjevu — automatski test za dodatnu zaštitu pronađenu pri
// analizi "koje još mogućnosti mogu izazvati slične probleme" nakon
// fix-a u lib/assignment-merge.ts, 2026-09-28): runAutoReset ranije je
// brisao šalter iz ably-fids:desk-status:all SAMO po broju šaltera,
// bez provjere da li taj šalter i dalje pokazuje BAŠ ONAJ let za koji
// se cleanup pokreće — vidi opširan komentar u lib/override-utils.ts
// uz `deskStatusKeysToDelete`/`actuallyDeleted`. Ovaj test simulira
// tačno taj scenario: legacy override:* hash kaže da je šalter 5
// pripadao terminiranom letu AB100, ali je u međuvremenu šalter 5
// RUČNO dodijeljen NOVOM, aktivnom letu CD200 preko assign-checkin
// panela — auto-reset NE SMIJE obrisati tu aktivnu dodjelu.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const redisState = {
  overrideHashes: new Map<string, Record<string, string>>(),
  deskStatusAll: {} as Record<string, unknown>,
  gateStatusAll: {} as Record<string, unknown>,
};

function makePipeline(kind: 'hgetall' | 'hdel' | 'del') {
  const ops: (() => unknown)[] = [];
  return {
    hgetall(key: string) {
      ops.push(() => [null, redisState.overrideHashes.get(key) || {}]);
      return this;
    },
    hdel(key: string, field: string) {
      ops.push(() => {
        const h = redisState.overrideHashes.get(key);
        if (h) delete h[field];
        return [null, 1];
      });
      return this;
    },
    del(key: string) {
      ops.push(() => {
        redisState.overrideHashes.delete(key);
        return [null, 1];
      });
      return this;
    },
    hlen(key: string) {
      ops.push(() => [null, Object.keys(redisState.overrideHashes.get(key) || {}).length]);
      return this;
    },
    async exec() {
      return ops.map(op => op());
    },
  };
}

const mockRedisClient = {
  scan: vi.fn(async (_cursor: string) => {
    return ['0', Array.from(redisState.overrideHashes.keys())];
  }),
  pipeline: vi.fn(() => makePipeline('hgetall')),
  get: vi.fn(async (key: string) => {
    if (key === 'ably-fids:desk-status:all') return JSON.stringify(redisState.deskStatusAll);
    if (key === 'ably-fids:gate-status:all') return JSON.stringify(redisState.gateStatusAll);
    return null;
  }),
  set: vi.fn(async (key: string, value: string, ..._rest: unknown[]) => {
    if (key === 'ably-fids:desk-status:all') redisState.deskStatusAll = JSON.parse(value);
    if (key === 'ably-fids:gate-status:all') redisState.gateStatusAll = JSON.parse(value);
    return 'OK';
  }),
  eval: vi.fn(async () => 1),
  incr: vi.fn(async () => 1),
};

vi.mock('@/lib/redis', () => ({
  getRedisClient: () => mockRedisClient,
  // NOVO — autoCloseDepartedDesks/Gates koriste safeRedisGetStrict/
  // safeRedisSet (iste bezbjedne primitive kao desk/gate-status-override
  // route.ts) umjesto sirovog redis.get/set, da bi circuit-breaker
  // zaštita (izbjegavanje read-modify-write nad lažno praznim stanjem)
  // pokrivala i ovaj put. Mock ih ovdje svodi na isti mockRedisClient.
  safeRedisGetStrict: async (key: string) => {
    const value = await mockRedisClient.get(key);
    return { ok: true, value };
  },
  safeRedisSet: async (key: string, value: string) => {
    await mockRedisClient.set(key, value);
    return true;
  },
}));

const publishToChannelMock = vi.fn(async (_channel: string, _event: string, _data: unknown) => {});
vi.mock('@/lib/ably-server', () => ({
  publishToChannel: (channel: string, event: string, data: unknown) => publishToChannelMock(channel, event, data),
}));

const invalidateAssignmentsCacheMock = vi.fn();
vi.mock('@/lib/assignments-service', () => ({
  invalidateAssignmentsCache: () => invalidateAssignmentsCacheMock(),
}));

// acquireLock koristi redis.set(LOCK_KEY, token, 'EX', ttl, 'NX') — mock
// 'set' iznad prihvata bilo koje dodatne argumente i uvijek vraća 'OK',
// pa lock uvijek uspije odmah (dovoljno za ovaj test, ne testiramo
// lock-contention ovdje).

import { runAutoReset, autoCloseDepartedDesks, autoCloseDepartedGates } from './override-utils';

describe('runAutoReset — desk-status cross-contamination zaštita', () => {
  beforeEach(() => {
    redisState.overrideHashes.clear();
    redisState.deskStatusAll = {};
    redisState.gateStatusAll = {};
    publishToChannelMock.mockClear();
    invalidateAssignmentsCacheMock.mockClear();
  });

  it('NE briše šalter koji je u međuvremenu dodijeljen NOVOM, aktivnom letu', async () => {
    // Legacy override hash: AB100 je "vlasnik" šaltera 5.
    redisState.overrideHashes.set('override:AB100', { CheckInDesk: '5' });
    // AB100 je terminiran (poletio).
    // Šalter 5 je u ably-fids:desk-status:all u MEĐUVREMENU dodijeljen
    // sasvim drugom, AKTIVNOM letu CD200 preko assign-checkin panela.
    redisState.deskStatusAll = {
      '5': { status: 'open', flightNumber: 'CD200', classType: null, setAt: Date.now(), seq: 42 },
    };

    const allFlights = [
      { FlightNumber: 'AB100', StatusEN: 'Departed', ScheduledDepartureTime: '08:00' },
    ];

    await runAutoReset(allFlights);

    // Šalter 5 MORA ostati netaknut — i dalje pokazuje CD200.
    expect((redisState.deskStatusAll['5'] as { flightNumber: string }).flightNumber).toBe('CD200');
    // Ably NIKAD nije objavio "clear" za šalter 5 (jer se ništa nije desilo).
    expect(publishToChannelMock).not.toHaveBeenCalled();
  });

  it('I DALJE briše šalter ako i dalje pokazuje BAŠ terminirani let (normalan, ispravan slučaj)', async () => {
    redisState.overrideHashes.set('override:AB100', { CheckInDesk: '5' });
    redisState.deskStatusAll = {
      '5': { status: 'open', flightNumber: 'AB100', classType: null, setAt: Date.now(), seq: 42 },
    };

    const allFlights = [
      { FlightNumber: 'AB100', StatusEN: 'Departed', ScheduledDepartureTime: '08:00' },
    ];

    await runAutoReset(allFlights);

    expect(redisState.deskStatusAll['5']).toBeUndefined();
    expect(publishToChannelMock).toHaveBeenCalledTimes(1);
    expect(publishToChannelMock).toHaveBeenCalledWith(
      'assignments:desks',
      'update',
      expect.objectContaining({ deskNumber: '5' })
    );
  });
});

describe('autoCloseDepartedDesks/Gates — automatsko oslobađanje kad let poleti/otkaže se', () => {
  beforeEach(() => {
    redisState.overrideHashes.clear();
    redisState.deskStatusAll = {};
    redisState.gateStatusAll = {};
    publishToChannelMock.mockClear();
    invalidateAssignmentsCacheMock.mockClear();
  });

  it('automatski zatvara šalter čiji je let POLETIO, bez obzira da li je osoblje zaboravilo da ga ručno ukloni', async () => {
    // Tačan scenario iz zahtjeva: "AB100 poletio, osoblje zaboravilo da
    // zatvori šalter (npr. zadnji let dana, žurba da idu kući)".
    redisState.deskStatusAll = {
      '5': { status: 'open', flightNumber: 'AB100', classType: null, setAt: Date.now() - 60_000, seq: 10 },
    };
    const allFlights = [{ FlightNumber: 'AB100', StatusEN: 'Departed' }];

    const closed = await autoCloseDepartedDesks(allFlights);

    expect(closed).toEqual(['5']);
    expect(redisState.deskStatusAll['5']).toBeUndefined();
    expect(publishToChannelMock).toHaveBeenCalledWith(
      'assignments:desks',
      'update',
      expect.objectContaining({ deskNumber: '5', entry: expect.objectContaining({ status: null, flightNumber: '' }) })
    );
    expect(invalidateAssignmentsCacheMock).toHaveBeenCalled();
  });

  it('NE dira šalter čiji let JOŠ NIJE poletio (i dalje aktivan, treba ostati prikazan)', async () => {
    redisState.deskStatusAll = {
      '5': { status: 'open', flightNumber: 'AB100', classType: null, setAt: Date.now(), seq: 10 },
    };
    const allFlights = [{ FlightNumber: 'AB100', StatusEN: 'Scheduled' }];

    const closed = await autoCloseDepartedDesks(allFlights);

    expect(closed).toEqual([]);
    expect(redisState.deskStatusAll['5']).toBeDefined();
    expect(publishToChannelMock).not.toHaveBeenCalled();
  });

  it('automatski zatvara gate čiji je let OTKAZAN', async () => {
    redisState.gateStatusAll = {
      '12': { status: 'open', flightNumber: 'XY200', classType: null, setAt: Date.now(), seq: 3 },
    };
    const allFlights = [{ FlightNumber: 'XY200', StatusEN: 'Cancelled' }];

    const closed = await autoCloseDepartedGates(allFlights);

    expect(closed).toEqual(['12']);
    expect(redisState.gateStatusAll['12']).toBeUndefined();
    expect(publishToChannelMock).toHaveBeenCalledWith(
      'assignments:gates',
      'update',
      expect.objectContaining({ gateNumber: '12' })
    );
  });

  it('ne dira šalter čiji let uopšte nije u trenutnom rasporedu (npr. drugi dan) — bez pretpostavki', async () => {
    redisState.deskStatusAll = {
      '5': { status: 'open', flightNumber: 'ZZ999', classType: null, setAt: Date.now(), seq: 10 },
    };
    const allFlights = [{ FlightNumber: 'AB100', StatusEN: 'Departed' }];

    const closed = await autoCloseDepartedDesks(allFlights);

    expect(closed).toEqual([]);
    expect(redisState.deskStatusAll['5']).toBeDefined();
  });
});
