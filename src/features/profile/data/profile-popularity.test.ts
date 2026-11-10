import { beforeEach, describe, expect, it, vi } from 'vitest';
import { doc, getDoc } from 'firebase/firestore';

import { getFirebase } from '@/data/firebase';

import { PROFILE_POPULARITY_COLLECTION, loadProfilePopularityViews } from './profile-popularity';

vi.mock('firebase/firestore', () => ({
  doc: vi.fn((_db: unknown, collectionName: string, id: string) => ({
    path: `${collectionName}/${id}`,
  })),
  getDoc: vi.fn(),
}));

vi.mock('@/data/firebase', () => ({
  getFirebase: vi.fn(),
}));

const fakeDb = { name: 'mock-db' };

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getFirebase).mockResolvedValue({
    db: fakeDb as never,
    app: {} as never,
    auth: {} as never,
    functions: {} as never,
  });
});

describe('loadProfilePopularityViews', () => {
  it('空 UID 或含斜線不查 Firestore', async () => {
    expect(await loadProfilePopularityViews('')).toBeNull();
    expect(await loadProfilePopularityViews('   ')).toBeNull();
    expect(await loadProfilePopularityViews('bad/uid')).toBeNull();
    expect(getFirebase).not.toHaveBeenCalled();
    expect(getDoc).not.toHaveBeenCalled();
  });

  it('有文件且 views 為有限非負數：取整後回傳', async () => {
    vi.mocked(getDoc).mockResolvedValue({
      exists: () => true,
      data: () => ({ views: 1280.9 }),
    } as never);
    expect(await loadProfilePopularityViews('U-1')).toBe(1280);
    expect(doc).toHaveBeenCalledWith(fakeDb, PROFILE_POPULARITY_COLLECTION, 'U-1');
    expect(getDoc).toHaveBeenCalledTimes(1);
  });

  it('文件不存在（讀取成功）回 0', async () => {
    vi.mocked(getDoc).mockResolvedValue({
      exists: () => false,
      data: () => undefined,
    } as never);
    expect(await loadProfilePopularityViews('U-missing')).toBe(0);
  });

  it.each([
    undefined,
    null,
    '12',
    Number.NaN,
    Number.POSITIVE_INFINITY,
    -1,
    true,
  ])('views 非法（%s）回 null，不把畫面改成 0 星', async (views) => {
    vi.mocked(getDoc).mockResolvedValue({
      exists: () => true,
      data: () => ({ views }),
    } as never);
    expect(await loadProfilePopularityViews('U-bad')).toBeNull();
  });

  it('讀取失敗（含 permission-denied）靜默回 null', async () => {
    vi.mocked(getDoc).mockRejectedValue(Object.assign(new Error('denied'), { code: 'permission-denied' }));
    await expect(loadProfilePopularityViews('U-1')).resolves.toBeNull();
    vi.mocked(getFirebase).mockRejectedValueOnce(new Error('offline'));
    await expect(loadProfilePopularityViews('U-2')).resolves.toBeNull();
  });

  it('同一 UID 進行中的請求只讀一次；完成後再呼叫會重讀', async () => {
    let resolveSnap: (value: unknown) => void = () => {};
    vi.mocked(getDoc).mockImplementationOnce(
      () => new Promise((resolve) => {
        resolveSnap = resolve;
      }) as never,
    );
    const first = loadProfilePopularityViews('U-shared');
    const second = loadProfilePopularityViews('U-shared');
    // getFirebase() 是 microtask，getDoc 要等它 resolve 才會被呼叫。
    await vi.waitFor(() => expect(getDoc).toHaveBeenCalledTimes(1));
    resolveSnap({ exists: () => true, data: () => ({ views: 50 }) });
    await expect(first).resolves.toBe(50);
    await expect(second).resolves.toBe(50);

    vi.mocked(getDoc).mockResolvedValue({
      exists: () => true,
      data: () => ({ views: 100 }),
    } as never);
    await expect(loadProfilePopularityViews('U-shared')).resolves.toBe(100);
    expect(getDoc).toHaveBeenCalledTimes(2);
  });
});
