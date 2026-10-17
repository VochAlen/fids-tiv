import { describe, it, expect, vi, beforeEach } from 'vitest';

const store = new Map<string, string>();
const setSpy = vi.fn();
vi.mock('@/lib/redis', () => ({
  safeRedisGet: vi.fn(async (k: string) => store.get(k) ?? null),
  safeRedisSet: vi.fn(async (k: string, v: string) => { setSpy(k); store.set(k, v); return true; }),
}));

import { getOrTrainModelStates, buildStates, isFresh } from '@/lib/assignment-model-server';
import { trainModel, predictorFromState, parseExamples, examplesSignature, encodeExample, exampleField } from '@/lib/assignment-model';

function mkRaw(n: number): Record<string, string> {
  const raw: Record<string, string> = {};
  const base = Date.parse('2026-10-15T08:00:00Z');
  for (let i = 0; i < n; i++) {
    raw[exampleField(base + i * 60000, 'ab')] = encodeExample({
      kind: 'desk', flight: i % 2 ? 'JU681' : 'OS123', dow: 3, minute: 600 + i, chosen: String(i % 2 ? 9 : 4), busy: ['1', '2'], season: 'summer',
    } as never);
  }
  return raw;
}

beforeEach(() => { store.clear(); setSpy.mockClear(); });

describe('centralno treniranje modela', () => {
  it('predictorFromState daje isti info kao trainModel', () => {
    const raw = mkRaw(60);
    const ex = parseExamples(raw);
    const st = buildStates(raw, '2026-10-17');
    const local = trainModel(ex, 'desk', '2026-10-17');
    const central = predictorFromState(st.desk, ex, 'desk');
    expect(central.info).toEqual(local.info);
  });
  it('trenira i sprema jednom, drugi poziv čita iz Redis-a bez SET-a', async () => {
    const raw = mkRaw(50);
    const a = await getOrTrainModelStates(raw, '2026-10-17');
    const b = await getOrTrainModelStates(raw, '2026-10-17');
    expect(a).not.toBeNull();
    expect(b?.sig).toBe(a?.sig);
    expect(setSpy).toHaveBeenCalledTimes(1);
  });
  it('novi primjer ili novi dan → retrening', async () => {
    const raw = mkRaw(50);
    await getOrTrainModelStates(raw, '2026-10-17');
    await getOrTrainModelStates({ ...raw, ...mkRaw(51) }, '2026-10-17');
    await getOrTrainModelStates(mkRaw(51), '2026-10-18');
    expect(setSpy).toHaveBeenCalledTimes(3);
  });
  it('null primjeri (Redis pao) → null, bez SET-a', async () => {
    expect(await getOrTrainModelStates(null, '2026-10-17')).toBeNull();
    expect(setSpy).not.toHaveBeenCalled();
  });
  it('isFresh/examplesSignature', () => {
    const raw = mkRaw(5);
    expect(isFresh(null, raw, 'x')).toBe(false);
    expect(examplesSignature(raw)).toBe(examplesSignature({ ...raw }));
  });
});
