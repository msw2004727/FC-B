import { h } from 'preact';
import type { FeatureManifest } from '@/core/feature-types';

export const manifest: FeatureManifest = {
  id: 'site-theme',
  status: 'enabled',
  routes: [
    {
      path: '/admin/theme',
      titleKey: 'site-theme.title',
      load: () =>
        import('@/ui/PlaceholderPage').then((m) => ({
          default: () => h(m.PlaceholderPage, { titleKey: 'site-theme.title' }),
        })),
    },
  ],
};
