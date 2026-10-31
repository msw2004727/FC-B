import { describe, expect, it } from 'vitest';
import { createPermissionChecker, getDefaultRolePermissions } from '@/features/profile/data/permissions';
import { BLOCKLIST_ENTRY, BLOCKLIST_PERMISSION, canViewEventBlocklist, canWriteEventBlocklist,
  searchEvents, searchUsers, type BlocklistViewer } from './event-blocklist-model';
import matrix from './event-blocklist-access.json';

describe('黑名單管理', () => {
  it.each(matrix)('授權矩陣 $label', row => {
    const rolePermissions = row.permissions === null ? {} : { [row.role]: row.permissions };
    const viewer: BlocklistViewer = { uid: 'uidA', role: row.role, displayName: '管理員',
      hasPermission: createPermissionChecker({ role: row.role, rolePermissions,
        userGrants: row.enabled === false ? [] : row.grants }),
      permissionSources: { rolePermissions: row.permissions, userGrants: row.grants, customRoles: [] } };
    expect(canViewEventBlocklist(viewer)).toBe(row.view);
    expect(canWriteEventBlocklist(viewer)).toBe(row.write);
  });
  it('未登入與來源缺失', () => {
    const viewer: BlocklistViewer = { uid: null, role: 'super_admin', displayName: null, hasPermission: () => true };
    expect(canWriteEventBlocklist(viewer)).toBe(false);
    expect(canViewEventBlocklist(viewer)).toBe(false);
    expect(canWriteEventBlocklist({ ...viewer, uid: 'uidA', role: 'admin' })).toBe(false);
  });
  it('預設授權', () => {
    expect(getDefaultRolePermissions('admin')).toContain(BLOCKLIST_ENTRY);
    expect(getDefaultRolePermissions('admin')).not.toContain(BLOCKLIST_PERMISSION);
  });
  it('搜尋上限與空值', () => {
    const events = Array.from({ length: 25 }, () => ({ id: 'evtA', title: '活動' }));
    const users = Array.from({ length: 25 }, () => ({ uid: 'targetA', name: '小明', lineUserId: '' }));
    expect(searchEvents(events, '活動')).toHaveLength(20);
    expect(searchUsers(users, '小明')).toHaveLength(20);
    expect(searchEvents(events, ' ')).toEqual([]);
    expect(searchUsers(users, '')).toEqual([]);
    expect(searchEvents(events, '不存在')).toEqual([]);
    expect(searchUsers(users, '不存在')).toEqual([]);
  });
});
