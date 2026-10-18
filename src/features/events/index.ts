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
      load: () => import('./pages/EventDetailPage'),
    },
  ],
  nav: [{ path: '/activities', labelKey: 'nav.events', icon: 'calendar', order: 3 }],
};
