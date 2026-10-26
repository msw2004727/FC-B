import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// T-041 退修 1：登入旗標（既有的 fcb:signed-in，見 auth-hint.ts）由 auth.ts 的 emitAuth 寫入與清除。
// 登入成功、還原登入者 → 寫入；登出（signOut）、帳號失效（還原時 Auth 判定沒有使用者）→ Auth 發 null 狀態 → 清除。
// 這個旗標決定下次開頁時 Firestore 要不要等 Auth（data/firebase.ts 的「登入旗標閘」）。

const FLAG_KEY = 'fcb:signed-in';

const hoisted = vi.hoisted(() => ({
  listeners: new Set<(user: { uid: string; displayName: null; photoURL: null } | null) => void>(),
}));

vi.mock('./callables', () => ({ callFn: vi.fn() }));
vi.mock('./firebase', () => ({
  getFirebase: vi.fn(async () => ({ auth: { name: 'fake-auth' } })),
  shouldUseEmulator: () => false,
}));
vi.mock('firebase/auth', () => ({
  onAuthStateChanged: (
    _auth: unknown,
    cb: (user: { uid: string; displayName: null; photoURL: null } | null) => void,
  ) => {
    hoisted.listeners.add(cb);
    return () => hoisted.listeners.delete(cb);
  },
  // 真的 signOut 會讓 Auth 把目前使用者清成 null 並通知所有狀態監聽
  signOut: vi.fn(async () => {
    for (const listener of [...hoisted.listeners]) listener(null);
  }),
  signInWithCustomToken: vi.fn(),
}));

import { onAuthChanged, signOut } from './auth';

const user = (uid: string) => ({ uid, displayName: null, photoURL: null });
const emitState = (u: ReturnType<typeof user> | null): void => {
  for (const listener of [...hoisted.listeners]) listener(u);
};

let stop: (() => void) | null = null;

beforeEach(async () => {
  localStorage.clear();
  hoisted.listeners.clear();
  stop = onAuthChanged(() => undefined);
  await vi.waitFor(() => expect(hoisted.listeners.size).toBe(1));
});

afterEach(() => {
  stop?.();
  stop = null;
  localStorage.clear();
});

describe('登入旗標的寫入與清除（fcb:signed-in）', () => {
  it('Auth 還原出登入者（或登入成功後的狀態事件）→ 寫入旗標', () => {
    expect(localStorage.getItem(FLAG_KEY)).toBeNull();
    emitState(user('U1'));
    expect(localStorage.getItem(FLAG_KEY)).toBe('1');
  });

  it('登出（signOut）→ Auth 通知 null 狀態 → 清掉旗標', async () => {
    emitState(user('U1'));
    expect(localStorage.getItem(FLAG_KEY)).toBe('1');

    await signOut();
    expect(localStorage.getItem(FLAG_KEY)).toBeNull();
  });

  it('帳號失效（旗標還在，但還原時 Auth 判定沒有使用者）→ 第一次狀態事件為 null → 清掉旗標', () => {
    localStorage.setItem(FLAG_KEY, '1');
    emitState(null);
    expect(localStorage.getItem(FLAG_KEY)).toBeNull();
  });

  it('旗標只存 1，不存 UID', () => {
    emitState(user('U-secret-uid'));
    expect(localStorage.getItem(FLAG_KEY)).toBe('1');
    expect(JSON.stringify({ ...localStorage })).not.toContain('U-secret-uid');
  });

  it('localStorage 不能寫（LINE WebView 可能禁用）→ 不丟錯、不影響狀態事件', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage disabled');
    });
    const removeItem = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('storage disabled');
    });
    try {
      expect(() => emitState(user('U1'))).not.toThrow();
      expect(() => emitState(null)).not.toThrow();
    } finally {
      setItem.mockRestore();
      removeItem.mockRestore();
    }
  });
});
