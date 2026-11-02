import type { FeatureManifest } from '@/core/feature-types';
import { drawerByPermission } from '@/core/drawer-access';

export const manifest: FeatureManifest = {
  id: 'inbox',
  status: 'enabled',
  routes: [
    {
      path: '/inbox',
      titleKey: 'inbox.title',
      load: () => import('./pages/InboxPage'),
    },
    {
      path: '/admin/messages',
      titleKey: 'inbox.admin.title',
      // 照 A DRAWER_MENUS `admin.messages.entry`（頁面本身另擋）。
      drawerVisibleIf: drawerByPermission('admin.messages.entry'),
      load: () => import('./admin/pages/AdminMessagesPage'),
    },
  ],
  nav: [{ path: '/inbox', labelKey: 'nav.inbox', icon: 'inbox', order: 0 }],
};
