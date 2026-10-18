import { h } from 'preact';
import type { FeatureManifest } from '@/core/feature-types';

export const manifest: FeatureManifest = {
  id: 'exp-achievements',
  status: 'reserved',
  routes: [
    {
      path: '/achievements',
      titleKey: 'exp-achievements.title',
      load: () =>
        import('@/ui/PlaceholderPage').then((m) => ({
          default: () => h(m.PlaceholderPage, { titleKey: 'exp-achievements.title' }),
        })),
    },
  ],
};
