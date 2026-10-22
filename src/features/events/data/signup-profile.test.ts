const { mockGetDoc } = vi.hoisted(() => ({ mockGetDoc: vi.fn() }));

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/data/firebase', () => ({
  getFirebase: () => Promise.resolve({ db: {} }),
}));

vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, collection: string, id: string) => ({ collection, id }),
  getDoc: mockGetDoc,
}));

import { loadSignupProfile } from './signup-profile';

describe('loadSignupProfile', () => {
  beforeEach(() => {
    mockGetDoc.mockReset();
  });

  it('文件不存在回空值物件', async () => {
    mockGetDoc.mockResolvedValue({ exists: () => false, data: () => ({}) });
    expect(await loadSignupProfile('u1')).toEqual({
      gender: '', birthday: '', exp: 0, lineNotifyBound: false,
    });
  });

  it('讀 gender / birthday / exp / lineNotifyBound', async () => {
    mockGetDoc.mockResolvedValue({
      exists: () => true,
      data: () => ({
        gender: '男',
        birthday: '1990/01/01',
        exp: 120,
        lineNotify: { bound: true },
      }),
    });
    expect(await loadSignupProfile('u1')).toEqual({
      gender: '男',
      birthday: '1990/01/01',
      exp: 120,
      lineNotifyBound: true,
    });
  });

  it('非字串／非數字一律正規化為空值', async () => {
    mockGetDoc.mockResolvedValue({
      exists: () => true,
      data: () => ({ gender: 123, birthday: null, exp: 'abc', lineNotify: 'bad' }),
    });
    expect(await loadSignupProfile('u1')).toEqual({
      gender: '', birthday: '', exp: 0, lineNotifyBound: false,
    });
  });

  it('lineNotify 缺 bound 或非物件視為 false', async () => {
    mockGetDoc.mockResolvedValue({
      exists: () => true,
      data: () => ({ gender: '女', lineNotify: { bound: 'yes' } }),
    });
    expect((await loadSignupProfile('u1')).lineNotifyBound).toBe(false);
  });

  it('讀取失敗 reject（呼叫端視為 profile=null）', async () => {
    mockGetDoc.mockRejectedValue(new Error('permission-denied'));
    await expect(loadSignupProfile('u1')).rejects.toThrow('permission-denied');
  });
});
