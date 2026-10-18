import { h } from 'preact';
import type { FeatureManifest } from '@/core/feature-types';

export const manifest: FeatureManifest = {
  id: 'personal-dashboard',
  status: 'enabled',
  routes: [
    {
      path: '/me/dashboard',
      titleKey: 'personal-dashboard.title',
      load: () =>
        import('@/ui/PlaceholderPage').then((m) => ({
          default: () => h(m.PlaceholderPage, { titleKey: 'personal-dashboard.title' }),
        })),
    },
  ],
};
