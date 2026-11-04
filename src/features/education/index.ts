import { h } from 'preact';
import type { FeatureManifest } from '@/core/feature-types';

// 站長裁示：課程功能先不做，保留槽位待未來新版；reserved 讓路由與導覽都不出現（取代 enabled 的占位頁）。
export const manifest: FeatureManifest = {
  id: 'education',
  status: 'reserved',
  dependsOn: ['clubs'],
  routes: [
    {
      path: '/education',
      titleKey: 'education.title',
      load: () =>
        import('@/ui/PlaceholderPage').then((m) => ({
          default: () => h(m.PlaceholderPage, { titleKey: 'education.title' }),
        })),
    },
  ],
};
