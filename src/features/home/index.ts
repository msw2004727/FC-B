import type { FeatureManifest } from '@/core/feature-types';

export const manifest: FeatureManifest = {
  id: 'home',
  status: 'enabled',
  routes: [
    {
      path: '/',
      titleKey: 'home.title',
      load: () => import('./pages/HomePage'),
    },
  ],
  nav: [{ path: '/', labelKey: 'home.nav', icon: 'home', order: 0 }],
};
