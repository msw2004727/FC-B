// 推播通知設定入口：登記、抽屜指向 /admin/notif、四種身分的選單顯示與頁面同一判斷。
import { describe, expect, it } from 'vitest';
import type { RouteAccessContext } from '@/core/feature-types';
import { ALL_FEATURES } from '@/features.config';
import { createPermissionChecker } from '@/features/profile/data/permissions';
import { canAccessDrawerItem, DRAWER_MENUS, drawerItemStatus } from '@/ui/drawer-menu';
import { canEnterNotifSettings, NOTIF_ENTRY_PERMISSION } from './data/notif-toggles';
import { manifest } from './index';

const LEVEL: Record<string, number> = { user: 0, coach: 1, captain: 2, venue_owner: 3, admin: 4, super_admin: 5 };

function access(
  role: string,
  opts: { rolePermissions?: Record<string, readonly string[]>; userGrants?: string[] } = {},
): RouteAccessContext {
  return {
    uid: `U-${role}`,
    role,
    roleLevel: LEVEL[role] ?? 0,
    capabilities: [],
    hasPermission: createPermissionChecker({
      role,
      rolePermissions: opts.rolePermissions ?? null,
      userGrants: opts.userGrants ?? null,
    }),
  };
}

const entry = DRAWER_MENUS.find((e) => e.label === '推播通知設定')!;

describe('admin-notif manifest', () => {
  it('登記在 ALL_FEATURES，路由 /admin/notif', () => {
    expect(ALL_FEATURES).toContain(manifest);
    expect(manifest.id).toBe('admin-notif');
    expect(manifest.status).toBe('enabled');
    expect(manifest.routes.map((r) => r.path)).toEqual(['/admin/notif']);
  });

  it('DRAWER_MENUS「推播通知設定」指向 /admin/notif、minRole super_admin、admin.notif.entry，進度標 done', () => {
    expect(entry.routePath).toBe('/admin/notif');
    expect(entry.page).toBe('page-admin-notif');
    expect(entry.minRole).toBe('super_admin');
    expect(entry.permissionCode).toBe('admin.notif.entry');
    expect(NOTIF_ENTRY_PERMISSION).toBe('admin.notif.entry');
    expect(drawerItemStatus(entry)).toBe('done');
  });
});

describe('四種身分：抽屜、manifest 與頁面守門三者一致', () => {
  const cases: Array<[string, RouteAccessContext, boolean]> = [
    ['一般 user', access('user'), false],
    ['admin（預設權限）', access('admin'), false],
    ['super_admin', access('super_admin'), true],
    ['admin 角色層級持有 admin.notif.entry', access('admin', { rolePermissions: { admin: ['admin.notif.entry'] } }), true],
    ['一般 user 個別授權 admin.notif.entry', access('user', { userGrants: ['admin.notif.entry'] }), true],
    ['admin 只有 admin.notif.toggle（沒有入口碼）', access('admin', { rolePermissions: { admin: ['admin.notif.toggle'] } }), false],
  ];

  it.each(cases)('%s', (_name, ctx, expected) => {
    expect(canAccessDrawerItem(entry, ctx)).toBe(expected);
    expect(manifest.routes[0]!.drawerVisibleIf!(ctx)).toBe(expected);
    expect(canEnterNotifSettings(ctx)).toBe(expected);
  });

  it('未登入：一律看不到', () => {
    const guest: RouteAccessContext = { uid: null, role: 'user', roleLevel: 0, capabilities: [], hasPermission: () => false };
    expect(canAccessDrawerItem(entry, guest)).toBe(false);
    expect(canEnterNotifSettings(guest)).toBe(false);
  });
});
