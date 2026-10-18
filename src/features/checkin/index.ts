import { h } from 'preact';
import type { FeatureManifest } from '@/core/feature-types';

export const manifest: FeatureManifest = {
  id: 'checkin',
  status: 'enabled',
  dependsOn: ['events'],
  routes: [
    {
      path: '/checkin',
      titleKey: 'checkin.title',
      load: () =>
        import('@/ui/PlaceholderPage').then((m) => ({
          default: () => h(m.PlaceholderPage, { titleKey: 'checkin.title' }),
        })),
    },
  ],
  nav: [{ path: '/checkin', labelKey: 'checkin.nav', icon: 'qr', order: 2 }],
};
