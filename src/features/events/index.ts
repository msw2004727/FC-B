import { h } from 'preact';
import type { FeatureManifest } from '@/core/feature-types';

export const manifest: FeatureManifest = {
  id: 'events',
  status: 'enabled',
  routes: [
    {
      path: '/activities',
      titleKey: 'events.title',
      load: () => import('./pages/ActivitiesPage'),
    },
    {
      path: '/events/:id',
      titleKey: 'events.detail',
      load: () =>
        import('@/ui/PlaceholderPage').then((m) => ({
          default: () => h(m.PlaceholderPage, { titleKey: 'events.detail' }),
        })),
    },
  ],
  nav: [{ path: '/activities', labelKey: 'nav.events', icon: 'calendar', order: 3 }],
};
