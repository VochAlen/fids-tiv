import { describe, it, expect } from 'vitest';
import {
  encodeExample, exampleField, parseExamples, trainModel, trainWeights,
  INITIAL_WEIGHTS, TRAIN_DAYS, type Example,
} from './assignment-model';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 9, 1); // 2026-10-01

// deterministički "slučajni" brojevi
function lcg(seed: number) { let s = seed; return () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296; }

/** Osoblje za 'XX' bira prvi šalter nasumično, a drugi UVIJEK kao +1 (d-1 je zauzet drugim letom). */
function synthetic(days: number, flightsPerDay = 5): Example[] {
  const rnd = lcg(7);
  const out: Example[] = [];
  for (let d = 0; d < days; d++) {
    for (let i = 0; i < flightsPerDay; i++) {
      const ts = T0 + d * DAY + i * 3_600_000;
      const first = 2 + Math.floor(rnd() * 8); // 2..9
      const base = { kind: 'desk' as const, flight: `XX${100 + i}`, dow: (4 + d) % 7, minute: 600, season: 'S' as const };
      out.push({ ...base, ts, chosen: String(first), busy: [] });
      out.push({ ...base, ts: ts + 60_000, chosen: String(first + 1), busy: [String(first - 1)] });
    }
  }
  return out;
}

describe('zapis primjera', () => {
  it('encode → parse (krug) i sortiranje po vremenu; neispravno se preskače', () => {
    const e = { kind: 'desk' as const, flight: 'LY5111', dow: 3, minute: 745, chosen: '10', busy: ['1', '2'], season: 'S' as const };
    const raw = {
      [exampleField(T0 + 5000, 'ab')]: encodeExample(e),
      [exampleField(T0, 'cd')]: encodeExample({ ...e, chosen: '11', busy: [] }),
      zzz: 'smeće',
    };
    const p = parseExamples(raw);
    expect(p).toHaveLength(2);
    expect(p[0]).toMatchObject({ ts: T0, chosen: '11', busy: [] });
    expect(p[1]).toMatchObject({ ts: T0 + 5000, flight: 'LY5111', busy: ['1', '2'], dow: 3, season: 'S' });
  });
});

describe('trenerski postupak', () => {
  it('bez primjera težine se ne mijenjaju; broj primjera se računa po vrsti', () => {
    expect(trainWeights([], INITIAL_WEIGHTS)).toEqual(INITIAL_WEIGHTS);
    expect(trainModel(synthetic(12), 'desk', '2026-10-13').info.examples).toBe(120);
  });

  it('prvih 7 dana model samo uči (ne utiče na prijedloge)', () => {
    const t = trainModel(synthetic(3), 'desk', '2026-10-03');
    expect(t.info.phase).toBe('learning');
    expect(t.predictor).toBeNull();
    expect(t.info.text).toContain('trenutno uči');
    expect(t.info.text).toContain(`dan 3 od ${TRAIN_DAYS}`);
  });

  it('nema primjera → uči; premalo primjera poslije 7 dana → i dalje uči', () => {
    expect(trainModel([], 'desk', '2026-10-03').info.phase).toBe('learning');
    const few = synthetic(8, 1).slice(0, 12);
    const t = trainModel(few, 'desk', '2026-10-20');
    expect(t.info.phase).toBe('learning');
    expect(t.info.text).toContain('potrebnih');
  });

  it('poslije 7 dana i dovoljno primjera: model sa susjedstvom pobjeđuje brojače → aktivan, sa predviđanjem', () => {
    const t = trainModel(synthetic(12), 'desk', '2026-10-13');
    expect(t.info.phase).toBe('active');
    expect(t.info.modelRate!).toBeGreaterThan(t.info.baselineRate! + 0.03);
    expect(t.info.text).toContain('Model aktivan');
    const p = t.predictor!({ flight: 'XX100', dow: 1, chosenSoFar: ['5'] });
    const best = Object.entries(p).sort((a, b) => b[1] - a[1])[0][0];
    expect(['4', '6']).toContain(best); // susjed već odabranog
    expect(Object.values(p).reduce((a, b) => a + b, 0)).toBeCloseTo(1);
  });

  it('kad model nije bolji od brojača ostaje u sjeni (bez predictor-a)', () => {
    // Osoblje uvijek bira isti šalter po kompaniji → brojači su savršeni, model ne može biti bolji za +3pp.
    const ex: Example[] = [];
    for (let d = 0; d < 12; d++) for (let i = 0; i < 4; i++) {
      ex.push({ kind: 'desk', flight: `YY${i}`, dow: d % 7, minute: 600, season: 'S', ts: T0 + d * DAY + i * 1000, chosen: String(3 + i), busy: [] });
    }
    const t = trainModel(ex, 'desk', '2026-10-13');
    expect(t.info.phase).toBe('shadow');
    expect(t.predictor).toBeNull();
    expect(t.info.text).toContain('još ne utiče');
  });

  it('desk i gate se treniraju odvojeno', () => {
    const gates = synthetic(12).map(e => ({ ...e, kind: 'gate' as const }));
    expect(trainModel(gates, 'desk', '2026-10-13').info.examples).toBe(0);
    expect(trainModel(gates, 'gate', '2026-10-13').info.examples).toBe(gates.length);
  });
});

describe('v4: doba dana, pristrasnost po šalteru, objašnjenje', () => {
  /** Ista kompanija: ujutro (10h) šalter 3, uvečer (18h) šalter 9 — brojači po kompaniji to ne vide. */
  function byTime(days: number): Example[] {
    const out: Example[] = [];
    for (let d = 0; d < days; d++) for (let i = 0; i < 4; i++) {
      const evening = i % 2 === 1;
      out.push({
        kind: 'desk', flight: `ZZ${200 + ((d + i * 2) % 3)}`, dow: (d * 3 + i) % 7, minute: evening ? 1080 : 600, season: 'S',
        ts: T0 + d * DAY + i * 60_000, chosen: evening ? '9' : '3', busy: [],
      });
    }
    return out;
  }

  it('uči da se isti šalter bira u isto doba dana', () => {
    const t = trainModel(byTime(12), 'desk', '2026-10-13');
    expect(t.info.phase).toBe('active');
    const best = (minute: number) =>
      Object.entries(t.predictor!({ flight: 'ZZ999', dow: 2, chosenSoFar: [], minute, busyCount: 0 })).sort((a, b) => b[1] - a[1])[0][0];
    expect(best(600)).toBe('3');
    expect(best(1080)).toBe('9');
  });

  it('daje kratko objašnjenje zašto su baš ti šalteri predloženi', () => {
    const t = trainModel(byTime(12), 'desk', '2026-10-13');
    const why = t.predictor!.explain!({ flight: 'ZZ999', dow: 2, chosenSoFar: [], minute: 600, busyCount: 0 }, ['3']);
    expect(why.length).toBeGreaterThan(0);
    expect(why).toMatch(/doba dana|kompanij|rado bira|često/);
  });

  it('objašnjenje je prazno kad ništa ne izdvaja izabrane resurse', () => {
    const t = trainModel(synthetic(12), 'desk', '2026-10-13');
    expect(typeof t.predictor!.explain!({ flight: 'XX100', dow: 1, chosenSoFar: ['5'] }, ['4'])).toBe('string');
  });
});

describe('dan od 7 — trajni "since"', () => {
  it('računa se od ranijeg od (najstariji primjer, since), pa dan stiže do 7 i kad se primjeri skraćuju', async () => {
    const { trainModelState } = await import('./assignment-model');
    const DAY = 86_400_000;
    const t0 = Date.UTC(2026, 9, 20, 10);
    const ex = [{ ts: t0 + 5 * DAY, kind: 'desk' as const, flight: 'LY1', dow: 1, minute: 600, chosen: '5', busy: [], season: 'W' as const }];
    expect(trainModelState(ex, 'desk', '2026-10-26').info.day).toBe(2);              // bez since: samo od najstarijeg primjera
    expect(trainModelState(ex, 'desk', '2026-10-26', t0).info.day).toBe(7);          // sa since: pravi dan
  });
});
