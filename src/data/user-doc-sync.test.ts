import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const TS = { __sentinel: 'serverTimestamp' };
const fs = vi.hoisted(() => ({
  doc: vi.fn((_db: unknown, col: string, id: string) => ({ path: `${col}/${id}` })),
  collection: vi.fn((_db: unknown, col: string) => ({ col })),
  where: vi.fn((field: string, op: string, value: unknown) => ({ field, op, value })),
  limit: vi.fn((n: number) => ({ limit: n })),
  query: vi.fn((...parts: unknown[]) => ({ parts })),
  getDoc: vi.fn(),
  getDocs: vi.fn(),
  setDoc: vi.fn(),
  updateDoc: vi.fn(),
  serverTimestamp: vi.fn(),
}));
const fb = vi.hoisted(() => ({ currentUid: 'U1' as string | null }));
const liffState = vi.hoisted(() => ({
  ready: null as unknown,
  ensure: vi.fn(),
}));

vi.mock('firebase/firestore', () => fs);
vi.mock('@/data/firebase', () => ({
  getFirebase: vi.fn(async () => ({
    db: {},
    auth: { get currentUser() { return fb.currentUid ? { uid: fb.currentUid } : null; } },
  })),
}));
vi.mock('./liff-init', () => ({
  getReadyLiff: () => liffState.ready,
  ensureLiffInit: liffState.ensure,
}));

import { emit, on } from '@/core/events';
import { USER_DOC_CREATE_FIELDS } from './user-doc-payload';
import {
  _resetUserDocSyncForTest,
  PERMANENT_FAILURE_BACKOFF_MS,
  readLineProfile,
  startUserDocSync,
  syncUserDoc,
  USER_DOC_FAILED_KEY_PREFIX,
  USER_DOC_SYNCED_KEY,
} from './user-doc-sync';

const NOW = Date.UTC(2026, 10, 9, 6, 0, 0);
const MIN = 60_000;

function liff(profile: Partial<{ userId: string; displayName: string; pictureUrl: string }> | Error = {
  userId: 'U1', displayName: ' 小明 ', pictureUrl: 'https://p/1',
}, idToken: Record<string, string> | null = { email: 'a@example.test' }) {
  return {
    isLoggedIn: () => true,
    getProfile: vi.fn(async () => {
      if (profile instanceof Error) throw profile;
      return profile;
    }),
    getDecodedIDToken: () => idToken,
  };
}
const missing = { exists: () => false, data: () => undefined };
const existing = (data: Record<string, unknown>) => ({ exists: () => true, data: () => data });
const ts = (ms: number) => ({ toMillis: () => ms });
const noLegacy = { docs: [] };

let refreshes = 0;
let stopRefresh: () => void;

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
  for (const fn of Object.values(fs)) fn.mockClear();
  fs.getDoc.mockReset();
  fs.getDocs.mockReset().mockResolvedValue(noLegacy);
  fs.setDoc.mockReset().mockResolvedValue(undefined);
  fs.updateDoc.mockReset().mockResolvedValue(undefined);
  fs.serverTimestamp.mockReturnValue(TS);
  fb.currentUid = 'U1';
  liffState.ready = null;
  liffState.ensure.mockReset();
  localStorage.clear();
  _resetUserDocSyncForTest();
  refreshes = 0;
  stopRefresh = on('viewer:refresh', () => { refreshes += 1; });
});

afterEach(() => {
  stopRefresh();
  vi.useRealTimers();
});

describe('syncUserDoc：文件不存在', () => {
  it('剛登入（LIFF 已就緒）：照 A 新建，欄位剛好是 A 的新建欄位、role user、exp 0，並通知重讀 viewer', async () => {
    liffState.ready = liff();
    fs.getDoc.mockResolvedValue(missing);

    await expect(syncUserDoc('U1')).resolves.toBe('created');

    expect(fs.where).toHaveBeenCalledWith('lineUserId', '==', 'U1');
    expect(fs.limit).toHaveBeenCalledWith(1);
    expect(fs.setDoc).toHaveBeenCalledTimes(1);
    const [ref, payload, options] = fs.setDoc.mock.calls[0]!;
    expect(ref).toEqual({ path: 'users/U1' });
    expect(options).toBeUndefined();
    expect(Object.keys(payload).sort()).toEqual([...USER_DOC_CREATE_FIELDS].sort());
    expect(payload).toMatchObject({
      uid: 'U1', lineUserId: 'U1', displayName: '小明', pictureUrl: 'https://p/1', email: 'a@example.test',
      role: 'user', exp: 0, level: 1, createdAt: TS, lastLogin: TS,
    });
    expect(refreshes).toBe(1);
    expect(localStorage.getItem(USER_DOC_SYNCED_KEY)).toBe(`U1|${NOW}`);
  });

  it('Auth 還原進站（LIFF 未初始化）：初始化 LIFF 取 LINE profile 後建檔', async () => {
    liffState.ensure.mockResolvedValue(liff());
    fs.getDoc.mockResolvedValue(missing);
    await expect(syncUserDoc('U1')).resolves.toBe('created');
    expect(liffState.ensure).toHaveBeenCalledTimes(1);
    expect(fs.setDoc).toHaveBeenCalledTimes(1);
  });

  it('legacy 文件（無 createdAt）：照 A merge 遷移', async () => {
    liffState.ready = liff();
    fs.getDoc.mockResolvedValue(missing);
    fs.getDocs.mockResolvedValue({ docs: [{ id: 'old', data: () => ({ lineUserId: 'U1', displayName: '舊', gender: '男' }) }] });
    await expect(syncUserDoc('U1')).resolves.toBe('migrated');
    const [, payload, options] = fs.setDoc.mock.calls[0]!;
    expect(options).toEqual({ merge: true });
    expect(payload).toMatchObject({ uid: 'U1', lineUserId: 'U1', displayName: '小明', gender: '男', createdAt: TS, lastLogin: TS });
  });

  it('legacy 文件帶舊 createdAt／非 user 角色：Rules 一定擋，不送寫入、拋錯', async () => {
    liffState.ready = liff();
    fs.getDoc.mockResolvedValue(missing);
    fs.getDocs.mockResolvedValue({ docs: [{ id: 'old', data: () => ({ lineUserId: 'U1', role: 'coach', createdAt: ts(1) }) }] });
    await expect(syncUserDoc('U1')).rejects.toMatchObject({
      reason: 'legacy-not-migratable:create-values-not-allowed:role,createdAt',
    });
    expect(fs.setDoc).not.toHaveBeenCalled();
    expect(localStorage.getItem(USER_DOC_SYNCED_KEY)).toBeNull();
  });

  it('legacy 文件有 Rules 不允許的欄位：不送寫入', async () => {
    liffState.ready = liff();
    fs.getDoc.mockResolvedValue(missing);
    fs.getDocs.mockResolvedValue({ docs: [{ id: 'old', data: () => ({ lineUserId: 'U1', manualRole: 'admin' }) }] });
    await expect(syncUserDoc('U1')).rejects.toMatchObject({ reason: 'legacy-not-migratable:create-fields-not-allowed' });
    expect(fs.setDoc).not.toHaveBeenCalled();
  });

  it('審查 P3-5：新建送出的 payload 一定帶本次 serverTimestamp 的 createdAt', async () => {
    liffState.ready = liff();
    fs.getDoc.mockResolvedValue(missing);
    await syncUserDoc('U1');
    const payload = fs.setDoc.mock.calls[0]![1] as Record<string, unknown>;
    expect(payload.createdAt).toBe(TS);
  });

  it('LINE 未登入（拿不到 profile）：不建檔、拋錯', async () => {
    liffState.ensure.mockResolvedValue({ ...liff(), isLoggedIn: () => false });
    fs.getDoc.mockResolvedValue(missing);
    await expect(syncUserDoc('U1')).rejects.toMatchObject({ reason: 'line-profile-unavailable' });
    expect(fs.setDoc).not.toHaveBeenCalled();
  });
});

describe('syncUserDoc：文件已存在', () => {
  it('剛登入：只更新 displayName／pictureUrl／lastLogin（超過 10 分鐘），不寫 role／exp／level／lineNotify', async () => {
    liffState.ready = liff();
    fs.getDoc.mockResolvedValue(existing({
      uid: 'U1', displayName: '舊名', pictureUrl: null, role: 'admin', exp: 99, level: 3,
      lineNotify: { bound: true }, lastLogin: ts(NOW - 11 * MIN),
    }));
    await expect(syncUserDoc('U1')).resolves.toBe('updated');
    expect(fs.updateDoc).toHaveBeenCalledWith({ path: 'users/U1' }, {
      displayName: '小明', pictureUrl: 'https://p/1', lastLogin: TS,
    });
    expect(fs.setDoc).not.toHaveBeenCalled();
    expect(fs.getDocs).not.toHaveBeenCalled();
    expect(refreshes).toBe(1);
  });

  it('剛登入、10 分鐘內、名稱頭像相同：不寫入', async () => {
    liffState.ready = liff();
    fs.getDoc.mockResolvedValue(existing({ displayName: '小明', pictureUrl: 'https://p/1', lastLogin: ts(NOW - MIN) }));
    await expect(syncUserDoc('U1')).resolves.toBe('unchanged');
    expect(fs.updateDoc).not.toHaveBeenCalled();
    expect(refreshes).toBe(0);
  });

  it('Auth 還原進站（沒有 LINE profile）：只補 lastLogin，不初始化 LIFF', async () => {
    fs.getDoc.mockResolvedValue(existing({ displayName: '舊名', role: 'user', lastLogin: ts(NOW - 30 * MIN) }));
    await expect(syncUserDoc('U1')).resolves.toBe('updated');
    expect(fs.updateDoc).toHaveBeenCalledWith({ path: 'users/U1' }, { lastLogin: TS });
    expect(liffState.ensure).not.toHaveBeenCalled();
    // 只補 lastLogin：畫面資料沒變，不通知重讀 viewer。
    expect(refreshes).toBe(0);
  });

  it('Auth 還原進站、10 分鐘內同步過：直接略過，不讀 Firestore', async () => {
    localStorage.setItem(USER_DOC_SYNCED_KEY, `U1|${NOW - 2 * MIN}`);
    await expect(syncUserDoc('U1')).resolves.toBe('skipped');
    expect(fs.getDoc).not.toHaveBeenCalled();
  });

  it('記號屬於別的帳號或已過 10 分鐘：照常確認', async () => {
    fs.getDoc.mockResolvedValue(existing({ lastLogin: ts(NOW - MIN) }));
    localStorage.setItem(USER_DOC_SYNCED_KEY, `U2|${NOW}`);
    await expect(syncUserDoc('U1')).resolves.toBe('unchanged');
    localStorage.setItem(USER_DOC_SYNCED_KEY, `U1|${NOW - 11 * MIN}`);
    await expect(syncUserDoc('U1')).resolves.toBe('unchanged');
    expect(fs.getDoc).toHaveBeenCalledTimes(2);
  });
});

describe('syncUserDoc：拒絕寫入與失敗處理', () => {
  it('LINE userId 與 auth uid 不一致：照 A 拒絕，不寫入', async () => {
    liffState.ready = liff({ userId: 'U-other', displayName: 'x' });
    fs.getDoc.mockResolvedValue(missing);
    await expect(syncUserDoc('U1')).rejects.toMatchObject({ reason: 'line-uid-mismatch' });
    expect(fs.setDoc).not.toHaveBeenCalled();
    expect(fs.updateDoc).not.toHaveBeenCalled();
  });

  it('Firebase 目前登入者不是這個 uid：不讀不寫', async () => {
    fb.currentUid = 'U-other';
    liffState.ready = liff();
    await expect(syncUserDoc('U1')).rejects.toMatchObject({ reason: 'auth-uid-mismatch' });
    expect(fs.getDoc).not.toHaveBeenCalled();
  });

  it('寫入失敗：startUserDocSync 不拋（不擋登入）、留結構化警告（不含 uid）、不寫記號；下次進站重試成功', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    liffState.ready = liff();
    fs.getDoc.mockResolvedValue(missing);
    fs.setDoc.mockRejectedValueOnce(Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' }));

    await expect(startUserDocSync('U1')).resolves.toBeNull();
    expect(warn).toHaveBeenCalledWith('[user-doc-sync] 會員文件同步失敗', {
      reason: 'firestore-failed', retry: 'next-visit', code: 'permission-denied', message: 'Missing or insufficient permissions.',
    });
    expect(JSON.stringify(warn.mock.calls)).not.toContain('U1');
    expect(localStorage.getItem(USER_DOC_SYNCED_KEY)).toBeNull();
    // 暫時性錯誤不寫失敗記號，下次進站照常重試。
    expect(localStorage.getItem(USER_DOC_FAILED_KEY_PREFIX + 'U1')).toBeNull();
    expect(refreshes).toBe(0);

    await expect(startUserDocSync('U1')).resolves.toBe('created');
    expect(fs.setDoc).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });

  it('同一 uid 同時觸發只跑一次', async () => {
    liffState.ready = liff();
    fs.getDoc.mockResolvedValue(missing);
    const [a, b] = [syncUserDoc('U1'), syncUserDoc('U1')];
    await expect(Promise.all([a, b])).resolves.toEqual(['created', 'created']);
    expect(fs.getDoc).toHaveBeenCalledTimes(1);
    expect(fs.setDoc).toHaveBeenCalledTimes(1);
  });
});

describe('審查 P3-2：已存在文件只用真的 getProfile 結果更新名稱頭像', () => {
  it('getProfile 失敗、退回 ID token（沒有 name）：不用 LINE User 覆寫既有名稱，只補 lastLogin', async () => {
    liffState.ready = liff(new Error('timeout'), { sub: 'U1' });
    fs.getDoc.mockResolvedValue(existing({ displayName: '老會員', pictureUrl: 'https://p/old', lastLogin: ts(NOW - 30 * MIN) }));
    await expect(syncUserDoc('U1')).resolves.toBe('updated');
    expect(fs.updateDoc).toHaveBeenCalledWith({ path: 'users/U1' }, { lastLogin: TS });
    expect(refreshes).toBe(0);
  });

  it('退回 ID token 且有 name／picture：仍不覆寫既有名稱頭像（10 分鐘內就不寫）', async () => {
    liffState.ready = liff(new Error('timeout'), { sub: 'U1', name: '別名', picture: 'https://p/new' });
    fs.getDoc.mockResolvedValue(existing({ displayName: '老會員', pictureUrl: 'https://p/old', lastLogin: ts(NOW - MIN) }));
    await expect(syncUserDoc('U1')).resolves.toBe('unchanged');
    expect(fs.updateDoc).not.toHaveBeenCalled();
  });

  it('getProfile 名稱空白：保留既有名稱（不用 uid 覆寫），頭像照 getProfile 更新', async () => {
    liffState.ready = liff({ userId: 'U1', displayName: '  ', pictureUrl: 'https://p/new' });
    fs.getDoc.mockResolvedValue(existing({ displayName: '老會員', pictureUrl: 'https://p/old', lastLogin: ts(NOW - MIN) }));
    await expect(syncUserDoc('U1')).resolves.toBe('updated');
    expect(fs.updateDoc).toHaveBeenCalledWith({ path: 'users/U1' }, { pictureUrl: 'https://p/new' });
  });

  it('文件不存在、只能退回 ID token：新建照 A 後備（LINE User）', async () => {
    liffState.ready = liff(new Error('timeout'), { sub: 'U1' });
    fs.getDoc.mockResolvedValue(missing);
    await expect(syncUserDoc('U1')).resolves.toBe('created');
    expect(fs.setDoc.mock.calls[0]![1]).toMatchObject({ displayName: 'LINE User', pictureUrl: null });
  });

  it('signIn 已取得的 profile（liff.fcbProfile）直接沿用，不再呼叫 getProfile', async () => {
    const source = { ...liff(), fcbProfile: Promise.resolve({ userId: 'U1', displayName: '小明', pictureUrl: 'https://p/1' }) };
    liffState.ready = source;
    fs.getDoc.mockResolvedValue(existing({ displayName: '小明', pictureUrl: 'https://p/1', lastLogin: ts(NOW - MIN) }));
    await expect(syncUserDoc('U1')).resolves.toBe('unchanged');
    expect(source.getProfile).not.toHaveBeenCalled();
  });
});

describe('Flash 審查 P2-1：signIn 留下的 fcbProfile 要屬於目前帳號', () => {
  it('fcbProfile 是別的帳號：丟棄並重新呼叫 getProfile', async () => {
    const source = {
      ...liff({ userId: 'U1', displayName: '新帳號', pictureUrl: 'https://p/1' }),
      fcbProfile: Promise.resolve({ userId: 'U-old', displayName: '舊帳號', pictureUrl: 'https://p/old' }),
    } as Parameters<typeof readLineProfile>[0] & { getProfile: ReturnType<typeof vi.fn> };
    await expect(readLineProfile(source, 'U1')).resolves.toMatchObject({ userId: 'U1', displayName: '新帳號', source: 'getProfile' });
    expect(source.getProfile).toHaveBeenCalledTimes(1);
    expect(source.fcbProfile).toBeUndefined();
  });

  it('fcbProfile 失敗（signIn 時 getProfile 被拒）：丟棄並重新呼叫 getProfile', async () => {
    const rejected = Promise.reject(new Error('signIn getProfile failed'));
    rejected.catch(() => undefined);
    const source = { ...liff(), fcbProfile: rejected } as Parameters<typeof readLineProfile>[0] & { getProfile: ReturnType<typeof vi.fn> };
    await expect(readLineProfile(source, 'U1')).resolves.toMatchObject({ userId: 'U1', source: 'getProfile' });
    expect(source.getProfile).toHaveBeenCalledTimes(1);
    expect(source.fcbProfile).toBeUndefined();
  });

  it('登出（auth:changed uid=null）時清掉 LIFF 上的 fcbProfile', () => {
    const source = { ...liff(), fcbProfile: Promise.resolve({ userId: 'U1' }) } as Parameters<typeof readLineProfile>[0];
    liffState.ready = source;
    emit('auth:changed', { uid: 'U1' });
    expect(source.fcbProfile).toBeDefined();
    emit('auth:changed', { uid: null });
    expect(source.fcbProfile).toBeUndefined();
  });
});

describe('Flash 審查 P2-3：確定會失敗的 24 小時內不重試，暫時性錯誤下次重試', () => {
  it('LINE 帳號不符：寫 uid 專屬失敗記號；24 小時內再進站直接 backoff 不讀 Firestore；過了才重試', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    liffState.ready = liff({ userId: 'U-other', displayName: 'x' });
    fs.getDoc.mockResolvedValue(missing);

    await expect(startUserDocSync('U1')).resolves.toBeNull();
    expect(warn.mock.calls[0]![1]).toMatchObject({ reason: 'line-uid-mismatch', retry: 'after-24h' });
    expect(localStorage.getItem(USER_DOC_FAILED_KEY_PREFIX + 'U1')).toBe(String(NOW));

    fs.getDoc.mockClear();
    await expect(syncUserDoc('U1')).resolves.toBe('backoff');
    expect(fs.getDoc).not.toHaveBeenCalled();
    // 記號是 uid 專屬：別的帳號不受影響。
    fb.currentUid = 'U2';
    liffState.ready = liff({ userId: 'U2', displayName: '乙' });
    await expect(syncUserDoc('U2')).resolves.toBe('created');

    vi.setSystemTime(NOW + PERMANENT_FAILURE_BACKOFF_MS + 1);
    fb.currentUid = 'U1';
    liffState.ready = liff();
    fs.getDoc.mockResolvedValue(missing);
    await expect(syncUserDoc('U1')).resolves.toBe('created');
    // 成功後清掉失敗記號。
    expect(localStorage.getItem(USER_DOC_FAILED_KEY_PREFIX + 'U1')).toBeNull();
    warn.mockRestore();
  });

  it('文件不存在又拿不到 LINE profile（LIFF 暫未登入／getProfile 逾時）：暫時性，不寫失敗記號，下次進站重試', async () => {
    liffState.ensure.mockResolvedValue({ ...liff(), isLoggedIn: () => false });
    fs.getDoc.mockResolvedValue(missing);
    await expect(syncUserDoc('U1')).rejects.toMatchObject({ reason: 'line-profile-unavailable' });
    expect(localStorage.getItem(USER_DOC_FAILED_KEY_PREFIX + 'U1')).toBeNull();

    liffState.ensure.mockResolvedValue(liff());
    await expect(syncUserDoc('U1')).resolves.toBe('created');
  });

  it('backoff 期間剛重新 LINE 登入（有屬於這個 uid 的新鮮 fcbProfile）：略過 backoff 照常同步，成功後清掉失敗記號', async () => {
    localStorage.setItem(USER_DOC_FAILED_KEY_PREFIX + 'U1', String(NOW - MIN));
    liffState.ready = { ...liff(), fcbProfile: Promise.resolve({ userId: 'U1', displayName: '小明', pictureUrl: 'https://p/1' }) };
    fs.getDoc.mockResolvedValue(missing);
    await expect(syncUserDoc('U1')).resolves.toBe('created');
    expect(localStorage.getItem(USER_DOC_FAILED_KEY_PREFIX + 'U1')).toBeNull();
  });

  it('backoff 只擋沒有新 profile 的自動重試：LIFF 就緒但沒有 fcbProfile、或 fcbProfile 是別的帳號，都照樣 backoff', async () => {
    localStorage.setItem(USER_DOC_FAILED_KEY_PREFIX + 'U1', String(NOW - MIN));
    liffState.ready = liff();
    await expect(syncUserDoc('U1')).resolves.toBe('backoff');
    liffState.ready = { ...liff(), fcbProfile: Promise.resolve({ userId: 'U-other' }) };
    await expect(syncUserDoc('U1')).resolves.toBe('backoff');
    expect(fs.getDoc).not.toHaveBeenCalled();
  });

  it('同一份 fcbProfile 只能略過 backoff 一次：略過後又遇永久錯誤（legacy 不可遷移）就重寫記號、照常 backoff', async () => {
    localStorage.setItem(USER_DOC_FAILED_KEY_PREFIX + 'U1', String(NOW - MIN));
    const stash = Promise.resolve({ userId: 'U1', displayName: '小明' });
    liffState.ready = { ...liff(), fcbProfile: stash };
    fs.getDoc.mockResolvedValue(missing);
    fs.getDocs.mockResolvedValue({ docs: [{ id: 'old', data: () => ({ lineUserId: 'U1', manualRole: 'admin' }) }] });
    await expect(syncUserDoc('U1')).rejects.toMatchObject({ reason: 'legacy-not-migratable:create-fields-not-allowed' });
    expect(localStorage.getItem(USER_DOC_FAILED_KEY_PREFIX + 'U1')).toBe(String(NOW));
    fs.getDoc.mockClear();
    await expect(syncUserDoc('U1')).resolves.toBe('backoff');
    expect(fs.getDoc).not.toHaveBeenCalled();
  });

  it('略過 backoff 時先清掉舊失敗記號：這次只遇暫時性錯誤，下次進站照常重試（不 backoff）', async () => {
    localStorage.setItem(USER_DOC_FAILED_KEY_PREFIX + 'U1', String(NOW - MIN));
    const stash = Promise.resolve({ userId: 'U1', displayName: '小明' });
    liffState.ready = { ...liff(), fcbProfile: stash };
    fs.getDoc.mockRejectedValueOnce(Object.assign(new Error('unavailable'), { code: 'unavailable' }));
    await expect(syncUserDoc('U1')).rejects.toBeTruthy();
    expect(localStorage.getItem(USER_DOC_FAILED_KEY_PREFIX + 'U1')).toBeNull();

    fs.getDoc.mockResolvedValue(missing);
    await expect(syncUserDoc('U1')).resolves.toBe('created');
  });

  it('登出時重設「已略過」紀錄：同一份 fcbProfile 在重新登入後可再略過一次', async () => {
    localStorage.setItem(USER_DOC_FAILED_KEY_PREFIX + 'U1', String(NOW - MIN));
    const stash = Promise.resolve({ userId: 'U1', displayName: '小明' });
    liffState.ready = { ...liff(), fcbProfile: stash };
    fs.getDoc.mockResolvedValue(missing);
    fs.getDocs.mockResolvedValue({ docs: [{ id: 'old', data: () => ({ lineUserId: 'U1', manualRole: 'admin' }) }] });
    await expect(syncUserDoc('U1')).rejects.toBeTruthy();
    await expect(syncUserDoc('U1')).resolves.toBe('backoff');

    emit('auth:changed', { uid: null });
    localStorage.setItem(USER_DOC_FAILED_KEY_PREFIX + 'U1', String(NOW - MIN));
    liffState.ready = { ...liff(), fcbProfile: stash };
    fs.getDocs.mockResolvedValue(noLegacy);
    await expect(syncUserDoc('U1')).resolves.toBe('created');
  });

  it('auth uid 不符時不記下這一頁的帳號：之後登出不會去清那個 uid 的記號', async () => {
    fb.currentUid = 'U-other';
    liffState.ready = liff();
    await expect(syncUserDoc('U1')).rejects.toMatchObject({ reason: 'auth-uid-mismatch' });
    localStorage.setItem(USER_DOC_FAILED_KEY_PREFIX + 'U1', String(NOW));
    emit('auth:changed', { uid: null });
    expect(localStorage.getItem(USER_DOC_FAILED_KEY_PREFIX + 'U1')).toBe(String(NOW));
  });

  it('登出時明確清掉這個帳號的失敗記號（不依賴帳號資料前綴清理），重新登入一定重試', async () => {
    liffState.ready = liff({ userId: 'U-other', displayName: 'x' });
    fs.getDoc.mockResolvedValue(missing);
    await expect(syncUserDoc('U1')).rejects.toMatchObject({ reason: 'line-uid-mismatch' });
    expect(localStorage.getItem(USER_DOC_FAILED_KEY_PREFIX + 'U1')).not.toBeNull();
    localStorage.setItem(USER_DOC_FAILED_KEY_PREFIX + 'U2', String(NOW));

    emit('auth:changed', { uid: null });

    expect(localStorage.getItem(USER_DOC_FAILED_KEY_PREFIX + 'U1')).toBeNull();
    // 只清這個帳號的，不動別的 uid。
    expect(localStorage.getItem(USER_DOC_FAILED_KEY_PREFIX + 'U2')).toBe(String(NOW));
  });

  it('LIFF 初始化失敗（暫時性）：不寫失敗記號', async () => {
    liffState.ensure.mockRejectedValue(new Error('network'));
    fs.getDoc.mockResolvedValue(missing);
    await expect(syncUserDoc('U1')).rejects.toMatchObject({ reason: 'liff-init-failed' });
    expect(localStorage.getItem(USER_DOC_FAILED_KEY_PREFIX + 'U1')).toBeNull();
  });

  it('legacy 欄位型別不符 Rules：判定不可自動遷移、不送寫入、寫失敗記號', async () => {
    liffState.ready = liff();
    fs.getDoc.mockResolvedValue(missing);
    fs.getDocs.mockResolvedValue({ docs: [{ id: 'old', data: () => ({ lineUserId: 'U1', sports: ['football'], totalGames: 1.5 }) }] });
    await expect(syncUserDoc('U1')).rejects.toMatchObject({
      reason: 'legacy-not-migratable:create-types-not-allowed:sports,totalGames',
    });
    expect(fs.setDoc).not.toHaveBeenCalled();
    expect(localStorage.getItem(USER_DOC_FAILED_KEY_PREFIX + 'U1')).not.toBeNull();
  });

  it('文件已存在、LIFF 就緒但拿不到 profile：不當成失敗，只補 lastLogin', async () => {
    liffState.ready = liff(new Error('timeout'), null);
    fs.getDoc.mockResolvedValue(existing({ displayName: '老會員', lastLogin: ts(NOW - 30 * MIN) }));
    await expect(syncUserDoc('U1')).resolves.toBe('updated');
    expect(fs.updateDoc).toHaveBeenCalledWith({ path: 'users/U1' }, { lastLogin: TS });
    expect(localStorage.getItem(USER_DOC_FAILED_KEY_PREFIX + 'U1')).toBeNull();
  });
});

describe('Flash 審查 P3-3：viewer:refresh 的 listener 拋錯不影響同步結果', () => {
  it('listener 拋錯：emit 自行隔離（core/events），同步仍回 created、寫成功記號', async () => {
    const stopBad = on('viewer:refresh', () => { throw new Error('listener boom'); });
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    liffState.ready = liff();
    fs.getDoc.mockResolvedValue(missing);
    await expect(syncUserDoc('U1')).resolves.toBe('created');
    expect(localStorage.getItem(USER_DOC_SYNCED_KEY)).toBe(`U1|${NOW}`);
    expect(refreshes).toBe(1);
    stopBad();
    error.mockRestore();
  });
});

describe('readLineProfile', () => {
  it('getProfile 失敗時退回 ID token（照 A Fallback 2）', async () => {
    const source = liff(new Error('blocked'), { sub: 'U1', name: '小華', picture: 'https://p/2', email: 'b@example.test' });
    await expect(readLineProfile(source)).resolves.toEqual({
      userId: 'U1', displayName: '小華', pictureUrl: 'https://p/2', email: 'b@example.test', source: 'idToken',
    });
  });

  it('兩者都拿不到回 null', async () => {
    await expect(readLineProfile(liff(new Error('blocked'), null))).resolves.toBeNull();
  });
});
