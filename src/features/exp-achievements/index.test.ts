import { afterEach, describe, expect, it, vi } from 'vitest';

import { manifest } from './index';

describe('exp-achievements 路由守衛（T-038）', () => {
  afterEach(() => {
    vi.doUnmock('./availability');
    vi.resetModules();
  });

  it('仍登記 /achievements 與 /titles 兩條路由', () => {
    expect(manifest.routes.map((route) => route.path)).toEqual(['/achievements', '/titles']);
  });

  it('關閉期間：兩條路由都載入導回我的頁的替身頁，不載入成就頁／稱號頁', async () => {
    const closed = await import('./pages/ClosedRedirect');
    for (const route of manifest.routes) {
      const page = await route.load();
      expect(page.default).toBe(closed.default);
    }
  });

  it('關閉期間：成就頁與稱號頁模組完全不會被載入（不只是回傳替身，退修 1 測試強度）', async () => {
    const loaded = vi.fn();
    vi.resetModules();
    vi.doUnmock('./availability');
    vi.doMock('./pages/AchievementsPage', () => {
      loaded('achievements');
      return { default: () => null };
    });
    vi.doMock('./pages/TitlesPage', () => {
      loaded('titles');
      return { default: () => null };
    });
    const { manifest: closedManifest } = await import('./index');
    for (const route of closedManifest.routes) await route.load();
    expect(loaded).not.toHaveBeenCalled();
    vi.doUnmock('./pages/AchievementsPage');
    vi.doUnmock('./pages/TitlesPage');
  });

  it('開放時：路由載入原本的成就頁與稱號頁', async () => {
    vi.resetModules();
    vi.doMock('./availability', () => ({ ACHIEVEMENTS_OPEN: true }));
    const { manifest: openManifest } = await import('./index');
    const achievements = await import('./pages/AchievementsPage');
    const titles = await import('./pages/TitlesPage');
    const closed = await import('./pages/ClosedRedirect');

    const [achRoute, titlesRoute] = openManifest.routes;
    expect((await achRoute!.load()).default).toBe(achievements.default);
    expect((await titlesRoute!.load()).default).toBe(titles.default);
    expect((await achRoute!.load()).default).not.toBe(closed.default);
  });
});
