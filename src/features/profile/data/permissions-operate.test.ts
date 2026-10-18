import { describe, expect, it } from 'vitest';

import {
  ACTIVITY_CAPABILITY_CODES,
  createPermissionChecker,
  getDefaultRoleActivityCapabilities,
  getRoleLevel,
  normalizePermissionCode,
  sanitizeRoleActivityCapabilities,
  sanitizeUserPermissionGrantCodeList,
} from './permissions';

describe('O 階段共用權限修正', () => {
  it('區分缺失角色文件與明確空權限', () => {
    expect(createPermissionChecker({ role: 'admin' })('event.edit_all')).toBe(true);
    expect(createPermissionChecker({
      role: 'admin',
      rolePermissions: { admin: [] },
    })('event.edit_all')).toBe(false);
    expect(createPermissionChecker({ role: 'coach' })('activity.manage.entry')).toBe(true);
    expect(createPermissionChecker({
      role: 'coach',
      rolePermissions: { coach: [] },
    })('activity.manage.entry')).toBe(false);
  });

  it('super_admin 合併完整 catalog，而非任意 code 都放行', () => {
    const check = createPermissionChecker({
      role: 'super_admin',
      rolePermissions: { super_admin: [] },
      userGrants: ['user.extra'],
      permissionCatalog: [{ items: [{ code: 'remote.extra' }] }],
    });
    expect(check('event.edit_all')).toBe(true);
    expect(check('event.delete')).toBe(true);
    expect(check('profile.secondary_identity')).toBe(true);
    expect(check('remote.extra')).toBe(true);
    expect(check('some.other.code')).toBe(false);
    expect(check('user.extra')).toBe(false);
  });

  it('legacy permission 正規化，但 legacy 個別 grant 不會變相授權', () => {
    expect(normalizePermissionCode(' event.edit_own ')).toBe('event.edit_self');
    expect(normalizePermissionCode('admin.roles.entry')).toBe('');
    expect(normalizePermissionCode('admin.scoreboard.entry')).toBe('');
    expect(sanitizeUserPermissionGrantCodeList([
      'event.edit_own', ' event.edit_self ', 'unknown.code', 'admin.roles.entry',
    ])).toEqual(['event.edit_self']);
    expect(createPermissionChecker({
      role: 'coach',
      rolePermissions: { coach: ['event.edit_own'] },
    })('event.edit_self')).toBe(true);
  });

  it('user 角色權限全忽略，但允許有效個別 grant', () => {
    const check = createPermissionChecker({
      role: 'user',
      rolePermissions: { user: ['event.edit_all'] },
      userGrants: ['event.edit_self', 'admin.repair.event_blocklist'],
    });
    expect(check('event.edit_all')).toBe(false);
    expect(check('event.edit_self')).toBe(true);
    expect(check('admin.repair.event_blocklist')).toBe(true);
  });

  it('capability 不 trim，空陣列不回填 defaults', () => {
    expect(sanitizeRoleActivityCapabilities([])).toEqual([]);
    expect(sanitizeRoleActivityCapabilities([
      'user.activity.site_operate',
      ' user.activity.site_operate ',
      'unknown',
      'user.activity.site_operate',
    ])).toEqual(['user.activity.site_operate']);
    expect(getDefaultRoleActivityCapabilities('user')).toEqual(
      ACTIVITY_CAPABILITY_CODES.filter(code => code !== 'user.activity.addons_use'),
    );
    expect(getDefaultRoleActivityCapabilities('coach')).toEqual([]);
  });

  it('只含空白的 custom role 不參與插值，保留非空 key 原值', () => {
    const roles = [
      { key: ' ', afterRole: 'captain' },
      { key: ' judge ', afterRole: 'captain' },
    ];
    expect(getRoleLevel(' ', roles)).toBe(0);
    expect(getRoleLevel(' judge ', roles)).toBe(2.5);
    expect(getRoleLevel('judge', roles)).toBe(0);
  });
});
