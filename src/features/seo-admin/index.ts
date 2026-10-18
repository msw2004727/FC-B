import { h } from 'preact';
import type { FeatureManifest } from '@/core/feature-types';

export const manifest: FeatureManifest = {
  id: 'seo-admin',
  status: 'enabled',
  routes: [
    {
      path: '/admin/seo',
      titleKey: 'seo-admin.title',
      load: () =>
        import('@/ui/PlaceholderPage').then((m) => ({
          default: () => h(m.PlaceholderPage, { titleKey: 'seo-admin.title' }),
        })),
    },
  ],
};
