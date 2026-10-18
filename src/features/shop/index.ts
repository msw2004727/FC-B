import { h } from 'preact';
import type { FeatureManifest } from '@/core/feature-types';

export const manifest: FeatureManifest = {
  id: 'shop',
  status: 'reserved',
  routes: [
    {
      path: '/shop',
      titleKey: 'shop.title',
      load: () =>
        import('@/ui/PlaceholderPage').then((m) => ({
          default: () => h(m.PlaceholderPage, { titleKey: 'shop.title' }),
        })),
    },
  ],
};
