import type { FeatureManifest } from '@/core/feature-types';

export const manifest: FeatureManifest = {
  id: 'exp-achievements',
  status: 'enabled',
  routes: [
    {
      path: '/achievements',
      titleKey: 'exp-achievements.title',
      load: () => import('./pages/AchievementsPage'),
    },
    {
      path: '/titles',
      titleKey: 'exp-achievements.title',
      load: () => import('./pages/TitlesPage'),
    },
  ],
};
