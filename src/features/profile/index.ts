import type { FeatureManifest } from '@/core/feature-types';

export const manifest: FeatureManifest = {
  id: 'profile',
  status: 'enabled',
  routes: [
    {
      path: '/profile',
      titleKey: 'profile.title',
      load: () => import('./pages/ProfilePage'),
    },
    {
      path: '/profile/qr',
      titleKey: 'profile.qr',
      load: () => import('./pages/QrPage'),
    },
    {
      path: '/profile/:uid',
      titleKey: 'profile.publicTitle',
      load: () => import('./pages/PublicProfilePage'),
    },
  ],
  nav: [{ path: '/profile', labelKey: 'nav.profile', icon: 'user', order: 4 }],
};
