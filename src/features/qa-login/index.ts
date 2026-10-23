import type { FeatureManifest } from '@/core/feature-types';
import { isInternalTestMode } from '@/data/internal-test';

export const manifest: FeatureManifest = {
  id: 'qa-login',
  status: 'enabled',
  routes: isInternalTestMode()
    ? [
        {
          path: '/qa-login',
          titleKey: 'qa-login.title',
          load: () => import('./pages/QaLoginPage'),
        },
      ]
    : [],
};
