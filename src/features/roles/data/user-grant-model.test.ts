import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getUserPermissionGrantAllowedCodes, normalizePermissionCode } from '@/features/profile/data/permissions';
import { assertGrantUid, grantState, prepareUserGrantChange, validateGrantPermissions, type UserGrantAction, type UserGrantSnapshot } from './user-grant-model';
vi.mock('@/features/profile/data/permissions', async importOriginal => {
  const actual = await importOriginal<typeof import('@/features/profile/data/permissions')>();
  return { ...actual, getUserPermissionGrantAllowedCodes: vi.fn(actual.getUserPermissionGrantAllowedCodes), normalizePermissionCode: vi.fn(actual.normalizePermissionCode) };
});
const real = await vi.importActual<typeof import('@/features/profile/data/permissions')>('@/features/profile/data/permissions');
beforeEach(() => {
  vi.mocked(getUserPermissionGrantAllowedCodes).mockImplementation(real.getUserPermissionGrantAllowedCodes);
  vi.mocked(normalizePermissionCode).mockImplementation(real.normalizePermissionCode);
});
const fixture = (): UserGrantSnapshot => ({ uid: 'test-target', targetName: '合成用戶',
  document: { uid: 'test-target', permissions: ['event.create'], enabled: true, updatedAt: { seconds: 1 } } });

describe('個別授權模型', () => {
  it.each([null, 123, '', ' ', 'x/y', 'x\\y', '.', '..', '__reserved__', 'x\ny', 'x'.repeat(129), ' x'])('G01 拒絕目標 UID %j', uid => {
    expect(() => assertGrantUid(uid)).toThrow('invalid-argument');
  });
  it('G01 合成 UID 及 128 字邊界有效', () => {
    expect(() => assertGrantUid('test-target')).not.toThrow();
    expect(() => assertGrantUid('x'.repeat(128))).not.toThrow();
  });
  it('G01b 即使文件 UID 同樣含路徑，grantState 仍驗目標格式', () => {
    const snapshot = fixture(); snapshot.uid = 'bad/path'; snapshot.document!['uid'] = 'bad/path';
    expect(() => grantState(snapshot)).toThrow('invalid-argument');
  });
  it('G03b grantState 獨立驗原始 permissions，不靠下一次預覽重算', () => {
    for (const permissions of [null, ['unknown.code'], [123], Array(501).fill('event.create')]) {
      expect(() => grantState({ ...fixture(), document: { uid: 'test-target', permissions, enabled: true } })).toThrow('invalid-argument');
    }
  });
  it('G08b 停用狀態仍先拒絕未知 action code，獨立於結果驗證', () => {
    const snapshot = fixture(); snapshot.document!['enabled'] = false;
    expect(() => prepareUserGrantChange(snapshot, { kind: 'toggle_permission', code: 'unknown.code' }, 'test-actor')).toThrow('invalid-argument');
  });
  it('G02 文件 UID 必須等於目標，enabled 必須布林', () => {
    for (const document of [{ uid: 'other-test', permissions: [] }, { uid: 'test-target', permissions: [], enabled: 'false' }]) {
      expect(() => grantState({ ...fixture(), document })).toThrow('invalid-argument');
    }
  });
  it.each([null, {}, 'event.create', [123], ['unknown.code'], ['admin.roles.entry'], ['event.edit_own'], [' event.create'], ['']])(
    'G03 未知、非陣列、非字串、停用與舊碼拒絕 %j', raw => {
      expect(() => validateGrantPermissions(raw)).toThrow('invalid-argument');
    });
  it('G04 停用碼檢查獨立於允許清單', () => {
    vi.mocked(getUserPermissionGrantAllowedCodes).mockReturnValue(['admin.roles.entry']);
    expect(() => validateGrantPermissions(['admin.roles.entry'])).toThrow('invalid-argument');
  });
  it('G05 非字串檢查獨立於後續正規化與 allowlist', () => {
    // 刻意讓後續兩層接受數字，單獨驗證原始字串型別防線。
    vi.mocked(normalizePermissionCode).mockImplementation(code => code as string);
    vi.mocked(getUserPermissionGrantAllowedCodes).mockReturnValue([123] as unknown as string[]);
    expect(() => validateGrantPermissions([123])).toThrow('invalid-argument');
  });
  it('M11 501 筆在去重前拒絕，500 筆邊界接受後去重', () => {
    expect(() => validateGrantPermissions(Array(501).fill('event.create'))).toThrow('invalid-argument');
    expect(validateGrantPermissions(Array(500).fill('event.create'))).toEqual(['event.create']);
  });
  it('M11 寫前也檢查原文件 501，500 可獨立啟停', () => {
    const snapshot = fixture();
    snapshot.document!['permissions'] = Array(501).fill('event.create');
    expect(() => prepareUserGrantChange(snapshot, { kind: 'update_enabled' }, 'test-actor')).toThrow('invalid-argument');
    snapshot.document!['permissions'] = Array(500).fill('event.create');
    expect(prepareUserGrantChange(snapshot, { kind: 'update_enabled' }, 'test-actor').payload.permissions).toEqual(['event.create']);
  });
  it('M11c 新增後第 501 碼拒絕，獨立於原文件長度檢查', () => {
    const codes = Array.from({ length: 501 }, (_, i) => 'synthetic.code.' + i);
    vi.mocked(getUserPermissionGrantAllowedCodes).mockReturnValue(codes);
    const snapshot = fixture(); snapshot.document!['permissions'] = codes.slice(0, 500);
    expect(() => prepareUserGrantChange(snapshot, { kind: 'toggle_permission', code: codes[500]! }, 'test-actor')).toThrow('invalid-argument');
  });
  it('M12 停用時切碼拒絕，獨立啟用不改權限', () => {
    const snapshot = fixture(); snapshot.document!['enabled'] = false;
    expect(() => prepareUserGrantChange(snapshot, { kind: 'toggle_permission', code: 'event.publish' }, 'test-actor')).toThrow('grant-disabled');
    const enabled = prepareUserGrantChange(snapshot, { kind: 'update_enabled' }, 'test-actor');
    expect(enabled.payload).toEqual({ uid: 'test-target', permissions: ['event.create'], enabled: true, updatedAt: 'SERVER_TIMESTAMP' });
    expect(snapshot.document!['enabled']).toBe(false);
  });
  it('G29 停用授權的預覽列出啟用狀態前後值', () => {
    const snapshot = fixture();
    const preview = prepareUserGrantChange(snapshot, { kind: 'update_enabled' }, 'test-actor');
    expect(preview.before?.['enabled']).toBe(true);
    expect(preview.after['enabled']).toBe(false);
    expect(preview.payload.enabled).toBe(false);
    const changedFields = Object.keys(preview.after).filter(key => preview.before?.[key] !== preview.after[key]);
    expect(changedFields).toContain('enabled');
    expect(preview.payload.permissions).toEqual(['event.create']);
    expect(preview.added).toEqual([]); expect(preview.removed).toEqual([]);
    expect(snapshot.document!['enabled']).toBe(true);
  });
  it('G06 缺文件初始停用；既有缺 enabled 沿 A 視為啟用；空清單保留', () => {
    expect(grantState({ ...fixture(), document: null })).toEqual({ permissions: [], enabled: false });
    expect(grantState({ ...fixture(), document: { uid: 'test-target', permissions: [] } })).toEqual({ permissions: [], enabled: true });
  });
  it('G07 整份取代的 diff 涵蓋額外欄位、時間、順序與動作', () => {
    const snapshot = fixture(); snapshot.document!['oldField'] = '合成值';
    const action: UserGrantAction = { kind: 'toggle_permission', code: 'event.create' };
    const preview = prepareUserGrantChange(snapshot, action, 'test-actor');
    expect(preview.before).toEqual(snapshot.document);
    expect(preview.after).toEqual({ uid: 'test-target', permissions: [], enabled: true, updatedAt: 'SERVER_TIMESTAMP' });
    expect(preview.removed).toEqual(['event.create']);
    expect(preview.added).toEqual([]);
    const changed = { ...snapshot, document: { ...snapshot.document, oldField: '另一值' } };
    expect(prepareUserGrantChange(changed, action, 'test-actor').fingerprint).not.toBe(preview.fingerprint);
  });
  it('G09 操作者、名稱與空動作必須有效', () => {
    expect(() => prepareUserGrantChange(fixture(), { kind: 'update_enabled' }, '')).toThrow('invalid-argument');
    expect(() => prepareUserGrantChange({ ...fixture(), targetName: 123 as unknown as string }, { kind: 'update_enabled' }, 'test-actor')).toThrow('invalid-argument');
    expect(() => prepareUserGrantChange(fixture(), null as unknown as UserGrantAction, 'test-actor')).toThrow('invalid-argument');
  });
  it.each([{ kind: 'bad' }, { kind: 'toggle_permission', code: 'bad' }, { kind: 'update_enabled', enabled: true },
    { kind: 'toggle_permission', code: 'event.create', 'permissions.extra': true }])('G08 動作結構拒絕 %j', action => {
    expect(() => prepareUserGrantChange(fixture(), action as UserGrantAction, 'test-actor')).toThrow();
  });
});
