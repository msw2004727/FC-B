import { h } from 'preact';
import type { FeatureManifest } from '@/core/feature-types';

export const manifest: FeatureManifest = {
  id: 'education',
  status: 'enabled',
  dependsOn: ['clubs'],
  routes: [
    {
      path: '/education',
      titleKey: 'education.title',
      load: () =>
        import('@/ui/PlaceholderPage').then((m) => ({
          default: () => h(m.PlaceholderPage, { titleKey: 'education.title' }),
        })),
    },
  ],
};
