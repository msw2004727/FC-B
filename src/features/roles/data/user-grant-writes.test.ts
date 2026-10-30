import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prepareUserGrantChange, type UserGrantAction, type UserGrantSnapshot } from './user-grant-model';
import { loadUserGrant } from './user-grant-admin';
import { toggleUserGrantEnabled, toggleUserGrantPermission } from './user-grant-writes';

let uid: string | null = 'test-actor';
let role = 'super_admin';
let current: Record<string, unknown> | null;
const mockViewer = vi.fn();
const mockFirebase = vi.fn();
const mockDoc = vi.fn();
const mockCollection = vi.fn();
const mockRead = vi.fn();
const mockBatch = vi.fn();
const mockSet = vi.fn();
const mockCommit = vi.fn();
const mockRefresh = vi.fn();
const mockOpLog = vi.fn();
const stamp = { serverTimestamp: true };
vi.mock('@/data/auth', () => ({ getLastKnownAuthUid: () => uid }));
vi.mock('@/features/profile/data/viewer', () => ({ loadViewer: () => mockViewer(), requestViewerRefresh: () => mockRefresh() }));
vi.mock('@/data/firebase', () => ({ getFirebase: () => mockFirebase() }));
vi.mock('@/data/op-log', () => ({ writeOpLog: (...args: unknown[]) => mockOpLog(...args) }));
vi.mock('firebase/firestore', () => ({
  doc: (...args: unknown[]) => mockDoc(...args), collection: (...args: unknown[]) => mockCollection(...args),
  getDocFromServer: (...args: unknown[]) => mockRead(...args), serverTimestamp: () => stamp,
  writeBatch: (...args: unknown[]) => mockBatch(...args),
}));
const operations = [
  { kind: 'toggle_permission', action: { kind: 'toggle_permission', code: 'event.publish' }, write: toggleUserGrantPermission },
  { kind: 'update_enabled', action: { kind: 'update_enabled' }, write: toggleUserGrantEnabled },
] satisfies { kind: string; action: UserGrantAction; write: typeof toggleUserGrantEnabled }[];
const fixture = (): UserGrantSnapshot => ({ uid: 'test-target', targetName: '合成用戶',
  document: { uid: 'test-target', permissions: ['event.create'], enabled: true, updatedAt: { seconds: 1 } } });
const snap = () => ({ exists: () => current !== null, data: () => current });
function noFirestore(): void {
  for (const call of [mockFirebase, mockDoc, mockCollection, mockRead, mockBatch, mockSet, mockCommit]) expect(call).not.toHaveBeenCalled();
}
beforeEach(() => {
  vi.resetAllMocks(); uid = 'test-actor'; role = 'super_admin'; current = fixture().document;
  mockViewer.mockImplementation(async () => ({ uid, role, displayName: '合成操作者' }));
  mockFirebase.mockResolvedValue({ db: {} });
  mockDoc.mockImplementation((...args: unknown[]) => args.length === 1 ? { path: String(args[0]) + '/test-audit' } : { path: args.slice(1).join('/') });
  mockCollection.mockImplementation((...args: unknown[]) => args.slice(1).join('/'));
  mockRead.mockImplementation(async () => snap());
  mockBatch.mockImplementation(() => ({ set: mockSet, commit: mockCommit }));
  mockCommit.mockImplementation(async () => { current = mockSet.mock.calls[0]?.[1] as Record<string, unknown>; });
});

describe('T-079b 公開寫入守衛與 batch', () => {
  for (const operation of operations) describe(operation.kind, () => {
    function setup() {
      const original = fixture();
      return { original, preview: prepareUserGrantChange(original, operation.action, 'test-actor') };
    }
    it.each(['admin', 'captain', 'coach', 'venue_owner', 'user', 'guest'])('G10 %s 直呼拒絕且 Firestore 零呼叫', async denied => {
      const { original, preview } = setup(); role = denied;
      await expect(operation.write(original, preview, preview.fingerprint)).rejects.toMatchObject({ code: 'permission-denied' });
      noFirestore();
    });
    it('G11 未登入拒絕；viewer 不得查詢', async () => {
      const { original, preview } = setup(); uid = null;
      await expect(operation.write(original, preview, preview.fingerprint)).rejects.toMatchObject({ code: 'permission-denied' });
      expect(mockViewer).not.toHaveBeenCalled(); noFirestore();
    });
    it('G12 viewer UID 不符拒絕', async () => {
      const { original, preview } = setup();
      mockViewer.mockResolvedValueOnce({ uid: 'other-test', role: 'super_admin' });
      await expect(operation.write(original, preview, preview.fingerprint)).rejects.toMatchObject({ code: 'permission-denied' });
      noFirestore();
    });
    it('G13 loadViewer await 期間換帳號拒絕', async () => {
      const { original, preview } = setup();
      mockViewer.mockImplementationOnce(async () => { await Promise.resolve(); uid = 'other-test'; return { uid: 'test-actor', role }; });
      await expect(operation.write(original, preview, preview.fingerprint)).rejects.toMatchObject({ code: 'permission-denied' });
      noFirestore();
    });
    it('G14 getFirebase await 期間換帳號在 doc 之前拒絕', async () => {
      const { original, preview } = setup();
      mockFirebase.mockImplementationOnce(async () => { await Promise.resolve(); uid = 'other-test'; return { db: {} }; });
      await expect(operation.write(original, preview, preview.fingerprint)).rejects.toMatchObject({ code: 'permission-denied' });
      expect(mockFirebase).toHaveBeenCalledOnce();
      for (const call of [mockDoc, mockRead, mockBatch, mockSet, mockCommit]) expect(call).not.toHaveBeenCalled();
    });
    it('G15 server read await 期間換帳號拒絕，batch 零呼叫', async () => {
      const { original, preview } = setup();
      mockRead.mockImplementationOnce(async () => { await Promise.resolve(); uid = 'other-test'; return snap(); });
      await expect(operation.write(original, preview, preview.fingerprint)).rejects.toMatchObject({ code: 'permission-denied' });
      expect(mockRead).toHaveBeenCalledOnce(); expect(mockBatch).not.toHaveBeenCalled(); expect(mockSet).not.toHaveBeenCalled();
    });
    it('G16 動作與公開入口不符拒絕', async () => {
      const original = fixture();
      const other = operations.find(item => item !== operation)!;
      const preview = prepareUserGrantChange(original, other.action, 'test-actor');
      await expect(operation.write(original, preview, preview.fingerprint)).rejects.toMatchObject({ code: 'invalid-argument' });
      noFirestore();
    });
    it('M14 未確認不寫', async () => {
      const { original, preview } = setup();
      for (const proof of [null, '', 'unconfirmed']) {
        await expect(operation.write(original, preview, proof)).rejects.toMatchObject({ code: 'confirmation-required' });
      }
      noFirestore();
    });
    it('M15 完整文件任一欄不同即 stale，不建立 batch', async () => {
      const { original, preview } = setup(); current = { ...current, anotherField: true };
      await expect(operation.write(original, preview, preview.fingerprint)).rejects.toMatchObject({ code: 'stale-document' });
      expect(mockRead).toHaveBeenCalledOnce(); expect(mockBatch).not.toHaveBeenCalled(); expect(mockSet).not.toHaveBeenCalled();
    });
    it('M10 super_admin 成功：兩份文件同一 batch、精確欄位與 audit 前後值', async () => {
      const { original, preview } = setup();
      const result = await operation.write(original, preview, preview.fingerprint);
      expect(mockBatch).toHaveBeenCalledOnce(); expect(mockSet).toHaveBeenCalledTimes(2); expect(mockCommit).toHaveBeenCalledOnce();
      expect(mockSet.mock.calls[0]).toEqual([{ path: 'userPermissionGrants/test-target' }, { ...preview.payload, updatedAt: stamp }]);
      expect(mockSet.mock.calls[1]).toEqual([{ path: 'userPermissionGrantAudit/test-target/entries/test-audit' }, {
        targetUid: 'test-target', targetName: '合成用戶', actorUid: 'test-actor', action: operation.kind,
        changedPermission: operation.action.kind === 'toggle_permission' ? 'event.publish' : '',
        enabled: preview.payload.enabled, previousEnabled: true,
        permissions: preview.payload.permissions, previousPermissions: ['event.create'], at: stamp,
      }]);
      expect(mockCommit.mock.invocationCallOrder[0]!).toBeGreaterThan(mockSet.mock.invocationCallOrder[1]!);
      expect(result).toEqual({ document: { ...preview.payload, updatedAt: stamp }, refreshFailed: false });
      expect(mockRead).toHaveBeenCalledTimes(2); expect(mockOpLog).not.toHaveBeenCalled(); expect(mockRefresh).toHaveBeenCalledOnce();
      expect(original).toEqual(fixture());
    });
    it.each([
      { permissions: 'event.create' }, { permissions: [123] }, { permissions: ['unknown.code'] },
      { permissions: ['admin.roles.entry'] }, { permissions: Array(501).fill('event.create') },
      { uid: 'other-target' }, { enabled: 'false' },
    ])('G25 直呼的原始文件格式拒絕 %j', async invalid => {
      const { original, preview } = setup(); original.document = { ...original.document, ...invalid };
      await expect(operation.write(original, preview, preview.fingerprint)).rejects.toMatchObject({ code: 'invalid-argument' });
      noFirestore();
    });
    it('G26 直呼目標 UID 路徑拒絕', async () => {
      const { original, preview } = setup(); original.uid = 'bad/path';
      await expect(operation.write(original, preview, preview.fingerprint)).rejects.toMatchObject({ code: 'invalid-argument' }); noFirestore();
    });
    it('G27 原始 500 筆邊界可寫，audit 與主文件都去重', async () => {
      const original = fixture(); original.document!['permissions'] = Array(500).fill('event.create');
      const preview = prepareUserGrantChange(original, operation.action, 'test-actor'); current = structuredClone(original.document);
      await operation.write(original, preview, preview.fingerprint);
      expect(mockCommit).toHaveBeenCalledOnce();
      expect(mockSet.mock.calls[0]?.[1].permissions).toEqual(preview.payload.permissions);
      expect(mockSet.mock.calls[1]?.[1].previousPermissions).toEqual(['event.create']);
    });
    it('G17 batch 拒絕整體失敗，不重讀、不 refresh', async () => {
      const { original, preview } = setup(); mockCommit.mockRejectedValueOnce(new Error('synthetic-failure'));
      await expect(operation.write(original, preview, preview.fingerprint)).rejects.toThrow('synthetic-failure');
      expect(mockRead).toHaveBeenCalledOnce(); expect(mockRefresh).not.toHaveBeenCalled();
    });
    it('G18 提交後重讀失敗回已提交結果', async () => {
      const { original, preview } = setup(); mockRead.mockResolvedValueOnce(snap()).mockRejectedValueOnce(new Error('synthetic-read'));
      expect(await operation.write(original, preview, preview.fingerprint)).toEqual({ document: preview.after, refreshFailed: true });
      expect(mockCommit).toHaveBeenCalledOnce();
    });
    it.each(['missing', 'invalid'])('G28 readback %s 保留提交值並要求重載', async condition => {
      const { original, preview } = setup();
      mockRead.mockResolvedValueOnce(snap()).mockResolvedValueOnce({ exists: () => condition !== 'missing',
        data: () => condition === 'missing' ? undefined : { ...preview.after, uid: 'other-test-target' } });
      expect(await operation.write(original, preview, preview.fingerprint)).toEqual({ document: preview.after, refreshFailed: true });
      expect(mockCommit).toHaveBeenCalledOnce();
    });
    it('G19 commit await 期間換帳號，不重讀也不 refresh', async () => {
      const { original, preview } = setup(); mockCommit.mockImplementationOnce(async () => { uid = 'other-test'; });
      expect(await operation.write(original, preview, preview.fingerprint)).toEqual({ document: preview.after, refreshFailed: true });
      expect(mockRead).toHaveBeenCalledOnce(); expect(mockRefresh).not.toHaveBeenCalled();
    });
    it('G20 readback await 期間換帳號，不回傳他人資料', async () => {
      const { original, preview } = setup(); mockRead.mockResolvedValueOnce(snap()).mockImplementationOnce(async () => {
        uid = 'other-test'; return { exists: () => true, data: () => ({ ...preview.after, updatedAt: 'different' }) };
      });
      expect(await operation.write(original, preview, preview.fingerprint)).toEqual({ document: preview.after, refreshFailed: true });
    });
  });
  it('G30 停用授權寫入 false，稽核保留啟用狀態前後值', async () => {
    const original = fixture();
    const preview = prepareUserGrantChange(original, { kind: 'update_enabled' }, 'test-actor');
    const result = await toggleUserGrantEnabled(original, preview, preview.fingerprint);
    expect(mockSet).toHaveBeenCalledTimes(2); expect(mockCommit).toHaveBeenCalledOnce();
    expect(mockSet.mock.calls[0]).toEqual([{ path: 'userPermissionGrants/test-target' }, {
      uid: 'test-target', permissions: ['event.create'], enabled: false, updatedAt: stamp,
    }]);
    expect(mockSet.mock.calls[1]).toEqual([{ path: 'userPermissionGrantAudit/test-target/entries/test-audit' }, {
      targetUid: 'test-target', targetName: '合成用戶', actorUid: 'test-actor', action: 'update_enabled',
      changedPermission: '', enabled: false, previousEnabled: true,
      permissions: ['event.create'], previousPermissions: ['event.create'], at: stamp,
    }]);
    expect(result.document['enabled']).toBe(false); expect(original.document!['enabled']).toBe(true);
  });
  it('M12 直呼停用文件切碼拒絕，啟用動作可獨立新建', async () => {
    const original = fixture();
    const preview = prepareUserGrantChange(original, { kind: 'toggle_permission', code: 'event.publish' }, 'test-actor');
    original.document!['enabled'] = false;
    await expect(toggleUserGrantPermission(original, preview, preview.fingerprint)).rejects.toMatchObject({ code: 'grant-disabled' });
    noFirestore();
    const missing = { ...fixture(), document: null }; current = null;
    const enable = prepareUserGrantChange(missing, { kind: 'update_enabled' }, 'test-actor');
    await toggleUserGrantEnabled(missing, enable, enable.fingerprint);
    expect(mockSet.mock.calls[0]?.[1]).toEqual({ uid: 'test-target', permissions: [], enabled: true, updatedAt: stamp });
    expect(mockSet.mock.calls[1]?.[1]).toMatchObject({ previousEnabled: false, previousPermissions: [], changedPermission: '' });
  });
  it.each(['admin', 'captain', 'coach', 'venue_owner', 'user', 'guest'])('G21 單筆讀取也拒絕 %s', async denied => {
    role = denied;
    await expect(loadUserGrant('test-target', '合成用戶')).rejects.toMatchObject({ code: 'permission-denied' }); noFirestore();
  });
  it.each(['firebase', 'read'])('G23 單筆讀取 %s await 換帳號拒絕', async stage => {
    if (stage === 'firebase') mockFirebase.mockImplementationOnce(async () => { uid = 'other-test'; return { db: {} }; });
    else mockRead.mockImplementationOnce(async () => { uid = 'other-test'; return snap(); });
    await expect(loadUserGrant('test-target', '合成用戶')).rejects.toMatchObject({ code: 'permission-denied' });
    if (stage === 'firebase') { expect(mockDoc).not.toHaveBeenCalled(); expect(mockRead).not.toHaveBeenCalled(); }
    else expect(mockRead).toHaveBeenCalledOnce();
    expect(mockBatch).not.toHaveBeenCalled();
  });
  it('G24 單筆讀取拒絕路徑 UID，缺文件與失敗分開', async () => {
    await expect(loadUserGrant('bad/path', '合成用戶')).rejects.toMatchObject({ code: 'invalid-argument' }); noFirestore();
    current = null;
    expect(await loadUserGrant('test-target', '合成用戶')).toEqual({ ...fixture(), document: null });
    mockRead.mockRejectedValueOnce(new Error('synthetic-read'));
    await expect(loadUserGrant('test-target', '合成用戶')).rejects.toThrow('synthetic-read');
  });
  it('G22 單筆 server read 保留原始文件，不載入 grant 集合', async () => {
    expect(await loadUserGrant('test-target', '合成用戶')).toEqual(fixture());
    expect(mockDoc).toHaveBeenCalledExactlyOnceWith({}, 'userPermissionGrants', 'test-target');
    expect(mockRead).toHaveBeenCalledOnce(); expect(mockCollection).not.toHaveBeenCalled(); expect(mockBatch).not.toHaveBeenCalled();
  });
});
