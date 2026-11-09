import { drawerTeamManage } from '@/core/drawer-access';
import type { FeatureManifest } from '@/core/feature-types';

export const manifest: FeatureManifest = {
  id: 'clubs',
  status: 'enabled',
  routes: [
    {
      path: '/teams',
      titleKey: 'clubs.title',
      load: () => import('./pages/TeamsPage'),
    },
    {
      path: '/teams/:id',
      titleKey: 'clubs.detail',
      load: () => import('./pages/TeamDetailPage'),
    },
    {
      path: '/team-manage',
      titleKey: 'clubs.manage',
      // 照 A DRAWER_MENUS「俱樂部管理」的 permissionCode，另加自建俱樂部的一般用戶（C1；頁面本身另擋，見 TeamManagePage）。
      drawerVisibleIf: drawerTeamManage,
      load: () => import('./pages/TeamManagePage'),
    },
  ],
  nav: [{ path: '/teams', labelKey: 'nav.clubs', icon: 'users', order: 1 }],
  messageActions: {
    team_join_request: () => import('./register-actions'),
  },
};
