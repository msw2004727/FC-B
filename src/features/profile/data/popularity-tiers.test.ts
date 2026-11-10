import { describe, expect, it } from 'vitest';

import {
  POPULARITY_STEPS,
  POPULARITY_TIER_NAMES,
  popularityStars,
  popularityTier,
} from './popularity-tiers';

describe('popularityStars（站長 2026-11-10 階梯）', () => {
  it('門檻由小到大，最高 5 星', () => {
    const mins = POPULARITY_STEPS.map(([min]) => min);
    expect([...mins].sort((a, b) => a - b)).toEqual(mins);
    expect(POPULARITY_STEPS[0]).toEqual([0, 0]);
    expect(POPULARITY_STEPS[POPULARITY_STEPS.length - 1]).toEqual([10000, 5]);
  });

  it.each(POPULARITY_STEPS.map(([min, stars], index) => ({ min, stars, index })))(
    '門檻 $min → $stars：前一名／剛好／後一名',
    ({ min, stars, index }) => {
      const prev = index === 0 ? 0 : POPULARITY_STEPS[index - 1]![1];
      if (index > 0) expect(popularityStars(min - 1)).toBe(prev);
      expect(popularityStars(min)).toBe(stars);
      expect(popularityStars(min + 1)).toBe(stars);
    },
  );

  it('0、負數、NaN、非整數、1e9', () => {
    expect(popularityStars(0)).toBe(0);
    expect(popularityStars(1)).toBe(0);
    expect(popularityStars(-1)).toBe(0);
    expect(popularityStars(-0.5)).toBe(0);
    expect(popularityStars(-Infinity)).toBe(0);
    expect(popularityStars(Number.NaN)).toBe(0);
    expect(popularityStars(Number.POSITIVE_INFINITY)).toBe(0);
    expect(popularityStars(49.9)).toBe(0);
    expect(popularityStars(50.9)).toBe(0.5);
    expect(popularityStars(99.2)).toBe(0.5);
    expect(popularityStars(100.9)).toBe(1);
    expect(popularityStars(9999.9)).toBe(4.5);
    expect(popularityStars(1e9)).toBe(5);
    expect(popularityStars('50')).toBe(0);
    expect(popularityStars(null)).toBe(0);
    expect(popularityStars(undefined)).toBe(0);
    expect(popularityStars(true)).toBe(0);
  });
});

describe('popularityTier', () => {
  it('五段稱號依星數整數段', () => {
    expect(POPULARITY_TIER_NAMES).toEqual(['新面孔', '小有名氣', '人氣新星', '熱門人物', '球場焦點']);
    expect(popularityTier(0)).toBe('新面孔');
    expect(popularityTier(50)).toBe('新面孔');
    expect(popularityTier(99)).toBe('新面孔');
    expect(popularityTier(100)).toBe('小有名氣');
    expect(popularityTier(250)).toBe('小有名氣');
    expect(popularityTier(500)).toBe('人氣新星');
    expect(popularityTier(1000)).toBe('人氣新星');
    expect(popularityTier(2000)).toBe('熱門人物');
    expect(popularityTier(3000)).toBe('熱門人物');
    expect(popularityTier(5000)).toBe('球場焦點');
    expect(popularityTier(10000)).toBe('球場焦點');
    expect(popularityTier(1e9)).toBe('球場焦點');
    expect(popularityTier(Number.NaN)).toBe('新面孔');
    expect(popularityTier(-3)).toBe('新面孔');
  });
});
