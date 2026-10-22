import { cleanup, fireEvent, render, waitFor } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/data/firebase', () => ({
  getFirebase: vi.fn(async () => ({
    auth: { currentUser: { uid: 'me' } },
    db: {},
  })),
}));

// 測試同步更新：照 A（fix-4d 項目 1）元件改用 useViewer 取登入 uid。
vi.mock('@/features/profile/data/viewer', () => ({
  useViewer: vi.fn(() => ({ uid: 'me' })),
}));

const getDocMock = vi.fn();
vi.mock('firebase/firestore', () => ({
  doc: vi.fn((_db: unknown, ...segments: unknown[]) => ({
    path: segments.join('/'),
  })),
  getDoc: getDocMock,
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

// 測試同步更新：照 A（項目 1）vi.mock 會被 hoist，factory 需在檔頂可用的 mock；用 vi.hoisted 建立。
const { saveTitlesMock } = vi.hoisted(() => ({
  saveTitlesMock: vi.fn(
    async (_uid: string, _big: string | null, _normal: string | null) => undefined,
  ),
}));
vi.mock('../data/titles-write', () => ({
  saveTitles: saveTitlesMock,
}));

vi.mock('@/ui/Toast', () => ({ toast: { show: vi.fn() } }));

import { loadAchievementDefs, loadUserAchievementProgress } from '../data/achievements';
import { useViewer } from '@/features/profile/data/viewer';
import { toast } from '@/ui/Toast';
import TitlesPage from './TitlesPage';

const useViewerMock = vi.mocked(useViewer);

describe('TitlesPage', () => {
  beforeEach(() => {
    document.documentElement.lang = 'zh-TW';
    vi.clearAllMocks();
    useViewerMock.mockReturnValue(
      { uid: 'me' } as unknown as ReturnType<typeof useViewer>,
    );
    getDocMock.mockResolvedValue({
      exists: () => true,
      data: () => ({ titleBig: 'GoldAch', titleNormal: 'SilverAch', displayName: 'TestUser' }),
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('讀取失敗顯示錯誤與重新整理並禁止儲存', async () => {
    vi.mocked(loadAchievementDefs).mockRejectedValue(new Error('fail'));
    vi.mocked(loadUserAchievementProgress).mockResolvedValue({});
    const { container, getByText } = render(<TitlesPage />);
    await waitFor(() => {
      expect(container.textContent).toContain('載入失敗，請重新整理');
    });
    expect(getByText('重新整理')).toBeTruthy();
    expect(container.textContent).not.toContain('儲存稱號');
  });

  it('儲存前驗證稱號在已取得清單內', async () => {
    vi.mocked(loadAchievementDefs).mockResolvedValue({
      achievements: [
        {
          id: 'a1',
          name: 'GoldAch',
          category: 'gold',
          condition: { action: 'register_event', timeRange: 'none', threshold: 1 },
        },
      ],
      badges: [],
    });
    vi.mocked(loadUserAchievementProgress).mockResolvedValue({
      a1: { current: 1, completedAt: null },
    });
    const { container, getByText } = render(<TitlesPage />);
    // 等載入完成（儲存鈕可用）再操作，否則 disabled 按鈕點擊不會觸發 onClick。
    await waitFor(() => {
      const btn = getByText('儲存稱號').closest('button') as HTMLButtonElement | null;
      expect(btn?.disabled).toBe(false);
    });
    const select = container.querySelector('#title-big') as HTMLSelectElement;
    const option = document.createElement('option');
    option.value = 'Hack';
    option.textContent = 'Hack';
    select.appendChild(option);
    select.value = 'Hack';
    fireEvent.change(select);
    const saveButton = getByText('儲存稱號').closest('button');
    if (saveButton) fireEvent.click(saveButton);
    await waitFor(() => {
      expect(vi.mocked(toast.show)).toHaveBeenCalled();
    });
    expect(saveTitlesMock).not.toHaveBeenCalled();
  });

  it('只列出已完成成就、預設選目前值', async () => {
    vi.mocked(loadAchievementDefs).mockResolvedValue({
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
        {
          id: 'a3',
          name: 'PendingAch',
          category: 'bronze',
          condition: { action: 'attend_play', timeRange: 'none', threshold: 5 },
        },
      ],
      badges: [],
    });
    vi.mocked(loadUserAchievementProgress).mockResolvedValue({
      a1: { current: 1, completedAt: null },
      a2: { current: 1, completedAt: null },
      a3: { current: 0, completedAt: null },
    });

    const { container, findByText } = render(<TitlesPage />);
    await findByText('儲存稱號');

    await waitFor(() => {
      const bigSelect = container.querySelector('#title-big') as HTMLSelectElement | null;
      const normalSelect = container.querySelector('#title-normal') as HTMLSelectElement | null;
      expect(bigSelect).toBeTruthy();
      expect(normalSelect).toBeTruthy();
      // (無) + 一個已完成
      expect(bigSelect?.options.length).toBe(2);
      expect(normalSelect?.options.length).toBe(2);
      expect(bigSelect?.value).toBe('GoldAch');
      expect(normalSelect?.value).toBe('SilverAch');
      // 未完成的「PendingAch」不應出現在 select
      const allOptions = Array.from(container.querySelectorAll('#title-big option, #title-normal option'));
      expect(allOptions.some((o) => o.textContent === 'PendingAch')).toBe(false);
    });
  });

  it('儲存呼叫 saveTitles（payload 由 saveTitles 只寫三欄）', async () => {
    vi.mocked(loadAchievementDefs).mockResolvedValue({
      achievements: [
        {
          id: 'a1',
          name: 'GoldAch',
          category: 'gold',
          condition: { action: 'complete_event', timeRange: 'none', threshold: 1 },
        },
      ],
      badges: [],
    });
    vi.mocked(loadUserAchievementProgress).mockResolvedValue({
      a1: { current: 1, completedAt: null },
    });

    const { container, findByText } = render(<TitlesPage />);
    await findByText('儲存稱號');
    // 使用者目前沒有 titleBig，預設是（無）；照 A 先選擇大成就稱號再儲存。
    await waitFor(() => expect(container.querySelector('#title-big option[value="GoldAch"]')).toBeTruthy());
    fireEvent.change(container.querySelector('#title-big') as HTMLSelectElement, { target: { value: 'GoldAch' } });

    const saveBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('儲存稱號'),
    );
    expect(saveBtn).toBeTruthy();
    if (saveBtn) fireEvent.click(saveBtn);

    await waitFor(() => expect(saveTitlesMock).toHaveBeenCalledTimes(1));
    const call = saveTitlesMock.mock.calls[0];
    expect(call?.[0]).toBe('me');
    expect(call?.[1]).toBe('GoldAch');
  });

  it('變更 select 更新預覽', async () => {
    vi.mocked(loadAchievementDefs).mockResolvedValue({
      achievements: [
        {
          id: 'a1',
          name: 'GoldAch',
          category: 'gold',
          condition: { action: 'complete_event', timeRange: 'none', threshold: 1 },
        },
      ],
      badges: [],
    });
    vi.mocked(loadUserAchievementProgress).mockResolvedValue({
      a1: { current: 1, completedAt: null },
    });
    const { container, findByText } = render(<TitlesPage />);
    await findByText('儲存稱號');

    const bigSelect = container.querySelector('#title-big') as HTMLSelectElement;
    // 清成（無）→ 預覽不應含 gold 標籤
    fireEvent.change(bigSelect, { target: { value: '' } });
    await waitFor(() => {
      expect(container.querySelector('#title-preview .title-tag.title-gold')).toBeFalsy();
    });

    // 再選回 GoldAch → 預覽應含 gold 標籤
    fireEvent.change(bigSelect, { target: { value: 'GoldAch' } });
    await waitFor(() => {
      expect(
        container.querySelector('#title-preview .title-tag.title-gold')?.textContent,
      ).toBe('GoldAch');
    });
  });
});
