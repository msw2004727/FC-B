import { cleanup, render, waitFor } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('preact-iso', () => ({
  useLocation: () => ({ route: vi.fn() }),
}));

vi.mock('@/features/exp-achievements/data/achievements', async () => {
  const actual: typeof import('@/features/exp-achievements/data/achievements') =
    await vi.importActual('@/features/exp-achievements/data/achievements');
  return {
    ...actual,
    loadAchievementDefs: vi.fn(async () => ({
      achievements: [
        {
          id: 'a1',
          name: 'GoldAch',
          category: 'gold',
          condition: { action: 'complete_event', timeRange: 'none', threshold: 1 },
        },
        {
          id: 'a2',
          name: 'SilverAch',
          category: 'silver',
          condition: { action: 'register_event', timeRange: 'none', threshold: 1 },
        },
      ],
      badges: [
        { id: 'b1', name: 'B1', achId: 'a1' },
        { id: 'b2', name: 'B2', achId: 'a2' },
      ],
    })),
    loadUserAchievementProgress: vi.fn(async () => ({
      a1: { current: 1, completedAt: '2025-10-01' },
      a2: { current: 1, completedAt: '2025-10-02' },
    })),
  };
});

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

import type { UserProfile } from '../../data/profile-model';
import type { ViewerView } from '../../data/viewer';
import { LegacyProfileTopSection } from './LegacyProfileHeader';

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
  beforeEach(() => {
    document.documentElement.lang = 'zh-TW';
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('頭部顯示金銀稱號與名字', async () => {
    const { container } = render(
      <LegacyProfileTopSection uid="me" profile={profile} viewer={viewer} summary={null} />,
    );
    await waitFor(() => {
      const gold = container.querySelector('.title-tag.title-gold');
      const normal = container.querySelector('.title-tag.title-normal');
      expect(gold?.textContent).toBe('GoldAch');
      expect(normal?.textContent).toBe('SilverAch');
    });
    expect(container.textContent).toContain('TestUser');
  });

  it('徽章數顯示已取得實數', async () => {
    const { container } = render(
      <LegacyProfileTopSection uid="me" profile={profile} viewer={viewer} summary={null} />,
    );
    await waitFor(() => {
      expect(container.querySelector('#profile-stat-badges')?.textContent).toBe('2');
    });
  });
});
