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
