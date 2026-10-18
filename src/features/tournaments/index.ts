import { h } from 'preact';
import type { FeatureManifest } from '@/core/feature-types';

export const manifest: FeatureManifest = {
  id: 'tournaments',
  status: 'external',
  // externalUrl 由部署時注入；之後接 msw2004727/toosterx-tournament
  externalUrl: '',
  routes: [
    {
      path: '/tournaments',
      titleKey: 'tournaments.title',
      load: () =>
        import('@/ui/PlaceholderPage').then((m) => ({
          default: () => h(m.PlaceholderPage, { titleKey: 'tournaments.title' }),
        })),
    },
  ],
};
