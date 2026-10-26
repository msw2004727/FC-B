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

// ── Callable／Toast mock：重新整理要走 refreshMyActivityRecords（照 A refreshMyActivityRecords）──
vi.mock('@/data/callables', () => ({ callFn: vi.fn() }));
vi.mock('@/ui/Toast', () => ({ toast: { show: vi.fn() } }));

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
import { callFn } from '@/data/callables';
import { toast } from '@/ui/Toast';

import { LegacyActivityRecordsCard } from './LegacyActivityRecordsCard';

const mockedLoadUserStats = vi.mocked(loadUserStats);
const mockedLoadSummary = vi.mocked(loadUserAttendanceSummary);
const mockedCallFn = vi.mocked(callFn);
const mockedToastShow = vi.mocked(toast.show);

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
        { _docId: 'r1', eventId: 'e1', status: 'registered', name: 'LiveEvent', date: '01/01', uid: 'u1' },
        { _docId: 'r2', eventId: 'e2', status: 'cancelled', name: 'CancelledOne', date: '02/01', uid: 'u1' },
      ],
      attendanceRecords: [],
      events: {
        e1: { status: 'open', date: '2024/01/01 19:00~21:00' },
        e2: { status: 'ended', date: '2024/02/01 19:00~21:00' },
      },
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

  it('重新整理鈕：先呼叫 refreshMyActivityRecords（A 的補齊報名紀錄＋重算統計），再重讀 loadUserStats／summary', async () => {
    mockedLoadUserStats.mockResolvedValue(emptyStats());
    mockedLoadSummary.mockResolvedValue(null);
    mockedCallFn.mockResolvedValue({ success: true, created: 0, updated: 0 } as never);

    render(<LegacyActivityRecordsCard uid="u1" />);
    fireEvent.click(getCollapseToggle());
    await waitFor(() => expect(mockedLoadUserStats).toHaveBeenCalledTimes(1));
    expect(mockedCallFn).not.toHaveBeenCalled();
    const summaryCallsBeforeRefresh = mockedLoadSummary.mock.calls.length;

    // Callable 還沒完成（deferred）時，不可以先重讀；完成後才重讀
    let resolveCallable: (v: unknown) => void = () => {};
    mockedCallFn.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveCallable = resolve;
        }) as never,
    );
    fireEvent.click(document.getElementById('my-records-refresh') as HTMLElement);
    await waitFor(() =>
      expect(mockedCallFn).toHaveBeenCalledWith('refreshMyActivityRecords', {}),
    );
    await new Promise((r) => setTimeout(r, 30));
    expect(mockedLoadUserStats).toHaveBeenCalledTimes(1);
    expect(mockedLoadSummary.mock.calls.length).toBe(summaryCallsBeforeRefresh);

    resolveCallable({ success: true, created: 0, updated: 0 });
    await waitFor(() => expect(mockedLoadUserStats).toHaveBeenCalledTimes(2));
    expect(mockedLoadSummary.mock.calls.length).toBeGreaterThan(summaryCallsBeforeRefresh);
  });

  it('刷新後重讀 summary 一律 fresh（不沿用刷新前就已發出的請求）', async () => {
    mockedLoadUserStats.mockResolvedValue(emptyStats());
    mockedLoadSummary.mockResolvedValue(null);
    mockedCallFn.mockResolvedValue({ success: true, created: 0, updated: 0 } as never);
    render(<LegacyActivityRecordsCard uid="u1" />);
    await waitFor(() => expect(mockedLoadSummary).toHaveBeenCalledTimes(1));
    expect(mockedLoadSummary).toHaveBeenLastCalledWith('u1');

    fireEvent.click(document.getElementById('my-records-refresh') as HTMLElement);
    await waitFor(() => expect(mockedLoadUserStats).toHaveBeenCalledTimes(1));
    expect(mockedLoadSummary).toHaveBeenLastCalledWith('u1', { fresh: true });
  });

  it('重新整理結果 toast：有新增或更新→「報名紀錄已更新」；沒有→「報名紀錄已是最新」', async () => {
    mockedLoadUserStats.mockResolvedValue(emptyStats());
    // summary 讀得到才算整體成功（讀不到是部分失敗，另有提示，見 races 測試 F2）
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

    mockedCallFn.mockResolvedValueOnce({ success: true, created: 1, updated: 0 } as never);
    fireEvent.click(document.getElementById('my-records-refresh') as HTMLElement);
    await waitFor(() =>
      expect(mockedToastShow).toHaveBeenCalledWith({ message: '報名紀錄已更新' }),
    );

    mockedToastShow.mockClear();
    mockedCallFn.mockResolvedValueOnce({ success: true, created: 0, updated: 0 } as never);
    fireEvent.click(document.getElementById('my-records-refresh') as HTMLElement);
    await waitFor(() =>
      expect(mockedToastShow).toHaveBeenCalledWith({ message: '報名紀錄已是最新' }),
    );
  });

  it('重新整理太頻繁（resource-exhausted）→ 顯示等待秒數，且不重讀', async () => {
    mockedLoadUserStats.mockResolvedValue(emptyStats());
    mockedLoadSummary.mockResolvedValue(null);
    render(<LegacyActivityRecordsCard uid="u1" />);

    mockedCallFn.mockRejectedValueOnce(
      Object.assign(new Error('too soon'), {
        code: 'functions/resource-exhausted',
        details: { retryAfterSeconds: 30 },
      }),
    );
    fireEvent.click(document.getElementById('my-records-refresh') as HTMLElement);
    await waitFor(() =>
      expect(mockedToastShow).toHaveBeenCalledWith({ message: '請 30 秒後再刷新' }),
    );
    expect(mockedLoadUserStats).not.toHaveBeenCalled();

    mockedToastShow.mockClear();
    mockedCallFn.mockRejectedValueOnce(
      Object.assign(new Error('too soon'), { code: 'resource-exhausted' }),
    );
    fireEvent.click(document.getElementById('my-records-refresh') as HTMLElement);
    await waitFor(() =>
      expect(mockedToastShow).toHaveBeenCalledWith({ message: '刷新太頻繁，請稍後再試' }),
    );
  });

  it('重新整理失敗（其它錯誤）→「報名紀錄刷新失敗」，按鈕恢復可按', async () => {
    mockedLoadUserStats.mockResolvedValue(emptyStats());
    mockedLoadSummary.mockResolvedValue(null);
    render(<LegacyActivityRecordsCard uid="u1" />);

    mockedCallFn.mockRejectedValueOnce(new Error('boom'));
    const btn = document.getElementById('my-records-refresh') as HTMLButtonElement;
    fireEvent.click(btn);
    await waitFor(() =>
      expect(mockedToastShow).toHaveBeenCalledWith({ message: '報名紀錄刷新失敗' }),
    );
    await waitFor(() => expect(btn.disabled).toBe(false));
  });

  it('重新整理進行中按鈕 disabled＋spinning，避免連點重複呼叫', async () => {
    mockedLoadUserStats.mockResolvedValue(emptyStats());
    mockedLoadSummary.mockResolvedValue(null);
    let release: (v: unknown) => void = () => {};
    mockedCallFn.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }) as never,
    );
    render(<LegacyActivityRecordsCard uid="u1" />);

    const btn = document.getElementById('my-records-refresh') as HTMLButtonElement;
    fireEvent.click(btn);
    await waitFor(() => expect(btn.disabled).toBe(true));
    expect(btn.classList.contains('spinning')).toBe(true);
    fireEvent.click(btn);
    expect(mockedCallFn).toHaveBeenCalledTimes(1);

    release({ success: true, created: 0, updated: 0 });
    await waitFor(() => expect(btn.disabled).toBe(false));
    expect(btn.classList.contains('spinning')).toBe(false);
  });

  it('收合狀態就載入 summary：標題列「資料更新」立即顯示統計時間（照 A 常駐監聽），不載入紀錄清單', async () => {
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
    await waitFor(() => {
      expect(screen.getByText('資料更新 2024/01/05 09:07')).toBeTruthy();
    });
    expect(mockedLoadSummary).toHaveBeenCalledWith('u1');
    expect(mockedLoadUserStats).not.toHaveBeenCalled();
  });

  it('已在收合狀態讀到 summary 時，第一次展開只讀紀錄、不重複讀 summary', async () => {
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
    await waitFor(() => {
      expect(screen.getByText('資料更新 2024/01/05 09:07')).toBeTruthy();
    });
    fireEvent.click(getCollapseToggle());
    await waitFor(() => expect(mockedLoadUserStats).toHaveBeenCalledTimes(1));
    expect(mockedLoadSummary).toHaveBeenCalledTimes(1);
  });

  it('超過 10 筆時顯示分頁「‹ p / total ›」且可按下一頁', async () => {
    const activityRecords = Array.from({ length: 15 }, (_, i) => ({
      _docId: `r${i}`,
      eventId: `e${i}`,
      status: 'registered' as const,
      name: `E${i}`,
      date: `01/${String(i + 1).padStart(2, '0')}`,
      uid: 'u1',
    }));
    const events = Object.fromEntries(
      activityRecords.map((r, i) => [
        r.eventId,
        { status: 'open', date: `2024/01/${String(i + 1).padStart(2, '0')} 19:00~21:00` },
      ]),
    );
    mockedLoadUserStats.mockResolvedValue({
      uid: 'u1',
      activityRecords,
      attendanceRecords: [],
      events,
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

  describe('標題列鍵盤操作（T-048 F6）', () => {
    beforeEach(() => {
      mockedLoadUserStats.mockResolvedValue(emptyStats());
      mockedLoadSummary.mockResolvedValue(null);
      mockedCallFn.mockResolvedValue({ success: true, created: 0, updated: 0 } as never);
    });

    it('焦點在內部按鈕（重新整理、?）時按 Enter／Space：不切換展開、不 preventDefault（按鈕維持原生行為）', async () => {
      render(<LegacyActivityRecordsCard uid="u1" />);
      const header = getCollapseToggle();
      const refresh = document.getElementById('my-records-refresh') as HTMLButtonElement;
      const info = screen.getByTestId('profile-info-btn');

      for (const target of [refresh, info]) {
        for (const key of ['Enter', ' ']) {
          // fireEvent 回傳 false＝事件被 preventDefault（瀏覽器會因此不再對按鈕觸發 click）
          expect(fireEvent.keyDown(target, { key })).toBe(true);
          expect(header.getAttribute('aria-expanded')).toBe('false');
        }
      }
      expect(mockedLoadUserStats).not.toHaveBeenCalled();

      // 按鈕自己的 click 照常觸發，且不會冒泡成展開／收合
      fireEvent.click(refresh);
      await waitFor(() => expect(mockedCallFn).toHaveBeenCalledTimes(1));
      expect(header.getAttribute('aria-expanded')).toBe('false');
    });

    it('焦點在標題列本身：Enter 展開、Space 收合，且 preventDefault', async () => {
      render(<LegacyActivityRecordsCard uid="u1" />);
      const header = getCollapseToggle();

      expect(fireEvent.keyDown(header, { key: 'Enter' })).toBe(false);
      expect(header.getAttribute('aria-expanded')).toBe('true');
      await waitFor(() => expect(mockedLoadUserStats).toHaveBeenCalledTimes(1));

      expect(fireEvent.keyDown(header, { key: ' ' })).toBe(false);
      expect(header.getAttribute('aria-expanded')).toBe('false');

      // 其它按鍵不處理
      expect(fireEvent.keyDown(header, { key: 'a' })).toBe(true);
      expect(header.getAttribute('aria-expanded')).toBe('false');
    });
  });
});
