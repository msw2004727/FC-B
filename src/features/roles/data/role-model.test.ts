import { describe, expect, it } from 'vitest';
import {
  ACTIVITY_CAPABILITY_CODES, createPermissionChecker, getAllPermissionCodes, normalizePermissionCode,
} from '@/features/profile/data/permissions';
import { getARolePermissionDefaults, savedDefaults } from './role-defaults';
import { BUILTIN_CATALOG, mergePermissionCatalog, permissionName } from './permission-catalog';
import {
  assertOnlyTopLevelFields, canManageRoles, canonical, capabilitySource, currentPermissions,
  normalizeCapabilities, prepareRoleChange, validatePermissions,
} from './role-model';
import { rolesFixture } from './role-test-fixtures';

describe('T-079a 模型與 Q10', () => {
  it.each(['user', 'coach', 'captain', 'venue_owner', 'admin', 'guest'])('入口拒絕 %s，即使有所有權限碼', role => {
    expect(canManageRoles({ uid: 'test-actor', role })).toBe(false);
  });
  it('入口只允許登入的 super_admin', () => {
    expect(canManageRoles({ uid: 'test-actor', role: 'super_admin' })).toBe(true);
    expect(canManageRoles({ uid: null, role: 'super_admin' })).toBe(false);
  });
  it('M3 未知角色與格式不符的角色鍵拒絕', () => {
    for (const role of ['unknown', '../admin', 'coach/child']) {
      expect(() => prepareRoleChange(rolesFixture(), role, { kind: 'toggle', code: 'event.create' }, 'test-actor')).toThrow('invalid-argument');
    }
  });
  it.each(['user', 'super_admin', 'custom'])('M4 鎖定／自訂角色 %s 不可改', role => {
    const data = rolesFixture();
    data.customRoles = [{ key: 'custom', afterRole: 'captain' }];
    for (const action of [{ kind: 'toggle', code: 'event.create' }, { kind: 'save-defaults' }, { kind: 'restore-defaults' }] as const) {
      expect(() => prepareRoleChange(data, role, action, 'test-actor'))
        .toThrow('locked-role');
    }
  });
  it('user 缺預設時復原先回 locked-role 且不可寫', () => {
    expect(() => prepareRoleChange(rolesFixture(), 'user', { kind: 'restore-defaults' }, 'test-actor')).toThrow('locked-role');
  });
  it('M5 固有權限不可從 payload 移除', () => {
    expect(() => validatePermissions(['admin.seo.entry'], 'super_admin', [])).toThrow();
    expect(validatePermissions(['admin.seo.entry', 'admin.repair.event_blocklist'], 'super_admin', [])).toHaveLength(2);
    expect(currentPermissions(rolesFixture(), 'super_admin')).toContain('admin.seo.entry');
  });
  it('M6 拒絕未知碼、非陣列、非字串與超長清單', () => {
    for (const raw of ['event.create', [null], ['unknown.code'], [''], Array(501).fill('event.create')]) {
      expect(() => validatePermissions(raw, 'coach', [])).toThrow();
    }
  });
  it('M7 精確 allowlist 擋多餘欄位及 dotted field', () => {
    for (const key of ['catalogVersion', 'uid', 'permissions.extra']) {
      expect(() => assertOnlyTopLevelFields({ permissions: [], [key]: true }, ['permissions'])).toThrow();
    }
  });
  it('M8 capabilities 全關 [] 保留，非法 shape 與碼拒絕', () => {
    expect(capabilitySource({ capabilities: [] })).toEqual({ user: [] });
    expect(normalizeCapabilities([])).toEqual([]);
    expect(() => capabilitySource({ capabilities: 'invalid' })).toThrow();
    expect(capabilitySource(null).user).not.toContain('user.activity.addons_use');
    for (const raw of ['bad', [null], ['event.create']]) expect(() => normalizeCapabilities(raw)).toThrow();
    expect(() => prepareRoleChange(rolesFixture(), 'coach', { kind: 'capability', code: ACTIVITY_CAPABILITY_CODES[0] }, 'test-actor')).toThrow();
  });
  it('M13 admin.roles.entry 明確拒絕授予', () => {
    expect(() => validatePermissions(['admin.roles.entry'], 'coach', [])).toThrow();
    expect(() => prepareRoleChange(rolesFixture(), 'coach', { kind: 'toggle', code: 'admin.roles.entry' }, 'test-actor')).toThrow();
  });
  it('完整 diff 包含舊碼移除及新碼新增，未改欄位保留', () => {
    const preview = prepareRoleChange(rolesFixture(), 'coach', { kind: 'toggle', code: 'event.publish' }, 'test-actor');
    expect(preview.removed).toEqual(['event.edit_own']);
    expect(preview.added).toEqual(expect.arrayContaining(['event.edit_self', 'event.publish']));
    expect(preview.after).toMatchObject({ catalogVersion: '20260506b', defaultPermissions: ['event.publish'], meta: { keep: true } });
    expect(Object.keys(preview.payload)).toEqual(['permissions']);
    expect(preview.fingerprint).not.toBe(canonical(preview.payload));
  });
  it('Q10 保存預設優先於 A 內建 fallback，[] 也有效', () => {
    expect(getARolePermissionDefaults('coach', { coach: { defaultPermissions: ['event.publish'] } })).toEqual(['event.publish']);
    expect(getARolePermissionDefaults('coach', { coach: { defaultPermissions: [] } })).toEqual([]);
    expect(getARolePermissionDefaults('coach', {})).toEqual(['activity.manage.entry', 'admin.tournaments.entry', 'activity.view_noshow']);
    expect(getARolePermissionDefaults('custom', {})).toBeNull();
    expect(getARolePermissionDefaults('user', { user: { defaultPermissions: ['event.create'] } })).toEqual([]);
    expect(savedDefaults({ permissions: [] })).toBeNull();
    expect(savedDefaults({ defaultPermissions: [] })).toEqual([]);
  });
  it('Q10 meta 陣列的文件鍵順序照 A', () => {
    expect(getARolePermissionDefaults('coach', [
      { _docId: 'captain', roleKey: 'coach', defaultPermissions: ['event.create'] },
      { roleKey: 'coach', defaultPermissions: ['event.publish'] },
    ])).toEqual(['event.publish']);
  });
  it('儲存預設取目前有效權限，復原取已保存預設', () => {
    const data = rolesFixture();
    expect(prepareRoleChange(data, 'coach', { kind: 'save-defaults' }, 'test-actor').payload)
      .toEqual({ defaultPermissions: ['event.create', 'event.edit_self'] });
    expect(prepareRoleChange(data, 'coach', { kind: 'restore-defaults' }, 'test-actor').payload)
      .toEqual({ permissions: ['event.publish'] });
  });
  it('未知既有碼不被顯示過濾靜默刪掉', () => {
    const data = rolesFixture();
    data.rolePermissions['coach'] = { permissions: ['unknown.code'] };
    expect(() => prepareRoleChange(data, 'coach', { kind: 'toggle', code: 'event.create' }, 'test-actor')).toThrow();
  });
  it('十條舊碼正規化逐碼對照 A', () => {
    const pairs = [
      ['event.edit_own', 'event.edit_self'], ['event.delete_own', 'event.delete_self'],
      ['event.scan_qr', 'event.scan'], ['event.view_participants', 'event.view_registrations'],
      ['team.manage_own', 'team.manage_self'], ['team.approve_join', 'team.review_join'],
      ['team.create_team_event', 'team.create_event'], ['team.toggle_event_public', 'team.toggle_event_visibility'],
      ['admin.teams.entry', 'team.manage.entry'], ['admin.scoreboard.entry', ''],
    ];
    for (const [old, next] of pairs) expect(normalizePermissionCode(old)).toBe(next);
    expect(validatePermissions(['event.edit_own', 'event.edit_self'], 'coach', [])).toEqual(['event.edit_self']);
  });
  it('顯示目錄涵蓋 B allowlist 且同分類遠端碼只補一次', () => {
    expect(new Set(BUILTIN_CATALOG.flatMap(category => category.items.map(item => item.code))))
      .toEqual(new Set(getAllPermissionCodes()));
    const remote = [{ cat: '活動管理', items: [
      { code: 'event.create', name: '不能覆蓋內建' }, { code: 'remote.code', name: '遠端碼' },
      { code: 'admin.roles.entry', name: '不可授予' },
    ] }];
    const merged = mergePermissionCatalog(remote);
    expect(merged[0]?.items.filter(item => item.code === 'event.create')).toEqual([{ code: 'event.create', name: '建立活動' }]);
    expect(permissionName('remote.code', remote)).toBe('遠端碼');
    expect(validatePermissions(['remote.code'], 'coach', remote)).toEqual(['remote.code']);
    expect(merged.flatMap(category => category.items).some(item => item.code === 'admin.roles.entry')).toBe(false);
  });
  it('撤回 admin.users.* 後共用 checker 同時撤回 M-142 入口／編輯能力', () => {
    const before = createPermissionChecker({ role: 'admin', rolePermissions: { admin: ['admin.users.entry', 'admin.users.edit_profile'] } });
    const after = createPermissionChecker({ role: 'admin', rolePermissions: { admin: [] } });
    for (const code of ['admin.users.entry', 'admin.users.edit_profile']) {
      expect(before(code)).toBe(true);
      expect(after(code)).toBe(false);
    }
  });
});
