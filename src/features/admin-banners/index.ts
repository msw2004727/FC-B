import type { FeatureManifest } from '@/core/feature-types';
import { drawerByPermission } from '@/core/drawer-access';

export const manifest: FeatureManifest = {
  id: 'admin-banners',
  status: 'enabled',
  routes: [
    {
      path: '/admin/banners',
      titleKey: 'admin-banners.title',
      // 照 A DRAWER_MENUS 的權限決定選單是否顯示（頁面本身另擋，見 AdminBannersPage）。
      drawerVisibleIf: drawerByPermission('admin.banners.entry'),
      load: () => import('./pages/AdminBannersPage'),
    },
  ],
};
