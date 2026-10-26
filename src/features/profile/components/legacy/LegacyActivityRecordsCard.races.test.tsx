import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render as preactRender } from 'preact';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';

// 退修 1：競態與錯誤路徑（換 uid、舊請求延後完成、Callable 期間卸載、刷新沿用舊 summary、Callable 成功後重讀失敗）。
// T-048：summary 單獨失敗的部分失敗提示（F2）、換 uid 第一次 render 的更新時間（F8）。

vi.mock('@/features/profile/components/legacy/ProfileInfoButton', () => ({
  ProfileInfoButton: () => <button data-testid="profile-info-btn">?</button>,
}));
vi.mock('@/data/callables', () => ({ callFn: vi.fn() }));
vi.mock('@/ui/Toast', () => ({ toast: { show: vi.fn() } }));
vi.mock('@/features/profile/data/activity-records', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/features/profile/data/activity-records')>();
  return { ...actual, loadUserStats: vi.fn() };
});
vi.mock('@/features/profile/data/attendance-summary', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/features/profile/data/attendance-summary')>();
  return { ...actual, loadUserAttendanceSummary: vi.fn() };
});

import { callFn } from '@/data/callables';
import {
  loadUserStats,
  type UserStatsSnapshot,
} from '@/features/profile/data/activity-records';
import {
  loadUserAttendanceSummary,
  type UserAttendanceSummary,
} from '@/features/profile/data/attendance-summary';
import { toast } from '@/ui/Toast';

import { LegacyActivityRecordsCard } from './LegacyActivityRecordsCard';

const mockedLoadUserStats = vi.mocked(loadUserStats);
const mockedLoadSummary = vi.mocked(loadUserAttendanceSummary);
const mockedCallFn = vi.mocked(callFn);
const mockedToastShow = vi.mocked(toast.show);

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (v: T) => void;
  reject: (e: unknown) => void;
}
function deferred<T>(): Deferred<T> {
  let resolve: (v: T) => void = () => {};
  let reject: (e: unknown) => void = () => {};
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function statsWith(uid: string, name: string, eventId = 'e1'): UserStatsSnapshot {
  return {
    uid,
    activityRecords: [
      { _docId: `${uid}-${eventId}`, eventId, status: 'cancelled', name, date: '01/01', uid },
    ],
    attendanceRecords: [],
    events: { [eventId]: { status: 'ended', date: '2026/01/01 19:00' } },
  };
}

function summaryOf(uid: string, updatedAt: Date): UserAttendanceSummary {
  return {
    uid,
    exists: true,
    sourceVersion: 1,
    expectedCount: 3,
    attendedCount: 2,
    completedCount: 1,
    attendRate: 67,
    updatedAt,
  };
}

const toggle = (): Element => document.querySelector('.profile-collapse-toggle') as Element;
const refreshBtn = (): HTMLButtonElement =>
  document.getElementById('my-records-refresh') as HTMLButtonElement;

describe('LegacyActivityRecordsCard 競態與錯誤路徑', () => {
  beforeEach(() => {
    document.documentElement.lang = 'zh-TW';
    vi.clearAllMocks();
    mockedLoadSummary.mockResolvedValue(null);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('Callable 成功但重讀失敗：提示「已修復但重新讀取失敗」；再按一次只重讀、不再打 Callable', async () => {
    mockedCallFn.mockResolvedValue({ success: true, created: 2, updated: 0 } as never);
    mockedLoadUserStats.mockRejectedValueOnce(new Error('network'));
    mockedLoadUserStats.mockResolvedValueOnce(statsWith('u1', 'Recovered'));
    mockedLoadSummary.mockResolvedValue(summaryOf('u1', new Date(2026, 5, 1, 12, 0, 0)));
    render(<LegacyActivityRecordsCard uid="u1" />);

    fireEvent.click(refreshBtn());
    await waitFor(() =>
      expect(mockedToastShow).toHaveBeenCalledWith({
        message: '報名紀錄已修復，但重新讀取失敗，請再按一次重新整理',
      }),
    );
    expect(mockedCallFn).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(refreshBtn().disabled).toBe(false));

    // 再按：Callable 已成功過 → 只重讀（避免撞上伺服器冷卻）
    mockedToastShow.mockClear();
    fireEvent.click(refreshBtn());
    await waitFor(() => expect(mockedLoadUserStats).toHaveBeenCalledTimes(2));
    expect(mockedCallFn).toHaveBeenCalledTimes(1);
    // 重讀成功 → 照第一次 Callable 的結果（created 2）顯示「已更新」
    await waitFor(() =>
      expect(mockedToastShow).toHaveBeenCalledWith({ message: '報名紀錄已更新' }),
    );

    // 之後再按一次：恢復正常流程（先打 Callable）
    mockedLoadUserStats.mockResolvedValue(statsWith('u1', 'Recovered'));
    mockedCallFn.mockResolvedValueOnce({ success: true, created: 0, updated: 0 } as never);
    fireEvent.click(refreshBtn());
    await waitFor(() => expect(mockedCallFn).toHaveBeenCalledTimes(2));
  });

  it('Callable 期間元件卸載：成功後不再重讀、不再發出任何讀取', async () => {
    const callable = deferred<unknown>();
    mockedCallFn.mockReturnValueOnce(callable.promise as never);
    mockedLoadUserStats.mockResolvedValue(statsWith('u1', 'X'));
    const { unmount } = render(<LegacyActivityRecordsCard uid="u1" />);
    await waitFor(() => expect(mockedLoadSummary).toHaveBeenCalledTimes(1));

    fireEvent.click(refreshBtn());
    await waitFor(() => expect(mockedCallFn).toHaveBeenCalledTimes(1));
    unmount();
    callable.resolve({ success: true, created: 1, updated: 0 });
    await new Promise((r) => setTimeout(r, 30));

    expect(mockedLoadUserStats).not.toHaveBeenCalled();
    expect(mockedLoadSummary).toHaveBeenCalledTimes(1); // 只有掛載時那次
    expect(mockedToastShow).not.toHaveBeenCalled();
  });

  it('Callable 期間換 uid：成功後不替舊 uid 重讀，也不影響新 uid', async () => {
    const callable = deferred<unknown>();
    mockedCallFn.mockReturnValueOnce(callable.promise as never);
    mockedLoadUserStats.mockResolvedValue(statsWith('u2', 'Two'));
    const { rerender } = render(<LegacyActivityRecordsCard uid="u1" />);
    await waitFor(() => expect(mockedLoadSummary).toHaveBeenCalledWith('u1'));

    fireEvent.click(refreshBtn());
    await waitFor(() => expect(mockedCallFn).toHaveBeenCalledTimes(1));
    rerender(<LegacyActivityRecordsCard uid="u2" />);
    callable.resolve({ success: true, created: 1, updated: 0 });
    await new Promise((r) => setTimeout(r, 30));

    expect(mockedLoadUserStats).not.toHaveBeenCalled();
    expect(mockedToastShow).not.toHaveBeenCalled();
    await waitFor(() => expect(refreshBtn().disabled).toBe(false));
  });

  it('同一元件換 uid：舊請求延後完成，不可把前一人的清單寫進新 uid 的畫面', async () => {
    const slowU1 = deferred<UserStatsSnapshot>();
    mockedLoadUserStats.mockImplementation((uid: string) =>
      uid === 'u1' ? slowU1.promise : Promise.resolve(statsWith('u2', 'U2-Event', 'e2')),
    );
    const { rerender } = render(<LegacyActivityRecordsCard uid="u1" />);
    fireEvent.click(toggle());
    await waitFor(() => expect(mockedLoadUserStats).toHaveBeenCalledWith('u1'));

    rerender(<LegacyActivityRecordsCard uid="u2" />);
    // 換人後卡片回到收合、未載入
    const content = document.querySelector('.profile-collapse-content') as HTMLElement;
    await waitFor(() => expect(content.style.display).toBe('none'));

    slowU1.resolve(statsWith('u1', 'U1-Event'));
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.queryByText('U1-Event')).toBeNull();

    // 展開 u2：只看到 u2 的資料
    fireEvent.click(toggle());
    await waitFor(() => expect(mockedLoadUserStats).toHaveBeenCalledWith('u2'));
    await waitFor(() => expect(screen.getByText('U2-Event')).toBeTruthy());
    expect(screen.queryByText('U1-Event')).toBeNull();
  });

  it('同一元件換 uid：舊 uid 的 summary 延後完成，不可蓋掉新 uid 的「資料更新」', async () => {
    const slowU1 = deferred<UserAttendanceSummary | null>();
    mockedLoadSummary.mockImplementation((uid: string) =>
      uid === 'u1'
        ? slowU1.promise
        : Promise.resolve(summaryOf('u2', new Date(2026, 1, 2, 10, 0, 0))),
    );
    const { rerender } = render(<LegacyActivityRecordsCard uid="u1" />);
    rerender(<LegacyActivityRecordsCard uid="u2" />);
    await waitFor(() => expect(screen.getByText('資料更新 2026/02/02 10:00')).toBeTruthy());

    slowU1.resolve(summaryOf('u1', new Date(2025, 4, 5, 8, 0, 0)));
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.getByText('資料更新 2026/02/02 10:00')).toBeTruthy();
    expect(screen.queryByText('資料更新 2025/05/05 08:00')).toBeNull();
  });

  it('換 uid 會清掉上一人的頁碼與篩選', async () => {
    const many = (uid: string): UserStatsSnapshot => ({
      uid,
      activityRecords: Array.from({ length: 15 }, (_, i) => ({
        _docId: `${uid}-${i}`,
        eventId: `e${i}`,
        status: 'cancelled',
        name: `${uid}-E${i}`,
        date: '01/01',
        uid,
      })),
      attendanceRecords: [],
      events: Object.fromEntries(
        Array.from({ length: 15 }, (_, i) => [
          `e${i}`,
          { status: 'ended', date: `2026/01/${String(i + 1).padStart(2, '0')} 19:00` },
        ]),
      ),
    });
    mockedLoadUserStats.mockImplementation((uid: string) => Promise.resolve(many(uid)));
    const { rerender } = render(<LegacyActivityRecordsCard uid="u1" />);
    fireEvent.click(toggle());
    await waitFor(() => expect(screen.getByText('1 / 2')).toBeTruthy());
    fireEvent.click(screen.getByText('›'));
    await waitFor(() => expect(screen.getByText('2 / 2')).toBeTruthy());

    rerender(<LegacyActivityRecordsCard uid="u2" />);
    fireEvent.click(toggle());
    await waitFor(() => expect(mockedLoadUserStats).toHaveBeenCalledWith('u2'));
    await waitFor(() => expect(screen.getByText('1 / 2')).toBeTruthy());
  });

  it('刷新成功後回到第 1 頁（照 A renderActivityRecords(filter, 1)），篩選維持不變', async () => {
    const many = (): UserStatsSnapshot => ({
      uid: 'u1',
      activityRecords: Array.from({ length: 15 }, (_, i) => ({
        _docId: `r${i}`,
        eventId: `e${i}`,
        status: 'cancelled',
        name: `E${i}`,
        date: '01/01',
        uid: 'u1',
      })),
      attendanceRecords: [],
      events: Object.fromEntries(
        Array.from({ length: 15 }, (_, i) => [
          `e${i}`,
          { status: 'ended', date: `2026/01/${String(i + 1).padStart(2, '0')} 19:00` },
        ]),
      ),
    });
    mockedLoadUserStats.mockImplementation(() => Promise.resolve(many()));
    mockedCallFn.mockResolvedValue({ success: true, created: 0, updated: 0 } as never);
    render(<LegacyActivityRecordsCard uid="u1" />);
    fireEvent.click(toggle());
    fireEvent.click(document.querySelector('button.tab[data-filter="cancelled"]') as HTMLElement);
    await waitFor(() => expect(screen.getByText('1 / 2')).toBeTruthy());
    fireEvent.click(screen.getByText('›'));
    await waitFor(() => expect(screen.getByText('2 / 2')).toBeTruthy());

    fireEvent.click(refreshBtn());
    await waitFor(() => expect(screen.getByText('1 / 2')).toBeTruthy());
    expect(
      document.querySelector('button.tab[data-filter="cancelled"]')?.classList.contains('active'),
    ).toBe(true);
  });

  describe('onSummaryRefreshed（把刷新取得的 fresh summary 交給父層更新頁首三格）', () => {
    const FRESH = summaryOf('u1', new Date(2026, 5, 1, 12, 0, 0));

    beforeEach(() => {
      mockedLoadSummary.mockImplementation((_uid: string, opts?: { fresh?: boolean }) =>
        Promise.resolve(opts?.fresh ? FRESH : null),
      );
      mockedLoadUserStats.mockResolvedValue(statsWith('u1', 'X'));
    });

    it('刷新成功（Callable 成功且重讀成功）→ 呼叫一次並帶 fresh summary；掛載與展開不呼叫', async () => {
      const onSummaryRefreshed = vi.fn();
      mockedCallFn.mockResolvedValue({ success: true, created: 0, updated: 0 } as never);
      render(<LegacyActivityRecordsCard uid="u1" onSummaryRefreshed={onSummaryRefreshed} />);
      fireEvent.click(toggle());
      await waitFor(() => expect(mockedLoadUserStats).toHaveBeenCalledTimes(1));
      expect(onSummaryRefreshed).not.toHaveBeenCalled();

      fireEvent.click(refreshBtn());
      await waitFor(() => expect(onSummaryRefreshed).toHaveBeenCalledTimes(1));
      expect(onSummaryRefreshed).toHaveBeenCalledWith(FRESH);
      // 呼叫發生在重讀完成之後（此時 toast 也已顯示）
      expect(mockedToastShow).toHaveBeenCalledWith({ message: '報名紀錄已是最新' });
    });

    it('沒傳 prop 也能正常刷新，不報錯', async () => {
      mockedCallFn.mockResolvedValue({ success: true, created: 1, updated: 0 } as never);
      render(<LegacyActivityRecordsCard uid="u1" />);
      fireEvent.click(refreshBtn());
      await waitFor(() =>
        expect(mockedToastShow).toHaveBeenCalledWith({ message: '報名紀錄已更新' }),
      );
    });

    it('Callable 失敗（冷卻中）或重讀失敗 → 不呼叫；之後只重讀成功才呼叫一次', async () => {
      const onSummaryRefreshed = vi.fn();
      render(<LegacyActivityRecordsCard uid="u1" onSummaryRefreshed={onSummaryRefreshed} />);

      mockedCallFn.mockRejectedValueOnce(
        Object.assign(new Error('too soon'), {
          code: 'functions/resource-exhausted',
          details: { retryAfterSeconds: 10 },
        }),
      );
      fireEvent.click(refreshBtn());
      await waitFor(() =>
        expect(mockedToastShow).toHaveBeenCalledWith({ message: '請 10 秒後再刷新' }),
      );
      expect(onSummaryRefreshed).not.toHaveBeenCalled();
      await waitFor(() => expect(refreshBtn().disabled).toBe(false));

      mockedCallFn.mockResolvedValueOnce({ success: true, created: 1, updated: 0 } as never);
      mockedLoadUserStats.mockRejectedValueOnce(new Error('network'));
      fireEvent.click(refreshBtn());
      await waitFor(() =>
        expect(mockedToastShow).toHaveBeenCalledWith({
          message: '報名紀錄已修復，但重新讀取失敗，請再按一次重新整理',
        }),
      );
      expect(onSummaryRefreshed).not.toHaveBeenCalled();
      await waitFor(() => expect(refreshBtn().disabled).toBe(false));

      // 只重讀這次成功 → 才通知父層
      fireEvent.click(refreshBtn());
      await waitFor(() => expect(onSummaryRefreshed).toHaveBeenCalledTimes(1));
      expect(onSummaryRefreshed).toHaveBeenCalledWith(FRESH);
      expect(mockedCallFn).toHaveBeenCalledTimes(2);
    });

    const PARTIAL = '報名紀錄已更新，但統計讀取失敗，請再按一次重新整理';

    it('F2：紀錄重讀成功但 summary 讀取失敗（null）→ 不顯示「已是最新」、顯示部分失敗提示，且不通知父層', async () => {
      const onSummaryRefreshed = vi.fn();
      mockedLoadSummary.mockResolvedValue(null);
      mockedCallFn.mockResolvedValue({ success: true, created: 0, updated: 0 } as never);
      render(<LegacyActivityRecordsCard uid="u1" onSummaryRefreshed={onSummaryRefreshed} />);
      fireEvent.click(refreshBtn());
      await waitFor(() => expect(mockedToastShow).toHaveBeenCalledWith({ message: PARTIAL }));
      expect(mockedToastShow).toHaveBeenCalledTimes(1);
      expect(mockedToastShow).not.toHaveBeenCalledWith({ message: '報名紀錄已是最新' });
      expect(mockedToastShow).not.toHaveBeenCalledWith({ message: '報名紀錄已更新' });
      expect(onSummaryRefreshed).not.toHaveBeenCalled();
      await waitFor(() => expect(refreshBtn().disabled).toBe(false));
    });

    it('F2：部分失敗後保留只讀重試——再按只重讀（Callable 不再被呼叫）；summary 成功後才清旗標並通知父層', async () => {
      const onSummaryRefreshed = vi.fn();
      let summaryReadable = false;
      mockedLoadSummary.mockImplementation((_uid: string, opts?: { fresh?: boolean }) =>
        Promise.resolve(opts?.fresh && summaryReadable ? FRESH : null),
      );
      mockedCallFn.mockResolvedValue({ success: true, created: 2, updated: 0 } as never);
      render(<LegacyActivityRecordsCard uid="u1" onSummaryRefreshed={onSummaryRefreshed} />);

      // 第一次：Callable 成功、紀錄重讀成功、summary 失敗 → 部分失敗提示
      fireEvent.click(refreshBtn());
      await waitFor(() => expect(mockedToastShow).toHaveBeenCalledWith({ message: PARTIAL }));
      expect(mockedCallFn).toHaveBeenCalledTimes(1);
      await waitFor(() => expect(refreshBtn().disabled).toBe(false));

      // 第二次：只重讀（不重打 Callable）；summary 仍失敗 → 仍是部分失敗，旗標保留
      mockedToastShow.mockClear();
      fireEvent.click(refreshBtn());
      await waitFor(() => expect(mockedToastShow).toHaveBeenCalledWith({ message: PARTIAL }));
      expect(mockedCallFn).toHaveBeenCalledTimes(1);
      expect(mockedLoadUserStats).toHaveBeenCalledTimes(2);
      expect(onSummaryRefreshed).not.toHaveBeenCalled();
      await waitFor(() => expect(refreshBtn().disabled).toBe(false));

      // 第三次：summary 讀得到 → 照第一次 Callable 的結果（created 2）顯示「已更新」並通知父層
      mockedToastShow.mockClear();
      summaryReadable = true;
      fireEvent.click(refreshBtn());
      await waitFor(() =>
        expect(mockedToastShow).toHaveBeenCalledWith({ message: '報名紀錄已更新' }),
      );
      expect(mockedCallFn).toHaveBeenCalledTimes(1);
      expect(onSummaryRefreshed).toHaveBeenCalledTimes(1);
      expect(onSummaryRefreshed).toHaveBeenCalledWith(FRESH);
      await waitFor(() => expect(refreshBtn().disabled).toBe(false));

      // 第四次：旗標已清，恢復正常流程（先打 Callable）
      fireEvent.click(refreshBtn());
      await waitFor(() => expect(mockedCallFn).toHaveBeenCalledTimes(2));
    });

    it('等待期間換 uid → 不把舊人的 summary 交給父層', async () => {
      const onSummaryRefreshed = vi.fn();
      const callable = deferred<unknown>();
      mockedCallFn.mockReturnValueOnce(callable.promise as never);
      const { rerender } = render(
        <LegacyActivityRecordsCard uid="u1" onSummaryRefreshed={onSummaryRefreshed} />,
      );
      fireEvent.click(refreshBtn());
      await waitFor(() => expect(mockedCallFn).toHaveBeenCalledTimes(1));
      rerender(<LegacyActivityRecordsCard uid="u2" onSummaryRefreshed={onSummaryRefreshed} />);
      callable.resolve({ success: true, created: 1, updated: 0 });
      await new Promise((r) => setTimeout(r, 30));
      expect(onSummaryRefreshed).not.toHaveBeenCalled();
    });
  });

  it('E1：Callable 期間換 uid，舊人的結果不得寫進「只重讀」旗標——新 uid 第一次刷新仍打 Callable，toast 不沿用舊人的 created', async () => {
    const callable = deferred<unknown>();
    mockedCallFn.mockReturnValueOnce(callable.promise as never);
    mockedLoadUserStats.mockResolvedValue(statsWith('u2', 'Two'));
    mockedLoadSummary.mockImplementation((uid: string) =>
      Promise.resolve(summaryOf(uid, new Date(2026, 5, 1, 12, 0, 0))),
    );
    const { rerender } = render(<LegacyActivityRecordsCard uid="u1" />);
    await waitFor(() => expect(mockedLoadSummary).toHaveBeenCalledWith('u1'));

    fireEvent.click(refreshBtn());
    await waitFor(() => expect(mockedCallFn).toHaveBeenCalledTimes(1));
    rerender(<LegacyActivityRecordsCard uid="u2" />);
    callable.resolve({ success: true, created: 5, updated: 0 }); // 舊人：有 5 筆新增
    await waitFor(() => expect(refreshBtn().disabled).toBe(false));
    await new Promise((r) => setTimeout(r, 30));
    expect(mockedLoadUserStats).not.toHaveBeenCalled();

    // 新 uid 第一次刷新：必須重新打 Callable（不能被誤判成「只重讀」），且結果是新人的（created 0）
    mockedCallFn.mockResolvedValueOnce({ success: true, created: 0, updated: 0 } as never);
    fireEvent.click(refreshBtn());
    await waitFor(() => expect(mockedCallFn).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(mockedToastShow).toHaveBeenCalledWith({ message: '報名紀錄已是最新' }),
    );
    expect(mockedToastShow).not.toHaveBeenCalledWith({ message: '報名紀錄已更新' });
  });

  it('E2：掛載時那次 summary 很慢、刷新後的較新 summary 先到——慢的晚到不可把畫面退回舊值', async () => {
    const slowMount = deferred<UserAttendanceSummary | null>();
    mockedLoadSummary.mockImplementation((_uid: string, opts?: { fresh?: boolean }) =>
      opts?.fresh
        ? Promise.resolve(summaryOf('u1', new Date(2026, 5, 1, 12, 0, 0)))
        : slowMount.promise,
    );
    mockedCallFn.mockResolvedValue({ success: true, created: 0, updated: 0 } as never);
    mockedLoadUserStats.mockResolvedValue(statsWith('u1', 'X'));
    render(<LegacyActivityRecordsCard uid="u1" />);

    fireEvent.click(refreshBtn());
    await waitFor(() => expect(screen.getByText('資料更新 2026/06/01 12:00')).toBeTruthy());

    slowMount.resolve(summaryOf('u1', new Date(2026, 0, 1, 8, 0, 0)));
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.getByText('資料更新 2026/06/01 12:00')).toBeTruthy();
    expect(screen.queryByText('資料更新 2026/01/01 08:00')).toBeNull();
  });

  it('掛載時讀到的 summary 超過 60 秒才展開 → 展開時重讀；60 秒內不重讀', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 0, 1, 12, 0, 0));
    mockedLoadUserStats.mockResolvedValue(statsWith('u1', 'X'));
    mockedLoadSummary.mockResolvedValue(summaryOf('u1', new Date(2026, 0, 1, 11, 59, 0)));

    // 情境 A：30 秒後展開 → 沿用掛載時讀到的
    const a = render(<LegacyActivityRecordsCard uid="u1" />);
    await waitFor(() => expect(screen.getByText('資料更新 2026/01/01 11:59')).toBeTruthy());
    vi.setSystemTime(new Date(2026, 0, 1, 12, 0, 30));
    fireEvent.click(toggle());
    await waitFor(() => expect(mockedLoadUserStats).toHaveBeenCalledTimes(1));
    expect(mockedLoadSummary).toHaveBeenCalledTimes(1);
    a.unmount();

    // 情境 B：掛載後過了 2 分鐘才展開 → 重讀 summary
    vi.clearAllMocks();
    vi.setSystemTime(new Date(2026, 0, 1, 13, 0, 0));
    mockedLoadUserStats.mockResolvedValue(statsWith('u1', 'X'));
    mockedLoadSummary.mockResolvedValue(summaryOf('u1', new Date(2026, 0, 1, 12, 59, 0)));
    render(<LegacyActivityRecordsCard uid="u1" />);
    await waitFor(() => expect(mockedLoadSummary).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByText('資料更新 2026/01/01 12:59')).toBeTruthy());
    vi.setSystemTime(new Date(2026, 0, 1, 13, 2, 0));
    fireEvent.click(toggle());
    await waitFor(() => expect(mockedLoadUserStats).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mockedLoadSummary).toHaveBeenCalledTimes(2));
  });

  it('F8：同一實例換 uid 的第一次 render（effect 清狀態之前），「資料更新」不得顯示前一人的時間', async () => {
    const slowU2 = deferred<UserAttendanceSummary | null>();
    mockedLoadSummary.mockImplementation((uid: string) =>
      uid === 'u1'
        ? Promise.resolve(summaryOf('u1', new Date(2025, 4, 5, 8, 0, 0)))
        : slowU2.promise,
    );
    // 直接用 preact render（不包 act）：Preact 的 effect 在繪製後才跑，所以 render() 回來時的 DOM
    // 就是「換 uid 的第一次 render」，這才抓得到 effect 清掉舊 summary 之前的畫面。
    const container = document.createElement('div');
    document.body.appendChild(container);
    try {
      preactRender(<LegacyActivityRecordsCard uid="u1" />, container);
      await waitFor(() =>
        expect(container.textContent).toContain('資料更新 2025/05/05 08:00'),
      );

      preactRender(<LegacyActivityRecordsCard uid="u2" />, container);
      expect(container.textContent).not.toContain('2025/05/05 08:00');
      expect(container.textContent).toContain('資料更新 --');

      // u2 自己的 summary 到了才顯示 u2 的時間
      slowU2.resolve(summaryOf('u2', new Date(2026, 1, 2, 10, 0, 0)));
      await waitFor(() =>
        expect(container.textContent).toContain('資料更新 2026/02/02 10:00'),
      );
    } finally {
      preactRender(null, container);
      container.remove();
    }
  });
});
