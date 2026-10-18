import { h } from 'preact';
import type { FeatureManifest } from '@/core/feature-types';

export const manifest: FeatureManifest = {
  id: 'checkin',
  status: 'enabled',
  dependsOn: ['events'],
  routes: [
    {
      path: '/checkin',
      titleKey: 'checkin.title',
      load: () =>
        import('@/ui/PlaceholderPage').then((m) => ({
          default: () => h(m.PlaceholderPage, { titleKey: 'checkin.title' }),
        })),
    },
  ],
  // 由 BottomNav 的中央 QR 拱起入口呈現，不重複佔用一般導覽格。
};
