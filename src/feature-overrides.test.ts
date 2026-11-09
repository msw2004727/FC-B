import { describe, expect, it } from 'vitest';
import { FEATURE_OVERRIDES as fromConfig } from './features.config';
import { FEATURE_OVERRIDES } from './feature-overrides';

describe('FEATURE_OVERRIDES 搬到 feature-overrides.ts', () => {
  it('features.config 轉出的是同一個物件（舊的引用方式照常可用、改一處兩邊一致）', () => {
    expect(fromConfig).toBe(FEATURE_OVERRIDES);
  });
});
