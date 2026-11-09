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

import { on } from '@/core/events';
import { USER_DOC_CREATE_FIELDS } from './user-doc-payload';
import {
  _resetUserDocSyncForTest,
  readLineProfile,
  startUserDocSync,
  syncUserDoc,
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
    await expect(syncUserDoc('U1')).rejects.toMatchObject({ reason: 'create-values-not-allowed:role,createdAt' });
    expect(fs.setDoc).not.toHaveBeenCalled();
    expect(localStorage.getItem(USER_DOC_SYNCED_KEY)).toBeNull();
  });

  it('legacy 文件有 Rules 不允許的欄位：不送寫入', async () => {
    liffState.ready = liff();
    fs.getDoc.mockResolvedValue(missing);
    fs.getDocs.mockResolvedValue({ docs: [{ id: 'old', data: () => ({ lineUserId: 'U1', manualRole: 'admin' }) }] });
    await expect(syncUserDoc('U1')).rejects.toMatchObject({ reason: 'create-fields-not-allowed' });
    expect(fs.setDoc).not.toHaveBeenCalled();
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
    expect(warn).toHaveBeenCalledWith('[user-doc-sync] 會員文件同步失敗，下次進站重試', {
      reason: 'firestore-failed', code: 'permission-denied', message: 'Missing or insufficient permissions.',
    });
    expect(JSON.stringify(warn.mock.calls)).not.toContain('U1');
    expect(localStorage.getItem(USER_DOC_SYNCED_KEY)).toBeNull();
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

describe('readLineProfile', () => {
  it('getProfile 失敗時退回 ID token（照 A Fallback 2）', async () => {
    const source = liff(new Error('blocked'), { sub: 'U1', name: '小華', picture: 'https://p/2', email: 'b@example.test' });
    await expect(readLineProfile(source)).resolves.toEqual({
      userId: 'U1', displayName: '小華', pictureUrl: 'https://p/2', email: 'b@example.test',
    });
  });

  it('兩者都拿不到回 null', async () => {
    await expect(readLineProfile(liff(new Error('blocked'), null))).resolves.toBeNull();
  });
});
