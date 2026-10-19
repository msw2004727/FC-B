import { describe, it, expect } from 'vitest';

import {
  INHERENT_ROLE_PERMISSIONS,
  BASE_ROLE_LEVEL_MAP,
  getRoleLevel,
  createPermissionChecker,
  buildPermissionCheckerInput,
} from './permissions';

describe('INHERENT_ROLE_PERMISSIONS', () => {
  it('逐字等於 A js/config.js 與 functions/index.js 的內容', () => {
    expect(INHERENT_ROLE_PERMISSIONS).toEqual({
      coach: [],
      captain: [],
      venue_owner: [],
      super_admin: ['admin.repair.event_blocklist', 'admin.seo.entry'],
    });
  });

  it('為 frozen 常數', () => {
    expect(Object.isFrozen(INHERENT_ROLE_PERMISSIONS)).toBe(true);
  });
});

describe('BASE_ROLE_LEVEL_MAP', () => {
  it('逐字等於 A _BASE_ROLE_LEVEL_MAP', () => {
    expect({ ...BASE_ROLE_LEVEL_MAP }).toEqual({
      user: 0,
      coach: 1,
      captain: 2,
      venue_owner: 3,
      admin: 4,
      super_admin: 5,
    });
  });
});

describe('getRoleLevel', () => {
  it('回傳內建角色 level', () => {
    expect(getRoleLevel('user')).toBe(0);
    expect(getRoleLevel('coach')).toBe(1);
    expect(getRoleLevel('captain')).toBe(2);
    expect(getRoleLevel('venue_owner')).toBe(3);
    expect(getRoleLevel('admin')).toBe(4);
    expect(getRoleLevel('super_admin')).toBe(5);
  });

  it('空白、null、undefined、未知角色皆回 0（沿用 A 的 fallback）', () => {
    expect(getRoleLevel('')).toBe(0);
    expect(getRoleLevel(null)).toBe(0);
    expect(getRoleLevel(undefined)).toBe(0);
    expect(getRoleLevel('unknown_role')).toBe(0);
  });

  it('單一自訂角色插值：captain 與 venue_owner 之間', () => {
    const customRoles = [{ key: 'judge', afterRole: 'captain' }];
    expect(getRoleLevel('judge', customRoles)).toBeCloseTo(2.5, 10);
  });

  it('兩個連續自訂角色插值：captain → a → b → venue_owner', () => {
    const customRoles = [
      { key: 'a', afterRole: 'captain' },
      { key: 'b', afterRole: 'a' },
    ];
    expect(getRoleLevel('a', customRoles)).toBeCloseTo(2 + 1 / 3, 10);
    expect(getRoleLevel('b', customRoles)).toBeCloseTo(2 + 2 / 3, 10);
  });

  it('自訂角色預設 afterRole 為 captain', () => {
    const customRoles = [{ key: 'defaulted' }];
    expect(getRoleLevel('defaulted', customRoles)).toBeCloseTo(2.5, 10);
  });

  it('自訂角色插在 admin 後、super_admin 前', () => {
    const customRoles = [{ key: 'post_admin', afterRole: 'admin' }];
    expect(getRoleLevel('post_admin', customRoles)).toBeCloseTo(4.5, 10);
  });

  it('afterRole=super_admin 的自訂角色，落於 admin 與 super_admin 之間（照 A 的 deferred 邏輯）', () => {
    const customRoles = [{ key: 'post_super', afterRole: 'super_admin' }];
    expect(getRoleLevel('post_super', customRoles)).toBeCloseTo(4.5, 10);
  });

  it('未知父角色的自訂角色照 A deferred 邏輯處理', () => {
    const customRoles = [{ key: 'orphan', afterRole: 'not_builtin' }];
    expect(getRoleLevel('orphan', customRoles)).toBeCloseTo(4.5, 10);
  });

  it('自訂角色 key 不自行 trim：含空白 key 與原 key 是不同角色', () => {
    const customRoles = [{ key: ' judge ', afterRole: 'captain' }];
    expect(getRoleLevel(' judge ', customRoles)).toBeCloseTo(2.5, 10);
    expect(getRoleLevel('judge', customRoles)).toBe(0);
  });
});

describe('createPermissionChecker', () => {
  it('未帶 role 一律 false', () => {
    const check = createPermissionChecker({ role: null });
    expect(check('anything')).toBe(false);
    expect(check('admin.repair.event_blocklist')).toBe(false);
  });

  it('空字串或空 code 一律 false', () => {
    const check = createPermissionChecker({ role: 'super_admin' });
    expect(check('')).toBe(false);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(check(null as any)).toBe(false);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(check(undefined as any)).toBe(false);
  });

  it('super_admin 具有 INHERENT_ROLE_PERMISSIONS 的兩條固有權限', () => {
    const check = createPermissionChecker({ role: 'super_admin' });
    expect(check('admin.repair.event_blocklist')).toBe(true);
    expect(check('admin.seo.entry')).toBe(true);
    expect(check('some.other.code')).toBe(false);
  });

  it('coach / captain / venue_owner 固有陣列為空 → 不因角色給未知權限，照 A：無文件用預設', () => {
    for (const role of ['coach', 'captain', 'venue_owner']) {
      const check = createPermissionChecker({ role });
      expect(check('any.code')).toBe(false);
      // 照 A：無文件用預設
      expect(check('activity.manage.entry')).toBe(true);
      expect(check('activity.view_noshow')).toBe(true);
    }
  });

  it('rolePermissions 授予角色權限（legacy 轉新碼、保留明確設定）', () => {
    const check = createPermissionChecker({
      role: 'coach',
      rolePermissions: {
        coach: ['event.create', 'event.edit_own'],
      },
    });
    expect(check('event.create')).toBe(true);
    expect(check('event.edit_self')).toBe(true);
    expect(check('event.delete')).toBe(false);
  });

  it('rolePermissions/user 固定不授予任何權限（含 admin.repair.event_blocklist）', () => {
    const check = createPermissionChecker({
      role: 'user',
      rolePermissions: { user: ['admin.repair.event_blocklist', 'event.create'] },
    });
    expect(check('admin.repair.event_blocklist')).toBe(false);
    expect(check('event.create')).toBe(false);
  });

  it('一般 user 可由有效個別授權取得 admin.repair.event_blocklist', () => {
    const check = createPermissionChecker({
      role: 'user',
      rolePermissions: { user: [] },
      userGrants: ['admin.repair.event_blocklist'],
    });
    expect(check('admin.repair.event_blocklist')).toBe(true);
  });

  it('停用個別授權後 admin.repair.event_blocklist 為 false（資料層不傳入 grant）', () => {
    const check = createPermissionChecker({
      role: 'user',
      rolePermissions: { user: [] },
      userGrants: [],
    });
    expect(check('admin.repair.event_blocklist')).toBe(false);
  });

  it('userGrants 授予其他個別權限', () => {
    const check = createPermissionChecker({
      role: 'user',
      rolePermissions: { user: [] },
      userGrants: ['admin.logs.audit_read'],
    });
    expect(check('admin.logs.audit_read')).toBe(true);
    expect(check('admin.logs.error_read')).toBe(false);
  });

  it('super_admin 不併入個別授權（照 A getCurrentUserEffectivePermissions）', () => {
    const check = createPermissionChecker({
      role: 'super_admin',
      userGrants: ['user.extra'],
    });
    expect(check('admin.repair.event_blocklist')).toBe(true);
    expect(check('user.extra')).toBe(false);
  });

  it('三種來源合併：inherent + rolePermissions + userGrants', () => {
    const check = createPermissionChecker({
      role: 'super_admin',
      rolePermissions: { super_admin: ['custom.code'] },
      userGrants: ['user.extra'],
    });
    expect(check('admin.repair.event_blocklist')).toBe(true);
    expect(check('admin.seo.entry')).toBe(true);
    expect(check('custom.code')).toBe(true);
    expect(check('user.extra')).toBe(false);
    expect(check('nope')).toBe(false);
  });

  it('code 前後空白視為相同', () => {
    const check = createPermissionChecker({ role: 'super_admin' });
    expect(check('  admin.seo.entry  ')).toBe(true);
  });

  it('rolePermissions 文件缺失時，照 A：無文件用預設；空陣列才明確全關', () => {
    // 照 A：無文件用預設
    const checkAbsent = createPermissionChecker({ role: 'coach' });
    expect(checkAbsent('activity.manage.entry')).toBe(true);
    expect(checkAbsent('event.create')).toBe(false);

    const checkEmpty = createPermissionChecker({
      role: 'coach',
      rolePermissions: { coach: [] },
    });
    expect(checkEmpty('activity.manage.entry')).toBe(false);
  });
});

describe('buildPermissionCheckerInput', () => {
  it('無文件時不產生 own key（照 A：無文件用預設），空陣列時保留 own key（明確全關）', () => {
    const absentInput = buildPermissionCheckerInput({
      role: 'coach',
      rolePermissionDocs: {},
      uid: 'u1',
    });
    expect(Object.prototype.hasOwnProperty.call(absentInput.rolePermissions, 'coach')).toBe(false);
    expect(createPermissionChecker(absentInput)('activity.manage.entry')).toBe(true);

    const emptyInput = buildPermissionCheckerInput({
      role: 'coach',
      rolePermissionDocs: { coach: { permissions: [] } },
      uid: 'u1',
    });
    expect(Object.prototype.hasOwnProperty.call(emptyInput.rolePermissions, 'coach')).toBe(true);
    expect(createPermissionChecker(emptyInput)('activity.manage.entry')).toBe(false);
  });
});
