import type { FeatureManifest } from '@/core/feature-types';
import { drawerSuperAdminOnly } from '@/core/drawer-access';

export const manifest: FeatureManifest = {
  id: 'roles',
  status: 'enabled',
  routes: [
    {
      path: '/admin/roles',
      titleKey: 'roles.title',
      // 照 A DRAWER_MENUS 的權限決定選單是否顯示（頁面本身另擋）。
      drawerVisibleIf: drawerSuperAdminOnly,
      load: () => import('./pages/RolesAdminPage'),
    },
  ],
};
