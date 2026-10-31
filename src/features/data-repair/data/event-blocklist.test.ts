import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { changeEventBlocklist, type ChangeBlocklistInput } from './event-blocklist';
import type { BlocklistViewer } from './event-blocklist-model';
import contract from './event-blocklist-contract.json';

type Transform = { operation: string; elements: unknown[] };
type Payload = Record<string, Transform>;
const mocks = vi.hoisted(() => ({
  firebase: vi.fn(), resolve: vi.fn(), opLog: vi.fn(), doc: vi.fn(), update: vi.fn(), transaction: vi.fn(),
  current: {} as Record<string, unknown>, exists: true,
}));
vi.mock('@/data/firebase', () => ({ getFirebase: mocks.firebase }));
vi.mock('@/data/paths', () => ({ eventDoc: (id: string) => 'events/' + id, resolveEventDocId: mocks.resolve }));
vi.mock('./event-blocklist-oplog', () => ({ recordBlocklistOpLog: mocks.opLog }));
vi.mock('firebase/firestore', () => ({
  doc: mocks.doc,
  arrayUnion: (...elements: unknown[]) => ({ operation: 'arrayUnion', elements }),
  arrayRemove: (...elements: unknown[]) => ({ operation: 'arrayRemove', elements }),
  runTransaction: mocks.transaction,
}));
const viewer: BlocklistViewer = {
  uid: 'uidA', role: 'admin', displayName: '管理員', hasPermission: () => true,
  permissionSources: { rolePermissions: ['admin.repair.event_blocklist'], userGrants: [], customRoles: [] },
};
function input(patch: Partial<ChangeBlocklistInput> = {}): ChangeBlocklistInput {
  return { viewer, event: { id: 'evtA', _docId: 'targetA' }, uid: 'targetA', action: 'add',
    reason: '測試原因', users: [{ uid: 'targetA', name: '小明', lineUserId: '' }], ...patch };
}
type FakeTx = { get: () => Promise<{ exists: () => boolean; data: () => Record<string, unknown> }>; update: typeof mocks.update };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.current = { id: 'evtA', title: '活動', blockedUids: [], blockedUidsLog: [] };
  mocks.exists = true;
  mocks.firebase.mockResolvedValue({ db: {}, auth: { currentUser: { uid: 'uidA' } } });
  mocks.resolve.mockResolvedValue('targetA');
  mocks.doc.mockImplementation((_db, path) => ({ path }));
  mocks.opLog.mockResolvedValue(undefined);
  mocks.update.mockImplementation((_ref, payload: Payload) => {
    for (const [key, transform] of Object.entries(payload)) {
      const before: unknown[] = Array.isArray(mocks.current[key]) ? mocks.current[key] as unknown[] : [];
      mocks.current[key] = transform.operation === 'arrayUnion'
        ? [...before, ...transform.elements.filter(value => !before.includes(value))]
        : before.filter(value => !transform.elements.includes(value));
    }
  });
  let queue = Promise.resolve<unknown>(undefined);
  mocks.transaction.mockImplementation((_db, operation: (tx: FakeTx) => Promise<unknown>) => {
    const result = queue.then(() => operation({
      get: async () => ({ exists: () => mocks.exists, data: () => ({ ...mocks.current }) }), update: mocks.update,
    }));
    queue = result.catch(() => undefined);
    return result;
  });
});
afterEach(() => vi.useRealTimers());

describe('黑名單管理', () => {
  it('T1 加入契約', async () => {
    await changeEventBlocklist(input());
    const payload = mocks.update.mock.calls[0]?.[1];
    expect(Object.keys(payload).sort()).toEqual(['blockedUids', 'blockedUidsLog']);
    expect(payload.blockedUids).toEqual({ operation: 'arrayUnion', elements: ['targetA'] });
  });
  it('T2 操作者與時間', async () => {
    await changeEventBlocklist({ ...input(), by: 'uidB' } as ChangeBlocklistInput);
    const entry = mocks.update.mock.calls[0]?.[1].blockedUidsLog.elements[0];
    expect(Object.keys(entry).sort()).toEqual(['action', 'at', 'by', 'reason', 'uid']);
    expect(entry).toMatchObject({ uid: 'targetA', by: 'uidA', action: 'add', reason: '測試原因' });
    expect(new Date(entry.at).toISOString()).toBe(entry.at);
  });
  it('T3 理由處理與移除', async () => {
    await changeEventBlocklist(input({ reason: '  ' + '因'.repeat(90) + '  ' }));
    expect(mocks.update.mock.calls[0]?.[1].blockedUidsLog.elements[0].reason).toBe('因'.repeat(80));
    await changeEventBlocklist(input({ action: 'remove', reason: '忽略' }));
    expect(mocks.update.mock.calls[1]?.[1].blockedUids).toEqual({ operation: 'arrayRemove', elements: ['targetA'] });
    expect(mocks.update.mock.calls[1]?.[1].blockedUidsLog.elements[0]).toMatchObject({ action: 'remove', reason: '' });
  });
  it.each([' targetA', 'targetA ', '', 'targetA/', 'targetA\n', 'a'.repeat(129), 'targetA'.repeat(19)])('T4 輸入拒絕 %s', async uid => {
    await expect(changeEventBlocklist(input({ uid }))).rejects.toMatchObject({ code: 'INVALID_UID' });
    expect(mocks.firebase).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it('T5 重複加入', async () => {
    mocks.current.blockedUids = ['targetA'];
    expect((await changeEventBlocklist(input())).changed).toBe(false);
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.opLog).not.toHaveBeenCalled();
  });
  it('T6 重複移除', async () => {
    expect((await changeEventBlocklist(input({ action: 'remove' }))).changed).toBe(false);
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.opLog).not.toHaveBeenCalled();
  });
  it('T7 課程連動', async () => {
    mocks.current.courseLinked = true;
    await expect(changeEventBlocklist(input())).rejects.toMatchObject({ code: 'COURSE_LINKED' });
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it('T7b 課程連動的已載入活動不進入交易', async () => {
    await expect(changeEventBlocklist(input({ event: { id: 'evtA', _docId: 'targetA', courseLinked: true } })))
      .rejects.toMatchObject({ code: 'COURSE_LINKED' });
    expect(mocks.firebase).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it.each([undefined, null, '舊資料', 0])('T8 舊資料 %s', async blockedUids => {
    mocks.current.blockedUids = blockedUids;
    mocks.current.blockedUidsLog = null;
    const result = await changeEventBlocklist(input());
    expect(result.event.blockedUids).toEqual(['targetA']);
    expect(result.event.blockedUidsLog).toHaveLength(1);
  });
  it.each([
    ['user', []], ['user', ['admin.repair.event_blocklist']], ['coach', []], ['captain', []], ['admin', []], ['admin', null],
  ])('T9 授權拒絕 %s', async (role, permissions) => {
    const denied = { ...viewer, role: role as string,
      permissionSources: { rolePermissions: permissions as string[] | null, userGrants: ['admin.repair.event_blocklist'], customRoles: [] } };
    await expect(changeEventBlocklist(input({ viewer: denied }))).rejects.toMatchObject({ code: 'permission-denied' });
    expect(mocks.firebase).not.toHaveBeenCalled();
    expect(mocks.resolve).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it.each(['coach', 'captain', 'admin', 'super_admin'])('T9 授權允許 %s', async role => {
    expect((await changeEventBlocklist(input({ viewer: { ...viewer, role } }))).changed).toBe(true);
  });
  it('T13 契約夾具', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-30T00:00:00.000Z'));
    await changeEventBlocklist(input());
    expect(mocks.update.mock.calls[0]?.[1]).toEqual(contract.payload);
  });
  it('T14 同時加入', async () => {
    const results = await Promise.all([changeEventBlocklist(input()), changeEventBlocklist(input())]);
    expect(results.map(result => result.changed)).toEqual([true, false]);
    expect(mocks.current.blockedUidsLog).toHaveLength(1);
    expect(mocks.update).toHaveBeenCalledTimes(1);
    expect(mocks.opLog).toHaveBeenCalledTimes(1);
  });
  it('活動解析', async () => {
    await changeEventBlocklist(input());
    expect(mocks.doc).toHaveBeenCalledWith({}, 'events/targetA');
    expect(mocks.resolve).not.toHaveBeenCalled();
    mocks.current.blockedUids = [];
    await changeEventBlocklist(input({ event: { id: 'evtA' } }));
    expect(mocks.resolve).toHaveBeenCalledWith('evtA');
    expect(mocks.doc).toHaveBeenLastCalledWith({}, 'events/targetA');
  });
  it('找不到活動', async () => {
    mocks.exists = false;
    await expect(changeEventBlocklist(input())).rejects.toMatchObject({ code: 'EVENT_MISSING' });
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it('找不到用戶', async () => {
    await expect(changeEventBlocklist(input({ users: [] }))).rejects.toMatchObject({ code: 'USER_MISSING' });
    expect(mocks.firebase).not.toHaveBeenCalled();
  });
  it('登入者已切換', async () => {
    mocks.firebase.mockResolvedValue({ db: {}, auth: { currentUser: { uid: 'uidB' } } });
    await expect(changeEventBlocklist(input())).rejects.toMatchObject({ code: 'permission-denied' });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it('尚未登入', async () => {
    mocks.firebase.mockResolvedValue({ db: {}, auth: { currentUser: null } });
    await expect(changeEventBlocklist(input())).rejects.toMatchObject({ code: 'permission-denied' });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it('交易內登入者已切換', async () => {
    const auth = { currentUser: { uid: 'uidA' } as { uid: string } | null };
    mocks.firebase.mockResolvedValue({ db: {}, auth });
    const run = mocks.transaction.getMockImplementation()!;
    mocks.transaction.mockImplementation((db, operation) => { auth.currentUser = { uid: 'uidB' }; return run(db, operation); });
    await expect(changeEventBlocklist(input())).rejects.toMatchObject({ code: 'permission-denied' });
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it('活動識別碼含斜線或解析不到', async () => {
    await expect(changeEventBlocklist(input({ event: { id: 'evtA', _docId: 'a/b' } })))
      .rejects.toMatchObject({ code: 'EVENT_MISSING' });
    mocks.resolve.mockResolvedValue(null);
    await expect(changeEventBlocklist(input({ event: { id: 'evtA' } }))).rejects.toMatchObject({ code: 'EVENT_MISSING' });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it('uid 長度邊界', async () => {
    const edge = 'a'.repeat(128);
    expect((await changeEventBlocklist(input({ uid: edge, users: [{ uid: edge, name: '甲', lineUserId: '' }] }))).changed).toBe(true);
  });
  it.each([undefined, '舊資料', null])('移除遇到非陣列舊資料 %s', async value => {
    mocks.current.blockedUids = value;
    mocks.current.blockedUidsLog = value;
    expect((await changeEventBlocklist(input({ action: 'remove' }))).changed).toBe(false);
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it('寫入成功後的操作紀錄參數', async () => {
    await changeEventBlocklist(input());
    expect(mocks.opLog).toHaveBeenCalledWith(viewer, expect.objectContaining({ blockedUids: ['targetA'] }), 'add', '小明');
  });
  it('以最新活動回傳', async () => {
    mocks.current.title = '最新活動';
    const result = await changeEventBlocklist(input({ event: { _docId: 'targetA', title: '舊活動' } }));
    expect(result.event.title).toBe('最新活動');
    expect(result.event.blockedUids).toEqual(['targetA']);
  });
});
