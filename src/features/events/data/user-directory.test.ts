import { cleanup } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  uid: 'viewer' as string | null,
  callFn: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
}));
vi.mock('@/data/auth', () => ({
  getCurrentUser: async () => mocks.uid ? { uid: mocks.uid } : null,
}));
vi.mock('@/data/callables', () => ({ callFn: mocks.callFn }));

type DirectoryModule = typeof import('./user-directory');
let directory: DirectoryModule;

function user(uid: string, name = uid) {
  return { uid, name, displayName: name, pictureUrl: '', role: 'user' };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

beforeEach(async () => {
  vi.resetModules();
  mocks.uid = 'viewer';
  mocks.callFn.mockReset();
  document.documentElement.lang = 'zh-TW';
  directory = await import('./user-directory');
});

afterEach(() => {
  cleanup();
});

describe('使用者目錄（1E-1）', () => {
  it('正規化、去重、快取與 force', async () => {
    mocks.callFn.mockResolvedValue({
      users: [
        { uid: ' a ', name: '', displayName: ' 小明 ', pictureUrl: ' p ', role: '' },
        { uid: 'a', name: '重複' },
        { uid: ' b ', name: '', displayName: '' },
        { uid: ' ' },
        null,
      ],
    });
    expect(await directory.loadUserDirectory()).toBe(true);
    expect(directory.getUserDirectory()).toEqual([
      { uid: 'a', name: '小明', displayName: '小明', pictureUrl: 'p', role: 'user' },
      { uid: 'b', name: '未知', displayName: '', pictureUrl: '', role: 'user' },
    ]);
    expect(await directory.loadUserDirectory()).toBe(true);
    expect(mocks.callFn).toHaveBeenCalledTimes(1);
    await directory.loadUserDirectory({ force: true });
    expect(mocks.callFn).toHaveBeenCalledTimes(2);
  });

  it('空目錄也算已載入', async () => {
    mocks.callFn.mockResolvedValue({ users: [] });
    await directory.loadUserDirectory();
    await directory.loadUserDirectory();
    expect(mocks.callFn).toHaveBeenCalledTimes(1);
  });

  it('同帳號進行中的請求共用同一個 Promise，包括 force', async () => {
    const request = deferred<unknown>();
    mocks.callFn.mockReturnValue(request.promise);
    const first = directory.loadUserDirectory();
    const second = directory.loadUserDirectory({ force: true });
    request.resolve({ users: [user('a')] });
    expect(await first).toBe(true);
    // 測試同步更新：loadUserDirectory 改為 async（B 讀登入者是非同步），以「只打一次」驗證共用。
    expect(await second).toBe(true);
    expect(mocks.callFn).toHaveBeenCalledTimes(1);
  });

  it('失敗後可以重試；force 失敗保留完整快取', async () => {
    mocks.callFn
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ users: [user('a')] })
      .mockResolvedValueOnce({ users: null });
    expect(await directory.loadUserDirectory()).toBe(false);
    expect(await directory.loadUserDirectory()).toBe(true);
    expect(await directory.loadUserDirectory({ force: true })).toBe(false);
    expect(directory.getUserDirectory()).toEqual([user('a')]);
    expect(mocks.callFn).toHaveBeenCalledTimes(3);
  });

  it('未登入不呼叫；換人清空並丟棄舊請求', async () => {
    mocks.uid = null;
    expect(await directory.loadUserDirectory()).toBe(false);
    expect(mocks.callFn).not.toHaveBeenCalled();

    mocks.uid = 'first';
    const old = deferred<unknown>();
    const next = deferred<unknown>();
    mocks.callFn.mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);
    const first = directory.loadUserDirectory();
    mocks.uid = 'second';
    expect(directory.getUserDirectory()).toEqual([]);
    const second = directory.loadUserDirectory();
    old.resolve({ users: [user('old')] });
    expect(await first).toBe(false);
    // 測試同步更新：B 讀登入者為非同步，改驗「同一登入者併發只打一次」（照 A _userDirectoryLoadUid）。
    const third = directory.loadUserDirectory();
    next.resolve({ users: [user('new')] });
    expect(await second).toBe(true);
    expect(await third).toBe(true);
    expect(mocks.callFn).toHaveBeenCalledTimes(2);
    expect(directory.getUserDirectory()).toEqual([user('new')]);
  });

  it('verify 空值直接成功，UID trim 去重', async () => {
    expect(await directory.verifyUserDirectorySelection([' ', ''])).toEqual({
      ok: true, users: [], missingUids: [], reason: '',
    });
    expect(mocks.callFn).not.toHaveBeenCalled();
    mocks.callFn.mockResolvedValue({ users: [user('a')] });
    expect((await directory.verifyUserDirectorySelection([' a ', 'a'])).ok).toBe(true);
    expect(mocks.callFn).toHaveBeenCalledWith('listUserDirectory', { verifyUids: ['a'] });
  });

  it('verify unauthenticated／unavailable', async () => {
    mocks.uid = null;
    expect(await directory.verifyUserDirectorySelection(['a'])).toEqual({
      ok: false, users: [], missingUids: ['a'], reason: 'unauthenticated',
    });
    mocks.uid = 'viewer';
    mocks.callFn.mockRejectedValue(new Error('offline'));
    expect((await directory.verifyUserDirectorySelection(['a'])).reason).toBe('unavailable');
  });

  it('verify 換人回 stale-auth，不污染新帳號', async () => {
    const request = deferred<unknown>();
    mocks.callFn.mockReturnValue(request.promise);
    const verification = directory.verifyUserDirectorySelection(['a']);
    mocks.uid = 'other';
    request.resolve({ users: [user('a')] });
    expect((await verification).reason).toBe('stale-auth');
    expect(directory.getUserDirectory()).toEqual([]);
  });

  it.each([
    { users: null },
    { users: [{ uid: '' }] },
    { users: [user('unexpected')] },
    { users: [user('a'), user(' a ')] },
    { users: [null] },
  ])('verify 拒絕不合法回應 %#', async response => {
    mocks.callFn.mockResolvedValue(response);
    expect((await directory.verifyUserDirectorySelection(['a'])).reason).toBe('invalid-response');
    expect(directory.getUserDirectory()).toEqual([]);
  });

  it('verify 更新名稱、保留未驗證者、移除已失效者', async () => {
    mocks.callFn.mockResolvedValueOnce({ users: [user('a'), user('b'), user('c')] });
    await directory.loadUserDirectory();
    mocks.callFn.mockResolvedValueOnce({ users: [user('a', '新名稱')] });
    expect(await directory.verifyUserDirectorySelection(['a', 'b'])).toEqual({
      ok: false,
      users: [user('a', '新名稱')],
      missingUids: ['b'],
      reason: 'missing-users',
    });
    expect(directory.getUserDirectory()).toEqual([user('c'), user('a', '新名稱')]);
  });

  it('search 比對三欄、不分大小寫、排除指定 UID、最多五筆', () => {
    const users = [
      { ...user('UID-A'), name: 'alpha', displayName: '小明' },
      ...Array.from({ length: 7 }, (_, index) => user(`b${index}`, `Alpha ${index}`)),
    ];
    expect(directory.searchUserDirectory(users, ' uid-a ', [])).toEqual([users[0]]);
    expect(directory.searchUserDirectory(users, '小明', [])).toEqual([users[0]]);
    const result = directory.searchUserDirectory(users, ' ALPHA ', ['UID-A', 'b0']);
    expect(result.map(value => value.uid)).toEqual(['b1', 'b2', 'b3', 'b4', 'b5']);
    expect(directory.searchUserDirectory(users, '不存在', [])).toEqual([]);
  });
});
