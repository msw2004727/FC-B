import { h } from 'preact';
import type { FeatureManifest } from '@/core/feature-types';

export const manifest: FeatureManifest = {
  id: 'clubs',
  status: 'enabled',
  routes: [
    {
      path: '/clubs',
      titleKey: 'clubs.title',
      load: () =>
        import('@/ui/PlaceholderPage').then((m) => ({
          default: () => h(m.PlaceholderPage, { titleKey: 'clubs.title' }),
        })),
    },
  ],
  nav: [{ path: '/clubs', labelKey: 'nav.clubs', icon: 'users', order: 1 }],
};
