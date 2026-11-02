import { describe, expect, it } from 'vitest';
import type { RouteAccessContext } from '@/core/feature-types';
import { DRAWER_MENUS, canAccessDrawerItem } from '@/ui/drawer-menu';
import { manifest } from './index';

function access(perms: readonly string[], role = 'captain'): RouteAccessContext {
  return { uid: 'u1', role, roleLevel: 2, capabilities: [], hasPermission: (c) => perms.includes(c) };
}

describe('clubs manifest：俱樂部管理（K1a）', () => {
  const route = manifest.routes.find((r) => r.path === '/team-manage');

  it('註冊 /team-manage，動態載入', () => {
    expect(route).toBeTruthy();
    expect(route!.titleKey).toBe('clubs.manage');
    expect(typeof route!.load).toBe('function');
  });

  it('抽屜入口照 A：minRole captain＋team.manage.entry，指向 /team-manage', () => {
    const item = DRAWER_MENUS.find((e) => e.page === 'page-team-manage');
    expect(item).toMatchObject({ routePath: '/team-manage', minRole: 'captain', permissionCode: 'team.manage.entry' });
    expect(canAccessDrawerItem(item, access(['team.manage.entry']))).toBe(true);
    // A 有 permissionCode 時只看權限碼：captain 角色但權限被關掉就看不到；一般用戶被個別授權則看得到。
    expect(canAccessDrawerItem(item, access([]))).toBe(false);
    expect(canAccessDrawerItem(item, access(['team.manage.entry'], 'user'))).toBe(true);
  });

  it('drawerVisibleIf 與抽屜同一判斷', () => {
    expect(route!.drawerVisibleIf!(access(['team.manage.entry']))).toBe(true);
    expect(route!.drawerVisibleIf!(access(['team.manage_all']))).toBe(false);
  });
});
