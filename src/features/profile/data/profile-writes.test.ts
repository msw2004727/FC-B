import { beforeEach, describe, expect, it, vi } from 'vitest';

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
import { getDoc, serverTimestamp, updateDoc } from 'firebase/firestore';

import {
  commitIdentitySettings,
  commitSecondaryIdentityAvatar,
  clearSocialLink,
  normalizeLineContactUrl,
  saveCompanions,
  saveEduChildren,
  saveFirstLoginProfile,
  saveSocialLink,
  updateProfileFields,
} from './profile-writes';

const SERVER_TS = { __sv: 'SERVER_TIMESTAMP' };

describe('write guardrails', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getFirebase).mockResolvedValue({ db: {} } as never);
    vi.mocked(updateDoc).mockResolvedValue(undefined as never);
    vi.mocked(serverTimestamp).mockReturnValue(SERVER_TS as never);
  });

  it('updateProfileFields 拒絕未白名單欄位', async () => {
    await expect(
      updateProfileFields('u1', { gender: 'x', unknownField: 'y' }),
    ).rejects.toThrow(/未允許欄位/);
    expect(vi.mocked(updateDoc)).not.toHaveBeenCalled();
  });

  it('updateProfileFields 拒絕寫 role', async () => {
    await expect(
      updateProfileFields('u1', { role: 'admin' }),
    ).rejects.toThrow(/未允許欄位/);
  });

  it('updateProfileFields 拒絕寫 exp', async () => {
    await expect(
      updateProfileFields('u1', { exp: 999 }),
    ).rejects.toThrow(/未允許欄位/);
  });

  it('updateProfileFields 拒絕衍生欄位 current / waitlist 等', async () => {
    // 衍生欄位需由 assertNoDerivedFields 逐項被擋；先驗 updateProfileFields
    // 第一道（allowlist）就會擋，這行同時確認結果是拒絕。
    await expect(
      updateProfileFields('u1', { current: 1 }),
    ).rejects.toThrow();
    // 直接測試 write-guard 行為（如通過 allowlist 後仍會被第二道擋）。
    const { assertNoDerivedFields } = await import('@/data/write-guard');
    expect(() => assertNoDerivedFields({ participants: [] })).toThrow(/衍生欄位/);
    expect(() => assertNoDerivedFields({ waitlistNames: [] })).toThrow(/衍生欄位/);
    expect(() => assertNoDerivedFields({ realCurrent: 0 })).toThrow(/衍生欄位/);
  });

  it('saveCompanions 拒絕多餘欄位', async () => {
    // saveCompanions 只能寫 companions；companion 本身被包成實際 payload 的 companions 值，
    // 但函式只接受陣列。此處驗證 create 出的 payload 只含 companions + updatedAt。
    vi.mocked(updateDoc).mockClear();
    await saveCompanions('u1', [{ name: 'x' }]);
    expect(vi.mocked(updateDoc)).toHaveBeenCalledTimes(1);
    const [, payload] = vi.mocked(updateDoc).mock.calls[0]!;
    expect(Object.keys(payload as object).sort()).toEqual(['companions', 'updatedAt']);
  });
});

describe('A29 updateProfileFields（golden payload 與 A 一致）', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getFirebase).mockResolvedValue({ db: {} } as never);
    vi.mocked(updateDoc).mockResolvedValue(undefined as never);
    vi.mocked(serverTimestamp).mockReturnValue(SERVER_TS as never);
  });

  it('payload = {...patch, updatedAt: serverTimestamp}', async () => {
    await updateProfileFields('u1', { gender: 'male', region: 'TW' });
    expect(vi.mocked(updateDoc)).toHaveBeenCalledTimes(1);
    const [ref, payload] = vi.mocked(updateDoc).mock.calls[0]!;
    expect(ref).toEqual({ __doc: 'users/u1' });
    expect(payload).toEqual({
      gender: 'male',
      region: 'TW',
      updatedAt: SERVER_TS,
    });
    expect(payload).not.toHaveProperty('role');
    expect(payload).not.toHaveProperty('exp');
  });

  it('不允許 patch 夾帶 updatedAt', async () => {
    await expect(
      updateProfileFields('u1', { gender: 'x', updatedAt: 123 }),
    ).rejects.toThrow(/未允許欄位/);
  });
});

describe('A29 saveFirstLoginProfile（golden payload 與 A 一致）', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getFirebase).mockResolvedValue({ db: {} } as never);
    vi.mocked(updateDoc).mockResolvedValue(undefined as never);
    vi.mocked(serverTimestamp).mockReturnValue(SERVER_TS as never);
  });

  it('帶 email 時 4 欄 + updatedAt', async () => {
    await saveFirstLoginProfile('u1', {
      gender: 'female',
      birthday: '1990-01-01',
      region: 'TW',
      email: 'a@example.com',
    });
    const [, payload] = vi.mocked(updateDoc).mock.calls[0]!;
    expect(payload).toEqual({
      gender: 'female',
      birthday: '1990-01-01',
      region: 'TW',
      email: 'a@example.com',
      updatedAt: SERVER_TS,
    });
  });

  it('無 email 時不寫 email 欄', async () => {
    await saveFirstLoginProfile('u1', {
      gender: 'female',
      birthday: '1990-01-01',
      region: 'TW',
      email: '',
    });
    const [, payload] = vi.mocked(updateDoc).mock.calls[0]!;
    expect(payload).toEqual({
      gender: 'female',
      birthday: '1990-01-01',
      region: 'TW',
      updatedAt: SERVER_TS,
    });
    expect(payload).not.toHaveProperty('email');
  });
});

describe('A31 saveCompanions / A32 saveEduChildren（golden）', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getFirebase).mockResolvedValue({ db: {} } as never);
    vi.mocked(updateDoc).mockResolvedValue(undefined as never);
    vi.mocked(serverTimestamp).mockReturnValue(SERVER_TS as never);
  });

  it('companions 只寫 companions + updatedAt', async () => {
    const comps = [{ name: 'A' }, { name: 'B' }];
    await saveCompanions('u1', comps);
    const [, payload] = vi.mocked(updateDoc).mock.calls[0]!;
    expect(payload).toEqual({ companions: comps, updatedAt: SERVER_TS });
  });

  it('eduChildren 只寫 eduChildren + updatedAt', async () => {
    const kids = [{ name: 'K' }];
    await saveEduChildren('u1', kids);
    const [, payload] = vi.mocked(updateDoc).mock.calls[0]!;
    expect(payload).toEqual({ eduChildren: kids, updatedAt: SERVER_TS });
  });
});

describe('社交連結正規化（A _normalizeLineContactUrl）', () => {
  it('https 與 line:// 原樣', () => {
    expect(normalizeLineContactUrl('https://example.com/x')).toBe('https://example.com/x');
    expect(normalizeLineContactUrl('line://ti/p/abc')).toBe('line://ti/p/abc');
  });

  it('空字串 → 空字串', () => {
    expect(normalizeLineContactUrl('')).toBe('');
    expect(normalizeLineContactUrl('   ')).toBe('');
  });

  it('@id 與純 id → 包 line.me/ti/p/', () => {
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
    vi.resetAllMocks();
    vi.mocked(getFirebase).mockResolvedValue({ db: {} } as never);
    vi.mocked(updateDoc).mockResolvedValue(undefined as never);
    vi.mocked(serverTimestamp).mockReturnValue(SERVER_TS as never);
    vi.mocked(getDoc).mockResolvedValue({
      exists: () => true,
      data: () => ({ socialLinks: { fb: 'https://fb.example/alice' } }),
    } as never);
  });

  it('saveSocialLink 保留其他平台並正規化 line', async () => {
    await saveSocialLink('u1', 'line', '@alice');
    const [, payload] = vi.mocked(updateDoc).mock.calls[0]!;
    expect(payload).toEqual({
      socialLinks: {
        fb: 'https://fb.example/alice',
        line: 'https://line.me/ti/p/alice',
      },
      updatedAt: SERVER_TS,
    });
  });

  it('clearSocialLink 覆寫為空字串', async () => {
    await clearSocialLink('u1', 'line');
    const [, payload] = vi.mocked(updateDoc).mock.calls[0]!;
    expect(payload).toEqual({
      socialLinks: {
        fb: 'https://fb.example/alice',
        line: '',
      },
      updatedAt: SERVER_TS,
    });
  });

  it('非 line 平台不做 line 正規化', async () => {
    await saveSocialLink('u1', 'ig', 'alice');
    const [, payload] = vi.mocked(updateDoc).mock.calls[0]!;
    expect((payload as unknown as { socialLinks: Record<string, string> }).socialLinks['ig']).toBe('alice');
  });
});

describe('A30 Callable 走 callFn（不直寫）', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(callFn).mockResolvedValue(undefined as never);
  });

  it('commitIdentitySettings 直接以 callFn 送 input', async () => {
    await commitIdentitySettings({ enabled: true, displayName: 'sec' });
    expect(vi.mocked(callFn)).toHaveBeenCalledWith('commitIdentitySettings', {
      enabled: true,
      displayName: 'sec',
    });
  });

  it('commitSecondaryIdentityAvatar 上傳 metadata', async () => {
    await commitSecondaryIdentityAvatar({
      avatarUrl: 'https://example.com/a.png',
      avatarStoragePath: 'users/u1/identities/secondary/avatar/a.png',
      avatarStorageBucket: 'bucket',
    });
    expect(vi.mocked(callFn)).toHaveBeenCalledWith('commitSecondaryIdentityAvatar', {
      avatarUrl: 'https://example.com/a.png',
      avatarStoragePath: 'users/u1/identities/secondary/avatar/a.png',
      avatarStorageBucket: 'bucket',
    });
  });

  it('commitSecondaryIdentityAvatar 清除', async () => {
    await commitSecondaryIdentityAvatar({ clear: true });
    expect(vi.mocked(callFn)).toHaveBeenCalledWith('commitSecondaryIdentityAvatar', {
      clear: true,
    });
  });

  it('A30 不經 updateDoc（不直寫 users 文件）', async () => {
    await commitIdentitySettings({ enabled: true });
    expect(vi.mocked(updateDoc)).not.toHaveBeenCalled();
  });
});
