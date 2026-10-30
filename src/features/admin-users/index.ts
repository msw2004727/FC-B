import type { FeatureManifest } from '@/core/feature-types';
import { drawerByPermission } from '@/core/drawer-access';

export const manifest: FeatureManifest = {
  id: 'admin-users',
  status: 'enabled',
  routes: [
    {
      path: '/admin/users',
      titleKey: 'admin-users.title',
      // 照 A DRAWER_MENUS：page-admin-users 的 permissionCode 為 admin.users.entry（頁面本身另擋）。
      drawerVisibleIf: drawerByPermission('admin.users.entry'),
      load: () => import('./pages/AdminUsersPage'),
    },
  ],
};
