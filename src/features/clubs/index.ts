import { h } from 'preact';
import type { FeatureManifest } from '@/core/feature-types';

export const manifest: FeatureManifest = {
  id: 'clubs',
  status: 'enabled',
  routes: [
    {
      path: '/teams',
      titleKey: 'clubs.title',
      load: () =>
        import('@/ui/PlaceholderPage').then((m) => ({
          default: () => h(m.PlaceholderPage, { titleKey: 'clubs.title' }),
        })),
    },
    {
      path: '/teams/:id',
      titleKey: 'clubs.detail',
      load: () =>
        import('@/ui/PlaceholderPage').then((m) => ({
          default: () => h(m.PlaceholderPage, { titleKey: 'clubs.detail' }),
        })),
    },
  ],
  nav: [{ path: '/teams', labelKey: 'nav.clubs', icon: 'users', order: 1 }],
};
