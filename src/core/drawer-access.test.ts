import { describe, expect, it } from 'vitest';
import type { RouteAccessContext } from './feature-types';
import { drawerByPermission, drawerByRolePermission, drawerOwnActivityManage, drawerSuperAdminOnly } from './drawer-access';

function access(overrides: Partial<RouteAccessContext> = {}): RouteAccessContext {
  return { uid: 'U_x', role: 'user', roleLevel: 0, capabilities: [], hasPermission: () => false, ...overrides };
}

describe('drawer-access（照 A _canAccessDrawerItem）', () => {
  it('有權限碼的入口看 hasPermission', () => {
    const gate = drawerByPermission('admin.logs.entry');
    expect(gate(access())).toBe(false);
    expect(gate(access({ hasPermission: (c) => c === 'admin.logs.entry' }))).toBe(true);
  });

  it('黑名單入口照寫入條件：super_admin 與角色層級持碼者顯示，無碼 admin 與個別授權不顯示', () => {
    const gate = drawerByRolePermission('admin.repair.event_blocklist');
    const withCode = { rolePermissions: ['admin.repair.event_blocklist'] };
    expect(gate(access({ role: 'super_admin', roleLevel: 5 }))).toBe(true);
    expect(gate(access({ role: 'admin', roleLevel: 4, permissionSources: withCode }))).toBe(true);
    expect(gate(access({ role: 'admin', roleLevel: 4, permissionSources: { rolePermissions: ['admin.repair.entry'] } }))).toBe(false);
    expect(gate(access({ role: 'admin', roleLevel: 4, permissionSources: { rolePermissions: null } }))).toBe(false);
    expect(gate(access({ role: 'admin', roleLevel: 4 }))).toBe(false);
    expect(gate(access({ role: 'admin', roleLevel: 4, hasPermission: () => true }))).toBe(false);
    expect(gate(access({ role: 'user', permissionSources: withCode, hasPermission: () => true }))).toBe(false);
    expect(gate(access({ uid: null, role: 'super_admin', roleLevel: 5 }))).toBe(false);
  });

  it('權限管理只給 super_admin', () => {
    expect(drawerSuperAdminOnly(access({ role: 'admin', roleLevel: 4 }))).toBe(false);
    expect(drawerSuperAdminOnly(access({ role: 'super_admin', roleLevel: 5 }))).toBe(true);
  });

  it('活動管理：入口權限、coach 以上、跨活動編輯，或一般用戶的 own_manage_entry', () => {
    expect(drawerOwnActivityManage(access())).toBe(false);
    expect(drawerOwnActivityManage(access({ uid: null, role: 'coach', roleLevel: 1 }))).toBe(false);
    expect(drawerOwnActivityManage(access({ role: 'coach', roleLevel: 1 }))).toBe(true);
    expect(drawerOwnActivityManage(access({ hasPermission: (c) => c === 'activity.manage.entry' }))).toBe(true);
    expect(drawerOwnActivityManage(access({ hasPermission: (c) => c === 'event.edit_all' }))).toBe(true);
    expect(drawerOwnActivityManage(access({ capabilities: ['user.activity.own_manage_entry'] }))).toBe(true);
    // 自訂角色等級插值在 coach 以上也算（A ROLE_LEVEL_MAP Proxy）
    expect(drawerOwnActivityManage(access({ role: 'judge', roleLevel: 2.5 }))).toBe(true);
  });
});
