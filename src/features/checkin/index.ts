import type { FeatureManifest } from '@/core/feature-types';

export const manifest: FeatureManifest = {
  id: 'checkin',
  status: 'enabled',
  dependsOn: ['events'],
  routes: [
    {
      path: '/checkin',
      titleKey: 'checkin.title',
      load: () => import('./CheckinPage'),
    },
  ],
};
