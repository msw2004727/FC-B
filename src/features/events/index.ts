import { h } from 'preact';
import type { FeatureManifest } from '@/core/feature-types';

export const manifest: FeatureManifest = {
  id: 'events',
  status: 'enabled',
  routes: [
    {
      path: '/events',
      titleKey: 'events.title',
      load: () =>
        import('@/ui/PlaceholderPage').then((m) => ({
          default: () => h(m.PlaceholderPage, { titleKey: 'events.title' }),
        })),
    },
  ],
  nav: [{ path: '/events', labelKey: 'nav.events', icon: 'calendar', order: 3 }],
};
