import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { on } from '@/core/events';

const { callFnMock, signInWithCustomTokenMock, firebaseSignOutMock, getFirebaseMock } = vi.hoisted(
  () => ({
    callFnMock: vi.fn(),
    signInWithCustomTokenMock: vi.fn(),
    firebaseSignOutMock: vi.fn(),
    getFirebaseMock: vi.fn(),
  }),
);

vi.mock('./callables', () => ({
  callFn: callFnMock,
}));

vi.mock('firebase/auth', () => ({
  signInWithCustomToken: signInWithCustomTokenMock,
  signOut: firebaseSignOutMock,
}));

vi.mock('./firebase', () => ({
  getFirebase: getFirebaseMock,
  shouldUseEmulator: () => false,
}));

import { clearAccountLocalState, readQaClaims, signInWithQa, signOutQa } from './auth';

const SECRET = 'pw-secret';
const LEAK_SECRET = 'pw-secret-123';
const QA_ERROR = '[auth] QA login failed';

interface FakeTokenResult {
  claims: Record<string, unknown>;
}

interface FakeUser {
  uid?: string;
  getIdTokenResult?: () => Promise<FakeTokenResult>;
}

const authState: { currentUser: FakeUser | null } = { currentUser: null };

const CLEARED_KEYS = [
  'shub_c_x',
  'shub_ts_x',
  'shub_cache_x',
  'LIFFfoo',
  'toosterx:auth:z',
  'sporthub_auto_exp_rules',
  'sporthub_auto_exp_logs',
] as const;

const consoleMethods = ['log', 'info', 'warn', 'error', 'debug'] as const;

function assertSanitizedError(err: unknown, secret: string): void {
  expect(err).toBeInstanceOf(Error);
  const error = err as Error & { cause?: unknown };
  expect(error.message).toBe(QA_ERROR);
  expect(error.message).not.toContain(secret);
  expect(error.stack ?? '').not.toContain(secret);
  expect(String(error.cause)).not.toContain(secret);
  if (error.cause !== undefined && error.cause !== null && typeof error.cause === 'object') {
    expect(JSON.stringify(error.cause)).not.toContain(secret);
  }
  expect(String(error)).not.toContain(secret);
}

function stringifyCallArgs(args: unknown[]): string {
  return JSON.stringify(args, (_key, value: unknown) => {
    if (value instanceof Error) {
      return { name: value.name, message: value.message, stack: value.stack };
    }
    return value;
  });
}

function assertSecretNotInStorage(secret: string): void {
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index) ?? '';
    expect(key).not.toContain(secret);
    expect(localStorage.getItem(key) ?? '').not.toContain(secret);
  }
  for (let index = 0; index < sessionStorage.length; index += 1) {
    const key = sessionStorage.key(index) ?? '';
    expect(key).not.toContain(secret);
    expect(sessionStorage.getItem(key) ?? '').not.toContain(secret);
  }
}

function assertSecretNotInLocation(secret: string): void {
  expect(location.href).not.toContain(secret);
  expect(location.search).not.toContain(secret);
  expect(location.hash).not.toContain(secret);
}

function seedAccountStorage(): void {
  for (const key of CLEARED_KEYS) {
    localStorage.setItem(key, `value-${key}`);
  }
  localStorage.setItem('unrelated', 'keep-me');
  sessionStorage.setItem('_lineLoginRetryCount', '3');
}

function expectAccountStorageCleared(): void {
  for (const key of CLEARED_KEYS) {
    expect(localStorage.getItem(key)).toBeNull();
  }
  expect(sessionStorage.getItem('_lineLoginRetryCount')).toBeNull();
  expect(localStorage.getItem('unrelated')).toBe('keep-me');
}

function expectAccountStorageKept(): void {
  for (const key of CLEARED_KEYS) {
    expect(localStorage.getItem(key)).toBe(`value-${key}`);
  }
  expect(localStorage.getItem('LIFFx')).toBe('still-here');
  expect(localStorage.getItem('shub_c_x')).toBe('value-shub_c_x');
  expect(sessionStorage.getItem('_lineLoginRetryCount')).toBe('3');
  expect(localStorage.getItem('unrelated')).toBe('keep-me');
}

beforeEach(() => {
  authState.currentUser = null;
  callFnMock.mockReset();
  signInWithCustomTokenMock.mockReset();
  firebaseSignOutMock.mockReset();
  getFirebaseMock.mockReset();
  getFirebaseMock.mockResolvedValue({ auth: authState });
  firebaseSignOutMock.mockResolvedValue(undefined);
  localStorage.clear();
  sessionStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('signInWithQa', () => {
  it('用密碼與身分換 customToken，登入後發出 auth:changed 並回傳使用者', async () => {
    callFnMock.mockResolvedValue({ customToken: 'custom-token-from-server' });
    signInWithCustomTokenMock.mockResolvedValue({
      user: {
        uid: 'uid-qa-1',
        displayName: 'QA Captain',
        photoURL: 'https://example.test/qa.png',
      },
    });

    const seen: Array<{ uid: string | null }> = [];
    const stop = on('auth:changed', (payload) => {
      seen.push(payload);
    });

    try {
      const user = await signInWithQa('pw', 'captain');

      expect(callFnMock).toHaveBeenCalledTimes(1);
      expect(callFnMock).toHaveBeenCalledWith('issueQaTestToken', {
        password: 'pw',
        persona: 'captain',
      });
      expect(signInWithCustomTokenMock).toHaveBeenCalledTimes(1);
      expect(signInWithCustomTokenMock).toHaveBeenCalledWith(authState, 'custom-token-from-server');
      expect(seen).toEqual([{ uid: 'uid-qa-1' }]);
      expect(user).toEqual({
        uid: 'uid-qa-1',
        displayName: 'QA Captain',
        pictureUrl: 'https://example.test/qa.png',
      });
    } finally {
      stop();
    }
  });

  it('password 或 persona 為空字串時拒絕，且不呼叫 callFn', async () => {
    await expect(signInWithQa('', 'captain')).rejects.toEqual(
      expect.objectContaining({ name: 'Error', message: QA_ERROR }),
    );
    await expect(signInWithQa('pw', '')).rejects.toEqual(
      expect.objectContaining({ name: 'Error', message: QA_ERROR }),
    );
    expect(callFnMock).not.toHaveBeenCalled();
    expect(signInWithCustomTokenMock).not.toHaveBeenCalled();
  });

  it('上游失敗、缺 token、空 token、登入失敗都改拋不含密碼的固定錯誤', async () => {
    const leaked = new Error(`upstream ${SECRET}`) as Error & { details?: unknown };
    leaked.details = { password: SECRET };
    callFnMock.mockRejectedValueOnce(leaked);

    const rejected = await signInWithQa(SECRET, 'captain').then(
      () => {
        throw new Error('應該拒絕');
      },
      (err: unknown) => err,
    );
    assertSanitizedError(rejected, SECRET);
    expect(rejected).not.toBe(leaked);

    callFnMock.mockResolvedValueOnce({});
    assertSanitizedError(
      await signInWithQa(SECRET, 'captain').then(
        () => {
          throw new Error('應該拒絕');
        },
        (err: unknown) => err,
      ),
      SECRET,
    );

    callFnMock.mockResolvedValueOnce({ customToken: '' });
    assertSanitizedError(
      await signInWithQa(SECRET, 'captain').then(
        () => {
          throw new Error('應該拒絕');
        },
        (err: unknown) => err,
      ),
      SECRET,
    );

    callFnMock.mockResolvedValueOnce({ customToken: 'custom-token-from-server' });
    const signInError = new Error(`sign-in ${SECRET}`) as Error & { details?: unknown };
    signInError.details = { password: SECRET };
    signInWithCustomTokenMock.mockRejectedValueOnce(signInError);
    const signInRejected = await signInWithQa(SECRET, 'captain').then(
      () => {
        throw new Error('應該拒絕');
      },
      (err: unknown) => err,
    );
    assertSanitizedError(signInRejected, SECRET);
    expect(signInRejected).not.toBe(signInError);
  });

  it('成功與失敗都不把密碼寫進 console、storage 或 location', async () => {
    const spies = consoleMethods.map((method) => vi.spyOn(console, method).mockImplementation(() => undefined));
    const setItem = vi.spyOn(Storage.prototype, 'setItem');

    callFnMock.mockResolvedValueOnce({ customToken: 'custom-token-from-server' });
    signInWithCustomTokenMock.mockResolvedValueOnce({
      user: { uid: 'uid-qa-1', displayName: null, photoURL: null },
    });

    assertSecretNotInStorage(LEAK_SECRET);
    assertSecretNotInLocation(LEAK_SECRET);
    await signInWithQa(LEAK_SECRET, 'captain');
    assertSecretNotInStorage(LEAK_SECRET);
    assertSecretNotInLocation(LEAK_SECRET);

    const leaked = new Error(`boom ${LEAK_SECRET}`) as Error & { details?: unknown };
    leaked.details = { password: LEAK_SECRET };
    callFnMock.mockRejectedValueOnce(leaked);
    await expect(signInWithQa(LEAK_SECRET, 'coach')).rejects.toEqual(
      expect.objectContaining({ message: QA_ERROR }),
    );
    assertSecretNotInStorage(LEAK_SECRET);
    assertSecretNotInLocation(LEAK_SECRET);

    for (const spy of spies) {
      for (const args of spy.mock.calls) {
        expect(stringifyCallArgs(args)).not.toContain(LEAK_SECRET);
      }
    }
    for (const args of setItem.mock.calls) {
      expect(JSON.stringify(args)).not.toContain(LEAK_SECRET);
    }
  });
});

describe('readQaClaims', () => {
  it('currentUser 為 null 時回 null', async () => {
    authState.currentUser = null;
    await expect(readQaClaims()).resolves.toBeNull();
  });

  it('claims.qa 為 true 時回傳 persona、agent、exp', async () => {
    authState.currentUser = {
      getIdTokenResult: () =>
        Promise.resolve({
          claims: {
            qa: true,
            qaPersona: 'captain',
            qaAgent: 'agent-1',
            qaExp: 1_700_000_000_000,
          },
        }),
    };
    await expect(readQaClaims()).resolves.toEqual({
      persona: 'captain',
      agent: 'agent-1',
      exp: 1_700_000_000_000,
    });
  });

  it('qa 不是嚴格的 true 時回 null', async () => {
    const invalid = ['true', 1, false, undefined] as const;
    for (const qa of invalid) {
      const claims: Record<string, unknown> = {
        qaPersona: 'captain',
        qaAgent: 'agent-1',
        qaExp: 10,
      };
      if (qa !== undefined) claims.qa = qa;
      authState.currentUser = {
        getIdTokenResult: () => Promise.resolve({ claims }),
      };
      await expect(readQaClaims()).resolves.toBeNull();
    }
  });

  it('qaPersona 為空字串或非字串時 persona 為 null', async () => {
    for (const qaPersona of ['', 12, null]) {
      authState.currentUser = {
        getIdTokenResult: () =>
          Promise.resolve({
            claims: { qa: true, qaPersona, qaAgent: 'agent-1', qaExp: 10 },
          }),
      };
      await expect(readQaClaims()).resolves.toEqual({
        persona: null,
        agent: 'agent-1',
        exp: 10,
      });
    }
  });

  it('qaExp 為 NaN 或字串時 exp 為 null', async () => {
    for (const qaExp of [Number.NaN, '1700']) {
      authState.currentUser = {
        getIdTokenResult: () =>
          Promise.resolve({
            claims: { qa: true, qaPersona: 'coach', qaAgent: 'agent-2', qaExp },
          }),
      };
      await expect(readQaClaims()).resolves.toEqual({
        persona: 'coach',
        agent: 'agent-2',
        exp: null,
      });
    }
  });

  it('getIdTokenResult 拒絕時回 null 且不拋錯', async () => {
    authState.currentUser = {
      getIdTokenResult: () => Promise.reject(new Error('token-fail')),
    };
    await expect(readQaClaims()).resolves.toBeNull();
  });

  it('讀取途中 currentUser 換人時回 null', async () => {
    const userB: FakeUser = {
      getIdTokenResult: () =>
        Promise.resolve({
          claims: { qa: true, qaPersona: 'coach', qaAgent: 'agent-b', qaExp: 2 },
        }),
    };
    const userA: FakeUser = {
      getIdTokenResult: () => {
        authState.currentUser = userB;
        return Promise.resolve({
          claims: { qa: true, qaPersona: 'captain', qaAgent: 'agent-a', qaExp: 1 },
        });
      },
    };
    authState.currentUser = userA;
    await expect(readQaClaims()).resolves.toBeNull();
  });

  it('expectedUid 是 A 但 currentUser 是 B 時回 null，即使 B 有 qa claim', async () => {
    authState.currentUser = {
      uid: 'B',
      getIdTokenResult: () =>
        Promise.resolve({
          claims: { qa: true, qaPersona: 'captain', qaAgent: 'agent-b', qaExp: 2 },
        }),
    };
    await expect(readQaClaims('A')).resolves.toBeNull();
  });

  it('一開始 uid 不符就回 null，即使讀取途中改成相符', async () => {
    const user: FakeUser = {
      uid: 'B',
      getIdTokenResult: () => {
        user.uid = 'A';
        return Promise.resolve({
          claims: { qa: true, qaPersona: 'captain', qaAgent: 'agent-b', qaExp: 2 },
        });
      },
    };
    authState.currentUser = user;
    await expect(readQaClaims('A')).resolves.toBeNull();
  });

  it('getIdTokenResult 回來後 uid 已變就回 null', async () => {
    const user: FakeUser = {
      uid: 'A',
      getIdTokenResult: () => {
        user.uid = 'B';
        return Promise.resolve({
          claims: { qa: true, qaPersona: 'captain', qaAgent: 'agent-a', qaExp: 1 },
        });
      },
    };
    authState.currentUser = user;
    await expect(readQaClaims('A')).resolves.toBeNull();
  });

  it('帶 expectedUid 且讀取途中換成另一個使用者時回 null', async () => {
    const userB: FakeUser = {
      uid: 'A',
      getIdTokenResult: () =>
        Promise.resolve({
          claims: { qa: true, qaPersona: 'coach', qaAgent: 'agent-b', qaExp: 2 },
        }),
    };
    const userA: FakeUser = {
      uid: 'A',
      getIdTokenResult: () => {
        authState.currentUser = userB;
        return Promise.resolve({
          claims: { qa: true, qaPersona: 'captain', qaAgent: 'agent-a', qaExp: 1 },
        });
      },
    };
    authState.currentUser = userA;
    await expect(readQaClaims('A')).resolves.toBeNull();
  });

  it('expectedUid 與 currentUser.uid 相符時回傳 claims', async () => {
    authState.currentUser = {
      uid: 'A',
      getIdTokenResult: () =>
        Promise.resolve({
          claims: {
            qa: true,
            qaPersona: 'captain',
            qaAgent: 'agent-1',
            qaExp: 1_700_000_000_000,
          },
        }),
    };
    await expect(readQaClaims('A')).resolves.toEqual({
      persona: 'captain',
      agent: 'agent-1',
      exp: 1_700_000_000_000,
    });
  });

  it('不帶 expectedUid 時不核對 uid，行為與原本相同', async () => {
    authState.currentUser = {
      uid: 'B',
      getIdTokenResult: () =>
        Promise.resolve({
          claims: { qa: true, qaPersona: 'coach', qaAgent: 'agent-2', qaExp: 9 },
        }),
    };
    await expect(readQaClaims()).resolves.toEqual({
      persona: 'coach',
      agent: 'agent-2',
      exp: 9,
    });
  });
});

describe('signOutQa', () => {
  it('uid 相符時呼叫 firebase signOut 一次，並清掉帳號相關 storage', async () => {
    authState.currentUser = { uid: 'uid-qa' };
    seedAccountStorage();
    await expect(signOutQa('uid-qa')).resolves.toBe(true);
    expect(firebaseSignOutMock).toHaveBeenCalledTimes(1);
    expect(firebaseSignOutMock).toHaveBeenCalledWith(authState);
    expectAccountStorageCleared();
  });

  it('uid 相符且 signOut 拒絕時一併拒絕，但清理仍會執行', async () => {
    authState.currentUser = { uid: 'uid-qa' };
    seedAccountStorage();
    firebaseSignOutMock.mockRejectedValueOnce(new Error('sign-out-failed'));
    await expect(signOutQa('uid-qa')).rejects.toThrow('sign-out-failed');
    expect(firebaseSignOutMock).toHaveBeenCalledTimes(1);
    expectAccountStorageCleared();
  });

  it('currentUser 為 null 時不 signOut，LIFFx、shub_c_x 與 _lineLoginRetryCount 都還在', async () => {
    seedAccountStorage();
    localStorage.setItem('LIFFx', 'still-here');
    authState.currentUser = null;
    await expect(signOutQa('uid-expected')).resolves.toBe(false);
    expect(firebaseSignOutMock).not.toHaveBeenCalled();
    expectAccountStorageKept();
  });

  it('currentUser 的 uid 與 expectedUid 不同時不 signOut，也不清 storage', async () => {
    seedAccountStorage();
    localStorage.setItem('LIFFx', 'still-here');
    authState.currentUser = { uid: 'uid-other' };
    await expect(signOutQa('uid-expected')).resolves.toBe(false);
    expect(firebaseSignOutMock).not.toHaveBeenCalled();
    expectAccountStorageKept();
  });
});

// ── T-047：已用一般帳號登入後再 QA 登入 ─────────────────────────────

/** 與帳號無關的 key：QA 切換帳號、登出清理都不能碰。 */
const UNRELATED_KEYS = [
  'unrelated',
  'sporthub_theme',
  'sporthub_font_size',
  'sporthub_active_sport',
  'toosterx:locale',
  'toosterx:theme',
] as const;

function seedRegularAccountStorage(): void {
  seedAccountStorage();
  for (const key of UNRELATED_KEYS) {
    localStorage.setItem(key, `keep-${key}`);
  }
}

function expectRegularAccountStorageKept(): void {
  for (const key of CLEARED_KEYS) {
    expect(localStorage.getItem(key)).toBe(`value-${key}`);
  }
  expect(sessionStorage.getItem('_lineLoginRetryCount')).toBe('3');
  for (const key of UNRELATED_KEYS) {
    expect(localStorage.getItem(key)).toBe(`keep-${key}`);
  }
}

function expectRegularAccountStorageCleared(): void {
  for (const key of CLEARED_KEYS) {
    expect(localStorage.getItem(key)).toBeNull();
  }
  expect(sessionStorage.getItem('_lineLoginRetryCount')).toBeNull();
  for (const key of UNRELATED_KEYS) {
    expect(localStorage.getItem(key)).toBe(`keep-${key}`);
  }
}

function storageSnapshot(): string {
  const local = Object.keys(localStorage).sort().map((key) => [key, localStorage.getItem(key)]);
  const session = Object.keys(sessionStorage).sort().map((key) => [key, sessionStorage.getItem(key)]);
  return JSON.stringify({ local, session });
}

function regularUser(uid = 'U-line-owner'): FakeUser {
  return { uid, getIdTokenResult: () => Promise.resolve({ claims: {} }) };
}

function qaUser(uid = 'uid-qa-old'): FakeUser {
  return {
    uid,
    getIdTokenResult: () =>
      Promise.resolve({
        claims: { qa: true, qaPersona: 'captain', qaAgent: 'agent-1', qaExp: 1 },
      }),
  };
}

function qaTokenIssued(): void {
  callFnMock.mockResolvedValue({ customToken: 'custom-token-from-server' });
  signInWithCustomTokenMock.mockResolvedValue({
    user: { uid: 'uid-qa-new', displayName: null, photoURL: null },
  });
}

function keysState(): 'keys-present' | 'keys-gone' {
  return localStorage.getItem('shub_c_x') === null ? 'keys-gone' : 'keys-present';
}

describe('clearAccountLocalState（signOutQa 與 QA 切換帳號共用）', () => {
  it('清掉帳號相關前綴、exact keys 與 _lineLoginRetryCount，保留與帳號無關的 key（主題、字級、語系…）', () => {
    seedRegularAccountStorage();
    expectRegularAccountStorageKept();

    clearAccountLocalState();

    expectRegularAccountStorageCleared();
  });

  it('清理結果與 signOutQa 完全一致', async () => {
    seedRegularAccountStorage();
    authState.currentUser = { uid: 'uid-qa' };
    await expect(signOutQa('uid-qa')).resolves.toBe(true);
    const afterSignOutQa = storageSnapshot();

    localStorage.clear();
    sessionStorage.clear();
    seedRegularAccountStorage();
    clearAccountLocalState();

    expect(storageSnapshot()).toBe(afterSignOutQa);
  });

  it('單一 key 移除失敗或 storage 不可用都不外拋', () => {
    seedRegularAccountStorage();
    const remove = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('storage-blocked');
    });
    expect(() => clearAccountLocalState()).not.toThrow();
    remove.mockRestore();

    const keysSpy = vi.spyOn(Object, 'keys').mockImplementation(() => {
      throw new Error('storage-unavailable');
    });
    expect(() => clearAccountLocalState()).not.toThrow();
    keysSpy.mockRestore();
  });
});

describe('signInWithQa 從一般帳號切換到 QA 帳號', () => {
  it('成功後才清掉舊帳號殘留的本機資料（先 signInWithCustomToken、再清、再發 auth:changed），保留與帳號無關的 key', async () => {
    seedRegularAccountStorage();
    authState.currentUser = regularUser();
    qaTokenIssued();

    const order: string[] = [];
    signInWithCustomTokenMock.mockImplementation(async () => {
      order.push(`signInWithCustomToken:${keysState()}`);
      return { user: { uid: 'uid-qa-new', displayName: null, photoURL: null } };
    });
    const stop = on('auth:changed', ({ uid }) => {
      order.push(`auth:changed:${uid}:${keysState()}`);
    });

    try {
      const user = await signInWithQa('pw', 'captain');
      expect(user.uid).toBe('uid-qa-new');
    } finally {
      stop();
    }

    expect(order).toEqual([
      'signInWithCustomToken:keys-present',
      'auth:changed:uid-qa-new:keys-gone',
    ]);
    expectRegularAccountStorageCleared();
    expect(firebaseSignOutMock).not.toHaveBeenCalled();
  });

  it('伺服器拒絕（密碼錯誤等）→ 原帳號與它的 key 都不動，沒換帳號、沒 signOut、沒 auth:changed', async () => {
    seedRegularAccountStorage();
    authState.currentUser = regularUser();
    callFnMock.mockRejectedValue(new Error('permission-denied'));
    const seen: Array<{ uid: string | null }> = [];
    const stop = on('auth:changed', (payload) => {
      seen.push(payload);
    });

    try {
      await expect(signInWithQa('wrong', 'captain')).rejects.toEqual(
        expect.objectContaining({ message: QA_ERROR }),
      );
    } finally {
      stop();
    }

    expect(signInWithCustomTokenMock).not.toHaveBeenCalled();
    expect(firebaseSignOutMock).not.toHaveBeenCalled();
    expect(seen).toEqual([]);
    expect(authState.currentUser?.uid).toBe('U-line-owner');
    expectRegularAccountStorageKept();
  });

  it('伺服器沒給 token 或給空 token → 原帳號的 key 都不動', async () => {
    seedRegularAccountStorage();
    authState.currentUser = regularUser();

    callFnMock.mockResolvedValueOnce({});
    await expect(signInWithQa('pw', 'captain')).rejects.toEqual(
      expect.objectContaining({ message: QA_ERROR }),
    );
    callFnMock.mockResolvedValueOnce({ customToken: '' });
    await expect(signInWithQa('pw', 'captain')).rejects.toEqual(
      expect.objectContaining({ message: QA_ERROR }),
    );

    expect(signInWithCustomTokenMock).not.toHaveBeenCalled();
    expectRegularAccountStorageKept();
  });

  it('伺服器已發 token 但 signInWithCustomToken 失敗 → 原帳號的 key 都不動，沒有 auth:changed', async () => {
    seedRegularAccountStorage();
    authState.currentUser = regularUser();
    callFnMock.mockResolvedValue({ customToken: 'custom-token-from-server' });
    signInWithCustomTokenMock.mockRejectedValue(new Error('auth/invalid-custom-token'));
    const seen: Array<{ uid: string | null }> = [];
    const stop = on('auth:changed', (payload) => {
      seen.push(payload);
    });

    try {
      await expect(signInWithQa('pw', 'captain')).rejects.toEqual(
        expect.objectContaining({ message: QA_ERROR }),
      );
    } finally {
      stop();
    }

    expect(seen).toEqual([]);
    expectRegularAccountStorageKept();
  });

  it('輸入為空字串（根本沒送出）→ 不讀 claims、不動 key', async () => {
    seedRegularAccountStorage();
    const getIdTokenResult = vi.fn(() => Promise.resolve({ claims: {} }));
    authState.currentUser = { uid: 'U-line-owner', getIdTokenResult };

    await expect(signInWithQa('', 'captain')).rejects.toEqual(
      expect.objectContaining({ message: QA_ERROR }),
    );

    expect(getIdTokenResult).not.toHaveBeenCalled();
    expectRegularAccountStorageKept();
  });

  it('已經是 QA 登入者再登入別的角色 → 不清理', async () => {
    seedRegularAccountStorage();
    authState.currentUser = qaUser();
    qaTokenIssued();

    await signInWithQa('pw', 'coach');

    expectRegularAccountStorageKept();
  });

  it('登入前沒有任何登入者 → 不清理', async () => {
    seedRegularAccountStorage();
    authState.currentUser = null;
    qaTokenIssued();

    await signInWithQa('pw', 'captain');

    expectRegularAccountStorageKept();
  });

  it('讀不到舊帳號的 claims（getIdTokenResult 拒絕）→ 視為一般帳號，登入照常成功並清理', async () => {
    seedRegularAccountStorage();
    authState.currentUser = {
      uid: 'U-line-owner',
      getIdTokenResult: () => Promise.reject(new Error('token-refresh-failed')),
    };
    qaTokenIssued();

    await expect(signInWithQa('pw', 'captain')).resolves.toEqual(
      expect.objectContaining({ uid: 'uid-qa-new' }),
    );

    expectRegularAccountStorageCleared();
  });

  it('清理本身失敗（storage 不可用）不影響登入結果', async () => {
    seedRegularAccountStorage();
    authState.currentUser = regularUser();
    qaTokenIssued();
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('storage-blocked');
    });

    await expect(signInWithQa('pw', 'captain')).resolves.toEqual(
      expect.objectContaining({ uid: 'uid-qa-new' }),
    );
  });

  it('切換成功與失敗都不把密碼寫進 console 或 storage', async () => {
    const spies = consoleMethods.map((method) => vi.spyOn(console, method).mockImplementation(() => undefined));
    seedRegularAccountStorage();
    authState.currentUser = regularUser();
    qaTokenIssued();

    await signInWithQa(LEAK_SECRET, 'captain');
    assertSecretNotInStorage(LEAK_SECRET);

    seedRegularAccountStorage();
    authState.currentUser = regularUser();
    callFnMock.mockRejectedValueOnce(new Error(`boom ${LEAK_SECRET}`));
    await expect(signInWithQa(LEAK_SECRET, 'captain')).rejects.toEqual(
      expect.objectContaining({ message: QA_ERROR }),
    );
    assertSecretNotInStorage(LEAK_SECRET);

    for (const spy of spies) {
      for (const args of spy.mock.calls) {
        expect(stringifyCallArgs(args)).not.toContain(LEAK_SECRET);
      }
    }
  });
});
