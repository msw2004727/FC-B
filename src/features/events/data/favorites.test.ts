import { describe, expect, it } from 'vitest';
import { normalizeFavorites, toggleEventInFavorites } from './favorites';

describe('normalizeFavorites (A M-076)', () => {
  it('returns empty when raw is null/undefined', () => {
    expect(normalizeFavorites(null)).toEqual({ events: [], tournaments: [] });
    expect(normalizeFavorites(undefined)).toEqual({ events: [], tournaments: [] });
  });

  it('returns empty when raw is not an object', () => {
    expect(normalizeFavorites('abc')).toEqual({ events: [], tournaments: [] });
    expect(normalizeFavorites(42)).toEqual({ events: [], tournaments: [] });
  });

  it('non-array fields become []', () => {
    expect(normalizeFavorites({ events: 'x', tournaments: 3 })).toEqual({ events: [], tournaments: [] });
  });

  it('filters out non-string entries', () => {
    expect(normalizeFavorites({ events: ['a', 1, 'b', null], tournaments: ['t', {}] }))
      .toEqual({ events: ['a', 'b'], tournaments: ['t'] });
  });

  it('preserves valid arrays', () => {
    expect(normalizeFavorites({ events: ['a'], tournaments: ['t'] }))
      .toEqual({ events: ['a'], tournaments: ['t'] });
    expect(normalizeFavorites({ events: [], tournaments: [] }))
      .toEqual({ events: [], tournaments: [] });
  });
});

describe('toggleEventInFavorites (A M-076)', () => {
  it('adds to the end when missing', () => {
    const { next, added } = toggleEventInFavorites({ events: ['a'], tournaments: ['t'] }, 'b');
    expect(added).toBe(true);
    expect(next).toEqual({ events: ['a', 'b'], tournaments: ['t'] });
  });

  it('removes only the first occurrence when present', () => {
    const { next, added } = toggleEventInFavorites({ events: ['a', 'b', 'a'], tournaments: ['t'] }, 'a');
    expect(added).toBe(false);
    expect(next).toEqual({ events: ['b', 'a'], tournaments: ['t'] });
  });

  it('does not mutate the input', () => {
    const input = { events: ['a'], tournaments: ['t'] };
    const result = toggleEventInFavorites(input, 'b');
    expect(input.events).toEqual(['a']);
    expect(input.tournaments).toEqual(['t']);
    // 回傳的是新物件
    expect(result.next.events).not.toBe(input.events);
    expect(result.next.tournaments).not.toBe(input.tournaments);
  });
});
