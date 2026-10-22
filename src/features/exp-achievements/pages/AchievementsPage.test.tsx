import { cleanup, render, waitFor } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/data/firebase', () => ({
  getFirebase: vi.fn(async () => ({ db: {} })),
}));

// 測試同步更新：照 A（fix-4d 項目 1）改用 useViewer 取登入 uid。
vi.mock('@/features/profile/data/viewer', () => ({
  useViewer: vi.fn(() => ({ uid: 'me' })),
}));

vi.mock('../data/achievements', async () => {
  const actual: typeof import('../data/achievements') = await vi.importActual(
    '../data/achievements',
  );
  return {
    ...actual,
    loadAchievementDefs: vi.fn(),
    loadUserAchievementProgress: vi.fn(),
  };
});

import { loadAchievementDefs, loadUserAchievementProgress } from '../data/achievements';
import { useViewer } from '@/features/profile/data/viewer';
import AchievementsPage, { generateConditionDesc } from './AchievementsPage';

const useViewerMock = vi.mocked(useViewer);

// 測試同步更新：照 A（fix-4e 項目 1）補 generateConditionDesc 三個案例。
describe('generateConditionDesc（照 A achievement/shared.js 條件描述）', () => {
  it('complete_event 100 → 顯示 A 中文條件描述', () => {
    expect(
      generateConditionDesc(
        { action: 'complete_event', timeRange: 'none', threshold: 100 },
        undefined,
      ),
    ).toBe('完成活動（簽到+簽退） 100 場');
  });

  it('complete_profile 1 → 只顯示 label', () => {
    expect(
      generateConditionDesc(
        { action: 'complete_profile', timeRange: 'none', threshold: 1 },
        undefined,
      ),
    ).toBe('完成個人檔案');
  });

  it('attendance_rate 90 → 含單位', () => {
    expect(
      generateConditionDesc(
        { action: 'attendance_rate', timeRange: 'none', threshold: 90 },
        undefined,
      ),
    ).toBe('達到出席率 90 %');
  });
});

describe('AchievementsPage', () => {
  beforeEach(() => {
    document.documentElement.lang = 'zh-TW';
    vi.clearAllMocks();
    useViewerMock.mockReturnValue(
      { uid: 'me' } as unknown as ReturnType<typeof useViewer>,
    );
  });

  afterEach(() => {
    cleanup();
  });

  it('渲染已獲得徽章／進行中／已完成三區與進度', async () => {
    vi.mocked(loadAchievementDefs).mockResolvedValue({
      achievements: [
        {
          id: 'a1',
          name: '測試成就1',
          category: 'bronze',
          condition: { action: 'register_event', timeRange: 'none', threshold: 3 },
        },
        {
          id: 'a2',
          name: '測試成就2',
          category: 'gold',
          condition: { action: 'complete_event', timeRange: 'none', threshold: 1 },
        },
      ],
      badges: [{ id: 'b1', name: '青銅徽章', achId: 'a2', image: null }],
    });
    vi.mocked(loadUserAchievementProgress).mockResolvedValue({
      a1: { current: 1, completedAt: null },
      a2: { current: 1, completedAt: '2025-10-01' },
    });

    const { container, findByText } = render(<AchievementsPage />);

    await findByText('已獲得徽章');
    await findByText('進行中');
    expect(await findByText('1/3')).toBeTruthy();

    await waitFor(() => {
      expect(container.querySelectorAll('.ach-card-done-overlay').length).toBe(1);
    });
    // 測試同步更新：照 A（項目 2）jsdom 會把 inline style 正規化成 rgb 形式。
    // 已完成卡片的分類色（gold → #d4a017）以 style.borderColor 斷言。
    const doneCard = container.querySelector('.ach-card-done') as HTMLElement | null;
    expect(doneCard).toBeTruthy();
    expect(doneCard?.style.borderColor).toBe('rgb(212, 160, 23)');
  });

  it('尚無成就', async () => {
    vi.mocked(loadAchievementDefs).mockResolvedValue({ achievements: [], badges: [] });
    vi.mocked(loadUserAchievementProgress).mockResolvedValue({});
    const { findByText } = render(<AchievementsPage />);
    await findByText('尚無成就');
  });

  it('分區標題不會在無資料時誤顯示', async () => {
    vi.mocked(loadAchievementDefs).mockResolvedValue({
      achievements: [
        {
          id: 'a1',
          name: '唯一成就',
          category: 'bronze',
          condition: { action: 'register_event', timeRange: 'none', threshold: 5 },
        },
      ],
      badges: [],
    });
    vi.mocked(loadUserAchievementProgress).mockResolvedValue({
      a1: { current: 1, completedAt: null },
    });
    const { container, findByText } = render(<AchievementsPage />);
    await findByText('進行中');
    // 沒有已完成／未獲得徽章時不應該顯示對應區塊
    expect(container.querySelectorAll('.ach-card-done-overlay').length).toBe(0);
    expect(container.textContent).not.toContain('已獲得徽章');
  });

  it('uid 延後出現才載入', async () => {
    useViewerMock.mockReturnValue(
      { uid: null } as unknown as ReturnType<typeof useViewer>,
    );
    vi.mocked(loadAchievementDefs).mockResolvedValue({ achievements: [], badges: [] });
    vi.mocked(loadUserAchievementProgress).mockResolvedValue({});

    const { rerender, findByText, queryByText } = render(<AchievementsPage />);
    await findByText('載入中...');
    expect(loadAchievementDefs).not.toHaveBeenCalled();
    expect(loadUserAchievementProgress).not.toHaveBeenCalled();
    expect(queryByText('尚無成就')).toBeNull();

    useViewerMock.mockReturnValue(
      { uid: 'me' } as unknown as ReturnType<typeof useViewer>,
    );
    rerender(<AchievementsPage />);
    await findByText('尚無成就');
    expect(loadAchievementDefs).toHaveBeenCalled();
    expect(loadUserAchievementProgress).toHaveBeenCalledWith('me');
  });
});

describe('generateConditionDesc', () => {
  it('無 condition 用 desc，沒 desc 顯示未設定成就條件', () => {
    expect(generateConditionDesc(undefined, 'desc')).toBe('desc');
    expect(generateConditionDesc(undefined, undefined)).toBe('未設定成就條件');
  });

  it('不支援的 condition 顯示未設定成就條件', () => {
    expect(generateConditionDesc({ action: 'unknown', timeRange: 'none' }, 'd')).toBe(
      '未設定成就條件',
    );
  });

  // 測試同步更新：照 A shared.js#generateConditionDesc（有單位時 threshold 1 仍帶數量與單位）。
  it('支援的 action、有單位時 threshold 1 也帶數量與單位', () => {
    expect(
      generateConditionDesc(
        { action: 'complete_event', timeRange: 'none', threshold: 1 },
        undefined,
      ),
    ).toBe('完成活動（簽到+簽退） 1 場');
  });

  it('支援的 action、threshold > 1 帶上數量與單位', () => {
    expect(
      generateConditionDesc(
        { action: 'complete_event', timeRange: 'none', threshold: 5 },
        undefined,
      ),
    ).toBe('完成活動（簽到+簽退） 5 場');
  });
});
