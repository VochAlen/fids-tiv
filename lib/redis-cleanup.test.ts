import { describe, it, expect } from 'vitest';
import { isPersistentKey } from '@/lib/redis-cleanup';

describe('redis-cleanup: trajni ključevi', () => {
  it('seq brojači i hash monitora se NE smiju dobiti TTL', () => {
    expect(isPersistentKey('ably-fids:seq:desk-status')).toBe(true);
    expect(isPersistentKey('ably-fids:seq:gate-status')).toBe(true);
    expect(isPersistentKey('fids:kiosks')).toBe(true);
  });
  it('ostali ključevi i dalje prolaze kroz cleanup', () => {
    expect(isPersistentKey('desk-status:all')).toBe(false);
    expect(isPersistentKey('cache:flights')).toBe(false);
    expect(isPersistentKey('override:JU681')).toBe(false);
  });
});

describe('redis-cleanup: učenje mora biti trajno', () => {
  it('brojači, primjeri i since nemaju fallback TTL; model-stanje ima svoj TTL', () => {
    expect(isPersistentKey('ably-fids:learn:v1')).toBe(true);
    expect(isPersistentKey('ably-fids:learn:ex:v1')).toBe(true);
    expect(isPersistentKey('ably-fids:learn:since:desk')).toBe(true);
    expect(isPersistentKey('ably-fids:learn:model:v1')).toBe(false);
  });
});
