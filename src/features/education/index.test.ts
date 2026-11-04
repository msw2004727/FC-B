import { beforeEach, describe, expect, it } from 'vitest';
import { ALL_FEATURES } from '@/features.config';
import {
  _resetForTest,
  getActiveRoutes,
  getNavItems,
  isFeatureEnabled,
  registerFeatures,
} from '@/core/feature-registry';
import { manifest } from './index';

describe('education manifest（課程功能暫不開放，保留槽位）', () => {
  beforeEach(() => {
    _resetForTest();
  });

  it('為 reserved，仍在功能清單內', () => {
    expect(manifest.status).toBe('reserved');
    expect(ALL_FEATURES).toContain(manifest);
  });

  it('註冊後不啟用、路由不出現、導覽不出現', () => {
    registerFeatures(ALL_FEATURES);
    expect(isFeatureEnabled('education')).toBe(false);
    expect(getActiveRoutes().some((r) => r.path === '/education')).toBe(false);
    expect(JSON.stringify(getNavItems())).not.toContain('education');
  });
});
