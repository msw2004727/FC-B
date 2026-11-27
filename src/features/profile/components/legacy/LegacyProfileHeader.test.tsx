import { cleanup, render } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('preact-iso', () => ({
  useLocation: () => ({ route: vi.fn() }),
}));

vi.mock('@/data/user-roles', () => ({
  useUserRoles: () => ({}),
}));

vi.mock('@/data/identity-settings', () => ({
  useIdentitySettings: () => ({}),
}));

vi.mock('@/data/identity-resolver', () => ({
  getEffectiveIdentity: () => ({
    displayName: 'TestUser',
    pictureUrl: null,
    identityId: 'primary',
  }),
}));

import { _setDictLoaderForTest, setLocale } from '@/i18n/i18n';
import type { UserProfile } from '../../data/profile-model';
import type { ViewerView } from '../../data/viewer';
import { LegacyProfileTopSection } from './LegacyProfileHeader';

// 即使資料裡還有稱號欄位（後端照舊累計），新站頭部也不顯示。
const profile = {
  titleBig: 'GoldAch',
  titleNormal: 'SilverAch',
  exp: 0,
} as unknown as UserProfile;

const viewer = {
  role: 'user',
  hasPermission: () => false,
} as unknown as ViewerView;

describe('LegacyProfileHeader', () => {
  beforeEach(async () => {
    _setDictLoaderForTest(null);
    await setLocale('zh-TW');
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  function renderHeader() {
    return render(
      <LegacyProfileTopSection uid="me" profile={profile} viewer={viewer} summary={null} />,
    );
  }

  it('頭部只顯示名字與參與／完成／出席率三個統計項', () => {
    const { container } = renderHeader();
    expect(container.textContent).toContain('TestUser');
    expect(container.querySelectorAll('.profile-stats .stat-item')).toHaveLength(3);
    expect(container.querySelector('#profile-stat-total')).not.toBeNull();
    expect(container.querySelector('#profile-stat-done')).not.toBeNull();
    expect(container.querySelector('#profile-stat-rate')).not.toBeNull();
  });

  it('成就／徽章、稱號、道具欄全部移除：沒有稱號標籤、徽章統計與快捷按鈕', () => {
    const { container } = renderHeader();
    expect(container.querySelector('.title-tag')).toBeNull();
    expect(container.querySelector('#profile-stat-badges')).toBeNull();
    expect(container.querySelector('.quick-grid')).toBeNull();
    expect(container.querySelector('.quick-item')).toBeNull();
    expect(container.textContent).not.toMatch(/成就|徽章|稱號|道具欄/);
    expect(container.textContent).not.toContain('GoldAch');
  });
});

// PROFILE-SPEED（顧問 §3.933）：頁首不再經 useUserRoles 重讀自己的 users 文件，身分只看 profile.role，
// 由 resolveEffectiveRole（profile-legacy-helpers.ts）套隱身規則，與 user-roles.ts readRole 相同：
// admin／super_admin 且 stealth===true 顯示成一般用戶；其他角色不受 stealth 影響。
// 原始 UID 是否顯示照改前：viewer.role 或 profile.role（原值，不套隱身）為 admin 以上就顯示。
describe('LegacyProfileHeader 身分標籤與隱身（PROFILE-SPEED）', () => {
  beforeEach(async () => {
    _setDictLoaderForTest(null);
    await setLocale('zh-TW');
  });
  afterEach(() => cleanup());

  const userViewer = { role: 'user', hasPermission: () => false } as unknown as ViewerView;

  function renderWith(p: Record<string, unknown>) {
    return render(
      <LegacyProfileTopSection
        uid="U-me"
        profile={{ exp: 0, ...p } as unknown as UserProfile}
        viewer={userViewer}
        summary={null}
      />,
    );
  }
  const roleLabel = (c: Element): string | null => c.querySelector('#profile-role-tag-wrap .uc-role-tag')?.textContent ?? null;
  const rawUidShown = (c: Element): boolean => (c.querySelector('#profile-uid-wrap')?.textContent ?? '').includes('U-me');

  it.each([
    [{ role: 'admin' }, '管理員', true],
    [{ role: 'admin', stealth: true }, '一般用戶', true],
    [{ role: 'super_admin' }, '總管', true],
    [{ role: 'super_admin', stealth: true }, '一般用戶', true],
    [{ role: 'coach', stealth: true }, '教練', false],
    [{ role: 'admin', stealth: 'true' }, '管理員', true],
    [{}, '一般用戶', false],
  ])('profile %o → 標籤 %s、原始 UID 顯示 %s', (p, label, uidShown) => {
    const { container } = renderWith(p);
    expect(roleLabel(container)).toBe(label);
    expect(rawUidShown(container)).toBe(uidShown);
  });
});
