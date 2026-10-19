import type { FeatureManifest } from '@/core/feature-types';

export const manifest: FeatureManifest = {
  id: 'clubs',
  status: 'enabled',
  routes: [
    {
      path: '/teams',
      titleKey: 'clubs.title',
      load: () => import('./pages/TeamsPage'),
    },
    {
      path: '/teams/:id',
      titleKey: 'clubs.detail',
      load: () => import('./pages/TeamDetailPage'),
    },
  ],
  nav: [{ path: '/teams', labelKey: 'nav.clubs', icon: 'users', order: 1 }],
  messageActions: {
    team_join_request: () => import('./register-actions'),
  },
};
