import { h } from 'preact';
import type { FeatureManifest } from '@/core/feature-types';

export const manifest: FeatureManifest = {
  id: 'inbox',
  status: 'enabled',
  routes: [
    {
      path: '/inbox',
      titleKey: 'inbox.title',
      load: () =>
        import('@/ui/PlaceholderPage').then((m) => ({
          default: () => h(m.PlaceholderPage, { titleKey: 'inbox.title' }),
        })),
    },
  ],
  nav: [{ path: '/inbox', labelKey: 'nav.inbox', icon: 'inbox', order: 0 }],
};
