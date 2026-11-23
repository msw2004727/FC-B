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
  it('未知既有碼不被顯示過濾靜默刪掉（P2-15 起改為原樣保留、不拋錯，詳見下方 P2-15 案例）', () => {
    const data = rolesFixture();
    data.rolePermissions['coach'] = { permissions: ['unknown.code'] };
    const preview = prepareRoleChange(data, 'coach', { kind: 'toggle', code: 'event.create' }, 'test-actor');
    expect(preview.payload).toEqual({ permissions: ['event.create', 'unknown.code'] });
    expect(preview.removed).toEqual([]);
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

describe('主辦賽事開關 disabledCodes（顧問 §3.612）', () => {
  const host = { kind: 'toggle', code: 'competition.host' } as const;
  const userHost = { kind: 'capability', code: 'user.competition.host' } as const;
  it('coach 開→關：缺欄位起點加入 disabledCodes，permissions 不動', () => {
    const data = rolesFixture();
    const preview = prepareRoleChange(data, 'coach', host, 'test-actor');
    expect(preview.payload).toEqual({ disabledCodes: ['competition.host'] });
    expect(Object.keys(preview.payload)).toEqual(['disabledCodes']);
    expect(preview.added).toEqual(['competition.host']);
    expect(preview.removed).toEqual([]);
    expect(preview.after['permissions']).toEqual(['event.create', 'event.edit_own']);
    expect(preview.after['defaultPermissions']).toEqual(['event.publish']);
    expect(preview.collection).toBe('rolePermissions');
  });
  it('coach 關→開：移出 disabledCodes，其他字串保留', () => {
    const data = rolesFixture();
    data.rolePermissions['coach'] = { ...data.rolePermissions['coach'], disabledCodes: ['other.code', 'competition.host'] };
    const preview = prepareRoleChange(data, 'coach', host, 'test-actor');
    expect(preview.payload).toEqual({ disabledCodes: ['other.code'] });
    expect(preview.added).toEqual([]);
    expect(preview.removed).toEqual(['competition.host']);
  });
  it('空陣列起點＝開，切換後關', () => {
    const data = rolesFixture();
    data.rolePermissions['captain'] = { permissions: [], disabledCodes: [] };
    expect(prepareRoleChange(data, 'captain', host, 'test-actor').payload).toEqual({ disabledCodes: ['competition.host'] });
  });
  it.each([null, 'competition.host', { a: 1 }, 7])('壞值 %j 起點＝關，切換後修復成 []', bad => {
    const data = rolesFixture();
    data.rolePermissions['coach'] = { ...data.rolePermissions['coach'], disabledCodes: bad };
    const preview = prepareRoleChange(data, 'coach', host, 'test-actor');
    expect(preview.payload).toEqual({ disabledCodes: [] });
    expect(preview.added).toEqual([]);
  });
  it('陣列內非字串與重複值被清掉', () => {
    const data = rolesFixture();
    data.rolePermissions['coach'] = { ...data.rolePermissions['coach'], disabledCodes: ['x', 'x', 3, null] };
    expect(prepareRoleChange(data, 'coach', host, 'test-actor').payload).toEqual({ disabledCodes: ['x', 'competition.host'] });
  });
  it('原 permissions 是壞值也不影響主辦開關（獨立欄位）', () => {
    const data = rolesFixture();
    data.rolePermissions['coach'] = { permissions: 'broken' };
    expect(prepareRoleChange(data, 'coach', host, 'test-actor').payload).toEqual({ disabledCodes: ['competition.host'] });
  });
  it.each(['user', 'super_admin', 'custom'])('鎖定／自訂角色 %s 不可切主辦開關', role => {
    const data = rolesFixture();
    data.customRoles = [{ key: 'custom', afterRole: 'captain' }];
    expect(() => prepareRoleChange(data, role, host, 'test-actor')).toThrow('locked-role');
  });
  it('主辦碼不能進 permissions，也不通過 validatePermissions', () => {
    expect(() => validatePermissions(['competition.host'], 'coach', [])).toThrow();
    expect(() => validatePermissions(['user.competition.host'], 'coach', [])).toThrow();
    expect(getAllPermissionCodes()).not.toContain('competition.host');
  });
  it.each([
    ['toggle 其他碼', { kind: 'toggle', code: 'event.publish' }, 'permissions'],
    ['儲存預設', { kind: 'save-defaults' }, 'defaultPermissions'],
    ['恢復預設', { kind: 'restore-defaults' }, 'permissions'],
  ] as const)('%s：payload 不帶 disabledCodes，after 保留原值', (_name, action, field) => {
    const data = rolesFixture();
    data.rolePermissions['coach'] = { ...data.rolePermissions['coach'], disabledCodes: ['competition.host'] };
    const preview = prepareRoleChange(data, 'coach', action, 'test-actor');
    expect(Object.keys(preview.payload)).toEqual([field]);
    expect(preview.after['disabledCodes']).toEqual(['competition.host']);
  });
  it('一般用戶主辦開關：缺欄位起點加入，capabilities 不動', () => {
    const data = rolesFixture();
    const preview = prepareRoleChange(data, 'user', userHost, 'test-actor');
    expect(preview.payload).toEqual({ disabledCodes: ['user.competition.host'], updatedAt: 'SERVER_TIMESTAMP', updatedBy: 'test-actor' });
    expect(preview.collection).toBe('roleActivityCapabilities');
    expect(preview.after['capabilities']).toEqual(['user.activity.basic_create']);
    expect(preview.added).toEqual(['user.competition.host']);
  });
  it('一般用戶主辦開關：已關起點移出', () => {
    const data = rolesFixture();
    data.roleActivityDocuments['user'] = { ...data.roleActivityDocuments['user'], disabledCodes: ['user.competition.host'] };
    const preview = prepareRoleChange(data, 'user', userHost, 'test-actor');
    expect(preview.payload).toMatchObject({ disabledCodes: [] });
    expect(preview.removed).toEqual(['user.competition.host']);
  });
  it('一般用戶主辦開關：壞值起點修復成 []；文件不存在也可寫', () => {
    const data = rolesFixture();
    data.roleActivityDocuments['user'] = { capabilities: [], disabledCodes: 'bad' };
    expect(prepareRoleChange(data, 'user', userHost, 'test-actor').payload).toMatchObject({ disabledCodes: [] });
    delete data.roleActivityDocuments['user'];
    const preview = prepareRoleChange(data, 'user', userHost, 'test-actor');
    expect(preview.before).toBeNull();
    expect(preview.payload).toMatchObject({ disabledCodes: ['user.competition.host'] });
  });
  it('一般用戶其他能力照舊：payload 不帶 disabledCodes，after 保留原值', () => {
    const data = rolesFixture();
    data.roleActivityDocuments['user'] = { ...data.roleActivityDocuments['user'], disabledCodes: ['user.competition.host'] };
    const preview = prepareRoleChange(data, 'user', { kind: 'capability', code: 'user.activity.basic_create' }, 'test-actor');
    expect(Object.keys(preview.payload).sort()).toEqual(['capabilities', 'updatedAt', 'updatedBy']);
    expect(preview.after['disabledCodes']).toEqual(['user.competition.host']);
  });
  it('主辦碼不能用錯系統：coach 走 capability、user 碼走 toggle 都拒絕', () => {
    expect(() => prepareRoleChange(rolesFixture(), 'coach', userHost, 'test-actor')).toThrow('locked-role');
    expect(() => prepareRoleChange(rolesFixture(), 'coach', { kind: 'toggle', code: 'user.competition.host' }, 'test-actor')).toThrow('invalid-argument');
    expect(() => prepareRoleChange(rolesFixture(), 'user', { kind: 'capability', code: 'competition.host' }, 'test-actor')).toThrow('invalid-argument');
  });
});

describe('P2-15 原文件未知碼不再讓整個角色的開關壞掉', () => {
  function withUnknown(): ReturnType<typeof rolesFixture> {
    const data = rolesFixture();
    data.rolePermissions['coach'] = { ...data.rolePermissions['coach'], permissions: ['event.create', 'future.code', 'event.edit_own'] };
    return data;
  }
  it('toggle 其他碼：未知碼原樣保留、不拋錯、不列在 removed', () => {
    const preview = prepareRoleChange(withUnknown(), 'coach', { kind: 'toggle', code: 'event.publish' }, 'test-actor');
    expect(preview.payload).toEqual({ permissions: ['event.create', 'event.edit_self', 'event.publish', 'future.code'] });
    expect(preview.removed).toEqual(['event.edit_own']);
    expect(preview.removed).not.toContain('future.code');
  });
  it('儲存預設：不拋錯，permissions 欄位（含未知碼）原樣保留', () => {
    const preview = prepareRoleChange(withUnknown(), 'coach', { kind: 'save-defaults' }, 'test-actor');
    expect(preview.payload).toEqual({ defaultPermissions: ['event.create', 'event.edit_self'] });
    expect(preview.after['permissions']).toEqual(['event.create', 'future.code', 'event.edit_own']);
  });
  it('恢復預設：丟掉未知碼並列在 removed', () => {
    const preview = prepareRoleChange(withUnknown(), 'coach', { kind: 'restore-defaults' }, 'test-actor');
    expect(preview.payload).toEqual({ permissions: ['event.publish'] });
    expect(preview.removed).toContain('future.code');
  });
  it('恢復預設：預設裡同一個未知碼也一併丟掉', () => {
    const data = withUnknown();
    data.rolePermissions['coach'] = { ...data.rolePermissions['coach'], defaultPermissions: ['event.publish', 'future.code'] };
    expect(prepareRoleChange(data, 'coach', { kind: 'restore-defaults' }, 'test-actor').payload).toEqual({ permissions: ['event.publish'] });
  });
  it('新加入的碼仍必須在目錄裡', () => {
    expect(() => prepareRoleChange(withUnknown(), 'coach', { kind: 'toggle', code: 'future.code' }, 'test-actor')).toThrow('invalid-argument');
    const data = withUnknown();
    data.rolePermissions['coach'] = { ...data.rolePermissions['coach'], defaultPermissions: ['other.unknown'] };
    expect(() => prepareRoleChange(data, 'coach', { kind: 'restore-defaults' }, 'test-actor')).toThrow('invalid-argument');
  });
  it.each([
    ['admin.roles.entry', ['event.create', 'admin.roles.entry']],
    ['非陣列', 'event.create'],
    ['非字串', ['event.create', 3]],
    ['空字串', ['event.create', '']],
    ['正規化後會變的未知碼', ['event.create', ' future.code']],
  ] as const)('%s 照舊拒絕', (_name, raw) => {
    const data = rolesFixture();
    data.rolePermissions['coach'] = { permissions: raw };
    expect(() => prepareRoleChange(data, 'coach', { kind: 'toggle', code: 'event.publish' }, 'test-actor')).toThrow('invalid-argument');
  });
  it('admin.roles.entry 不論在哪裡都拒絕', () => {
    expect(() => validatePermissions(['admin.roles.entry'], 'coach', [], ['admin.roles.entry'])).toThrow();
    expect(() => prepareRoleChange(rolesFixture(), 'coach', { kind: 'toggle', code: 'admin.roles.entry' }, 'test-actor')).toThrow();
  });
});
