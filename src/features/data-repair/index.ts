import { h } from 'preact';
import type { FeatureManifest } from '@/core/feature-types';
import { drawerByPermission } from '@/core/drawer-access';

export const manifest: FeatureManifest = {
  id: 'data-repair',
  status: 'enabled',
  routes: [
    {
      path: '/admin/repair',
      titleKey: 'data-repair.title',
      // 照 A DRAWER_MENUS 的權限決定選單是否顯示（頁面本身另擋）。
      drawerVisibleIf: drawerByPermission('admin.repair.entry'),
      load: () =>
        import('@/ui/PlaceholderPage').then((m) => ({
          default: () => h(m.PlaceholderPage, { titleKey: 'data-repair.title' }),
        })),
    },
  ],
};
