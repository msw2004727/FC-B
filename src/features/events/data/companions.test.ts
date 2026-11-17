import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/data/firebase', () => ({
  getFirebase: vi.fn(),
}));

vi.mock('@/data/profile-private', () => ({
  loadPrivateProfile: vi.fn(),
}));

vi.mock('firebase/firestore', () => ({
  doc: vi.fn((_db: unknown, path: string, id: string) => ({ __doc: `${path}/${id}` })),
  getDoc: vi.fn(),
}));

import { getFirebase } from '@/data/firebase';
import { loadPrivateProfile } from '@/data/profile-private';
import { getDoc } from 'firebase/firestore';

import { loadSignupCompanions } from './companions';

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getFirebase).mockResolvedValue({ db: {} } as never);
});

function mockRoot(data: Record<string, unknown> | null): void {
  vi.mocked(getDoc).mockResolvedValue({
    exists: () => data !== null,
    data: () => data ?? undefined,
  } as never);
}

describe('loadSignupCompanions', () => {
  it('私密有 companions 用私密', async () => {
    mockRoot({ companions: [{ id: 'r', name: 'Root' }] });
    vi.mocked(loadPrivateProfile).mockResolvedValue({ companions: [{ id: 'p', name: 'Priv' }] });
    expect(await loadSignupCompanions('u1')).toEqual([{ id: 'p', name: 'Priv' }]);
  });

  it('私密 null 回 []', async () => {
    mockRoot({ companions: [{ id: 'r', name: 'Root' }] });
    vi.mocked(loadPrivateProfile).mockResolvedValue({ companions: null });
    expect(await loadSignupCompanions('u1')).toEqual([]);
  });

  it('私密缺鍵用根', async () => {
    mockRoot({ companions: [{ id: 'r', name: 'Root' }] });
    vi.mocked(loadPrivateProfile).mockResolvedValue({ phone: 'x' });
    expect(await loadSignupCompanions('u1')).toEqual([{ id: 'r', name: 'Root' }]);
  });

  it('私密讀取失敗（null）用根', async () => {
    mockRoot({ companions: [{ id: 'r', name: 'Root' }] });
    vi.mocked(loadPrivateProfile).mockResolvedValue(null);
    expect(await loadSignupCompanions('u1')).toEqual([{ id: 'r', name: 'Root' }]);
  });

  it('根不存在、私密有 companions 用私密', async () => {
    mockRoot(null);
    vi.mocked(loadPrivateProfile).mockResolvedValue({ companions: [{ id: 'p', name: 'Priv' }] });
    expect(await loadSignupCompanions('u1')).toEqual([{ id: 'p', name: 'Priv' }]);
  });

  it('根不存在、私密缺鍵回 []', async () => {
    mockRoot(null);
    vi.mocked(loadPrivateProfile).mockResolvedValue(null);
    expect(await loadSignupCompanions('u1')).toEqual([]);
  });

  it('私密 companions 非陣列 throw', async () => {
    mockRoot(null);
    vi.mocked(loadPrivateProfile).mockResolvedValue({ companions: 'not-array' });
    await expect(loadSignupCompanions('u1')).rejects.toThrow('Invalid companion list');
  });

  it('私密 companions 驗證錯誤仍 throw', async () => {
    mockRoot(null);
    vi.mocked(loadPrivateProfile).mockResolvedValue({ companions: [{ name: 'no-id' }] });
    await expect(loadSignupCompanions('u1')).rejects.toThrow('Invalid companion');
  });
});
