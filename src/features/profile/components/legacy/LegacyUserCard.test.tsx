import { render as preactRender } from 'preact';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/ui/Toast', () => ({ toast: { show: vi.fn() } }));
vi.mock('../../data/profile-model', () => ({ loadUserProfile: vi.fn() }));
vi.mock('../../data/activity-records', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../data/activity-records')>();
  return {
    formatUserAttendanceSummaryTime: actual.formatUserAttendanceSummaryTime,
    loadUserStats: vi.fn(),
    getFilteredRecords: vi.fn(() => []),
    RECORDS_PAGE_SIZE: 10,
  };
});
vi.mock('../../data/attendance-summary', () => ({
  loadUserAttendanceSummary: vi.fn(),
}));
vi.mock('../../data/viewer', () => ({ useViewer: vi.fn() }));
vi.mock('@/data/identity-settings', () => ({ useIdentitySettings: vi.fn(() => null) }));

import { toast } from '@/ui/Toast';

import { loadUserStats, getFilteredRecords } from '../../data/activity-records';
import { loadUserAttendanceSummary } from '../../data/attendance-summary';
import { loadUserProfile, type UserProfile } from '../../data/profile-model';
import { useViewer, type ViewerView } from '../../data/viewer';

import { LegacyUserCard } from './LegacyUserCard';

function makeViewer(overrides: Partial<ViewerView> = {}): ViewerView {
  return {
    uid: 'viewer-uid',
    role: 'user',
    displayName: 'viewer',
    pictureUrl: null,
    capabilities: [],
    hasPermission: () => false,
    ...overrides,
  } as unknown as ViewerView;
}

function makeProfile(overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    uid: 'target-uid',
    name: 'Bob',
    _docId: 'target-uid',
    lastActive: null,
    displayName: 'Bob',
    phone: '0912345678',
    gender: '男',
    birthday: '1990-01-01',
    region: '台北市',
    sports: '籃球',
    createdAt: null,
    role: 'user',
    pictureUrl: 'https://example.com/bob.jpg',
    ...overrides,
  };
}

describe('LegacyUserCard（照 A showUserProfile）', () => {
  beforeEach(() => {
    document.documentElement.lang = 'zh-TW';
    vi.clearAllMocks();
    vi.mocked(loadUserProfile).mockResolvedValue(makeProfile());
    vi.mocked(loadUserStats).mockResolvedValue({
      uid: 'target-uid',
      activityRecords: [],
      attendanceRecords: [],
    });
    vi.mocked(loadUserAttendanceSummary).mockResolvedValue({
      uid: 'target-uid',
      exists: true,
      sourceVersion: 1,
      expectedCount: 5,
      attendedCount: 4,
      completedCount: 4,
      attendRate: 80,
      updatedAt: null,
    });
    vi.mocked(getFilteredRecords).mockReturnValue([]);
  });

  afterEach(() => {
    cleanup();
  });

  it('一般登入者看他人 → DOM 中沒有「聯繫方式」列與電話', async () => {
    vi.mocked(useViewer).mockReturnValue(makeViewer({ uid: 'viewer-uid', role: 'user' }));
    const { container } = render(<LegacyUserCard uid="target-uid" />);
    await waitFor(() => expect(container.querySelector('.uc-header')).toBeTruthy());

    expect(container.textContent).toContain('基本資料');
    expect(container.textContent).toContain('加入時間');
    expect(container.textContent).not.toContain('聯繫方式');
    expect(container.textContent).not.toContain('0912345678');
  });

  it('本人看自己 → 有「聯繫方式」列與電話', async () => {
    vi.mocked(useViewer).mockReturnValue(makeViewer({ uid: 'target-uid', role: 'user' }));
    const { container } = render(<LegacyUserCard uid="target-uid" />);
    await waitFor(() => expect(container.querySelector('.uc-header')).toBeTruthy());

    expect(container.textContent).toContain('聯繫方式');
    expect(container.textContent).toContain('0912345678');
  });

  it('全域管理員（roleLevel 4）看他人 → 有「聯繫方式」列與電話', async () => {
    vi.mocked(useViewer).mockReturnValue(makeViewer({ uid: 'admin-uid', role: 'admin' }));
    const { container } = render(<LegacyUserCard uid="target-uid" />);
    await waitFor(() => expect(container.querySelector('.uc-header')).toBeTruthy());

    expect(container.textContent).toContain('聯繫方式');
    expect(container.textContent).toContain('0912345678');
  });

  it('對方 secondaryEnabled=true 時一般登入者仍看得到名片（不再整張隱藏）', async () => {
    vi.mocked(loadUserProfile).mockResolvedValue(
      makeProfile({ secondaryEnabled: true, secondaryIdentityEnabled: true }),
    );
    vi.mocked(useViewer).mockReturnValue(makeViewer({ uid: 'viewer-uid', role: 'user' }));
    const { container } = render(<LegacyUserCard uid="target-uid" />);
    await waitFor(() => expect(container.querySelector('.uc-header')).toBeTruthy());

    expect(container.textContent).toContain('Bob');
    expect(container.textContent).toContain('基本資料');
  });

  it('活動紀錄：初次不呼 loadUserStats；點毛玻璃後才呼叫', async () => {
    vi.mocked(useViewer).mockReturnValue(makeViewer({ uid: 'viewer-uid', role: 'user' }));
    const { container } = render(<LegacyUserCard uid="target-uid" />);
    await waitFor(() => expect(container.querySelector('.uc-header')).toBeTruthy());

    expect(loadUserStats).not.toHaveBeenCalled();
    expect(loadUserAttendanceSummary).not.toHaveBeenCalled();

    const overlays = Array.from(container.querySelectorAll('.uc-blur-overlay'));
    const recordBlur = overlays.find((el) => el.textContent?.includes('點擊載入活動記錄'));
    expect(recordBlur).toBeTruthy();
    if (recordBlur) fireEvent.click(recordBlur);

    await waitFor(() => expect(loadUserStats).toHaveBeenCalledWith('target-uid'));
    expect(loadUserAttendanceSummary).toHaveBeenCalledWith('target-uid');
  });

  it('統計三格照 A _renderUserAttendanceSummary：應到＝expectedCount、完成場次＝completedCount（不是簽到場次 attendedCount）、出席率＝attendRate', async () => {
    // 站長實測帳號形狀：應到 26、簽到 22、完成（簽到＋簽退）14、出席率 85%。
    vi.mocked(loadUserAttendanceSummary).mockResolvedValue({
      uid: 'target-uid',
      exists: true,
      sourceVersion: 1,
      expectedCount: 26,
      attendedCount: 22,
      completedCount: 14,
      attendRate: 85,
      updatedAt: null,
    });
    vi.mocked(useViewer).mockReturnValue(makeViewer({ uid: 'viewer-uid', role: 'user' }));
    const { container } = render(<LegacyUserCard uid="target-uid" />);
    await waitFor(() => expect(container.querySelector('.uc-header')).toBeTruthy());

    // 載入前三格都是 --
    expect(container.querySelector('#uc-stat-total')?.textContent).toBe('--');
    expect(container.querySelector('#uc-stat-done')?.textContent).toBe('--');
    expect(container.querySelector('#uc-stat-rate')?.textContent).toBe('--');

    const recordBlur = Array.from(container.querySelectorAll('.uc-blur-overlay')).find((el) =>
      el.textContent?.includes('點擊載入活動記錄'),
    );
    expect(recordBlur).toBeTruthy();
    if (recordBlur) fireEvent.click(recordBlur);

    await waitFor(() =>
      expect(container.querySelector('#uc-stat-total')?.textContent).toBe('26'),
    );
    expect(container.querySelector('#uc-stat-done')?.textContent).toBe('14');
    expect(container.querySelector('#uc-stat-rate')?.textContent).toBe('85%');
  });

  it('「資料更新」時間照 A _formatUserAttendanceSummaryTime：YYYY/MM/DD HH:mm（含年份）', async () => {
    vi.mocked(loadUserAttendanceSummary).mockResolvedValue({
      uid: 'target-uid',
      exists: true,
      sourceVersion: 1,
      expectedCount: 5,
      attendedCount: 4,
      completedCount: 3,
      attendRate: 80,
      // Firestore Timestamp 形狀（正式資料的 updatedAt）
      updatedAt: { toDate: () => new Date(2026, 9, 26, 14, 30, 0) },
    });
    vi.mocked(useViewer).mockReturnValue(makeViewer({ uid: 'viewer-uid', role: 'user' }));
    const { container } = render(<LegacyUserCard uid="target-uid" />);
    await waitFor(() => expect(container.querySelector('.uc-header')).toBeTruthy());
    expect(container.querySelector('#uc-records-updated-at')?.textContent).toBe('資料更新 --');

    const recordBlur = Array.from(container.querySelectorAll('.uc-blur-overlay')).find((el) =>
      el.textContent?.includes('點擊載入活動記錄'),
    );
    if (recordBlur) fireEvent.click(recordBlur);

    await waitFor(() =>
      expect(container.querySelector('#uc-records-updated-at')?.textContent).toBe(
        '資料更新 2026/10/26 14:30',
      ),
    );
  });

  it('他人名片的清單一律以公開模式過濾（getFilteredRecords 第三參數 true：不顯示報名中／未出席）', async () => {
    vi.mocked(useViewer).mockReturnValue(makeViewer({ uid: 'viewer-uid', role: 'user' }));
    const { container } = render(<LegacyUserCard uid="target-uid" />);
    await waitFor(() => expect(container.querySelector('.uc-header')).toBeTruthy());
    const recordBlur = Array.from(container.querySelectorAll('.uc-blur-overlay')).find((el) =>
      el.textContent?.includes('點擊載入活動記錄'),
    );
    if (recordBlur) fireEvent.click(recordBlur);
    await waitFor(() => expect(getFilteredRecords).toHaveBeenCalled());
    for (const call of vi.mocked(getFilteredRecords).mock.calls) {
      expect(call[2]).toBe(true);
    }
    // 切換頁籤後仍是公開模式
    fireEvent.click(container.querySelector('#uc-record-tabs button[data-filter="cancelled"]') as Element);
    await waitFor(() =>
      expect(vi.mocked(getFilteredRecords)).toHaveBeenLastCalledWith(
        expect.anything(),
        'cancelled',
        true,
      ),
    );
  });

  it('活動紀錄載入失敗：顯示「活動紀錄刷新失敗」toast（照 A refreshUserCardRecords），可再點擊重試', async () => {
    vi.mocked(loadUserStats).mockRejectedValueOnce(new Error('network'));
    vi.mocked(useViewer).mockReturnValue(makeViewer({ uid: 'viewer-uid', role: 'user' }));
    const { container } = render(<LegacyUserCard uid="target-uid" />);
    await waitFor(() => expect(container.querySelector('.uc-header')).toBeTruthy());
    const overlayOf = (): Element | undefined =>
      Array.from(container.querySelectorAll('.uc-blur-overlay')).find((el) =>
        el.textContent?.includes('點擊載入活動記錄'),
      );
    fireEvent.click(overlayOf() as Element);
    await waitFor(() =>
      expect(vi.mocked(toast.show)).toHaveBeenCalledWith({ message: '活動紀錄刷新失敗' }),
    );
    // 失敗後仍維持未載入（毛玻璃還在），再點一次能重試成功
    expect(overlayOf()).toBeTruthy();
    fireEvent.click(overlayOf() as Element);
    await waitFor(() => expect(overlayOf()).toBeUndefined());
    expect(vi.mocked(toast.show)).toHaveBeenCalledTimes(1);
  });

  it('同一元件換看另一個人：前一人還在飛的活動紀錄／統計延後完成，不可寫進新的名片', async () => {
    vi.mocked(loadUserProfile).mockImplementation(async (uid: string) =>
      makeProfile({ uid, _docId: uid, name: uid, displayName: uid }),
    );
    let resolveStatsA: (v: { uid: string; activityRecords: []; attendanceRecords: [] }) => void =
      () => {};
    vi.mocked(loadUserStats).mockImplementation((uid: string) =>
      uid === 'uid-a'
        ? new Promise((resolve) => {
          resolveStatsA = resolve as typeof resolveStatsA;
        })
        : Promise.resolve({ uid, activityRecords: [], attendanceRecords: [] }),
    );
    vi.mocked(loadUserAttendanceSummary).mockImplementation(async (uid: string) => ({
      uid,
      exists: true,
      sourceVersion: 1,
      expectedCount: uid === 'uid-a' ? 99 : 5,
      attendedCount: 4,
      completedCount: 3,
      attendRate: 80,
      updatedAt: null,
    }));
    vi.mocked(useViewer).mockReturnValue(makeViewer({ uid: 'viewer-uid', role: 'user' }));

    const { container, rerender } = render(<LegacyUserCard uid="uid-a" />);
    await waitFor(() => expect(container.querySelector('.uc-header')).toBeTruthy());
    const overlayOf = (): Element | undefined =>
      Array.from(container.querySelectorAll('.uc-blur-overlay')).find((el) =>
        el.textContent?.includes('點擊載入活動記錄'),
      );
    fireEvent.click(overlayOf() as Element);
    await waitFor(() => expect(loadUserStats).toHaveBeenCalledWith('uid-a'));

    // 還沒讀完就換看 uid-b
    rerender(<LegacyUserCard uid="uid-b" />);
    await waitFor(() => expect(container.textContent).toContain('uid-b'));
    await waitFor(() => expect(overlayOf()).toBeTruthy());

    // 前一人的結果現在才到：uid-b 的名片必須維持「尚未載入」
    resolveStatsA({ uid: 'uid-a', activityRecords: [], attendanceRecords: [] });
    await new Promise((r) => setTimeout(r, 30));
    expect(overlayOf()).toBeTruthy();
    expect(container.querySelector('#uc-stat-total')?.textContent).toBe('--');

    // 之後正常點擊載入 uid-b：顯示 uid-b 自己的統計
    fireEvent.click(overlayOf() as Element);
    await waitFor(() => expect(loadUserStats).toHaveBeenCalledWith('uid-b'));
    await waitFor(() => expect(container.querySelector('#uc-stat-total')?.textContent).toBe('5'));
  });

  it('T-048 F8：同一實例換看另一個人的第一次 render（effect 清狀態之前）就不顯示前一人的資料', async () => {
    let resolveB: (p: UserProfile | null) => void = () => {};
    vi.mocked(loadUserProfile).mockImplementation((uid: string) =>
      uid === 'uid-a'
        ? Promise.resolve(makeProfile({ uid, _docId: uid, name: 'Alice', displayName: 'Alice' }))
        : new Promise<UserProfile | null>((resolve) => {
          resolveB = resolve;
        }),
    );
    vi.mocked(useViewer).mockReturnValue(makeViewer({ uid: 'viewer-uid', role: 'user' }));

    // 直接用 preact render（不包 act）：effect 在繪製後才跑，render() 回來時的 DOM 就是換 uid 的第一次 render。
    const container = document.createElement('div');
    document.body.appendChild(container);
    try {
      preactRender(<LegacyUserCard uid="uid-a" />, container);
      await waitFor(() => expect(container.textContent).toContain('Alice'));

      preactRender(<LegacyUserCard uid="uid-b" />, container);
      expect(container.textContent).not.toContain('Alice');
      expect(container.textContent).toContain('載入中...');

      // uid-b 的讀取是在 effect 裡才發出的；等它發出（resolveB 才有效）再讓它完成
      await waitFor(() => expect(loadUserProfile).toHaveBeenCalledWith('uid-b'));
      resolveB(makeProfile({ uid: 'uid-b', _docId: 'uid-b', name: 'Bob2', displayName: 'Bob2' }));
      await waitFor(() => expect(container.textContent).toContain('Bob2'));
    } finally {
      preactRender(null, container);
      container.remove();
    }
  });

  it('profile.uid 與請求的 uid 不同（以 lineUserId／doc id 後備查詢到）仍正常顯示，不卡在載入中', async () => {
    vi.mocked(loadUserProfile).mockResolvedValue(
      makeProfile({ uid: 'doc-uid', _docId: 'doc-uid', name: 'Carol', displayName: 'Carol' }),
    );
    vi.mocked(useViewer).mockReturnValue(makeViewer({ uid: 'viewer-uid', role: 'user' }));

    const { container } = render(<LegacyUserCard uid="line-user-id" />);

    await waitFor(() => expect(container.textContent).toContain('Carol'));
    expect(container.querySelector('.uc-header')).toBeTruthy();
  });
});
