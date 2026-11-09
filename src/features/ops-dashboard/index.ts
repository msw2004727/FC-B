import type { FeatureManifest } from '@/core/feature-types';
import { drawerByPermission } from '@/core/drawer-access';

// 兩條路由共用一個 chunk（見 pages/OpsPage.tsx），首頁主程式只多一組延遲載入檔名。
const load = () => import('./pages/OpsPage');

export const manifest: FeatureManifest = {
  id: 'ops-dashboard',
  status: 'enabled',
  routes: [
    {
      path: '/admin/ops',
      titleKey: 'ops-dashboard.title',
      // 照 A DRAWER_MENUS 的權限決定選單是否顯示（頁面本身另擋，同一權限碼）。
      drawerVisibleIf: drawerByPermission('admin.dashboard.entry'),
      load,
    },
    {
      // 活動參與查詢與分享網址（?q=&from=&to=）；開啟者同樣要登入且有 admin.dashboard.entry（頁面另擋）。
      path: '/admin/ops/participants',
      titleKey: 'ops-dashboard.title',
      load,
    },
  ],
};
