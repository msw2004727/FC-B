import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/data/firebase', () => ({
  getFirebase: vi.fn(),
}));

vi.mock('@/data/callables', () => ({
  callFn: vi.fn(),
}));

vi.mock('firebase/firestore', () => ({
  doc: vi.fn((_db, path, id) => ({ __doc: `${path}/${id}` })),
  getDoc: vi.fn(),
  updateDoc: vi.fn(),
  serverTimestamp: vi.fn(() => ({ __sv: 'SERVER_TIMESTAMP' })),
}));

import { callFn } from '@/data/callables';
import { getFirebase } from '@/data/firebase';
import { doc, getDoc, serverTimestamp, updateDoc } from 'firebase/firestore';

import {
  buildIdentitySettingsRequest,
  commitIdentitySettings,
  commitSecondaryIdentityAvatar,
  clearSocialLink,
  normalizeLineContactUrl,
  saveCompanions,
  saveEduChildren,
  saveFirstLoginProfile,
  saveSocialLink,
  updateProfileFields,
  type CommitIdentitySettingsInput,
  type FirstLoginInput,
} from './profile-writes';

const SERVER_TS = { __sv: 'SERVER_TIMESTAMP' };

function firstLogin(overrides: Partial<FirstLoginInput> = {}): FirstLoginInput {
  return {
    gender: '女',
    birthday: '1990/01/01',
    region: 'TW',
    email: 'a@example.com',
    legalConsent: true,
    ...overrides,
  };
}

function expectNoDirectAccess(): void {
  expect(getFirebase).not.toHaveBeenCalled();
  expect(doc).not.toHaveBeenCalled();
  expect(getDoc).not.toHaveBeenCalled();
  expect(updateDoc).not.toHaveBeenCalled();
  expect(serverTimestamp).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(doc).mockImplementation(
    ((_db: unknown, path: string, id: string) => ({
      __doc: `${path}/${id}`,
    })) as unknown as typeof doc,
  );
  vi.mocked(getFirebase).mockResolvedValue({ db: {} } as never);
  vi.mocked(updateDoc).mockResolvedValue(undefined);
  vi.mocked(serverTimestamp).mockReturnValue(SERVER_TS as never);
  vi.mocked(callFn).mockResolvedValue(undefined as never);
});

describe('write guardrails', () => {
  it('updateProfileFields 拒絕未白名單欄位', async () => {
    await expect(
      updateProfileFields('u1', { gender: 'x', unknownField: 'y' }),
    ).rejects.toThrow(/未允許欄位/);
    expectNoDirectAccess();
  });

  it.each(['role', 'exp', 'current', 'waitlist', 'uid', 'legalConsent'])(
    'updateProfileFields 拒絕寫入 %s',
    async (field) => {
      await expect(
        updateProfileFields('u1', { [field]: 999 }),
      ).rejects.toThrow(/未允許欄位/);
      expectNoDirectAccess();
    },
  );

  it('衍生欄位另由 assertNoDerivedFields 阻擋', async () => {
    const { assertNoDerivedFields } = await import('@/data/write-guard');
    expect(() => assertNoDerivedFields({ participants: [] })).toThrow(/衍生欄位/);
    expect(() => assertNoDerivedFields({ waitlistNames: [] })).toThrow(/衍生欄位/);
    expect(() => assertNoDerivedFields({ realCurrent: 0 })).toThrow(/衍生欄位/);
  });

  it('saveCompanions 的 payload 只含 companions 與 updatedAt', async () => {
    await saveCompanions('u1', [{ name: 'x' }]);
    expect(updateDoc).toHaveBeenCalledTimes(1);
    expect(updateDoc).toHaveBeenCalledWith(
      { __doc: 'users/u1' },
      { companions: [{ name: 'x' }], updatedAt: SERVER_TS },
    );
    expect(callFn).not.toHaveBeenCalled();
  });
});

describe('A29 updateProfileFields（golden payload）', () => {
  it('payload = {...patch, updatedAt: serverTimestamp}', async () => {
    await updateProfileFields('u1', { gender: 'male', region: 'TW' });
    expect(updateDoc).toHaveBeenCalledTimes(1);
    expect(updateDoc).toHaveBeenCalledWith(
      { __doc: 'users/u1' },
      {
        gender: 'male',
        region: 'TW',
        updatedAt: SERVER_TS,
      },
    );
    expect(serverTimestamp).toHaveBeenCalledTimes(1);
    expect(callFn).not.toHaveBeenCalled();
  });

  it('不允許 patch 夾帶 updatedAt', async () => {
    await expect(
      updateProfileFields('u1', { gender: 'x', updatedAt: 123 }),
    ).rejects.toThrow(/未允許欄位/);
    expectNoDirectAccess();
  });
});

const NOW_ISO = '2026-10-19T00:00:00.000Z';
// A `_buildFirstLoginLegalUpdates('profile_completion_submit')`（profile-form.js）對尚未同意者的輸出。
const LEGAL_NEW = {
  termsVersion: '2026-05-19',
  privacyVersion: '2026-05-19',
  legalAcceptedSource: 'profile_completion_submit',
  termsAcceptedAt: NOW_ISO,
  privacyAcceptedAt: NOW_ISO,
};

function mockUserDoc(data: Record<string, unknown> | null): void {
  vi.mocked(getDoc).mockResolvedValue({
    exists: () => data !== null,
    data: () => data ?? undefined,
  } as never);
}

describe('A29 saveFirstLoginProfile（golden payload 照 A）', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(NOW_ISO));
    mockUserDoc({});
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('帶 email 時寫 4 欄、A 的法律同意欄位與 updatedAt，不持久化 legalConsent', async () => {
    await saveFirstLoginProfile('u1', firstLogin());
    expect(updateDoc).toHaveBeenCalledTimes(1);
    expect(updateDoc).toHaveBeenCalledWith(
      { __doc: 'users/u1' },
      {
        ...LEGAL_NEW,
        gender: '女',
        birthday: '1990/01/01',
        region: 'TW',
        email: 'a@example.com',
        updatedAt: SERVER_TS,
      },
    );
    expect(serverTimestamp).toHaveBeenCalledTimes(1);
    expect(callFn).not.toHaveBeenCalled();
  });

  it.each(['', '   ', undefined])(
    'email 為 %s 時不寫 email 欄',
    async (email) => {
      const input = firstLogin();
      if (email === undefined) delete input.email;
      else input.email = email;

      await saveFirstLoginProfile('u1', input);
      expect(updateDoc).toHaveBeenCalledTimes(1);
      expect(updateDoc).toHaveBeenCalledWith(
        { __doc: 'users/u1' },
        {
          ...LEGAL_NEW,
          gender: '女',
          birthday: '1990/01/01',
          region: 'TW',
          updatedAt: SERVER_TS,
        },
      );
    },
  );

  it('只修剪 region 與 email，維持既有 birthday 字串格式', async () => {
    await saveFirstLoginProfile('u1', firstLogin({
      region: '  臺中市  ',
      email: '  a@example.com  ',
    }));
    expect(updateDoc).toHaveBeenCalledWith(
      { __doc: 'users/u1' },
      {
        ...LEGAL_NEW,
        gender: '女',
        birthday: '1990/01/01',
        region: '臺中市',
        email: 'a@example.com',
        updatedAt: SERVER_TS,
      },
    );
  });

    it('已同意當前版本時不覆蓋同意時間（照 A）', async () => {
    mockUserDoc({
      termsVersion: '2026-05-19',
      termsAcceptedAt: '2026-06-01T00:00:00.000Z',
      privacyVersion: '2026-05-19',
      privacyAcceptedAt: '2026-06-01T00:00:00.000Z',
    });
    await saveFirstLoginProfile('u1', firstLogin());
    const payload = vi.mocked(updateDoc).mock.calls[0]?.[1] as unknown as Record<string, unknown>;
    expect(payload).toMatchObject({
      termsVersion: '2026-05-19',
      privacyVersion: '2026-05-19',
      legalAcceptedSource: 'profile_completion_submit',
    });
    expect(payload).not.toHaveProperty('termsAcceptedAt');
    expect(payload).not.toHaveProperty('privacyAcceptedAt');
  });

  it('舊版本同意時重寫同意時間；使用者文件不存在時視為未同意', async () => {
    mockUserDoc({ termsVersion: '2025-01-01', termsAcceptedAt: 'x', privacyVersion: '2026-05-19', privacyAcceptedAt: 'y' });
    await saveFirstLoginProfile('u1', firstLogin());
    let payload = vi.mocked(updateDoc).mock.calls[0]?.[1] as unknown as Record<string, unknown>;
    expect(payload['termsAcceptedAt']).toBe(NOW_ISO);
    expect(payload).not.toHaveProperty('privacyAcceptedAt');

    vi.mocked(updateDoc).mockClear();
    mockUserDoc(null);
    await saveFirstLoginProfile('u1', firstLogin());
    payload = vi.mocked(updateDoc).mock.calls[0]?.[1] as unknown as Record<string, unknown>;
    expect(payload).toMatchObject(LEGAL_NEW);
  });

  it('未同意不得存取 Firestore', async () => {
    await expect(
      saveFirstLoginProfile('u1', firstLogin({ legalConsent: false })),
    ).rejects.toThrow(/legal consent/);
    expectNoDirectAccess();
    expect(callFn).not.toHaveBeenCalled();
  });

  it('執行期缺少 legalConsent 也拒絕', async () => {
    const { legalConsent: _consent, ...input } = firstLogin();
    await expect(
      saveFirstLoginProfile('u1', input as FirstLoginInput),
    ).rejects.toThrow(/legal consent/);
    expectNoDirectAccess();
  });

  it.each(['role', 'exp', 'uid', 'updatedAt', 'unknownField', 'current'])(
    '首次輸入拒絕夾帶 %s，不靜默刪除後寫入',
    async (field) => {
      const input = { ...firstLogin(), [field]: 999 };
      await expect(saveFirstLoginProfile('u1', input)).rejects.toThrow(/未允許欄位/);
      expectNoDirectAccess();
    },
  );

  it.each(['female', 'male', '', 'invalid'])(
    '首次性別拒絕非 A 選項 %s',
    async (gender) => {
      await expect(
        saveFirstLoginProfile('u1', firstLogin({ gender })),
      ).rejects.toThrow(/invalid gender/);
      expectNoDirectAccess();
    },
  );

  it.each(['男', '女', '其他'])('接受 A 性別選項 %s', async (gender) => {
    await saveFirstLoginProfile('u1', firstLogin({ gender }));
    expect(updateDoc).toHaveBeenCalledWith(
      { __doc: 'users/u1' },
      {
        ...LEGAL_NEW,
        gender,
        birthday: '1990/01/01',
        region: 'TW',
        email: 'a@example.com',
        updatedAt: SERVER_TS,
      },
    );
  });

  it.each(['1999-02-29', '2000-02-30', '2000-13-01', '1899-01-01', '2000-1-1'])(
    '拒絕無效生日 %s',
    async (birthday) => {
      await expect(
        saveFirstLoginProfile('u1', firstLogin({ birthday })),
      ).rejects.toThrow(/invalid birthday/);
      expectNoDirectAccess();
    },
  );

  it('接受有效閏日', async () => {
    await saveFirstLoginProfile('u1', firstLogin({ birthday: '2000/02/29' }));
    expect(updateDoc).toHaveBeenCalledWith(
      { __doc: 'users/u1' },
      {
        ...LEGAL_NEW,
        gender: '女',
        birthday: '2000/02/29',
        region: 'TW',
        email: 'a@example.com',
        updatedAt: SERVER_TS,
      },
    );
  });

  it('空白地區不得寫入', async () => {
    await expect(
      saveFirstLoginProfile('u1', firstLogin({ region: '   ' })),
    ).rejects.toThrow(/region is required/);
    expectNoDirectAccess();
  });

  it('無效 email 不得寫入', async () => {
    await expect(
      saveFirstLoginProfile('u1', firstLogin({ email: 'invalid' })),
    ).rejects.toThrow(/invalid email/);
    expectNoDirectAccess();
  });

  it('失敗原樣拒絕，保留輸入供重試', async () => {
    const input = firstLogin();
    const original = { ...input };
    const error = new Error('offline');
    vi.mocked(updateDoc).mockRejectedValueOnce(error);

    await expect(saveFirstLoginProfile('u1', input)).rejects.toBe(error);
    expect(input).toEqual(original);

    await saveFirstLoginProfile('u1', input);
    expect(updateDoc).toHaveBeenCalledTimes(2);
    expect(updateDoc).toHaveBeenNthCalledWith(
      2,
      { __doc: 'users/u1' },
      {
        ...LEGAL_NEW,
        gender: '女',
        birthday: '1990/01/01',
        region: 'TW',
        email: 'a@example.com',
        updatedAt: SERVER_TS,
      },
    );
  });
});

describe('A31 saveCompanions / A32 saveEduChildren（golden）', () => {
  it('companions 只寫 companions 與 updatedAt', async () => {
    const companions = [{ name: 'A' }, { name: 'B' }];
    await saveCompanions('u1', companions);
    expect(updateDoc).toHaveBeenCalledTimes(1);
    expect(updateDoc).toHaveBeenCalledWith(
      { __doc: 'users/u1' },
      { companions, updatedAt: SERVER_TS },
    );
  });

  it('eduChildren 只寫 eduChildren 與 updatedAt', async () => {
    const children = [{ name: 'K' }];
    await saveEduChildren('u1', children);
    expect(updateDoc).toHaveBeenCalledTimes(1);
    expect(updateDoc).toHaveBeenCalledWith(
      { __doc: 'users/u1' },
      { eduChildren: children, updatedAt: SERVER_TS },
    );
  });
});

describe('社交連結正規化（A _normalizeLineContactUrl）', () => {
  it('https 與 line:// 原樣', () => {
    expect(normalizeLineContactUrl('https://example.com/x')).toBe('https://example.com/x');
    expect(normalizeLineContactUrl('line://ti/p/abc')).toBe('line://ti/p/abc');
  });

  it('空字串轉為空字串', () => {
    expect(normalizeLineContactUrl('')).toBe('');
    expect(normalizeLineContactUrl('   ')).toBe('');
  });

  it('@id 與純 id 轉為 line.me/ti/p/', () => {
    expect(normalizeLineContactUrl('@myid')).toBe('https://line.me/ti/p/myid');
    expect(normalizeLineContactUrl('myid')).toBe('https://line.me/ti/p/myid');
  });

  it('需要 URL-encode 的字元', () => {
    expect(normalizeLineContactUrl('id with space')).toBe(
      'https://line.me/ti/p/id%20with%20space',
    );
  });
});

describe('saveSocialLink / clearSocialLink（golden）', () => {
  beforeEach(() => {
    vi.mocked(getDoc).mockResolvedValue({
      exists: () => true,
      data: () => ({ socialLinks: { fb: 'https://fb.example/alice' } }),
    } as never);
  });

  it('saveSocialLink 保留其他平台並正規化 line', async () => {
    await saveSocialLink('u1', 'line', '@alice');
    expect(updateDoc).toHaveBeenCalledTimes(1);
    expect(updateDoc).toHaveBeenCalledWith(
      { __doc: 'users/u1' },
      {
        socialLinks: {
          fb: 'https://fb.example/alice',
          line: 'https://line.me/ti/p/alice',
        },
        updatedAt: SERVER_TS,
      },
    );
  });

  it('clearSocialLink 覆寫為空字串', async () => {
    await clearSocialLink('u1', 'line');
    expect(updateDoc).toHaveBeenCalledWith(
      { __doc: 'users/u1' },
      {
        socialLinks: {
          fb: 'https://fb.example/alice',
          line: '',
        },
        updatedAt: SERVER_TS,
      },
    );
  });

  it('非 line 平台不做 line 正規化', async () => {
    await saveSocialLink('u1', 'ig', 'alice');
    expect(updateDoc).toHaveBeenCalledWith(
      { __doc: 'users/u1' },
      {
        socialLinks: {
          fb: 'https://fb.example/alice',
          ig: 'alice',
        },
        updatedAt: SERVER_TS,
      },
    );
  });

  it('讀取失敗不得覆寫既有 socialLinks', async () => {
    const error = new Error('offline');
    vi.mocked(getDoc).mockRejectedValueOnce(error);
    await expect(saveSocialLink('u1', 'ig', 'alice')).rejects.toBe(error);
    expect(updateDoc).not.toHaveBeenCalled();
    expect(serverTimestamp).not.toHaveBeenCalled();
  });
});

describe('A30 Callable 走 callFn（不直寫）', () => {
  // golden 照 A profile-data-render.js saveIdentitySettings → firebase-crud.js _buildIdentitySettingsCallablePayload，
  // 並符合 functions/index.js normalizeIdentitySettingsCommit 的欄位白名單。
  function wire(enabled: boolean, displayName: string) {
    return {
      profileActiveIdentityId: enabled ? 'secondary' : 'main',
      identities: {
        secondary: {
          identityId: 'secondary',
          enabled,
          displayName,
          displayRoleLabel: '一般用戶',
          isPrimary: false,
          editable: true,
        },
      },
    };
  }

  it('commitIdentitySettings 送出 A 的 wire payload', async () => {
    await commitIdentitySettings({
      secondaryEnabled: true,
      secondaryDisplayName: 'sec',
    });
    expect(callFn).toHaveBeenCalledTimes(1);
    expect(callFn).toHaveBeenCalledWith('commitIdentitySettings', wire(true, 'sec'));
    expectNoDirectAccess();
  });

  it('修剪次身分名稱', async () => {
    await commitIdentitySettings({
      secondaryEnabled: true,
      secondaryDisplayName: '  第二名字  ',
    });
    expect(callFn).toHaveBeenCalledWith('commitIdentitySettings', wire(true, '第二名字'));
    expectNoDirectAccess();
  });

  it('停用時切回主身分；空名稱照 A 補預設名稱', async () => {
    await commitIdentitySettings({
      secondaryEnabled: false,
      secondaryDisplayName: '',
    });
    expect(callFn).toHaveBeenCalledTimes(1);
    expect(callFn).toHaveBeenCalledWith('commitIdentitySettings', wire(false, '次身份'));
    expectNoDirectAccess();
  });

  it('wire payload 只含伺服器白名單欄位', () => {
    const req = buildIdentitySettingsRequest({ secondaryEnabled: true, secondaryDisplayName: 'x' });
    expect(Object.keys(req).sort()).toEqual(['identities', 'profileActiveIdentityId']);
    expect(Object.keys(req.identities)).toEqual(['secondary']);
    const allowed = ['identityId', 'enabled', 'displayName', 'displayRoleLabel', 'isPrimary', 'editable'];
    expect(Object.keys(req.identities.secondary).every((key) => allowed.includes(key))).toBe(true);
  });

  it.each(['role', 'uid', 'exp', 'updatedAt', 'enabled', 'displayName'])(
    '身分 input 拒絕額外欄位 %s',
    async (field) => {
      const input = {
        secondaryEnabled: true,
        secondaryDisplayName: 'sec',
        [field]: 'unexpected',
      };
      await expect(commitIdentitySettings(input)).rejects.toThrow(/未允許欄位/);
      expect(callFn).not.toHaveBeenCalled();
      expectNoDirectAccess();
    },
  );

  it('拒絕舊 enabled/displayName 格式', async () => {
    const legacy = { enabled: true, displayName: 'sec' };
    await expect(
      commitIdentitySettings(legacy as unknown as CommitIdentitySettingsInput),
    ).rejects.toThrow(/未允許欄位/);
    expect(callFn).not.toHaveBeenCalled();
    expectNoDirectAccess();
  });

  it.each(['', '   ', 'x'.repeat(41)])(
    '啟用時拒絕無效名稱 %s',
    async (secondaryDisplayName) => {
      await expect(commitIdentitySettings({
        secondaryEnabled: true,
        secondaryDisplayName,
      })).rejects.toThrow(/invalid identity settings/);
      expect(callFn).not.toHaveBeenCalled();
      expectNoDirectAccess();
    },
  );

  it('Callable 拒絕時不以直寫回退', async () => {
    const error = new Error('permission-denied');
    vi.mocked(callFn).mockRejectedValueOnce(error);
    await expect(commitIdentitySettings({
      secondaryEnabled: true,
      secondaryDisplayName: 'sec',
    })).rejects.toBe(error);
    expect(callFn).toHaveBeenCalledTimes(1);
    expectNoDirectAccess();
  });

  it('commitSecondaryIdentityAvatar 上傳 metadata', async () => {
    await commitSecondaryIdentityAvatar({
      avatarUrl: 'https://example.com/a.png',
      avatarStoragePath: 'users/u1/identities/secondary/avatar/a.png',
      avatarStorageBucket: 'bucket',
    });
    expect(callFn).toHaveBeenCalledTimes(1);
    expect(callFn).toHaveBeenCalledWith('commitSecondaryIdentityAvatar', {
      avatarUrl: 'https://example.com/a.png',
      avatarStoragePath: 'users/u1/identities/secondary/avatar/a.png',
      avatarStorageBucket: 'bucket',
    });
    expectNoDirectAccess();
  });

  it('commitSecondaryIdentityAvatar 清除', async () => {
    await commitSecondaryIdentityAvatar({ clear: true });
    expect(callFn).toHaveBeenCalledTimes(1);
    expect(callFn).toHaveBeenCalledWith('commitSecondaryIdentityAvatar', {
      clear: true,
    });
    expectNoDirectAccess();
  });

  it('次身分頭像拒絕額外欄位', async () => {
    const input = { clear: true as const, role: 'admin' };
    await expect(commitSecondaryIdentityAvatar(input)).rejects.toThrow(/未允許欄位/);
    expect(callFn).not.toHaveBeenCalled();
    expectNoDirectAccess();
  });
});
