import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  loginForClubs,
  rememberPendingJoin,
  getSessionJoinState,
  getSessionJoinHoursLeft,
  clearPendingJoin,
  _resetClubsSessionForTest,
} from './clubs-session';

const signIn = vi.hoisted(() => vi.fn());
const isLoginRedirectingError = vi.hoisted(() => vi.fn());

vi.mock('@/data/auth', () => ({
  signIn,
  isLoginRedirectingError,
}));

beforeEach(() => {
  signIn.mockReset();
  isLoginRedirectingError.mockReset();
});

async function waitForSignIn(times: number): Promise<void> {
  await vi.waitFor(() => {
    expect(signIn).toHaveBeenCalledTimes(times);
  });
}

describe('loginForClubs', () => {
  it('calls signIn once', async () => {
    signIn.mockResolvedValue({ uid: 'u1' });
    await loginForClubs();
    expect(signIn).toHaveBeenCalledTimes(1);
  });

  it('swallows LoginRedirectingError', async () => {
    const err = new Error('redirect');
    signIn.mockRejectedValue(err);
    isLoginRedirectingError.mockReturnValue(true);
    await expect(loginForClubs()).resolves.toBeUndefined();
    expect(signIn).toHaveBeenCalledTimes(1);
    expect(isLoginRedirectingError).toHaveBeenCalledWith(err);
  });

  it('rethrows other errors', async () => {
    const err = new Error('boom');
    signIn.mockRejectedValue(err);
    isLoginRedirectingError.mockReturnValue(false);
    await expect(loginForClubs()).rejects.toBe(err);
    expect(signIn).toHaveBeenCalledTimes(1);
  });

  it('returns the same promise while signIn is in flight and calls signIn again after it settles', async () => {
    let resolveSignIn!: (value: { uid: string }) => void;
    const pending = new Promise<{ uid: string }>((resolve) => {
      resolveSignIn = resolve;
    });
    signIn.mockReturnValue(pending);

    const first = loginForClubs();
    const second = loginForClubs();
    expect(second).toBe(first);
    await waitForSignIn(1);

    resolveSignIn({ uid: 'u1' });
    await first;

    const third = loginForClubs();
    expect(third).not.toBe(first);
    await third;
    expect(signIn).toHaveBeenCalledTimes(2);
  });

  it('shares one rejection and allows another signIn after a non-redirect error', async () => {
    const err = new Error('boom');
    let rejectSignIn!: (reason: unknown) => void;
    signIn.mockReturnValueOnce(new Promise<never>((_resolve, reject) => {
      rejectSignIn = reject;
    }));
    isLoginRedirectingError.mockReturnValue(false);

    const first = loginForClubs();
    const second = loginForClubs();
    expect(second).toBe(first);
    const caught = Promise.all([
      first.then(() => {
        throw new Error('should reject');
      }, (reason: unknown) => reason),
      second.then(() => {
        throw new Error('should reject');
      }, (reason: unknown) => reason),
    ]);
    await waitForSignIn(1);
    rejectSignIn(err);
    await expect(caught).resolves.toEqual([err, err]);
    expect(signIn).toHaveBeenCalledTimes(1);

    signIn.mockResolvedValueOnce({ uid: 'u1' });
    await expect(loginForClubs()).resolves.toBeUndefined();
    expect(signIn).toHaveBeenCalledTimes(2);
  });

  it('allows another signIn after LoginRedirectingError is swallowed', async () => {
    const err = new Error('redirect');
    signIn.mockRejectedValueOnce(err);
    isLoginRedirectingError.mockReturnValueOnce(true);
    await expect(loginForClubs()).resolves.toBeUndefined();

    signIn.mockResolvedValueOnce({ uid: 'u1' });
    await expect(loginForClubs()).resolves.toBeUndefined();
    expect(signIn).toHaveBeenCalledTimes(2);
  });
});

describe('加入申請本機保存（M-117）', () => {
  const now = 1_800_000_000_000;
  const ttl = 24 * 60 * 60 * 1000;
  const key = 'club-join-pending:u1:tm_1';

  beforeEach(() => {
    localStorage.clear();
    _resetClubsSessionForTest();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('寫入 sentAt JSON 並優先讀取記憶體', () => {
    rememberPendingJoin('tm_1', 'u1', now);
    expect(localStorage.getItem(key)).toBe(JSON.stringify({ sentAt: now }));
    const getItem = vi.spyOn(Storage.prototype, 'getItem');
    expect(getSessionJoinState('tm_1', 'u1', now)).toEqual({ status: 'pending' });
    expect(getItem).not.toHaveBeenCalled();
  });

  it('模擬重新整理後從 localStorage 還原並回填記憶體', () => {
    rememberPendingJoin('tm_1', 'u1', now);
    _resetClubsSessionForTest();
    expect(getSessionJoinState('tm_1', 'u1', now)).toEqual({ status: 'pending' });
    localStorage.removeItem(key);
    expect(getSessionJoinState('tm_1', 'u1', now)).toEqual({ status: 'pending' });
  });

  it.each([false, true])('滿 24 小時清除紀錄，重新整理=%s', (reload) => {
    rememberPendingJoin('tm_1', 'u1', now);
    if (reload) _resetClubsSessionForTest();
    expect(getSessionJoinState('tm_1', 'u1', now + ttl)).toBeUndefined();
    expect(localStorage.getItem(key)).toBeNull();
    expect(getSessionJoinState('tm_1', 'u1', now)).toBeUndefined();
  });

  it('不同 uid 與 teamId 互不影響', () => {
    rememberPendingJoin('tm_1', 'u1', now);
    expect(getSessionJoinState('tm_1', 'u2', now)).toBeUndefined();
    expect(getSessionJoinState('tm_2', 'u1', now)).toBeUndefined();
    _resetClubsSessionForTest();
    expect(getSessionJoinState('tm_1', 'u2', now)).toBeUndefined();
    expect(getSessionJoinState('tm_2', 'u1', now)).toBeUndefined();
    expect(getSessionJoinState('tm_1', 'u1', now)).toEqual({ status: 'pending' });

    rememberPendingJoin('tm_1', 'u2', now);
    rememberPendingJoin('tm_2', 'u1', now);
    clearPendingJoin('tm_1', 'u1');
    _resetClubsSessionForTest();
    expect(getSessionJoinState('tm_1', 'u2', now)).toEqual({ status: 'pending' });
    expect(getSessionJoinState('tm_2', 'u1', now)).toEqual({ status: 'pending' });
  });

  it('clearPendingJoin 同時清除記憶體與 localStorage', () => {
    rememberPendingJoin('tm_1', 'u1', now);
    clearPendingJoin('tm_1', 'u1');
    expect(localStorage.getItem(key)).toBeNull();
    expect(getSessionJoinState('tm_1', 'u1', now)).toBeUndefined();
    _resetClubsSessionForTest();
    expect(getSessionJoinState('tm_1', 'u1', now)).toBeUndefined();
  });

  it.each([
    '{broken',
    JSON.stringify({ sentAt: '1800000000000' }),
    JSON.stringify({ sentAt: null }),
    JSON.stringify({}),
    'null',
    JSON.stringify({ sentAt: 0 }),
    JSON.stringify({ sentAt: -1 }),
    JSON.stringify({ sentAt: now + ttl + 1 }),
  ])('損毀或無效資料會移除：%s', (raw) => {
    localStorage.setItem(key, raw);
    expect(getSessionJoinState('tm_1', 'u1', now)).toBeUndefined();
    expect(localStorage.getItem(key)).toBeNull();
  });

  it('setItem 丟例外時不拋錯且記憶體仍有效', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });
    expect(() => rememberPendingJoin('tm_1', 'u1', now)).not.toThrow();
    expect(getSessionJoinState('tm_1', 'u1', now)).toEqual({ status: 'pending' });
    expect(getSessionJoinHoursLeft('tm_1', 'u1', now)).toBe(24);
  });

  it('getItem 丟例外時回 undefined', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    expect(getSessionJoinState('tm_1', 'u1', now)).toBeUndefined();
    expect(getSessionJoinHoursLeft('tm_1', 'u1', now)).toBeUndefined();
  });

  it('removeItem 丟例外時仍清除記憶體且不拋錯', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('denied');
    });
    rememberPendingJoin('tm_1', 'u1', now);
    expect(() => clearPendingJoin('tm_1', 'u1')).not.toThrow();
    expect(getSessionJoinState('tm_1', 'u1', now)).toBeUndefined();

    rememberPendingJoin('tm_1', 'u1', now);
    expect(getSessionJoinState('tm_1', 'u1', now + ttl)).toBeUndefined();
    expect(getSessionJoinState('tm_1', 'u1', now)).toBeUndefined();
  });

  it.each([
    ['tm_1', 'u:1'],
    ['tm:1', 'u1'],
  ])('含冒號的識別值只存記憶體：%s / %s', (teamId, uid) => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const getItem = vi.spyOn(Storage.prototype, 'getItem');
    const removeItem = vi.spyOn(Storage.prototype, 'removeItem');
    rememberPendingJoin(teamId, uid, now);
    expect(getSessionJoinState(teamId, uid, now)).toEqual({ status: 'pending' });
    expect(localStorage.length).toBe(0);
    _resetClubsSessionForTest();
    expect(getSessionJoinState(teamId, uid, now)).toBeUndefined();
    clearPendingJoin(teamId, uid);
    expect(setItem).not.toHaveBeenCalled();
    expect(getItem).not.toHaveBeenCalled();
    expect(removeItem).not.toHaveBeenCalled();
  });

  it('缺少 teamId 或 uid 時不讀取 localStorage', () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem');
    expect(getSessionJoinState('', 'u1', now)).toBeUndefined();
    expect(getSessionJoinState('tm_1', '', now)).toBeUndefined();
    expect(getSessionJoinState('tm_1', null, now)).toBeUndefined();
    expect(getSessionJoinHoursLeft('', 'u1', now)).toBeUndefined();
    expect(getSessionJoinHoursLeft('tm_1', null, now)).toBeUndefined();
    expect(getItem).not.toHaveBeenCalled();
  });

  it('剩餘時間剛送出為 24、過 1 小時為 23、過期為 undefined', () => {
    rememberPendingJoin('tm_1', 'u1', now);
    expect(getSessionJoinHoursLeft('tm_1', 'u1', now)).toBe(24);
    _resetClubsSessionForTest();
    expect(getSessionJoinHoursLeft('tm_1', 'u1', now + 3600000)).toBe(23);
    expect(getSessionJoinHoursLeft('tm_1', 'u1', now + ttl)).toBeUndefined();
    expect(localStorage.getItem(key)).toBeNull();
  });
});
