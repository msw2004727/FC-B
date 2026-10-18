import { h } from 'preact';
import type { FeatureManifest } from '@/core/feature-types';

export const manifest: FeatureManifest = {
  id: 'logs',
  status: 'enabled',
  routes: [
    {
      path: '/admin/logs',
      titleKey: 'logs.title',
      load: () =>
        import('@/ui/PlaceholderPage').then((m) => ({
          default: () => h(m.PlaceholderPage, { titleKey: 'logs.title' }),
        })),
    },
  ],
};
