import { h } from 'preact';
import type { FeatureManifest } from '@/core/feature-types';
import { drawerByPermission } from '@/core/drawer-access';

export const manifest: FeatureManifest = {
  id: 'ops-dashboard',
  status: 'enabled',
  routes: [
    {
      path: '/admin/ops',
      titleKey: 'ops-dashboard.title',
      // 照 A DRAWER_MENUS 的權限決定選單是否顯示（頁面本身另擋）。
      drawerVisibleIf: drawerByPermission('admin.dashboard.entry'),
      load: () =>
        import('@/ui/PlaceholderPage').then((m) => ({
          default: () => h(m.PlaceholderPage, { titleKey: 'ops-dashboard.title' }),
        })),
    },
  ],
};
