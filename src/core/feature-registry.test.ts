import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FeatureManifest } from '@/core/feature-types';

const mocks = vi.hoisted(() => ({
  overrides: {} as Record<string, boolean | undefined>,
}));

vi.mock('@/features.config', () => ({
  FEATURE_OVERRIDES: mocks.overrides,
  ALL_FEATURES: [],
}));

import {
  _resetForTest,
  getActiveRoutes,
  getFeature,
  getNavItems,
  getRegistryVersion,
  isFeatureEnabled,
  registerFeatures,
  setRemoteFlags,
  subscribe,
} from '@/core/feature-registry';

const load = (): Promise<{ default: () => null }> =>
  Promise.resolve({ default: () => null });

function makeManifest(
  partial: Partial<FeatureManifest> & Pick<FeatureManifest, 'id' | 'status'>,
): FeatureManifest {
  return {
    ...partial,
    id: partial.id,
    status: partial.status,
    routes:
      partial.routes ??
      [{ path: `/${partial.id}`, load, titleKey: `${partial.id}.title` }],
  };
}

beforeEach(() => {
  _resetForTest();
  for (const key of Object.keys(mocks.overrides)) {
    mocks.overrides[key] = undefined;
  }
});

describe('feature-registry', () => {
  it('enabled 功能預設啟用', () => {
    registerFeatures([makeManifest({ id: 'enabled-feature', status: 'enabled' })]);
    expect(isFeatureEnabled('enabled-feature')).toBe(true);
  });

  it('reserved 功能預設不啟用', () => {
    registerFeatures([makeManifest({ id: 'reserved-feature', status: 'reserved' })]);
    expect(isFeatureEnabled('reserved-feature')).toBe(false);
  });

  it('建置期覆寫可以把 reserved 開啟、把 enabled 關閉', () => {
    mocks.overrides['reserved-on'] = true;
    mocks.overrides['enabled-off'] = false;

    registerFeatures([
      makeManifest({ id: 'reserved-on', status: 'reserved' }),
      makeManifest({ id: 'enabled-off', status: 'enabled' }),
    ]);

    expect(isFeatureEnabled('reserved-on')).toBe(true);
    expect(isFeatureEnabled('enabled-off')).toBe(false);
  });

  it('遠端旗標可以關閉功能，缺少的 id 視為開啟', () => {
    registerFeatures([makeManifest({ id: 'remote-feature', status: 'enabled' })]);

    setRemoteFlags({ 'remote-feature': false });
    expect(isFeatureEnabled('remote-feature')).toBe(false);

    setRemoteFlags({});
    expect(isFeatureEnabled('remote-feature')).toBe(true);
  });

  it('dependsOn 依賴的功能關閉時會連帶關閉', () => {
    mocks.overrides['dep-base'] = false;

    registerFeatures([
      makeManifest({ id: 'dep-base', status: 'enabled' }),
      makeManifest({
        id: 'dep-child',
        status: 'enabled',
        dependsOn: ['dep-base'],
      }),
    ]);

    expect(isFeatureEnabled('dep-child')).toBe(false);
  });

  it('getActiveRoutes 只包含啟用功能的 route', () => {
    registerFeatures([
      makeManifest({
        id: 'alpha',
        status: 'enabled',
        routes: [{ path: '/alpha', load, titleKey: 'alpha.title' }],
      }),
      makeManifest({
        id: 'beta',
        status: 'enabled',
        routes: [{ path: '/beta', load, titleKey: 'beta.title' }],
      }),
      makeManifest({
        id: 'gamma',
        status: 'reserved',
        routes: [{ path: '/gamma', load, titleKey: 'gamma.title' }],
      }),
    ]);

    expect(getActiveRoutes().map((r) => r.path)).toEqual(['/alpha', '/beta']);
  });

  it('getNavItems 只包含啟用功能且依 order 升冪排序', () => {
    registerFeatures([
      makeManifest({
        id: 'alpha',
        status: 'enabled',
        nav: [{ path: '/alpha', labelKey: 'alpha.nav', icon: 'a', order: 20 }],
      }),
      makeManifest({
        id: 'beta',
        status: 'enabled',
        nav: [{ path: '/beta', labelKey: 'beta.nav', icon: 'b', order: 10 }],
      }),
      makeManifest({
        id: 'gamma',
        status: 'reserved',
        nav: [{ path: '/gamma', labelKey: 'gamma.nav', icon: 'c', order: 5 }],
      }),
    ]);

    expect(getNavItems().map((n) => n.path)).toEqual(['/beta', '/alpha']);
  });

  it('重複的 id 會丟錯', () => {
    expect(() =>
      registerFeatures([
        makeManifest({ id: 'duplicate', status: 'enabled' }),
        makeManifest({ id: 'duplicate', status: 'enabled' }),
      ]),
    ).toThrow(/重複的功能 id/);
  });

  it('未知的 dependsOn 會丟錯', () => {
    expect(() =>
      registerFeatures([
        makeManifest({
          id: 'orphan',
          status: 'enabled',
          dependsOn: ['missing-feature'],
        }),
      ]),
    ).toThrow(/依賴未知的 id/);
  });

  it('重複的 route path 會丟錯', () => {
    expect(() =>
      registerFeatures([
        makeManifest({
          id: 'path-one',
          status: 'enabled',
          routes: [{ path: '/same', load, titleKey: 'path-one.title' }],
        }),
        makeManifest({
          id: 'path-two',
          status: 'enabled',
          routes: [{ path: '/same', load, titleKey: 'path-two.title' }],
        }),
      ]),
    ).toThrow(/重複的路由 path/);
  });

  it('自我依賴會丟錯且註冊表不變', () => {
    expect(() =>
      registerFeatures([
        makeManifest({
          id: 'self',
          status: 'enabled',
          dependsOn: ['self'],
        }),
      ]),
    ).toThrow(/self → self/);

    expect(getFeature('self')).toBeUndefined();
    expect(getActiveRoutes()).toEqual([]);
  });

  it('雙節點循環會丟錯且註冊表不變', () => {
    expect(() =>
      registerFeatures([
        makeManifest({ id: 'a', status: 'enabled', dependsOn: ['b'] }),
        makeManifest({ id: 'b', status: 'enabled', dependsOn: ['a'] }),
      ]),
    ).toThrow(/a → b → a/);

    expect(getFeature('a')).toBeUndefined();
    expect(getFeature('b')).toBeUndefined();
    expect(getActiveRoutes()).toEqual([]);
  });

  it('長循環會丟錯且既有註冊表不變', () => {
    registerFeatures([makeManifest({ id: 'stable', status: 'enabled' })]);

    expect(() =>
      registerFeatures([
        makeManifest({ id: 'a', status: 'enabled', dependsOn: ['b'] }),
        makeManifest({ id: 'b', status: 'enabled', dependsOn: ['c'] }),
        makeManifest({ id: 'c', status: 'enabled', dependsOn: ['a'] }),
      ]),
    ).toThrow(/a → b → c → a/);

    expect(getFeature('a')).toBeUndefined();
    expect(getFeature('b')).toBeUndefined();
    expect(getFeature('c')).toBeUndefined();
    expect(getActiveRoutes().map((r) => r.path)).toEqual(['/stable']);
  });

  it('合法菱形依賴可通過', () => {
    registerFeatures([
      makeManifest({ id: 'base', status: 'enabled' }),
      makeManifest({ id: 'left', status: 'enabled', dependsOn: ['base'] }),
      makeManifest({ id: 'right', status: 'enabled', dependsOn: ['base'] }),
      makeManifest({ id: 'top', status: 'enabled', dependsOn: ['left', 'right'] }),
    ]);

    expect(isFeatureEnabled('top')).toBe(true);
    expect(getActiveRoutes().map((r) => r.path)).toEqual([
      '/base',
      '/left',
      '/right',
      '/top',
    ]);
  });

  it('registerFeatures 成功後會遞增版本並通知訂閱者', () => {
    const listener = vi.fn();
    const unsubscribe = subscribe(listener);
    const before = getRegistryVersion();

    registerFeatures([makeManifest({ id: 'versioned', status: 'enabled' })]);

    expect(getRegistryVersion()).toBe(before + 1);
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
  });

  it('setRemoteFlags 會遞增版本並通知訂閱者；unsubscribe 後不再通知', () => {
    registerFeatures([makeManifest({ id: 'remote-feature', status: 'enabled' })]);

    const listener = vi.fn();
    const unsubscribe = subscribe(listener);
    const before = getRegistryVersion();

    setRemoteFlags({ 'remote-feature': false });

    expect(getRegistryVersion()).toBe(before + 1);
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();

    setRemoteFlags({});

    expect(getRegistryVersion()).toBe(before + 2);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
