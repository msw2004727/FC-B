import { h } from 'preact';
import type { FeatureManifest } from '@/core/feature-types';

export const manifest: FeatureManifest = {
  id: 'roles',
  status: 'enabled',
  routes: [
    {
      path: '/admin/roles',
      titleKey: 'roles.title',
      load: () =>
        import('@/ui/PlaceholderPage').then((m) => ({
          default: () => h(m.PlaceholderPage, { titleKey: 'roles.title' }),
        })),
    },
  ],
};
