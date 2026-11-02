import type { FeatureManifest } from '@/core/feature-types';
import { drawerByPermission } from '@/core/drawer-access';

export const manifest: FeatureManifest = {
  id: 'admin-inactive',
  status: 'enabled',
  routes: [
    {
      path: '/admin/inactive',
      titleKey: 'admin-inactive.title',
      // 照 A DRAWER_MENUS「無效資料查詢」：admin.inactive.entry（頁面本身另擋，同一權限碼）。
      drawerVisibleIf: drawerByPermission('admin.inactive.entry'),
      load: () => import('./pages/AdminInactivePage'),
    },
  ],
};
