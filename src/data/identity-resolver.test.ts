import { describe, expect, it } from 'vitest';
import {
  buildPublicSnapshot,
  getActiveIdentityId,
  getEffectiveIdentity,
  getMainIdentity,
  getSecondaryIdentity,
  isSecondaryEnabled,
  normalizeIdentitySettings,
} from './identity-resolver';

function withSecondary(overrides: Record<string, unknown> = {}) {
  return normalizeIdentitySettings({
    profileActiveIdentityId: 'secondary',
    identities: {
      secondary: { enabled: true, displayName: '官方', avatarUrl: 'off.jpg' },
    },
    ...overrides,
  });
}

describe('M-123 identity-resolver', () => {
  it('normalize：非物件、陣列 → null', () => {
    for (const value of [null, undefined, [], 's', 42, true, false]) {
      expect(normalizeIdentitySettings(value)).toBeNull();
    }
  });

  it('normalize：缺 identities → secondary 為 null；_docId 預設 settings', () => {
    const s = normalizeIdentitySettings({ profileActiveIdentityId: 'main' });
    expect(s?._docId).toBe('settings');
    expect(s?.profileActiveIdentityId).toBe('main');
    expect(s?.identities.secondary).toBeNull();
  });

  it('normalize：非法 active id → main', () => {
    expect(normalizeIdentitySettings({ profileActiveIdentityId: 'nope' })?.profileActiveIdentityId)
      .toBe('main');
    expect(normalizeIdentitySettings({ profileActiveIdentityId: undefined })?.profileActiveIdentityId)
      .toBe('main');
    expect(normalizeIdentitySettings({ profileActiveIdentityId: 1 })?.profileActiveIdentityId)
      .toBe('main');
  });

  it('normalize：secondary 欄位正規化（trim、editable 預設 true、displayRoleLabel 40 截）', () => {
    const s = normalizeIdentitySettings({
      _docId: 'doc1',
      profileActiveIdentityId: 'secondary',
      identities: {
        secondary: {
          enabled: true,
          displayName: '  官方  ',
          avatarUrl: '  a.jpg  ',
          displayRoleLabel: '主播',
          updatedAt: { seconds: 1 },
        },
      },
    });
    expect(s?._docId).toBe('doc1');
    expect(s?.profileActiveIdentityId).toBe('secondary');
    expect(s?.identities.secondary).toEqual({
      identityId: 'secondary',
      enabled: true,
      displayName: '官方',
      avatarUrl: 'a.jpg',
      avatarStoragePath: '',
      avatarStorageBucket: '',
      displayRoleLabel: '主播',
      isPrimary: false,
      editable: true,
      updatedAt: { seconds: 1 },
    });
  });

  it('isSecondaryEnabled：啟用但暱稱空白視為未啟用', () => {
    expect(isSecondaryEnabled(withSecondary())).toBe(true);
    expect(isSecondaryEnabled(normalizeIdentitySettings({
      identities: { secondary: { enabled: true, displayName: '   ' } },
    }))).toBe(false);
    expect(isSecondaryEnabled(normalizeIdentitySettings({
      identities: { secondary: { enabled: false, displayName: '官方' } },
    }))).toBe(false);
    expect(isSecondaryEnabled(null)).toBe(false);
    expect(isSecondaryEnabled(undefined)).toBe(false);
  });

  it('getActiveIdentityId：allowSecondaryIdentity=false 強制 main；A 預設可用', () => {
    const s = withSecondary();
    expect(getActiveIdentityId(s, { allowSecondaryIdentity: true })).toBe('secondary');
    expect(getActiveIdentityId(s, { allowSecondaryIdentity: false })).toBe('main');
    // A `_canUseSecondaryIdentity` 預設允許
    expect(getActiveIdentityId(s)).toBe('secondary');
    expect(getActiveIdentityId(null)).toBe('main');
    expect(getActiveIdentityId(undefined)).toBe('main');
  });

  it('getEffectiveIdentity：pm surface 一律主身份；其他例如 chrome／comment／profile 走第二身份', () => {
    const s = withSecondary();
    const user = { uid: 'u', displayName: '小明' };
    for (const surface of ['pm', 'privateMessage', 'private-message']) {
      expect(getEffectiveIdentity(user, { settings: s, surface })?.identityId).toBe('main');
    }
    for (const surface of ['chrome', 'comment', 'profile']) {
      expect(getEffectiveIdentity(user, { settings: s, surface })?.identityId).toBe('secondary');
    }
  });

  it('getEffectiveIdentity：無 settings 或未允許 → 主身份；null user → null', () => {
    expect(getEffectiveIdentity(null, {})).toBeNull();
    expect(getEffectiveIdentity({ uid: 'u' }, {})?.identityId).toBe('main');
    expect(getEffectiveIdentity({ uid: 'u' }, {
      settings: withSecondary(),
      allowSecondaryIdentity: false,
    })?.identityId).toBe('main');
  });

  it('getMainIdentity：uid 遞補與預設顯示名稱', () => {
    expect(getMainIdentity(null)).toBeNull();
    expect(getMainIdentity(undefined)).toBeNull();
    expect(getMainIdentity({ uid: 'u' })?.displayName).toBe('u');
    expect(getMainIdentity({ lineUserId: 'l' })?.uid).toBe('l');
    expect(getMainIdentity({ _docId: 'd' })?.uid).toBe('d');
    expect(getMainIdentity({})?.displayName).toBe('用戶');
    expect(getMainIdentity({ name: '小明', photoURL: 'p' })).toMatchObject({
      displayName: '小明',
      name: '小明',
      pictureUrl: 'p',
      photoURL: 'p',
      isPrimary: true,
      source: 'users',
    });
  });

  it('getSecondaryIdentity：需權限且已啟用，displayRoleLabel 預設一般用戶', () => {
    const s = withSecondary();
    expect(getSecondaryIdentity({ uid: 'u' }, s, { allowSecondaryIdentity: false })).toBeNull();
    expect(getSecondaryIdentity(null, s)).toBeNull();
    const r = getSecondaryIdentity({ uid: 'u' }, s);
    expect(r?.identityId).toBe('secondary');
    expect(r?.displayName).toBe('官方');
    expect(r?.avatarCandidates).toEqual(['off.jpg']);
    expect(r?.displayRoleLabel).toBe('一般用戶');
    expect(r?.source).toBe('users.identityPrivate.settings');
    expect(r?.isPrimary).toBe(false);
  });

  it('buildPublicSnapshot：截斷 80／1200、無 user 回 null、main 預設', () => {
    const snap = buildPublicSnapshot({
      uid: 'u',
      displayName: '名'.repeat(81),
      pictureUrl: 'x'.repeat(1201),
    });
    expect(snap?.displayName).toHaveLength(80);
    expect(snap?.avatarUrl).toHaveLength(1200);
    expect(snap?.identityId).toBe('main');
    expect(buildPublicSnapshot(null)).toBeNull();
  });

  it('buildPublicSnapshot：requestedIdentityId=secondary 且允許 → 第二身份；invalid／無權限 → main', () => {
    const s = withSecondary();
    const allow = { settings: s, allowSecondaryIdentity: true };

    const snap = buildPublicSnapshot(
      { uid: 'u', displayName: '小明' },
      { ...allow, requestedIdentityId: 'secondary' },
    );
    expect(snap?.identityId).toBe('secondary');
    expect(snap?.displayName).toBe('官方');
    expect(snap?.avatarUrl).toBe('off.jpg');

    const snapInvalid = buildPublicSnapshot(
      { uid: 'u', displayName: '小明' },
      { ...allow, requestedIdentityId: 'nope' },
    );
    expect(snapInvalid?.identityId).toBe('main');

    const snapNoPerm = buildPublicSnapshot(
      { uid: 'u', displayName: '小明' },
      { settings: s, allowSecondaryIdentity: false, requestedIdentityId: 'secondary' },
    );
    expect(snapNoPerm?.identityId).toBe('main');
  });
});
