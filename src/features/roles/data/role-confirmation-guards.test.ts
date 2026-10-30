import { beforeEach, describe, expect, it, vi } from 'vitest';
import { canonical, prepareRoleChange, type RolePreview, type RolesData } from './role-model';
import { rolesFixture } from './role-test-fixtures';

// 僅替換測試模組的輸出；產品守衛與交易 callback 都使用原實作。
vi.mock('./role-model', async importOriginal => {
  const actual = await importOriginal<typeof import('./role-model')>();
  return { ...actual, canonical: vi.fn(actual.canonical), prepareRoleChange: vi.fn(actual.prepareRoleChange) };
});
const realModel = await vi.importActual<typeof import('./role-model')>('./role-model');
const mockFirebase = vi.fn();
const mockGet = vi.fn();
const mockSet = vi.fn();
const mockRun = vi.fn();
const mockRead = vi.fn();
const mockLog = vi.fn();
const mockDoc = vi.fn();
const mockStamp = vi.fn();
const mockRefresh = vi.fn();
let current: Record<string, unknown> | null;
vi.mock('@/data/auth', () => ({ getLastKnownAuthUid: () => 'test-actor' }));
vi.mock('@/features/profile/data/viewer', () => ({
  loadViewer: async () => ({ uid: 'test-actor', role: 'super_admin', displayName: '測試操作者' }),
  requestViewerRefresh: () => mockRefresh(),
}));
vi.mock('@/data/firebase', () => ({ getFirebase: () => mockFirebase() }));
vi.mock('@/data/op-log', () => ({ writeOpLog: (...args: unknown[]) => mockLog(...args) }));
vi.mock('firebase/firestore', () => ({
  doc: (...args: unknown[]) => mockDoc(...args),
  serverTimestamp: () => mockStamp(),
  getDocFromServer: (...args: unknown[]) => mockRead(...args),
  runTransaction: (...args: unknown[]) => mockRun(...args),
}));
import { saveRolePermissions } from './role-admin-writes';

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(prepareRoleChange).mockImplementation(realModel.prepareRoleChange);
  vi.mocked(canonical).mockImplementation(realModel.canonical);
  current = null;
  mockFirebase.mockResolvedValue({ db: {} });
  mockDoc.mockImplementation((_db: unknown, collection: string, id: string) => ({ collection, id }));
  mockGet.mockImplementation(async () => ({ exists: () => current !== null, data: () => current }));
  mockRead.mockImplementation(async () => ({ exists: () => current !== null, data: () => current }));
  mockLog.mockResolvedValue(undefined);
  mockRun.mockImplementation(async (_db: unknown, callback: (tx: unknown) => Promise<void>) => {
    await callback({ get: mockGet, set: mockSet });
    const last = mockSet.mock.calls.at(-1);
    if (last) current = { ...current, ...(last[1] as object) };
  });
});
function setup(): { data: RolesData; preview: RolePreview } {
  const data = rolesFixture();
  const preview = realModel.prepareRoleChange(data, 'coach', { kind: 'toggle', code: 'event.publish' }, 'test-actor');
  current = structuredClone(preview.before);
  return { data, preview };
}
function expectNoFirestore(): void {
  for (const call of [mockFirebase, mockDoc, mockRun, mockGet, mockSet, mockRead, mockStamp, mockLog]) {
    expect(call).not.toHaveBeenCalled();
  }
}
function expectNoWrite(): void {
  for (const call of [mockSet, mockLog, mockRead, mockRefresh]) expect(call).not.toHaveBeenCalled();
}

describe('T-079a 確認守衛逐層回歸', () => {
  it('M14 入口單獨拒絕自洽 action＋payload 配上不同預覽指紋', async () => {
    const { data, preview } = setup();
    const changed = realModel.prepareRoleChange(data, 'coach', { kind: 'toggle', code: 'event.delete' }, 'test-actor');
    expect(changed.action).not.toEqual(preview.action);
    expect(changed.payload).not.toEqual(preview.payload);
    expect(changed.fingerprint).not.toBe(preview.fingerprint);
    // 確認字串符合新動作，但預覽仍帶舊指紋；只有入口能擋下此組合。
    await expect(saveRolePermissions(data, { ...changed, fingerprint: preview.fingerprint }, changed.fingerprint))
      .rejects.toMatchObject({ code: 'confirmation-required' });
    expectNoFirestore();
  });
  it('M14 入口單獨拒絕預覽操作者不同，即使資料與確認指紋皆相同', async () => {
    const { data, preview } = setup();
    await expect(saveRolePermissions(data, { ...preview, actorUid: 'other-test-actor' }, preview.fingerprint))
      .rejects.toMatchObject({ code: 'confirmation-required' });
    expectNoFirestore();
  });
  it('M14 一致更換 action＋payload 後沿用舊確認，入口缺席仍由 initial 擋下', async () => {
    const { data, preview } = setup();
    const changed = realModel.prepareRoleChange(data, 'coach', { kind: 'toggle', code: 'event.delete' }, 'test-actor');
    // 讓入口條件全部成立，等價於略過入口；其餘新預覽欄位保持一致。
    await expect(saveRolePermissions(data, { ...changed, fingerprint: preview.fingerprint }, preview.fingerprint))
      .rejects.toMatchObject({ code: 'confirmation-required' });
    expect(prepareRoleChange).toHaveBeenCalledExactlyOnceWith(data, 'coach', changed.action, 'test-actor');
    expectNoFirestore();
  });
  it('T10 未確認內容直呼由 initial 拒絕，尚未取得 Firestore', async () => {
    const { data, preview } = setup();
    const unconfirmed = 'synthetic-unconfirmed-diff';
    await expect(saveRolePermissions(data, { ...preview, fingerprint: unconfirmed }, unconfirmed))
      .rejects.toMatchObject({ code: 'confirmation-required' });
    expect(prepareRoleChange).toHaveBeenCalledOnce();
    expectNoFirestore();
  });
  it('T10 上游指紋比對被替身略過時，交易內重算仍拒絕未確認內容', async () => {
    const { data, preview } = setup();
    const unconfirmed = 'synthetic-unconfirmed-diff';
    // 只替換第一次重算的 fingerprint；交易重算仍使用真正模型。
    vi.mocked(prepareRoleChange).mockImplementationOnce((...args) => ({
      ...realModel.prepareRoleChange(...args), fingerprint: unconfirmed,
    }));
    await expect(saveRolePermissions(data, { ...preview, fingerprint: unconfirmed }, unconfirmed))
      .rejects.toMatchObject({ code: 'stale-document' });
    expect(mockGet).toHaveBeenCalledOnce();
    expect(prepareRoleChange).toHaveBeenCalledTimes(2);
    expect(vi.mocked(prepareRoleChange).mock.results[1]).toMatchObject({
      type: 'return', value: { fingerprint: preview.fingerprint },
    });
    expectNoWrite();
  });
  it('T11 他人修改完整文件先由 before 比對拒絕，不進入第二次重算', async () => {
    const { data, preview } = setup();
    current = { ...current, otherAdmin: true };
    await expect(saveRolePermissions(data, preview, preview.fingerprint))
      .rejects.toMatchObject({ code: 'stale-document' });
    expect(mockGet).toHaveBeenCalledOnce();
    expect(prepareRoleChange).toHaveBeenCalledOnce();
    expectNoWrite();
  });
  it('T11 before 比對被替身略過時，交易重算指紋仍擋下他人修改', async () => {
    const { data, preview } = setup();
    current = { ...current, otherAdmin: true };
    // 僅讓完整 before 比較相等；payload 與模型內部 canonical 仍用原實作。
    vi.mocked(canonical).mockImplementation(value => value === current || value === preview.before
      ? 'synthetic-equal-before' : realModel.canonical(value));
    await expect(saveRolePermissions(data, preview, preview.fingerprint))
      .rejects.toMatchObject({ code: 'stale-document' });
    expect(mockGet).toHaveBeenCalledOnce();
    expect(prepareRoleChange).toHaveBeenCalledTimes(2);
    expect(vi.mocked(prepareRoleChange).mock.results[1]).toMatchObject({
      type: 'return', value: { fingerprint: expect.any(String) },
    });
    expect(vi.mocked(prepareRoleChange).mock.results[1]).not.toMatchObject({ value: { fingerprint: preview.fingerprint } });
    expectNoWrite();
  });
});
