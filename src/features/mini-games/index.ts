import { h } from 'preact';
import type { FeatureManifest } from '@/core/feature-types';

export const manifest: FeatureManifest = {
  id: 'mini-games',
  status: 'reserved',
  routes: [
    {
      path: '/games',
      titleKey: 'mini-games.title',
      load: () =>
        import('@/ui/PlaceholderPage').then((m) => ({
          default: () => h(m.PlaceholderPage, { titleKey: 'mini-games.title' }),
        })),
    },
  ],
};
