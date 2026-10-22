import { cleanup, fireEvent, render, waitFor } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// 測試同步更新：照 A（項目 3）元件以動態 import 讀資料層；此處以 mock 取代，
// 同時封住 firebase/* 與 @/data/firebase，避免 vi.importActual 於模組頂層接觸真 Firestore
// 觸發 permission-denied。
vi.mock('firebase/firestore', () => ({
  getFirestore: vi.fn(() => ({})),
  collection: vi.fn(() => ({})),
  doc: vi.fn(() => ({})),
  getDoc: vi.fn(async () => ({ exists: () => false, data: () => undefined })),
  getDocs: vi.fn(async () => ({ docs: [], forEach: vi.fn(), size: 0 })),
  query: vi.fn(() => ({})),
  where: vi.fn(() => ({})),
  orderBy: vi.fn(() => ({})),
  limit: vi.fn(() => ({})),
  onSnapshot: vi.fn(() => () => {}),
  setDoc: vi.fn(async () => {}),
  updateDoc: vi.fn(async () => {}),
  serverTimestamp: vi.fn(() => ({})),
}));

vi.mock('@/data/firebase', () => ({
  getFirebase: vi.fn(async () => ({
    db: {},
    auth: { currentUser: { uid: 'test' } },
  })),
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
          name: 'A1',
          category: 'bronze' as const,
          condition: {
            action: 'register_event' as const,
            timeRange: 'none' as const,
            threshold: 1,
          },
        },
      ],
      badges: [{ id: 'b1', name: 'Badge1', achId: 'a1', image: null }],
    })),
    loadUserAchievementProgress: vi.fn(async () => ({
      a1: { current: 1, completedAt: '2025-10-01' },
    })),
  };
});

import { loadUserAchievementProgress } from '@/features/exp-achievements/data/achievements';
import { UserCardBadges } from './UserCardBadges';

// 測試同步更新：照 A（項目 5）——點毛玻璃改成「讀取對方成就」而非 toast 未開放。
describe('UserCardBadges', () => {
  beforeEach(() => {
    document.documentElement.lang = 'zh-TW';
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('看他人時輸出空狀態與毛玻璃', () => {
    const { container } = render(<UserCardBadges uid="target" isSelf={false} />);
    expect(container.textContent).toContain('已獲得徽章');
    expect(container.textContent).toContain('尚未獲得徽章');
    expect(container.querySelector('.uc-blur-overlay')).toBeTruthy();
    expect(container.textContent).toContain('點擊載入此用戶的徽章');
  });

  it('本人時不顯示毛玻璃', () => {
    const { container } = render(<UserCardBadges uid="target" isSelf={true} />);
    expect(container.querySelector('.uc-blur-overlay')).toBeFalsy();
  });

  it('點毛玻璃後載入徽章並移除遮蔽', async () => {
    const { container } = render(<UserCardBadges uid="target" isSelf={false} />);
    const blur = container.querySelector('.uc-blur-overlay');
    expect(blur).toBeTruthy();
    if (blur) fireEvent.click(blur);
    await waitFor(() => {
      expect(container.querySelector('.uc-badge-list')).toBeTruthy();
    });
    expect(container.textContent).toContain('Badge1');
    expect(container.querySelector('.uc-blur-overlay')).toBeFalsy();
  });

  it('rerender 換 uid 後重設並恢復遮罩', async () => {
    const { container, rerender } = render(<UserCardBadges uid="target" isSelf={false} />);
    const blur = container.querySelector('.uc-blur-overlay');
    if (blur) fireEvent.click(blur);
    await waitFor(() => {
      expect(container.querySelector('.uc-badge-list')).toBeTruthy();
    });
    expect(container.querySelector('.uc-blur-overlay')).toBeFalsy();

    rerender(<UserCardBadges uid="target2" isSelf={false} />);
    await waitFor(() => {
      expect(container.querySelector('.uc-blur-overlay')).toBeTruthy();
    });
  });

  it('切換 uid 後舊請求晚到不覆蓋新對象', async () => {
    type Progress = Record<string, { current: number; completedAt: unknown }>;
    let resolveOld: ((value: Progress) => void) | null = null;
    vi.mocked(loadUserAchievementProgress).mockImplementationOnce(
      () =>
        new Promise<Progress>((resolve) => {
          resolveOld = resolve;
        }),
    );

    const { container, rerender } = render(<UserCardBadges uid="old" isSelf={false} />);
    const blur = container.querySelector('.uc-blur-overlay');
    expect(blur).toBeTruthy();
    if (blur) fireEvent.click(blur);

    await waitFor(() => {
      expect(resolveOld).toBeTypeOf('function');
    });

    rerender(<UserCardBadges uid="new" isSelf={false} />);
    await waitFor(() => {
      expect(container.querySelector('.uc-blur-overlay')).toBeTruthy();
    });

    const finishOld = resolveOld as ((value: Progress) => void) | null;
    finishOld?.({ a1: { current: 1, completedAt: null } });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(container.querySelector('.uc-blur-overlay')).toBeTruthy();
    expect(container.textContent).not.toContain('Badge1');
  });
});
