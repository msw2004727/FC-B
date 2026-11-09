// 營運儀表板入口：登記、兩條路由（儀表板＋參與查詢分享網址）、抽屜與 manifest 同一權限判斷（四身分）。
import { describe, expect, it } from 'vitest';
import type { RouteAccessContext } from '@/core/feature-types';
import { ALL_FEATURES } from '@/features.config';
import { createPermissionChecker } from '@/features/profile/data/permissions';
import { canAccessDrawerItem, DRAWER_MENUS, drawerItemStatus } from '@/ui/drawer-menu';
import { OPS_ENTRY_PERMISSION } from './components/OpsShell';
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

const entry = DRAWER_MENUS.find((e) => e.routePath === '/admin/ops')!;

describe('ops-dashboard manifest', () => {
  it('登記在 ALL_FEATURES；一條路由（可選段）涵蓋 /admin/ops 與 /admin/ops/participants', () => {
    expect(ALL_FEATURES).toContain(manifest);
    expect(manifest.status).toBe('enabled');
    expect(manifest.routes.map((r) => r.path)).toEqual(['/admin/ops/:view?']);
  });

  it('preact-iso 路由比對：/admin/ops、/admin/ops/participants（含查詢字串）都進這條路由', async () => {
    const { exec } = await import('preact-iso/router');
    const route = manifest.routes[0]!.path;
    expect(exec('/admin/ops', route, {})).toBeTruthy();
    expect(exec('/admin/ops/participants', route, {})).toMatchObject({ params: { view: 'participants' } });
    expect(exec('/admin/opsx', route, {})).toBeFalsy();
    expect(exec('/admin/ops/a/b', route, {})).toBeFalsy();
  });

  it('抽屜「數據儀表板」指向 /admin/ops、admin.dashboard.entry，不再是佔位頁（done）', () => {
    expect(entry.permissionCode).toBe('admin.dashboard.entry');
    expect(OPS_ENTRY_PERMISSION).toBe('admin.dashboard.entry');
    expect(drawerItemStatus(entry)).toBe('done');
  });
});

describe('四種身分：抽屜、manifest 與頁面同一權限碼', () => {
  const cases: Array<[string, RouteAccessContext, boolean]> = [
    ['一般 user', access('user'), false],
    ['admin（預設權限）', access('admin'), false],
    ['super_admin', access('super_admin'), true],
    ['admin 角色層級持有 admin.dashboard.entry', access('admin', { rolePermissions: { admin: ['admin.dashboard.entry'] } }), true],
    ['一般 user 個別授權 admin.dashboard.entry', access('user', { userGrants: ['admin.dashboard.entry'] }), true],
  ];

  it.each(cases)('%s', (_name, ctx, expected) => {
    expect(canAccessDrawerItem(entry, ctx)).toBe(expected);
    expect(manifest.routes[0]!.drawerVisibleIf!(ctx)).toBe(expected);
    expect(ctx.hasPermission(OPS_ENTRY_PERMISSION)).toBe(expected);
  });
});
