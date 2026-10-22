import { act, cleanup, render, renderHook } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ViewerView } from '@/features/profile/data/viewer';
import type { DirectoryUser, DirectoryVerification } from '../../data/user-directory';
import { useDelegatePicker } from './use-delegate-picker';

const mocks = vi.hoisted(() => ({
  users: [] as DirectoryUser[],
  load: vi.fn<(...args: unknown[]) => Promise<boolean>>(),
  verify: vi.fn<(uids: string[]) => Promise<DirectoryVerification>>(),
  toast: vi.fn(),
}));

vi.mock('@/ui/Toast', () => ({ toast: { show: mocks.toast } }));
vi.mock('../../data/user-directory', async importOriginal => {
  const original = await importOriginal<typeof import('../../data/user-directory')>();
  return {
    ...original,
    getUserDirectory: () => mocks.users,
    loadUserDirectory: mocks.load,
    verifyUserDirectorySelection: mocks.verify,
  };
});

function person(uid: string, name = uid, role = 'user'): DirectoryUser {
  return { uid, name, displayName: name, pictureUrl: '', role };
}

function success(users: DirectoryUser[]): DirectoryVerification {
  return { ok: true, users, missingUids: [], reason: '' };
}

function failure(reason: string): DirectoryVerification {
  return { ok: false, users: [], missingUids: ['a'], reason };
}

function viewer(uid = 'self', allowed = true): ViewerView {
  return {
    uid,
    teamIds: new Set<string>(),
    hasPermission: () => false,
    roleLevel: 0,
    role: 'user',
    displayName: '本人',
    pictureUrl: null,
    capabilities: allowed ? ['user.activity.delegate_assign'] : [],
    permissionSources: { rolePermissions: [], userGrants: [], customRoles: [] },
  } as ViewerView;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  document.documentElement.lang = 'zh-TW';
  mocks.users = [person('self'), person('a', '甲', 'coach'), person('b'), person('c'), person('d')];
  mocks.load.mockReset().mockResolvedValue(true);
  mocks.verify.mockReset().mockImplementation(async uids =>
    success(uids.map(uid => mocks.users.find(user => user.uid === uid) ?? person(uid))),
  );
  mocks.toast.mockReset();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('委託人 hook（1E-2）', () => {
  it('reset trim、去重、濾空、排除本人、最多三人，角色取自目錄', () => {
    const { result } = renderHook(() => useDelegatePicker({ viewer: viewer(), existing: null }));
    act(() => result.current.reset([
      { uid: '', name: '' },
      { uid: 'self', name: '本人' },
      { uid: ' a ', name: ' 甲 ' },
      { uid: 'a', name: '重複' },
      { uid: 'b', name: '乙' },
      { uid: 'unknown', name: '丙' },
      { uid: 'd', name: '丁' },
    ]));
    expect(result.current.value).toEqual([
      { uid: 'a', name: '甲' }, { uid: 'b', name: '乙' }, { uid: 'unknown', name: '丙' },
    ]);
    expect(result.current.view.chips.map(chip => chip.role)).toEqual(['coach', 'user', 'user']);
    expect(result.current.view.placeholder).toBe('已達上限 3 人');
    expect(result.current.view.inputDisabled).toBe(true);
  });

  it('focus 首次強制更新，搜尋排除自己與已選者', async () => {
    const { result } = renderHook(() => useDelegatePicker({ viewer: viewer(), existing: null }));
    act(() => result.current.view.onFocus());
    await flush();
    expect(mocks.load).toHaveBeenLastCalledWith({ force: true });
    act(() => result.current.view.onFocus());
    await flush();
    expect(mocks.load).toHaveBeenLastCalledWith({ force: false });

    act(() => result.current.reset([{ uid: 'a', name: '甲' }]));
    await flush();
    act(() => result.current.view.onQuery('a'));
    await flush();
    expect(result.current.view.results).toEqual([]);
    act(() => result.current.view.onQuery('self'));
    await flush();
    expect(result.current.view.results).toEqual([]);
    act(() => result.current.view.onQuery('b'));
    await flush();
    expect(result.current.view.results.map(user => user.uid)).toEqual(['b']);
    expect(result.current.view.dropdownOpen).toBe(true);
    act(() => result.current.view.onQuery(' '));
    expect(result.current.view.dropdownOpen).toBe(false);
  });

  it('空目錄每次 focus 強制重載；較舊搜尋回應不得覆蓋較新查詢', async () => {
    const first = deferred<boolean>();
    const second = deferred<boolean>();
    mocks.users = [];
    mocks.load.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const { result } = renderHook(() => useDelegatePicker({ viewer: viewer(), existing: null }));
    act(() => result.current.view.onQuery('a'));
    act(() => result.current.view.onQuery('b'));
    mocks.users = [person('b')];
    await act(async () => { second.resolve(true); });
    expect(result.current.view.results.map(user => user.uid)).toEqual(['b']);
    mocks.users = [person('a')];
    await act(async () => { first.resolve(true); });
    expect(result.current.view.results.map(user => user.uid)).toEqual(['b']);

    mocks.users = [];
    act(() => result.current.view.onFocus());
    await flush();
    act(() => result.current.view.onFocus());
    await flush();
    expect(mocks.load).toHaveBeenLastCalledWith({ force: true });
  });

  it('選取先驗證，以新名稱寫入；上限、去重、本人均不重複驗證', async () => {
    const { result } = renderHook(() => useDelegatePicker({ viewer: viewer(), existing: null }));
    mocks.verify.mockResolvedValueOnce(success([person('a', '新甲')]));
    act(() => result.current.view.onPick('a'));
    await flush();
    expect(result.current.value).toEqual([{ uid: 'a', name: '新甲' }]);
    act(() => {
      result.current.view.onPick('a');
      result.current.view.onPick('self');
    });
    expect(mocks.verify).toHaveBeenCalledTimes(1);
    act(() => result.current.view.onPick('b'));
    await flush();
    act(() => result.current.view.onPick('c'));
    await flush();
    act(() => result.current.view.onPick('d'));
    expect(mocks.verify).toHaveBeenCalledTimes(3);
    expect(result.current.value).toHaveLength(3);
    expect(result.current.view.placeholder).toBe('已達上限 3 人');
    act(() => result.current.view.onRemove('a'));
    expect(result.current.view.placeholder).toBe('搜尋用戶...');
    expect(result.current.view.inputDisabled).toBe(false);
  });

  it('並行點選不得超過三人', async () => {
    const a = deferred<DirectoryVerification>();
    const b = deferred<DirectoryVerification>();
    const { result } = renderHook(() => useDelegatePicker({ viewer: viewer(), existing: null }));
    act(() => result.current.reset([{ uid: 'c', name: '丙' }, { uid: 'd', name: '丁' }]));
    await flush();
    mocks.verify.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
    act(() => {
      result.current.view.onPick('a');
      result.current.view.onPick('b');
    });
    await act(async () => { a.resolve(success([person('a')])); });
    await act(async () => { b.resolve(success([person('b')])); });
    expect(result.current.value.map(item => item.uid)).toEqual(['c', 'd', 'a']);
  });

  it('無權限時顯示與 handler 使用相同權限判斷', async () => {
    const { result } = renderHook(() =>
      useDelegatePicker({ viewer: viewer('self', false), existing: null }),
    );
    act(() => result.current.reset([{ uid: 'a', name: '甲' }]));
    expect(result.current.view.canManage).toBe(false);
    expect(result.current.view.placeholder).toBe('無權設定委託人');
    expect(result.current.view.inputDisabled).toBe(true);
    act(() => {
      result.current.view.onPick('b');
      result.current.view.onRemove('a');
    });
    expect(mocks.toast).toHaveBeenCalledWith('權限不足');
    expect(result.current.value).toEqual([{ uid: 'a', name: '甲' }]);
    expect(await result.current.verifyForSubmit()).toEqual({ ok: true });
    expect(mocks.verify).not.toHaveBeenCalled();
    expect(mocks.load).not.toHaveBeenCalled();
  });

  it('編輯別人的活動即使有委託能力仍拒絕', () => {
    const { result } = renderHook(() => useDelegatePicker({
      viewer: viewer(),
      existing: { id: 'public-id', docId: 'document-id', creatorUid: 'other' },
    }));
    expect(result.current.view.canManage).toBe(false);
  });

  it.each([
    ['missing-users', '此用戶目前無法選取，請重新搜尋'],
    ['unavailable', '用戶驗證失敗，請檢查網路後再試'],
  ])('選取失敗 %s', async (reason, message) => {
    mocks.verify.mockResolvedValue(failure(reason));
    const { result } = renderHook(() => useDelegatePicker({ viewer: viewer(), existing: null }));
    act(() => result.current.view.onPick('a'));
    await flush();
    expect(mocks.toast).toHaveBeenCalledWith(message);
    expect(result.current.value).toEqual([]);
  });

  it('選取非同步拒絕可恢復', async () => {
    mocks.verify.mockRejectedValueOnce(new Error('offline'));
    const { result } = renderHook(() => useDelegatePicker({ viewer: viewer(), existing: null }));
    act(() => result.current.view.onPick('a'));
    await flush();
    expect(mocks.toast).toHaveBeenCalledWith('用戶驗證失敗，請檢查網路後再試');
    act(() => result.current.view.onPick('a'));
    await flush();
    expect(result.current.value).toHaveLength(1);
  });

  it('reset 與換帳號後，舊選取回應不得回寫', async () => {
    const old = deferred<DirectoryVerification>();
    mocks.verify.mockReturnValueOnce(old.promise);
    const { result, rerender } = renderHook(
      ({ account }) => useDelegatePicker({ viewer: viewer(account), existing: null }),
      { initialProps: { account: 'self' } },
    );
    act(() => result.current.view.onPick('a'));
    act(() => result.current.reset([]));
    rerender({ account: 'other' });
    await act(async () => { old.resolve(success([person('a')])); });
    expect(result.current.value).toEqual([]);
    expect(mocks.toast).not.toHaveBeenCalled();
  });

  it('等待選取時撤銷權限，不接受結果', async () => {
    const request = deferred<DirectoryVerification>();
    mocks.verify.mockReturnValueOnce(request.promise);
    const { result, rerender } = renderHook(
      ({ allowed }) => useDelegatePicker({ viewer: viewer('self', allowed), existing: null }),
      { initialProps: { allowed: true } },
    );
    act(() => result.current.view.onPick('a'));
    rerender({ allowed: false });
    await act(async () => { request.resolve(success([person('a')])); });
    expect(result.current.value).toEqual([]);
  });

  it('沒有委託人直接成功；送出成功更新最新名稱', async () => {
    const { result } = renderHook(() => useDelegatePicker({ viewer: viewer(), existing: null }));
    expect(await result.current.verifyForSubmit()).toEqual({ ok: true });
    expect(mocks.verify).not.toHaveBeenCalled();
    act(() => result.current.reset([{ uid: 'a', name: '舊名' }]));
    mocks.verify.mockResolvedValueOnce(success([person('a', '新名')]));
    await act(async () => {
      expect(await result.current.verifyForSubmit()).toEqual({ ok: true });
    });
    expect(result.current.value).toEqual([{ uid: 'a', name: '新名' }]);
  });

  it.each([
    ['missing-users', '委託人資料已失效，請重新選擇後再送出'],
    ['unavailable', '無法驗證委託人，請檢查網路後再試'],
    ['invalid-response', '無法驗證委託人，請檢查網路後再試'],
  ])('送出驗證失敗 %s', async (reason, message) => {
    const { result } = renderHook(() => useDelegatePicker({ viewer: viewer(), existing: null }));
    act(() => result.current.reset([{ uid: 'a', name: '甲' }]));
    mocks.verify.mockResolvedValueOnce(failure(reason));
    await act(async () => {
      expect(await result.current.verifyForSubmit()).toEqual({ ok: false, message });
    });
  });

  it('成功旗標但回傳數量不足，仍拒絕送出', async () => {
    const { result } = renderHook(() => useDelegatePicker({ viewer: viewer(), existing: null }));
    act(() => result.current.reset([{ uid: 'a', name: '甲' }]));
    mocks.verify.mockResolvedValueOnce(success([]));
    await act(async () => {
      expect(await result.current.verifyForSubmit()).toEqual({
        ok: false, message: '無法驗證委託人，請檢查網路後再試',
      });
    });
  });

  it('送出期間名單改變，拒絕舊結果', async () => {
    const request = deferred<DirectoryVerification>();
    const { result } = renderHook(() => useDelegatePicker({ viewer: viewer(), existing: null }));
    act(() => result.current.reset([{ uid: 'a', name: '甲' }]));
    mocks.verify.mockReturnValueOnce(request.promise);
    const submitting = result.current.verifyForSubmit();
    act(() => result.current.view.onRemove('a'));
    await act(async () => { request.resolve(success([person('a')])); });
    expect(await submitting).toEqual({
      ok: false, message: '委託人名單已變更，請重新送出',
    });
    expect(result.current.value).toEqual([]);
  });

  it('送出驗證拒絕顯示 A 例外訊息', async () => {
    const { result } = renderHook(() => useDelegatePicker({ viewer: viewer(), existing: null }));
    act(() => result.current.reset([{ uid: 'a', name: '甲' }]));
    mocks.verify.mockRejectedValueOnce(new Error('unexpected'));
    await act(async () => {
      expect(await result.current.verifyForSubmit()).toEqual({
        ok: false, message: '委託人驗證失敗，請稍後再試',
      });
    });
  });

  it('逾時拒絕，晚到結果不改名，計時器清除', async () => {
    vi.useFakeTimers();
    const request = deferred<DirectoryVerification>();
    const { result } = renderHook(() => useDelegatePicker({ viewer: viewer(), existing: null }));
    act(() => result.current.reset([{ uid: 'a', name: '舊名' }]));
    mocks.verify.mockReturnValueOnce(request.promise);
    const submitting = result.current.verifyForSubmit();
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
    expect(await submitting).toEqual({
      ok: false, message: '委託人驗證逾時，請檢查網路後再試',
    });
    await act(async () => { request.resolve(success([person('a', '晚到名稱')])); });
    expect(result.current.value).toEqual([{ uid: 'a', name: '舊名' }]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('blur 延遲 200ms 關閉；卸載取消驗證與計時器', async () => {
    vi.useFakeTimers();
    const { result, unmount } = renderHook(() =>
      useDelegatePicker({ viewer: viewer(), existing: null }),
    );
    const input = render(<input id="ce-delegate-search" />);
    act(() => result.current.view.onQuery('a'));
    await flush();
    expect(result.current.view.dropdownOpen).toBe(true);
    act(() => {
      input.container.querySelector('input')!.dispatchEvent(
        new FocusEvent('focusout', { bubbles: true }),
      );
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    expect(result.current.view.dropdownOpen).toBe(false);

    act(() => result.current.reset([{ uid: 'a', name: '甲' }]));
    const request = deferred<DirectoryVerification>();
    mocks.verify.mockReturnValueOnce(request.promise);
    const submitting = result.current.verifyForSubmit();
    unmount();
    expect(await submitting).toEqual({
      ok: false, message: '委託人名單已變更，請重新送出',
    });
    expect(vi.getTimerCount()).toBe(0);
    request.resolve(success([person('a')]));
    await flush();
    expect(mocks.toast).not.toHaveBeenCalled();
  });
});
