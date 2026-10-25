import { cleanup, fireEvent, render, waitFor } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { routeMock } = vi.hoisted(() => ({ routeMock: vi.fn() }));
vi.mock('preact-iso', () => ({
  useLocation: () => ({ route: routeMock }),
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

import { toast } from '@/ui/Toast';
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

  // T-038（2026-10-26）：成就／稱號系統先關閉（exp-achievements/availability.ts）
  describe('成就／稱號關閉', () => {
    function renderHeader() {
      return render(
        <LegacyProfileTopSection uid="me" profile={profile} viewer={viewer} summary={null} />,
      );
    }
    function quickItem(container: Element, label: string): HTMLButtonElement {
      const item = Array.from(container.querySelectorAll<HTMLButtonElement>('.quick-item')).find(
        (button) => button.textContent?.includes(label),
      );
      if (!item) throw new Error(`找不到快捷按鈕：${label}`);
      return item;
    }

    it('成就/徽章、稱號按鈕反灰：ach-closed＋aria-disabled，且不是 disabled 屬性（才收得到點擊）', () => {
      const { container } = renderHeader();
      for (const label of ['成就/徽章', '稱號']) {
        const item = quickItem(container, label);
        expect(item.classList.contains('ach-closed')).toBe(true);
        expect(item.getAttribute('aria-disabled')).toBe('true');
        expect(item.disabled).toBe(false);
      }
    });

    it('點擊成就/徽章與稱號：顯示尚未開放 toast、不導頁', () => {
      const toastSpy = vi.spyOn(toast, 'show');
      const { container } = renderHeader();
      fireEvent.click(quickItem(container, '成就/徽章'));
      fireEvent.click(quickItem(container, '稱號'));
      expect(routeMock).not.toHaveBeenCalled();
      expect(toastSpy).toHaveBeenCalledTimes(2);
      for (const call of toastSpy.mock.calls) {
        expect(call[0]).toEqual({ message: expect.stringMatching(/exp-achievements\.closed|尚未開放/) });
      }
      toastSpy.mockRestore();
    });

    it('徽章數統計項反灰（仍顯示實數），道具欄維持原本的 disabled', async () => {
      const { container } = renderHeader();
      const stat = container.querySelector('#profile-stat-badges')?.closest('.stat-item');
      expect(stat?.classList.contains('ach-closed')).toBe(true);
      await waitFor(() => {
        expect(container.querySelector('#profile-stat-badges')?.textContent).toBe('2');
      });
      // 其他三個統計項不反灰
      expect(container.querySelectorAll('.stat-item.ach-closed')).toHaveLength(1);
      expect(quickItem(container, '道具欄').disabled).toBe(true);
    });
  });
});
