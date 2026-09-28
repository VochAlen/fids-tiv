// lib/assignments-service.test.ts
//
// NOVO (KRITIČNO — regresija pronađena pri ponovnoj analizi osnovnog
// problema nakon fix-a u lib/assignment-merge.ts, 2026-09-28): vidi
// opširan komentar uz `ok` polje u RawAssignments (lib/assignments-service.ts).
// Pošto mergeNewer na klijentu SAD ispravno tretira "ključ nedostaje u
// punom snapshot-u" kao "obrisano na serveru", getRawAssignments() MORA
// pouzdano signalizirati kad čitanje iz Redis-a NIJE uspjelo (umjesto da
// tiho vrati lažno prazan, ali "ok" snapshot) — inače bi svaki prolazan
// Redis problem doveo do brisanja SVIH aktivnih dodjela na SVIM
// kioscima. Ovaj test simulira baš taj neuspjeh.
import { describe, it, expect, vi, beforeEach } from 'vitest';

type StrictResult = { ok: boolean; value: string | null };

const redisState = {
  desk: null as string | null,
  gate: null as string | null,
  failDesk: false,
  failGate: false,
};

vi.mock('@/lib/redis', () => ({
  safeRedisGetStrict: async (key: string): Promise<StrictResult> => {
    if (key === 'ably-fids:desk-status:all') {
      if (redisState.failDesk) return { ok: false, value: null };
      return { ok: true, value: redisState.desk };
    }
    if (key === 'ably-fids:gate-status:all') {
      if (redisState.failGate) return { ok: false, value: null };
      return { ok: true, value: redisState.gate };
    }
    return { ok: true, value: null };
  },
}));

describe('getRawAssignments — regresija: ok:false na neuspjelo Redis čitanje', () => {
  beforeEach(() => {
    redisState.desk = null;
    redisState.gate = null;
    redisState.failDesk = false;
    redisState.failGate = false;
    vi.resetModules();
  });

  it('vraća ok:true i stvaran sadržaj kad je Redis čitanje uspješno', async () => {
    redisState.desk = JSON.stringify({ '5': { status: 'open', flightNumber: 'AB100', classType: null, setAt: 1, seq: 1 } });
    redisState.gate = JSON.stringify({});

    const { getRawAssignments } = await import('./assignments-service');
    const raw = await getRawAssignments();

    expect(raw.ok).toBe(true);
    expect(raw.desks['5'].flightNumber).toBe('AB100');
  });

  it('KRITIČNO — vraća ok:false (NE lažno prazan ok:true) kad safeRedisGetStrict javi neuspjeh za desk ključ', async () => {
    redisState.failDesk = true;
    redisState.gate = JSON.stringify({});

    const { getRawAssignments } = await import('./assignments-service');
    const raw = await getRawAssignments();

    expect(raw.ok).toBe(false);
  });

  it('KRITIČNO — vraća ok:false kad safeRedisGetStrict javi neuspjeh za gate ključ, čak i ako je desk uspio', async () => {
    redisState.desk = JSON.stringify({ '5': { status: 'open', flightNumber: 'AB100', classType: null, setAt: 1, seq: 1 } });
    redisState.failGate = true;

    const { getRawAssignments } = await import('./assignments-service');
    const raw = await getRawAssignments();

    expect(raw.ok).toBe(false);
  });

  it('nakon neuspjeha vraća POSLEDNJI POZNAT keš (best-effort) sa ok:false, ne prazan objekat, ako je keš već postojao', async () => {
    redisState.desk = JSON.stringify({ '5': { status: 'open', flightNumber: 'AB100', classType: null, setAt: 1, seq: 1 } });
    redisState.gate = JSON.stringify({});

    const { getRawAssignments } = await import('./assignments-service');
    const first = await getRawAssignments();
    expect(first.ok).toBe(true);
    expect(first.desks['5'].flightNumber).toBe('AB100');

    // Sad Redis počne da otkazuje (npr. circuit breaker otvoren). Pomjeramo
    // sat naprijed preko RAW_CACHE_TTL_MS (8s) da FORSIRAMO novo čitanje —
    // namjerno NE zovemo invalidateAssignmentsCache() ovdje, jer ono briše
    // i sam cachedRaw (ne samo TTL), pa bi maskiralo baš ono što ovaj test
    // provjerava: best-effort fallback na POSLEDNJI POZNAT sadržaj kad
    // keš prirodno istekne dok je Redis nedostupan.
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 9_000);
    redisState.failDesk = true;
    redisState.failGate = true;

    const second = await getRawAssignments();
    nowSpy.mockRestore();

    expect(second.ok).toBe(false);
    // Best-effort: i dalje vraća poslednji poznat sadržaj (ne prazan {}),
    // ali pozivalac MORA gledati `ok`, ne sadržaj, prije upotrebe za merge.
    expect(second.desks['5']?.flightNumber).toBe('AB100');
  });
});
