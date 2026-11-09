import type { FeatureManifest } from '@/core/feature-types';
import { drawerByPermission } from '@/core/drawer-access';

export const manifest: FeatureManifest = {
  id: 'admin-notif',
  status: 'enabled',
  routes: [
    {
      path: '/admin/notif',
      titleKey: 'admin-notif.title',
      // 照 A DRAWER_MENUS「推播通知設定」：admin.notif.entry（頁面本身另擋，同一權限碼；super_admin 經權限檢查器自動持有）。
      // 寫字面值、不 import data 層：manifest 會被主程式靜態載入，頁面與資料層留在路由 chunk。
      drawerVisibleIf: drawerByPermission('admin.notif.entry'),
      load: () => import('./pages/AdminNotifPage'),
    },
  ],
};
