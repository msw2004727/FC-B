import { afterEach, describe, expect, it, vi } from 'vitest';
import { isInternalTestMode } from './internal-test';

afterEach(() => {
  vi.unstubAllEnvs();
});

// 測試同步更新：2026-10-20 站長取消內測名單與寫入守門
describe('internal-test', () => {
  it('dev／測試預設不套用內測模式，VITE_INTERNAL_TEST=1 才套用', () => {
    expect(isInternalTestMode()).toBe(false);
    vi.stubEnv('VITE_INTERNAL_TEST', '1');
    expect(isInternalTestMode()).toBe(true);
  });

  it('正式建置預設是內測模式，只有 VITE_PUBLIC_LAUNCH=1 才關閉', () => {
    vi.stubEnv('DEV', false);
    expect(isInternalTestMode()).toBe(true);
    vi.stubEnv('VITE_PUBLIC_LAUNCH', '1');
    expect(isInternalTestMode()).toBe(false);
  });
});
