import { drawerOwnActivityManage } from '@/core/drawer-access';
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
    {
      path: '/my-activities',
      titleKey: 'events.manage.title',
      drawerVisibleIf: drawerOwnActivityManage,
      load: () => import('./pages/MyActivitiesPage'),
    },
  ],
  nav: [{ path: '/activities', labelKey: 'nav.events', icon: 'calendar', order: 3 }],
};
