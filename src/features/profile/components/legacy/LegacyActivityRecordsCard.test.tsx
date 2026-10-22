import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';

// ── ProfileInfoButton mock（避免 createPortal 影響測試焦點） ──
vi.mock('@/features/profile/components/legacy/ProfileInfoButton', () => ({
  ProfileInfoButton: (p: { infoKey: string }) => (
    <button data-testid="profile-info-btn" data-key={p.infoKey}>
      ?
    </button>
  ),
}));

// ── data 層：保留純函式本體，僅 mock loadUserStats ──
vi.mock('@/features/profile/data/activity-records', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/features/profile/data/activity-records')>();
  return {
    ...actual,
    loadUserStats: vi.fn(),
  };
});

// ── attendance-summary：僅 mock loadUserAttendanceSummary（避免打真 Firestore） ──
vi.mock('@/features/profile/data/attendance-summary', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/features/profile/data/attendance-summary')>();
  return {
    ...actual,
    loadUserAttendanceSummary: vi.fn(),
  };
});

import {
  loadUserStats,
  type UserStatsSnapshot,
} from '@/features/profile/data/activity-records';
import { loadUserAttendanceSummary } from '@/features/profile/data/attendance-summary';

import { LegacyActivityRecordsCard } from './LegacyActivityRecordsCard';

const mockedLoadUserStats = vi.mocked(loadUserStats);
const mockedLoadSummary = vi.mocked(loadUserAttendanceSummary);

function emptyStats(uid = 'u1'): UserStatsSnapshot {
  return { uid, activityRecords: [], attendanceRecords: [] };
}

function getCollapseToggle(): Element {
  const el = document.querySelector('.profile-collapse-toggle');
  if (!el) throw new Error('collapse toggle not found');
  return el;
}

describe('LegacyActivityRecordsCard', () => {
  beforeEach(() => {
    document.documentElement.lang = 'zh-TW';
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('預設收起；標題列顯示「報名紀錄」、資料更新 --、重新整理鈕', () => {
    mockedLoadUserStats.mockResolvedValue(emptyStats());
    mockedLoadSummary.mockResolvedValue(null);

    render(<LegacyActivityRecordsCard uid="u1" />);

    expect(screen.getByText('報名紀錄')).toBeTruthy();
    expect(screen.getByText('資料更新 --')).toBeTruthy();
    expect(document.getElementById('my-records-refresh')).toBeTruthy();
    expect(document.getElementById('record-tabs')).toBeTruthy();
    expect(document.getElementById('my-activity-records')).toBeTruthy();

    const content = document.querySelector('.profile-collapse-content') as HTMLElement;
    expect(content.style.display).toBe('none');
    expect(mockedLoadUserStats).not.toHaveBeenCalled();
  });

  it('展開才呼叫 loadUserStats，載入中顯示「載入紀錄中...」', async () => {
    let resolveLoad: (v: UserStatsSnapshot) => void = () => {};
    const pending = new Promise<UserStatsSnapshot>((r) => {
      resolveLoad = r;
    });
    mockedLoadUserStats.mockReturnValue(pending);
    mockedLoadSummary.mockResolvedValue(null);

    render(<LegacyActivityRecordsCard uid="u1" />);
    fireEvent.click(getCollapseToggle());

    expect(mockedLoadUserStats).toHaveBeenCalledWith('u1');
    expect(screen.getByText('載入紀錄中...')).toBeTruthy();

    resolveLoad(emptyStats());
    await waitFor(() => {
      expect(screen.getByText('點擊頁籤查看紀錄')).toBeTruthy();
    });
  });

  it('載入失敗顯示「紀錄載入失敗，請按重新整理」', async () => {
    mockedLoadUserStats.mockRejectedValueOnce(new Error('boom'));
    mockedLoadSummary.mockResolvedValue(null);

    render(<LegacyActivityRecordsCard uid="u1" />);
    fireEvent.click(getCollapseToggle());

    await waitFor(() => {
      expect(screen.getByText('紀錄載入失敗，請按重新整理')).toBeTruthy();
    });
  });

  it('切換頁籤會重算清單', async () => {
    const stats: UserStatsSnapshot = {
      uid: 'u1',
      activityRecords: [
        { _docId: 'r1', eventId: 'e1', status: 'registered', name: 'LiveEvent', date: '2024-01-01T00:00:00Z', eventStatus: 'ongoing' },
        { _docId: 'r2', eventId: 'e2', status: 'cancelled', name: 'CancelledOne', date: '2024-02-01T00:00:00Z' },
      ],
      attendanceRecords: [],
    };
    mockedLoadUserStats.mockResolvedValue(stats);
    mockedLoadSummary.mockResolvedValue(null);

    render(<LegacyActivityRecordsCard uid="u1" />);
    fireEvent.click(getCollapseToggle());

    await waitFor(() => {
      expect(screen.getByText('LiveEvent')).toBeTruthy();
      expect(screen.getByText('CancelledOne')).toBeTruthy();
    });

    const cancelledTab = document.querySelector(
      'button.tab[data-filter="cancelled"]',
    ) as HTMLElement;
    fireEvent.click(cancelledTab);

    await waitFor(() => {
      expect(screen.queryByText('LiveEvent')).toBeNull();
      expect(screen.getByText('CancelledOne')).toBeTruthy();
    });
  });

  it('重新整理鈕會再次呼叫 loadUserStats／loadUserAttendanceSummary', async () => {
    mockedLoadUserStats.mockResolvedValue(emptyStats());
    mockedLoadSummary.mockResolvedValue(null);

    render(<LegacyActivityRecordsCard uid="u1" />);
    fireEvent.click(getCollapseToggle());
    await waitFor(() => expect(mockedLoadUserStats).toHaveBeenCalledTimes(1));
    expect(mockedLoadSummary).toHaveBeenCalledTimes(1);

    fireEvent.click(document.getElementById('my-records-refresh') as HTMLElement);
    await waitFor(() => expect(mockedLoadUserStats).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(mockedLoadSummary).toHaveBeenCalledTimes(2));
  });

  it('超過 10 筆時顯示分頁「‹ p / total ›」且可按下一頁', async () => {
    const activityRecords = Array.from({ length: 15 }, (_, i) => ({
      _docId: `r${i}`,
      eventId: `e${i}`,
      status: 'registered' as const,
      name: `E${i}`,
      date: `2024-01-${String(i + 1).padStart(2, '0')}T00:00:00Z`,
      eventStatus: 'ongoing',
    }));
    mockedLoadUserStats.mockResolvedValue({
      uid: 'u1',
      activityRecords,
      attendanceRecords: [],
    });
    mockedLoadSummary.mockResolvedValue(null);

    render(<LegacyActivityRecordsCard uid="u1" />);
    fireEvent.click(getCollapseToggle());

    await waitFor(() => expect(screen.getByText('1 / 2')).toBeTruthy());

    fireEvent.click(screen.getByText('›'));

    await waitFor(() => expect(screen.getByText('2 / 2')).toBeTruthy());
  });

  it('summary 更新時 #my-records-updated-at 格式照 A', async () => {
    mockedLoadUserStats.mockResolvedValue(emptyStats());
    mockedLoadSummary.mockResolvedValue({
      uid: 'u1',
      exists: true,
      sourceVersion: 1,
      expectedCount: 3,
      attendedCount: 2,
      completedCount: 2,
      attendRate: 67,
      updatedAt: new Date(2024, 0, 5, 9, 7, 0),
    });

    render(<LegacyActivityRecordsCard uid="u1" />);
    expect(screen.getByText('資料更新 --')).toBeTruthy();

    fireEvent.click(getCollapseToggle());
    await waitFor(() => {
      expect(screen.getByText('資料更新 2024/01/05 09:07')).toBeTruthy();
    });
  });
});
