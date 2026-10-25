import type { FeatureManifest } from '@/core/feature-types';

type PageModule = { default: import('preact').ComponentType<any> };

// 成就／稱號關閉期間（availability.ts 的 ACHIEVEMENTS_OPEN=false）：路由改載入導回我的頁的替身頁，不載入成就頁程式碼。
// 開關用動態 import 讀取，避免 availability.ts（含樣式）被打進首屏 manifest。
async function loadPage(open: () => Promise<PageModule>): Promise<PageModule> {
  const { ACHIEVEMENTS_OPEN } = await import('./availability');
  return ACHIEVEMENTS_OPEN ? open() : import('./pages/ClosedRedirect');
}

export const manifest: FeatureManifest = {
  id: 'exp-achievements',
  status: 'enabled',
  routes: [
    {
      path: '/achievements',
      titleKey: 'exp-achievements.title',
      load: () => loadPage(() => import('./pages/AchievementsPage')),
    },
    {
      path: '/titles',
      titleKey: 'exp-achievements.title',
      load: () => loadPage(() => import('./pages/TitlesPage')),
    },
  ],
};
