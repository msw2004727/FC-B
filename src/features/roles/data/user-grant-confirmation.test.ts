import { beforeEach, describe, expect, it, vi } from 'vitest';
import { assertOnlyTopLevelFields, canonical } from './role-model';
import { prepareUserGrantChange, type UserGrantSnapshot } from './user-grant-model';
import { loadUserGrant } from './user-grant-admin';
import { requireRoleAdmin } from './role-auth';
import { toggleUserGrantEnabled, toggleUserGrantPermission } from './user-grant-writes';
vi.mock('./role-model', async importOriginal => {
  const actual = await importOriginal<typeof import('./role-model')>();
  return { ...actual, canonical: vi.fn(actual.canonical), assertOnlyTopLevelFields: vi.fn(actual.assertOnlyTopLevelFields) };
});
vi.mock('./user-grant-model', async importOriginal => {
  const actual = await importOriginal<typeof import('./user-grant-model')>();
  return { ...actual, prepareUserGrantChange: vi.fn(actual.prepareUserGrantChange) };
});
vi.mock('./role-auth', async importOriginal => {
  const actual = await importOriginal<typeof import('./role-auth')>();
  return { ...actual, requireRoleAdmin: vi.fn(actual.requireRoleAdmin) };
});
const realModel = await vi.importActual<typeof import('./user-grant-model')>('./user-grant-model');
const realRole = await vi.importActual<typeof import('./role-model')>('./role-model');
const realAuth = await vi.importActual<typeof import('./role-auth')>('./role-auth');
let uid: string | null = 'test-actor';
let current: Record<string, unknown> | null;
const mockFirebase = vi.fn();
const mockRead = vi.fn();
const mockSet = vi.fn();
const mockBatch = vi.fn();
const mockCommit = vi.fn();
vi.mock('@/data/auth', () => ({ getLastKnownAuthUid: () => uid }));
vi.mock('@/features/profile/data/viewer', () => ({
  loadViewer: async () => ({ uid: 'test-actor', role: 'super_admin' }), requestViewerRefresh: () => undefined,
}));
vi.mock('@/data/firebase', () => ({ getFirebase: () => mockFirebase() }));
vi.mock('firebase/firestore', () => ({
  doc: (...args: unknown[]) => args, collection: (...args: unknown[]) => args,
  getDocFromServer: () => mockRead(), serverTimestamp: () => 'stamp', writeBatch: () => mockBatch(),
}));
function setup() {
  const original: UserGrantSnapshot = { uid: 'test-target', targetName: '合成用戶',
    document: { uid: 'test-target', permissions: ['event.create'], enabled: true, updatedAt: 1 } };
  current = structuredClone(original.document);
  const preview = realModel.prepareUserGrantChange(original, { kind: 'toggle_permission', code: 'event.publish' }, 'test-actor');
  return { original, preview };
}
beforeEach(() => {
  vi.resetAllMocks(); uid = 'test-actor';
  vi.mocked(prepareUserGrantChange).mockImplementation(realModel.prepareUserGrantChange);
  vi.mocked(canonical).mockImplementation(realRole.canonical);
  vi.mocked(assertOnlyTopLevelFields).mockImplementation(realRole.assertOnlyTopLevelFields);
  vi.mocked(requireRoleAdmin).mockImplementation(realAuth.requireRoleAdmin);
  mockFirebase.mockResolvedValue({ db: {} });
  mockRead.mockImplementation(async () => ({ exists: () => current !== null, data: () => current }));
  mockBatch.mockReturnValue({ set: mockSet, commit: mockCommit });
  mockCommit.mockResolvedValue(undefined);
});
function noWrite(): void { expect(mockBatch).not.toHaveBeenCalled(); expect(mockSet).not.toHaveBeenCalled(); expect(mockCommit).not.toHaveBeenCalled(); }

describe('個別授權確認守衛獨立覆蓋', () => {
  it('C01 入口指紋不同，尚未重算即拒絕', async () => {
    const { original, preview } = setup();
    await expect(toggleUserGrantPermission(original, { ...preview, fingerprint: 'different' }, preview.fingerprint))
      .rejects.toMatchObject({ code: 'confirmation-required' });
    expect(prepareUserGrantChange).not.toHaveBeenCalled(); expect(mockFirebase).not.toHaveBeenCalled(); noWrite();
  });
  it('C02 預覽操作者不同，入口獨立拒絕', async () => {
    const { original, preview } = setup();
    await expect(toggleUserGrantPermission(original, { ...preview, actorUid: 'other-test' }, preview.fingerprint))
      .rejects.toMatchObject({ code: 'confirmation-required' });
    expect(prepareUserGrantChange).not.toHaveBeenCalled(); noWrite();
  });
  it('C03 空確認即使預覽同為空仍由入口拒絕', async () => {
    const { original, preview } = setup();
    await expect(toggleUserGrantPermission(original, { ...preview, fingerprint: '' }, ''))
      .rejects.toMatchObject({ code: 'confirmation-required' });
    expect(prepareUserGrantChange).not.toHaveBeenCalled(); noWrite();
  });
  it('C04 initial 指紋獨立於完整 preview 比對', async () => {
    const { original, preview } = setup();
    // 僅使完整 preview 的外部 canonical 比對相等；模型內的指紋仍為原值。
    vi.mocked(canonical).mockReturnValue('same');
    await expect(toggleUserGrantPermission(original, { ...preview, fingerprint: 'unconfirmed' }, 'unconfirmed'))
      .rejects.toMatchObject({ code: 'confirmation-required' });
    expect(prepareUserGrantChange).toHaveBeenCalledOnce(); expect(mockFirebase).not.toHaveBeenCalled(); noWrite();
  });
  it.each(['uid', 'targetName', 'before', 'after', 'payload', 'added', 'removed'])('C05 預覽 %s 被改動不可沿用確認', async field => {
    const { original, preview } = setup();
    const changed = { ...preview, [field]: field === 'payload' ? { ...preview.payload, enabled: false } : 'tampered' };
    await expect(toggleUserGrantPermission(original, changed, preview.fingerprint)).rejects.toMatchObject({ code: 'confirmation-required' });
    expect(mockFirebase).not.toHaveBeenCalled(); noWrite();
  });
  it('C06 server before 不同在第二次模型重算前中止', async () => {
    const { original, preview } = setup(); current = { ...current, extra: true };
    await expect(toggleUserGrantPermission(original, preview, preview.fingerprint)).rejects.toMatchObject({ code: 'stale-document' });
    expect(prepareUserGrantChange).toHaveBeenCalledOnce(); expect(mockRead).toHaveBeenCalledOnce(); noWrite();
  });
  it('C07 before 比對被替身略過，最新重算仍中止', async () => {
    const { original, preview } = setup(); current = { ...current, extra: true };
    vi.mocked(canonical).mockImplementation(value => value === current || value === original.document ? 'same-before' : realRole.canonical(value));
    await expect(toggleUserGrantPermission(original, preview, preview.fingerprint)).rejects.toMatchObject({ code: 'stale-document' });
    expect(prepareUserGrantChange).toHaveBeenCalledTimes(2); noWrite();
  });
  it('C08 上游被替身略過，重算指紋仍拒絕未確認內容', async () => {
    const { original, preview } = setup();
    const unconfirmed = { ...preview, fingerprint: 'unconfirmed' };
    vi.mocked(prepareUserGrantChange).mockReturnValueOnce(unconfirmed);
    await expect(toggleUserGrantPermission(original, unconfirmed, unconfirmed.fingerprint)).rejects.toMatchObject({ code: 'stale-document' });
    expect(prepareUserGrantChange).toHaveBeenCalledTimes(2); noWrite();
  });
  it.each([
    { write: toggleUserGrantPermission, action: { kind: 'toggle_permission', code: 'event.publish' } as const },
    { write: toggleUserGrantEnabled, action: { kind: 'update_enabled' } as const },
  ])('C09 requireRoleAdmin 返回後的 UID 守衛獨立拒絕', async operation => {
    const { original } = setup();
    const preview = realModel.prepareUserGrantChange(original, operation.action, 'test-actor');
    // 隔離 auth helper 內部檢查，覆蓋公開入口 await 完成後的檢查。
    vi.mocked(requireRoleAdmin).mockImplementationOnce(async () => { uid = 'other-test'; return { uid: 'test-actor', role: 'super_admin' } as Awaited<ReturnType<typeof requireRoleAdmin>>; });
    await expect(operation.write(original, preview, preview.fingerprint)).rejects.toMatchObject({ code: 'permission-denied' });
    expect(prepareUserGrantChange).not.toHaveBeenCalled(); expect(mockFirebase).not.toHaveBeenCalled(); noWrite();
  });
  it('C12 讀取入口在 requireRoleAdmin 返回後也重新驗 UID', async () => {
    vi.mocked(requireRoleAdmin).mockImplementationOnce(async () => { uid = 'other-test'; return { uid: 'test-actor', role: 'super_admin' } as Awaited<ReturnType<typeof requireRoleAdmin>>; });
    await expect(loadUserGrant('test-target', '合成用戶')).rejects.toMatchObject({ code: 'permission-denied' });
    expect(mockFirebase).not.toHaveBeenCalled(); expect(mockRead).not.toHaveBeenCalled(); noWrite();
  });
  it('C13 模型產生的四欄 payload 也經精確守衛', () => {
    const { preview } = setup();
    expect(assertOnlyTopLevelFields).toHaveBeenCalledWith(preview.payload, realModel.GRANT_FIELDS);
  });
  it('C10 grant 與 audit 都經精確欄位守衛', async () => {
    const { original, preview } = setup();
    await toggleUserGrantPermission(original, preview, preview.fingerprint);
    for (const [payload, fields] of [[mockSet.mock.calls[0]?.[1], realModel.GRANT_FIELDS], [mockSet.mock.calls[1]?.[1], realModel.GRANT_AUDIT_FIELDS]]) {
      expect(assertOnlyTopLevelFields).toHaveBeenCalledWith(payload, fields);
      expect(Object.keys(payload).sort()).toEqual([...fields].sort());
    }
  });
  it('C11 只從最新重算取得寫入值，不信任元件 payload', async () => {
    const { original, preview } = setup();
    vi.mocked(prepareUserGrantChange).mockImplementationOnce(realModel.prepareUserGrantChange)
      .mockImplementationOnce((...args) => ({ ...realModel.prepareUserGrantChange(...args), payload: { ...preview.payload, forbidden: true } }));
    await expect(toggleUserGrantPermission(original, preview, preview.fingerprint)).rejects.toThrow();
    noWrite();
  });
});
