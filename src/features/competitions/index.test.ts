import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { COMPETITIONS_ENABLED, FEATURE_OVERRIDES } from '@/feature-overrides';
import { ALL_FEATURES } from '@/features.config';
import {
  _resetForTest,
  getActiveRoutes,
  isFeatureEnabled,
  registerFeatures,
} from '@/core/feature-registry';
import { competitionRoutes, manifest } from './index';
import { isCompetitionsEnabled, loadCompetitionsBackend } from './load';

const COMPETITION_PATHS = [
  '/competitions/new',
  '/competitions/:cid/manage',
  '/competitions/:cid/schedule',
  '/competitions/:cid/matches',
  '/competitions/:cid/matches/:mtId/score',
  '/competitions/:cid/matches/:mtId/live',
  '/competitions/:cid/entries/:enId/join',
  '/competitions/:cid/entries/:enId/add',
  '/competitions/:cid/entries/:enId',
  '/competitions/:cid/staff/assign',
  '/competitions/:cid/staff/invite',
  '/competitions/:cid/staff',
  '/competitions/:cid/my-matches',
  '/competitions/:cid/invite',
  '/competitions/:cid',
];

describe('competitions 功能開關（依建置期常數，不載入 asia 程式）', () => {
  afterEach(() => {
    _resetForTest();
    FEATURE_OVERRIDES.competitions = false;
  });

  it('建置期開關決定 manifest 是否帶路由；打開時 /competitions 啟用，關閉時不帶路由', () => {
    // 執行期覆寫可能被別的測試改過，這裡對回建置期常數再斷言。
    FEATURE_OVERRIDES.competitions = COMPETITIONS_ENABLED;
    expect(isCompetitionsEnabled()).toBe(COMPETITIONS_ENABLED);
    expect(manifest.id).toBe('competitions');
    expect(manifest.status).toBe('reserved');
    expect(competitionRoutes().map((route) => route.path)).toEqual(COMPETITION_PATHS);
    expect(ALL_FEATURES).toContain(manifest);
    if (COMPETITIONS_ENABLED) {
      expect(manifest.routes.map((route) => route.path)).toEqual(COMPETITION_PATHS);
      registerFeatures(ALL_FEATURES);
      expect(isFeatureEnabled('competitions')).toBe(true);
      expect(
        getActiveRoutes().map((route) => route.path).filter((path) => path.startsWith('/competitions')),
      ).toEqual(COMPETITION_PATHS);
    } else {
      expect(manifest.routes).toEqual([]);
    }
  });

  it('開關打開後十五條路由都啟用，而且 /competitions/new 排在 :cid 前面', () => {
    FEATURE_OVERRIDES.competitions = true;
    registerFeatures(ALL_FEATURES.map((f) => (f.id === 'competitions' ? { ...f, routes: competitionRoutes() } : f)));
    const paths = getActiveRoutes().map((route) => route.path).filter((path) => path.startsWith('/competitions'));
    expect(paths).toEqual(COMPETITION_PATHS);
  });

  it('關閉時註冊後不啟用，也沒有賽事第 2 步路由', () => {
    FEATURE_OVERRIDES.competitions = false;
    registerFeatures(ALL_FEATURES);
    expect(isFeatureEnabled('competitions')).toBe(false);
    expect(getActiveRoutes().some((route) => route.path.startsWith('/competitions'))).toBe(false);
  });

  it('關閉時不呼叫資料層載入器', async () => {
    FEATURE_OVERRIDES.competitions = false;
    const loaders = {
      loadFirebase: vi.fn(),
      loadCallables: vi.fn(),
      loadRepo: vi.fn(),
    };
    await expect(loadCompetitionsBackend(loaders)).resolves.toBe(false);
    expect(loaders.loadFirebase).not.toHaveBeenCalled();
    expect(loaders.loadCallables).not.toHaveBeenCalled();
    expect(loaders.loadRepo).not.toHaveBeenCalled();
  });

  it('開關打開才載入資料層', async () => {
    const loaders = {
      loadFirebase: vi.fn(async () => 'firebase'),
      loadCallables: vi.fn(async () => 'callables'),
      loadRepo: vi.fn(async () => 'repo'),
    };
    FEATURE_OVERRIDES.competitions = true;
    try {
      await expect(loadCompetitionsBackend(loaders)).resolves.toBe(true);
    } finally {
      FEATURE_OVERRIDES.competitions = false;
    }
    expect(loaders.loadFirebase).toHaveBeenCalledTimes(1);
    expect(loaders.loadCallables).toHaveBeenCalledTimes(1);
    expect(loaders.loadRepo).toHaveBeenCalledTimes(1);
  });

  it('功能入口與主程式不靜態引用資料層', () => {
    const files = [
      resolve(__dirname, '../../main.tsx'),
      resolve(__dirname, '../../features.config.ts'),
      resolve(__dirname, '../../data/firebase.ts'),
      resolve(__dirname, './index.ts'),
    ];
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      expect(text, file).not.toContain('asia-main');
      expect(text, file).not.toContain('cp-firebase');
      expect(text, file).not.toContain('cp-callables');
      expect(text, file).not.toContain('cp-repo');
    }
  });

  it('賽事頁只在開關通過後才動態載入站內賽事區', () => {
    const text = readFileSync(resolve(__dirname, '../tournaments/pages/TournamentsPage.tsx'), 'utf8');
    const gate = text.indexOf('if (!COMPETITIONS_ENABLED) return null');
    const slotImport = text.indexOf("import('@/features/competitions/components/InAppSection')");
    expect(gate).toBeGreaterThan(-1);
    expect(slotImport).toBeGreaterThan(gate);
    expect(text).not.toContain("from '@/features/competitions/components/InAppSection'");
    expect(text).not.toContain('cp-repo');
    expect(text).not.toContain('asia-main');
  });

  it('載入器只在開關通過後才動態 import 資料層', () => {
    const text = readFileSync(resolve(__dirname, './load.ts'), 'utf8');
    const gate = text.indexOf('if (!isCompetitionsEnabled()) return false;');
    const firebaseImport = text.indexOf("import('./data/cp-firebase')");
    const callablesImport = text.indexOf("import('./data/cp-callables')");
    const repoImport = text.indexOf("import('./data/cp-repo')");
    expect(gate).toBeGreaterThan(-1);
    expect(firebaseImport).toBeGreaterThan(gate);
    expect(callablesImport).toBeGreaterThan(gate);
    expect(repoImport).toBeGreaterThan(gate);
  });

  it('載入功能入口不會連帶執行資料層', async () => {
    vi.resetModules();
    const hit = vi.fn();
    vi.doMock('./data/cp-firebase', () => {
      hit();
      return {};
    });
    vi.doMock('./data/cp-callables', () => {
      hit();
      return {};
    });
    vi.doMock('./data/cp-repo', () => {
      hit();
      return {};
    });
    try {
      await import('./index');
      expect(hit).not.toHaveBeenCalled();
    } finally {
      vi.doUnmock('./data/cp-firebase');
      vi.doUnmock('./data/cp-callables');
      vi.doUnmock('./data/cp-repo');
    }
  });
});
