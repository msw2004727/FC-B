import { h } from 'preact';
import type { FeatureManifest } from '@/core/feature-types';

export const manifest: FeatureManifest = {
  id: 'leaderboard',
  status: 'reserved',
  routes: [
    {
      path: '/leaderboard',
      titleKey: 'leaderboard.title',
      load: () =>
        import('@/ui/PlaceholderPage').then((m) => ({
          default: () => h(m.PlaceholderPage, { titleKey: 'leaderboard.title' }),
        })),
    },
  ],
};
