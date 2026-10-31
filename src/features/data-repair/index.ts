import type { FeatureManifest } from '@/core/feature-types';
import { drawerByRolePermission } from '@/core/drawer-access';

export const manifest: FeatureManifest = {
  id: 'data-repair',
  status: 'enabled',
  routes: [
    {
      path: '/admin/repair',
      titleKey: 'data-repair.title',
      // 入口條件照寫入條件（頁面本身另擋）。
      drawerVisibleIf: (access) => drawerByRolePermission('admin.repair.event_blocklist')(access)
        && access.hasPermission('admin.repair.entry'),
      load: () => import('./pages/EventBlocklistPage'),
    },
  ],
};
