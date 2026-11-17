import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/data/firebase', () => ({
  getFirebase: vi.fn(),
}));

vi.mock('firebase/firestore', () => ({
  collection: vi.fn((_db, path) => ({ __coll: path })),
  doc: vi.fn((_db, path, id) => ({ __doc: `${path}/${id}` })),
  getDoc: vi.fn(),
  getDocs: vi.fn(),
  limit: vi.fn((n) => ({ __limit: n })),
  query: vi.fn((...parts) => ({ __query: parts })),
  where: vi.fn((field, op, value) => ({ __where: { field, op, value } })),
}));

vi.mock('@/data/profile-private', () => ({
  loadPrivateProfileStrict: vi.fn(),
  mergePrivateFields: vi.fn(),
}));

import { getFirebase } from '@/data/firebase';
import { getDoc, getDocs } from 'firebase/firestore';
import { loadPrivateProfileStrict, mergePrivateFields } from '@/data/profile-private';

import { loadOwnUserProfile, loadUserProfile, mapUserProfileDoc } from './profile-model';

describe('mapUserProfileDoc', () => {
  it('null / undefined → null', () => {
    expect(mapUserProfileDoc(null, 'x')).toBeNull();
    expect(mapUserProfileDoc(undefined, 'x')).toBeNull();
  });

  it('displayName → name; uid 優先於 lineUserId、docId', () => {
    const r = mapUserProfileDoc(
      { displayName: 'Alice', uid: 'u1', lineUserId: 'l1' },
      'docId',
    );
    expect(r?.name).toBe('Alice');
    expect(r?.uid).toBe('u1');
    expect(r?._docId).toBe('docId');
  });

  it('name fallback 用 name 欄位', () => {
    expect(mapUserProfileDoc({ name: 'Bob' }, 'docId')?.name).toBe('Bob');
  });

  it('name 缺失時為 Unknown', () => {
    expect(mapUserProfileDoc({}, 'docId')?.name).toBe('Unknown');
  });

  it('uid fallback 用 lineUserId', () => {
    expect(mapUserProfileDoc({ lineUserId: 'line-1' }, 'docId')?.uid).toBe('line-1');
  });

  it('uid 完全缺失時退到 docId', () => {
    expect(mapUserProfileDoc({}, 'docId')?.uid).toBe('docId');
  });

  it('lastActive 優先 lastLogin，其次 lastActive', () => {
    const lastLogin = { seconds: 100 };
    const lastActive = { seconds: 50 };
    expect(mapUserProfileDoc({ lastLogin, lastActive }, 'x')?.lastActive).toBe(lastLogin);
    expect(mapUserProfileDoc({ lastActive }, 'x')?.lastActive).toBe(lastActive);
    expect(mapUserProfileDoc({}, 'x')?.lastActive).toBeNull();
  });

  it('保留原始文件其餘欄位', () => {
    const r = mapUserProfileDoc({ displayName: 'A', role: 'user', exp: 9 }, 'x');
    expect(r?.['role']).toBe('user');
    expect(r?.['exp']).toBe(9);
  });
});

describe('loadOwnUserProfile', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getFirebase).mockResolvedValue({ db: {} } as never);
    vi.mocked(mergePrivateFields).mockImplementation(
      ((root: Record<string, unknown>, priv: Record<string, unknown> | null) => (
        priv
          ? { ...root, ...Object.fromEntries(
              Object.entries(priv).filter(([, v]) => v !== undefined),
            ) }
          : { ...root }
      )) as unknown as typeof mergePrivateFields,
    );
  });

  it('併行讀根與私密並合併', async () => {
    vi.mocked(getDoc).mockResolvedValue({
      exists: () => true,
      id: 'u1',
      data: () => ({ displayName: 'Alice', uid: 'u1', phone: 'root-phone' }),
    } as never);
    vi.mocked(loadPrivateProfileStrict).mockResolvedValue({ phone: 'priv-phone' });

    const r = await loadOwnUserProfile('u1');
    expect(r).not.toBeNull();
    expect(r?.phone).toBe('priv-phone');
    expect(r?.name).toBe('Alice');
  });

  it('私密文件不存在時照常回根', async () => {
    vi.mocked(getDoc).mockResolvedValue({
      exists: () => true,
      id: 'u1',
      data: () => ({ displayName: 'Alice', uid: 'u1', phone: 'root-phone' }),
    } as never);
    vi.mocked(loadPrivateProfileStrict).mockResolvedValue(null);

    const r = await loadOwnUserProfile('u1');
    expect(r?.phone).toBe('root-phone');
  });

  it('私密讀取以 unavailable 失敗時整個載入 reject，不回根資料（避免拿過期值覆寫同行者）', async () => {
    vi.mocked(getDoc).mockResolvedValue({
      exists: () => true,
      id: 'u1',
      data: () => ({ displayName: 'Alice', uid: 'u1', phone: 'root-phone', companions: [{ name: 'old' }] }),
    } as never);
    vi.mocked(loadPrivateProfileStrict).mockRejectedValue(Object.assign(new Error('offline'), { code: 'unavailable' }));

    await expect(loadOwnUserProfile('u1')).rejects.toMatchObject({ code: 'unavailable' });
  });

  it('profile 不存在回 null', async () => {
    vi.mocked(getDoc).mockResolvedValue({ exists: () => false } as never);
    vi.mocked(getDocs).mockResolvedValue({ docs: [] } as never);
    vi.mocked(loadPrivateProfileStrict).mockResolvedValue({ phone: 'priv-phone' });

    expect(await loadOwnUserProfile('u1')).toBeNull();
  });
});

describe('loadUserProfile', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getFirebase).mockResolvedValue({ db: {} } as never);
  });

  it('空 uid 直接回 null', async () => {
    expect(await loadUserProfile('')).toBeNull();
    expect(await loadUserProfile('   ')).toBeNull();
  });

  it('直接命中 users/{uid}', async () => {
    vi.mocked(getDoc).mockResolvedValue({
      exists: () => true,
      id: 'u1',
      data: () => ({ displayName: 'Alice', uid: 'u1' }),
    } as never);

    const r = await loadUserProfile('u1');
    expect(r?.name).toBe('Alice');
    expect(r?.uid).toBe('u1');
    expect(vi.mocked(getDocs)).not.toHaveBeenCalled();
  });

  it('直接 doc 不存在時，以 uid 欄位查詢', async () => {
    vi.mocked(getDoc).mockResolvedValue({ exists: () => false } as never);
    vi.mocked(getDocs).mockResolvedValue({
      docs: [
        {
          exists: () => true,
          id: 'legacy',
          data: () => ({ displayName: 'Bob', uid: 'u1' }),
        },
      ],
    } as never);

    const r = await loadUserProfile('u1');
    expect(r?.name).toBe('Bob');
    expect(r?.uid).toBe('u1');
    expect(r?._docId).toBe('legacy');
  });

  it('name 查詢不存在於模組（R-ID-002）', async () => {
    // 只有 uid / lineUserId 兩種查詢，無 displayName / name。
    vi.mocked(getDoc).mockRejectedValue(new Error('offline'));
    vi.mocked(getDocs).mockResolvedValue({ docs: [] } as never);
    const r = await loadUserProfile('u1');
    expect(r).toBeNull();
    const calls = vi.mocked(getDocs).mock.calls.map((c) => JSON.stringify(c[0]));
    for (const s of calls) {
      expect(s).not.toContain('"field":"displayName"');
      expect(s).not.toContain('"field":"name"');
    }
  });
});
