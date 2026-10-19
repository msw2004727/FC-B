import type { FeatureManifest } from '@/core/feature-types';

export const manifest: FeatureManifest = {
  id: 'inbox',
  status: 'enabled',
  routes: [
    {
      path: '/inbox',
      titleKey: 'inbox.title',
      load: () => import('./pages/InboxPage'),
    },
  ],
  nav: [{ path: '/inbox', labelKey: 'nav.inbox', icon: 'inbox', order: 0 }],
};
