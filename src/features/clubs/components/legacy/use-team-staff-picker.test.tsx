// @vitest-environment jsdom
// 依附件撰寫；本交付環境未執行測試。
import { act, cleanup, render } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getUserDirectory,
  loadUserDirectory,
  searchUserDirectory,
  verifyUserDirectorySelection,
} from '@/features/events/data/user-directory';
import type {
  DirectoryUser,
  DirectoryVerification,
} from '@/features/events/data/user-directory';
import { toast } from '@/ui/Toast';
import { useStaffPicker } from './use-team-staff-picker';
import type { StaffPickerApi } from './use-team-staff-picker';

vi.mock('@/features/events/data/user-directory', () => ({
  getUserDirectory: vi.fn(),
  loadUserDirectory: vi.fn(),
  searchUserDirectory: vi.fn(),
  verifyUserDirectorySelection: vi.fn(),
}));
vi.mock('@/ui/Toast', () => ({ toast: { show: vi.fn() } }));

function user(uid: string, name = uid, displayName = name): DirectoryUser {
  return { uid, name, displayName, pictureUrl: '', role: 'user' };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

let api: StaffPickerApi;
function Harness(props: { enabled: boolean; excludeUids: string[] }) {
  api = useStaffPicker(props);
  return null;
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getUserDirectory).mockReturnValue([]);
  vi.mocked(loadUserDirectory).mockResolvedValue(true);
  vi.mocked(searchUserDirectory).mockImplementation((users, query, excluded) =>
    users.filter(item =>
      !excluded.includes(item.uid)
      && [item.name, item.displayName, item.uid]
        .some(value => value.toLowerCase().includes(query.trim().toLowerCase())),
    ).slice(0, 5),
  );
  vi.mocked(verifyUserDirectorySelection).mockImplementation(async uids => ({
    ok: true,
    users: uids.map(uid => user(uid)),
    missingUids: [],
    reason: '',
  }));
});
afterEach(cleanup);

describe('useStaffPicker', () => {
  it('空查詢沒有建議；先過濾 A 語意再取五筆，排除已選 uid', async () => {
    const users = [
      ...Array.from({ length: 6 }, (_, i) => user(`hidden-${i}`, 'other', 'MATCH')),
      user('excluded', 'match'),
      ...Array.from({ length: 7 }, (_, i) => user(`match-${i}`, `name-${i}`)),
    ];
    vi.mocked(getUserDirectory).mockReturnValue(users);
    render(<Harness enabled excludeUids={['excluded']} />);
    await flush();
    expect(api.suggestions).toEqual([]);
    act(() => api.setQuery('MaTcH'));
    expect(api.suggestions.map(item => item.uid)).toEqual([
      'match-0', 'match-1', 'match-2', 'match-3', 'match-4',
    ]);
    expect(loadUserDirectory).toHaveBeenCalledTimes(1);
  });

  it('驗證成功只採回傳 uid 與 name/displayName', async () => {
    vi.mocked(verifyUserDirectorySelection).mockResolvedValue({
      ok: true,
      users: [user('u1', '', '已驗證姓名')],
      missingUids: [],
      reason: '',
    });
    render(<Harness enabled excludeUids={[]} />);
    await flush();
    let picked: Awaited<ReturnType<StaffPickerApi['pick']>> = null;
    await act(async () => { picked = await api.pick(' u1 '); });
    expect(verifyUserDirectorySelection).toHaveBeenCalledWith(['u1']);
    expect(picked).toEqual({ uid: 'u1', name: '已驗證姓名' });
    expect(api.verifying).toBe(false);
  });

  it.each(['missing', 'rejected'] as const)('驗證失敗 %s 不回傳人員', async kind => {
    if (kind === 'missing') {
      vi.mocked(verifyUserDirectorySelection).mockResolvedValue({
        ok: false, users: [], missingUids: ['u1'], reason: 'missing',
      });
    } else {
      vi.mocked(verifyUserDirectorySelection).mockRejectedValue(new Error('offline'));
    }
    render(<Harness enabled excludeUids={[]} />);
    await flush();
    await act(async () => { expect(await api.pick('u1')).toBeNull(); });
    expect(toast.show).toHaveBeenCalledWith({
      message: '無法確認此使用者，請重新搜尋後再試', tone: 'error',
    });
  });

  it('停用後舊驗證失效，重新啟用可再選', async () => {
    const pending = deferred<DirectoryVerification>();
    vi.mocked(verifyUserDirectorySelection).mockReturnValueOnce(pending.promise);
    const view = render(<Harness enabled excludeUids={[]} />);
    await flush();
    let selection!: ReturnType<StaffPickerApi['pick']>;
    act(() => { selection = api.pick('old'); });
    expect(api.verifying).toBe(true);
    view.rerender(<Harness enabled={false} excludeUids={[]} />);
    view.rerender(<Harness enabled excludeUids={[]} />);
    await act(async () => {
      pending.resolve({ ok: true, users: [user('old')], missingUids: [], reason: '' });
      expect(await selection).toBeNull();
    });
    await act(async () => {
      expect(await api.pick('new')).toEqual({ uid: 'new', name: 'new' });
    });
    expect(toast.show).not.toHaveBeenCalled();
  });

  it('後發驗證優先；先發結果不得覆蓋 verifying', async () => {
    const first = deferred<DirectoryVerification>();
    const second = deferred<DirectoryVerification>();
    vi.mocked(verifyUserDirectorySelection)
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    render(<Harness enabled excludeUids={[]} />);
    await flush();
    let a!: ReturnType<StaffPickerApi['pick']>;
    let b!: ReturnType<StaffPickerApi['pick']>;
    act(() => {
      a = api.pick('a');
      b = api.pick('b');
    });
    await act(async () => {
      first.resolve({ ok: true, users: [user('a')], missingUids: [], reason: '' });
      expect(await a).toBeNull();
    });
    expect(api.verifying).toBe(true);
    await act(async () => {
      second.resolve({ ok: true, users: [user('b')], missingUids: [], reason: '' });
      expect(await b).toEqual({ uid: 'b', name: 'b' });
    });
    expect(api.verifying).toBe(false);
  });

  it('載入失敗提示一次，保留快取，卸載後不提示驗證錯誤', async () => {
    vi.mocked(loadUserDirectory).mockResolvedValue(false);
    vi.mocked(getUserDirectory).mockReturnValue([user('cached')]);
    const pending = deferred<DirectoryVerification>();
    vi.mocked(verifyUserDirectorySelection).mockReturnValue(pending.promise);
    const view = render(<Harness enabled excludeUids={[]} />);
    await flush();
    expect(toast.show).toHaveBeenCalledTimes(1);
    expect(toast.show).toHaveBeenCalledWith({
      message: '用戶資料載入失敗；表單仍可編輯，若搜尋不到請關閉後重試',
      tone: 'error',
    });
    act(() => api.setQuery('cached'));
    expect(api.suggestions).toHaveLength(1);
    let selection!: ReturnType<StaffPickerApi['pick']>;
    act(() => { selection = api.pick('u1'); });
    view.unmount();
    await act(async () => {
      pending.reject(new Error('offline'));
      expect(await selection).toBeNull();
    });
    expect(toast.show).toHaveBeenCalledTimes(1);
  });
});
