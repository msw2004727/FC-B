import { h } from 'preact';
import type { FeatureManifest } from '@/core/feature-types';

export const manifest: FeatureManifest = {
  id: 'profile',
  status: 'enabled',
  routes: [
    {
      path: '/profile',
      titleKey: 'profile.title',
      load: () =>
        import('@/ui/PlaceholderPage').then((m) => ({
          default: () => h(m.PlaceholderPage, { titleKey: 'profile.title' }),
        })),
    },
    {
      path: '/profile/qr',
      titleKey: 'profile.qr',
      load: () =>
        import('@/ui/PlaceholderPage').then((m) => ({
          default: () => h(m.PlaceholderPage, { titleKey: 'profile.qr' }),
        })),
    },
  ],
  nav: [{ path: '/profile', labelKey: 'nav.profile', icon: 'user', order: 4 }],
};
