import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RoleAction, RolePreview } from './role-model';
import { prepareRoleChange } from './role-model';
import { rolesFixture } from './role-test-fixtures';

let role = 'super_admin';
let uid: string | null = 'test-actor';
let current: Record<string, unknown> | null;
const mockViewer = vi.fn(async () => ({ uid, role, displayName: '測試操作者' }));
const mockRefresh = vi.fn();
const mockFirebase = vi.fn(async () => ({ db: {} }));
const mockSet = vi.fn();
const mockRead = vi.fn();
const mockLog = vi.fn();
const mockRun = vi.fn();
const stamp = { serverTimestamp: true };
vi.mock('@/data/auth', () => ({ getLastKnownAuthUid: () => uid }));
vi.mock('@/features/profile/data/viewer', () => ({
  loadViewer: () => mockViewer(),
  requestViewerRefresh: () => mockRefresh(),
}));
vi.mock('@/data/firebase', () => ({ getFirebase: () => mockFirebase() }));
vi.mock('@/data/op-log', () => ({ writeOpLog: (...args: unknown[]) => mockLog(...args) }));
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, collection: string, id: string) => ({ collection, id }),
  serverTimestamp: () => stamp,
  getDocFromServer: (...args: unknown[]) => mockRead(...args),
  runTransaction: (...args: unknown[]) => mockRun(...args),
}));

import {
  ENABLE_ROLES_OPLOG, ROLES_WRITE_CONFIRM_ENABLED, resetRolePermissions,
  saveRoleActivityCapabilities, saveRolePermissionDefaults, saveRolePermissions,
} from './role-admin-writes';

const operations = [
  { name: 'toggle', action: { kind: 'toggle', code: 'event.publish' }, role: 'coach', write: saveRolePermissions },
  { name: 'save-defaults', action: { kind: 'save-defaults' }, role: 'coach', write: saveRolePermissionDefaults },
  { name: 'restore-defaults', action: { kind: 'restore-defaults' }, role: 'coach', write: resetRolePermissions },
  { name: 'capability', action: { kind: 'capability', code: 'user.activity.basic_create' }, role: 'user', write: saveRoleActivityCapabilities },
] satisfies { name: string; action: RoleAction; role: string; write: typeof saveRolePermissions }[];

beforeEach(() => {
  vi.resetAllMocks();
  role = 'super_admin'; uid = 'test-actor'; current = null;
  mockViewer.mockImplementation(async () => ({ uid, role, displayName: '測試操作者' }));
  mockFirebase.mockResolvedValue({ db: {} });
  mockLog.mockResolvedValue(undefined);
  mockRead.mockImplementation(async () => ({ exists: () => current !== null, data: () => current }));
  mockRun.mockImplementation(async (_db: unknown, callback: (tx: unknown) => Promise<void>) => {
    await callback({
      get: async () => ({ exists: () => current !== null, data: () => current }),
      set: mockSet,
    });
    const last = mockSet.mock.calls[mockSet.mock.calls.length - 1];
    if (last) current = { ...current, ...(last[1] as object) };
  });
});

describe('T-079a 寫入層授權核心', () => {
  it.each(operations)('S2b $name getFirebase 等待期間換帳號，在交易前拒絕', async operation => {
    const data = rolesFixture();
    const preview = prepareRoleChange(data, operation.role, operation.action, 'test-actor');
    current = structuredClone(preview.before);
    mockFirebase.mockImplementationOnce(async () => {
      await Promise.resolve();
      uid = 'other-test-actor';
      return { db: {} };
    });
    await expect(operation.write(data, preview, preview.fingerprint)).rejects.toMatchObject({ code: 'permission-denied' });
    expect(mockFirebase).toHaveBeenCalledOnce();
    expect(mockRun).not.toHaveBeenCalled();
    expect(mockSet).not.toHaveBeenCalled();
    expect(mockRead).not.toHaveBeenCalled();
    expect(mockLog).not.toHaveBeenCalled();
  });
  it('兩旗標預設開', () => {
    expect(ENABLE_ROLES_OPLOG).toBe(true);
    expect(ROLES_WRITE_CONFIRM_ENABLED).toBe(true);
  });
  for (const operation of operations) {
    describe(operation.name, () => {
      function setup(): { data: ReturnType<typeof rolesFixture>; preview: RolePreview } {
        const data = rolesFixture();
        const preview = prepareRoleChange(data, operation.role, operation.action, 'test-actor');
        current = structuredClone(preview.before);
        return { data, preview };
      }
      it.each(['guest', 'user', 'coach', 'captain', 'venue_owner', 'admin'])('M1/M2 直呼拒絕 %s 且 Firestore 零呼叫', async denied => {
        const { data, preview } = setup();
        role = denied;
        await expect(operation.write(data, preview, preview.fingerprint)).rejects.toMatchObject({ code: 'permission-denied' });
        expect(mockFirebase).not.toHaveBeenCalled();
        expect(mockSet).not.toHaveBeenCalled();
        expect(mockLog).not.toHaveBeenCalled();
      });
      it('S1 動作與公開入口不符即拒絕，Firestore 零呼叫', async () => {
        const { data } = setup();
        const other = operations.find(item => item.name !== operation.name)!;
        const preview = prepareRoleChange(data, other.role, other.action, 'test-actor');
        current = structuredClone(preview.before);
        await expect(operation.write(data, preview, preview.fingerprint)).rejects.toMatchObject({ code: 'invalid-argument' });
        expect(mockFirebase).not.toHaveBeenCalled();
        expect(mockRun).not.toHaveBeenCalled();
        expect(mockSet).not.toHaveBeenCalled();
        expect(mockRead).not.toHaveBeenCalled();
        expect(mockLog).not.toHaveBeenCalled();
      });
      it('S2 交易讀取期間 auth UID 改變即拒絕，不寫入', async () => {
        const { data, preview } = setup();
        mockRun.mockImplementationOnce(async (_db: unknown, callback: (tx: unknown) => Promise<void>) =>
          callback({ get: async () => {
            uid = 'other-test-actor';
            return { exists: () => current !== null, data: () => current };
          }, set: mockSet }));
        await expect(operation.write(data, preview, preview.fingerprint)).rejects.toMatchObject({ code: 'permission-denied' });
        expect(mockRun).toHaveBeenCalledOnce();
        expect(mockSet).not.toHaveBeenCalled();
        expect(mockLog).not.toHaveBeenCalled();
        expect(mockRead).not.toHaveBeenCalled();
        expect(mockRefresh).not.toHaveBeenCalled();
      });
      it('S3 loadViewer 回傳他人 UID 即拒絕，auth UID 維持原人', async () => {
        const { data, preview } = setup();
        mockViewer.mockResolvedValueOnce({ uid: 'other-test-actor', role: 'super_admin', displayName: '另一測試操作者' });
        await expect(operation.write(data, preview, preview.fingerprint)).rejects.toMatchObject({ code: 'permission-denied' });
        expect(uid).toBe('test-actor');
        expect(mockFirebase).not.toHaveBeenCalled();
        expect(mockSet).not.toHaveBeenCalled();
        expect(mockLog).not.toHaveBeenCalled();
      });
      it('未登入直呼拒絕', async () => {
        const { data, preview } = setup(); uid = null;
        await expect(operation.write(data, preview, preview.fingerprint)).rejects.toMatchObject({ code: 'permission-denied' });
        expect(mockFirebase).not.toHaveBeenCalled();
        expect(mockSet).not.toHaveBeenCalled();
      });
      it('M14 未確認與錯誤確認均拒絕', async () => {
        const { data, preview } = setup();
        for (const proof of [null, '', 'unrelated']) {
          await expect(operation.write(data, preview, proof)).rejects.toMatchObject({ code: 'confirmation-required' });
        }
        expect(mockFirebase).not.toHaveBeenCalled();
      });
      it('M15 最新文件任一欄變更即中止', async () => {
        const { data, preview } = setup();
        current = { ...current, otherAdmin: true };
        await expect(operation.write(data, preview, preview.fingerprint)).rejects.toMatchObject({ code: 'stale-document' });
        expect(mockSet).not.toHaveBeenCalled();
        expect(mockLog).not.toHaveBeenCalled();
      });
      it('M9/M19 成功只 merge 指定欄位，保留 catalogVersion 與 meta 並記操作日誌', async () => {
        const { data, preview } = setup();
        const result = await operation.write(data, preview, preview.fingerprint);
        const expected = operation.name === 'capability'
          ? { capabilities: [], updatedAt: stamp, updatedBy: 'test-actor' } : preview.payload;
        expect(mockSet).toHaveBeenCalledExactlyOnceWith(
          { collection: preview.collection, id: preview.role }, expected, { merge: true },
        );
        expect(result.document['catalogVersion']).toBe(preview.before?.['catalogVersion']);
        expect(result.document['defaultCapabilities']).toEqual(preview.before?.['defaultCapabilities']);
        expect(mockRead).toHaveBeenCalledOnce();
        expect(mockLog).toHaveBeenCalledOnce();
        expect(mockLog.mock.calls[0]?.[0]).toMatchObject({
          actorUid: 'test-actor', operator: '測試操作者',
          type: operation.name === 'capability' ? 'role_cap_edit' : 'role_perm_edit',
        });
        expect(mockLog.mock.calls[0]?.[0]).not.toHaveProperty('uid');
        expect(mockLog.mock.calls[0]?.[0].content).not.toContain('test-actor');
        expect(mockRefresh).toHaveBeenCalledOnce();
      });
      it('opLog 旗標關閉仍寫主文件但不記錄', async () => {
        const { data, preview } = setup();
        await operation.write(data, preview, preview.fingerprint, { opLogEnabled: false });
        expect(mockSet).toHaveBeenCalledOnce();
        expect(mockLog).not.toHaveBeenCalled();
      });
      it('寫入失敗不記日誌、不重讀、不發 viewer refresh', async () => {
        const { data, preview } = setup();
        mockRun.mockRejectedValueOnce(new Error('synthetic-write-failure'));
        await expect(operation.write(data, preview, preview.fingerprint)).rejects.toThrow('synthetic-write-failure');
        expect(mockLog).not.toHaveBeenCalled();
        expect(mockRead).not.toHaveBeenCalled();
        expect(mockRefresh).not.toHaveBeenCalled();
      });
    });
  }
  it('篡改 payload 或 action 無法重用已確認內容', async () => {
    const data = rolesFixture();
    const preview = prepareRoleChange(data, 'coach', { kind: 'toggle', code: 'event.publish' }, 'test-actor');
    current = preview.before;
    await expect(saveRolePermissions(data, { ...preview, payload: { permissions: ['event.delete'] } }, preview.fingerprint))
      .rejects.toMatchObject({ code: 'confirmation-required' });
    await expect(saveRolePermissions(data, { ...preview, action: { kind: 'toggle', code: 'event.delete' } }, preview.fingerprint))
      .rejects.toMatchObject({ code: 'confirmation-required' });
    expect(mockSet).not.toHaveBeenCalled();
  });
  it('換帳號／登出發生在 viewer 載入或交易讀取後均拒絕', async () => {
    const data = rolesFixture();
    const preview = prepareRoleChange(data, 'coach', { kind: 'toggle', code: 'event.publish' }, 'test-actor');
    current = preview.before;
    mockViewer.mockImplementationOnce(async () => { uid = 'different-test-actor'; return { uid: 'test-actor', role: 'super_admin', displayName: '測試操作者' }; });
    await expect(saveRolePermissions(data, preview, preview.fingerprint)).rejects.toMatchObject({ code: 'permission-denied' });
    uid = 'test-actor';
    mockRun.mockImplementationOnce(async (_db: unknown, callback: (tx: unknown) => Promise<void>) =>
      callback({ get: async () => { uid = null; return { exists: () => true, data: () => current }; }, set: mockSet }));
    await expect(saveRolePermissions(data, preview, preview.fingerprint)).rejects.toMatchObject({ code: 'permission-denied' });
    expect(mockSet).not.toHaveBeenCalled();
  });
  it('opLog 失敗只 warn，主操作仍成功', async () => {
    const data = rolesFixture();
    const preview = prepareRoleChange(data, 'coach', { kind: 'toggle', code: 'event.publish' }, 'test-actor');
    current = preview.before;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      mockLog.mockRejectedValueOnce(new Error('synthetic-log-failure'));
      expect((await saveRolePermissions(data, preview, preview.fingerprint)).refreshFailed).toBe(false);
      expect(warn).toHaveBeenCalledOnce();
    } finally { warn.mockRestore(); }
  });
  it('已提交後重讀失敗不假報寫入失敗', async () => {
    const data = rolesFixture();
    const preview = prepareRoleChange(data, 'coach', { kind: 'toggle', code: 'event.publish' }, 'test-actor');
    current = preview.before;
    mockRead.mockRejectedValueOnce(new Error('synthetic-read-failure'));
    expect(await saveRolePermissions(data, preview, preview.fingerprint)).toEqual({ document: preview.after, refreshFailed: true });
    expect(mockSet).toHaveBeenCalledOnce();
  });
});
