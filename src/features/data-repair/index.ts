import { h } from 'preact';
import type { FeatureManifest } from '@/core/feature-types';

export const manifest: FeatureManifest = {
  id: 'data-repair',
  status: 'enabled',
  routes: [
    {
      path: '/admin/repair',
      titleKey: 'data-repair.title',
      load: () =>
        import('@/ui/PlaceholderPage').then((m) => ({
          default: () => h(m.PlaceholderPage, { titleKey: 'data-repair.title' }),
        })),
    },
  ],
};
