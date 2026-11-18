import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/data/firebase', () => ({
  getFirebase: vi.fn(),
}));

vi.mock('firebase/firestore', () => ({
  doc: vi.fn((_db: unknown, ...segs: string[]) => ({ __doc: segs.join('/') })),
  getDoc: vi.fn(),
  serverTimestamp: vi.fn(() => ({ __sv: 'SERVER_TIMESTAMP' })),
}));

import { getFirebase } from '@/data/firebase';
import type { Firestore, WriteBatch } from 'firebase/firestore';
import { getDoc, serverTimestamp } from 'firebase/firestore';

import {
  addPrivateWrite,
  loadPrivateProfile,
  loadPrivateProfileStrict,
  mergePrivateFields,
  pickPrivatePatch,
  profilePrivateDocRef,
} from './profile-private';

const SERVER_TS = { __sv: 'SERVER_TIMESTAMP' };

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getFirebase).mockResolvedValue({ db: {} } as never);
  vi.mocked(serverTimestamp).mockReturnValue(SERVER_TS as never);
});

describe('profilePrivateDocRef', () => {
  it('路徑為 users/{uid}/profilePrivate/profile', () => {
    const ref = profilePrivateDocRef({} as Firestore, 'uidA');
    expect(ref).toEqual({ __doc: 'users/uidA/profilePrivate/profile' });
  });

  it('非法 uid throw', () => {
    expect(() => profilePrivateDocRef({} as Firestore, '')).toThrow();
    expect(() => profilePrivateDocRef({} as Firestore, '   ')).toThrow();
    expect(() => profilePrivateDocRef({} as Firestore, 'a/b')).toThrow();
  });
});

describe('loadPrivateProfileStrict', () => {
  it('文件不存在回 null', async () => {
    vi.mocked(getDoc).mockResolvedValue({ exists: () => false } as never);
    expect(await loadPrivateProfileStrict('uidA')).toBeNull();
  });

  it('unavailable 等錯誤一律拋出（不吞成 null）', async () => {
    vi.mocked(getDoc).mockRejectedValue({ code: 'unavailable' });
    await expect(loadPrivateProfileStrict('uidA')).rejects.toMatchObject({ code: 'unavailable' });
  });
});

describe('loadPrivateProfile', () => {
  it('文件不存在回 null', async () => {
    vi.mocked(getDoc).mockResolvedValue({ exists: () => false } as never);
    expect(await loadPrivateProfile('uidA')).toBeNull();
  });

  it('只回四欄中存在的鍵', async () => {
    vi.mocked(getDoc).mockResolvedValue({
      exists: () => true,
      data: () => ({
        phone: '0912',
        email: 'a@b',
        companions: [{ id: 'x' }],
        eduChildren: [],
        updatedAt: { __ts: true },
      }),
    } as never);
    const data = await loadPrivateProfile('uidA');
    expect(data).toEqual({
      phone: '0912',
      email: 'a@b',
      companions: [{ id: 'x' }],
      eduChildren: [],
    });
    expect(data).not.toHaveProperty('updatedAt');
  });

  it('permission-denied 回 null 且 console.debug 不含 uid', async () => {
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => undefined);
    vi.mocked(getDoc).mockRejectedValue({ code: 'permission-denied' });
    expect(await loadPrivateProfile('uidA')).toBeNull();
    expect(debugSpy).toHaveBeenCalledTimes(1);
    const args = debugSpy.mock.calls[0] ?? [];
    for (const arg of args) {
      expect(String(arg)).not.toContain('uidA');
    }
    debugSpy.mockRestore();
  });
});

describe('mergePrivateFields', () => {
  it('私密有值用私密', () => {
    const root = { phone: 'r', email: 'r@e', gender: 'g' };
    const priv = { phone: 'p' };
    const out = mergePrivateFields(root, priv);
    expect(out).toEqual({ phone: 'p', email: 'r@e', gender: 'g' });
  });

  it('私密 null 不退回根', () => {
    const root = { phone: 'r', gender: 'g' };
    const priv: Record<string, unknown> = { phone: null };
    const out = mergePrivateFields(root, priv);
    expect(out).toEqual({ phone: null, gender: 'g' });
  });

  it('私密缺鍵用根', () => {
    const root = { phone: 'r', email: 'r@e' };
    const out = mergePrivateFields(root, {});
    expect(out).toEqual({ phone: 'r', email: 'r@e' });
  });

  it('其他鍵不變', () => {
    const root = { name: 'N', phone: 'r' };
    const out = mergePrivateFields(root, { phone: 'p' });
    expect(out).toEqual({ name: 'N', phone: 'p' });
  });

  it('priv 為 null 回新物件', () => {
    const root = { name: 'N' };
    const out = mergePrivateFields(root, null);
    expect(out).toEqual(root);
    expect(out).not.toBe(root);
  });
});

describe('pickPrivatePatch', () => {
  it('只挑四欄且 undefined 轉 null', () => {
    const out = pickPrivatePatch({
      phone: 'x',
      email: undefined,
      companions: [{ id: 'a' }],
      gender: 'g',
      updatedAt: { __ts: true },
    });
    expect(out).toEqual({
      phone: 'x',
      email: null,
      companions: [{ id: 'a' }],
    });
  });

  it('空 patch 回空物件', () => {
    expect(pickPrivatePatch({ gender: 'g' })).toEqual({});
  });
});

describe('addPrivateWrite', () => {
  const makeBatch = () => ({
    set: vi.fn(),
    update: vi.fn(),
    commit: vi.fn(),
  });

  it('空 patch 不呼叫 batch.set', () => {
    const batch = makeBatch();
    addPrivateWrite(batch as unknown as WriteBatch, {} as Firestore, 'uidA', {});
    expect(batch.set).not.toHaveBeenCalled();
  });

  it('寫入路徑、merge、無 createdAt/backfilledAt', () => {
    const batch = makeBatch();
    addPrivateWrite(batch as unknown as WriteBatch, {} as Firestore, 'uidA', { phone: '0912' });
    expect(batch.set).toHaveBeenCalledTimes(1);
    const [ref, payload, options] = batch.set.mock.calls[0]!;
    expect(ref).toEqual({ __doc: 'users/uidA/profilePrivate/profile' });
    expect(payload).toEqual({ phone: '0912', updatedAt: SERVER_TS });
    expect(payload).not.toHaveProperty('createdAt');
    expect(payload).not.toHaveProperty('backfilledAt');
    expect(options).toEqual({ merge: true });
  });
});
