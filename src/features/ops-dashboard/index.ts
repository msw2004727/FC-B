import type { FeatureManifest } from '@/core/feature-types';
import { drawerByPermission } from '@/core/drawer-access';

export const manifest: FeatureManifest = {
  id: 'ops-dashboard',
  status: 'enabled',
  routes: [
    {
      // 一條路由涵蓋 /admin/ops 與 /admin/ops/participants（活動參與查詢與分享網址 ?q=&from=&to=），
      // 由 pages/OpsPage.tsx 依路徑切換：少一個路由物件與一組 chunk 檔名，首頁主程式 gzip 不增加。
      path: '/admin/ops/:view?',
      titleKey: 'ops-dashboard.title',
      // 照 A DRAWER_MENUS 的權限決定選單是否顯示（頁面本身另擋，同一權限碼；分享網址開啟者也一樣）。
      drawerVisibleIf: drawerByPermission('admin.dashboard.entry'),
      load: () => import('./pages/OpsPage'),
    },
  ],
};
