import { h } from 'preact';
import type { FeatureManifest } from '@/core/feature-types';

export const manifest: FeatureManifest = {
  id: 'ops-dashboard',
  status: 'enabled',
  routes: [
    {
      path: '/admin/ops',
      titleKey: 'ops-dashboard.title',
      load: () =>
        import('@/ui/PlaceholderPage').then((m) => ({
          default: () => h(m.PlaceholderPage, { titleKey: 'ops-dashboard.title' }),
        })),
    },
  ],
};
