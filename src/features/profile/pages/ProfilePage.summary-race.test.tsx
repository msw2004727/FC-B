import { cleanup, fireEvent, render, waitFor } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// T-048 F1：個人頁（ProfilePage）＋真實的報名紀錄卡。掛載時的 summary 讀取比「卡片刷新」晚完成時，
// 舊值不得蓋掉頁首剛更新的新數字（卡片與個人頁共用同一套發出序號保護）。
const firestore = vi.hoisted(() => ({
  getDoc: vi.fn(),
  getDocs: vi.fn(),
}));

vi.mock('firebase/firestore', () => ({
  doc: vi.fn(() => ({})),
  collection: vi.fn(() => ({})),
  query: vi.fn(() => ({})),
  where: vi.fn(() => ({})),
  limit: vi.fn(() => ({})),
  getDoc: firestore.getDoc,
  getDocs: firestore.getDocs,
}));
vi.mock('@/data/firebase', () => ({
  getFirebase: vi.fn(async () => ({ db: {} })),
}));
vi.mock('preact-iso', () => ({
  useLocation: () => ({ route: vi.fn() }),
}));
vi.mock('../data/viewer', () => ({
  useViewer: () => ({
    uid: 'U-me',
    role: 'user',
    roleLevel: 1,
    teamIds: new Set<string>(),
    capabilities: [],
    displayName: null,
    pictureUrl: null,
    hasPermission: () => false,
  }),
}));
vi.mock('@/data/callables', () => ({ callFn: vi.fn() }));
vi.mock('@/ui/Toast', () => ({ toast: { show: vi.fn() } }));
vi.mock('../components/legacy/ProfileInfoButton', () => ({
  ProfileInfoButton: () => <button type="button">?</button>,
}));
vi.mock('../data/activity-records', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../data/activity-records')>();
  return { ...actual, loadUserStats: vi.fn() };
});
vi.mock('../data/attendance-summary', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../data/attendance-summary')>();
  return { ...actual, loadUserAttendanceSummary: vi.fn() };
});

// 頁首換成只顯示「完成場次」的替身，直接證明 ProfilePage 傳下去的 summary 是哪一個。
vi.mock('../components/legacy/LegacyProfileHeader', () => ({
  LegacyProfileTopSection: ({ summary }: { summary: { completedCount: number } | null }) => (
    <div id="stub-header-done">{summary ? String(summary.completedCount) : '--'}</div>
  ),
}));
vi.mock('../components/legacy/LegacyProfileSocialAndRelated', () => ({
  LegacyRelatedActivities: () => null,
  LegacySocialGrid: () => null,
}));
vi.mock('../components/legacy/LegacyIdentityCard', () => ({ LegacyIdentityCard: () => null }));
vi.mock('../components/legacy/LegacyLineNotifyCard', () => ({ LegacyLineNotifyCard: () => null }));
vi.mock('../components/legacy/LegacyProfileCards', () => ({ LegacyProfileInfoCard: () => null }));
vi.mock('../components/legacy/LegacyFavoritesCard', () => ({ LegacyFavoritesCard: () => null }));
vi.mock('../components/legacy/LegacyApplicationsCard', () => ({ LegacyApplicationsCard: () => null }));
vi.mock('../components/legacy/LegacyCompanionsCard', () => ({ LegacyCompanionsCard: () => null }));

import { callFn } from '@/data/callables';
import { _setDictLoaderForTest, setLocale } from '@/i18n/i18n';
import { loadUserStats } from '../data/activity-records';
import { loadUserAttendanceSummary, type UserAttendanceSummary } from '../data/attendance-summary';
import ProfilePage from './ProfilePage';

const mockedLoadSummary = vi.mocked(loadUserAttendanceSummary);
const mockedLoadUserStats = vi.mocked(loadUserStats);
const mockedCallFn = vi.mocked(callFn);

function summaryOf(completedCount: number, updatedAt: Date): UserAttendanceSummary {
  return {
    uid: 'U-me',
    exists: true,
    sourceVersion: 1,
    expectedCount: 26,
    attendedCount: 22,
    completedCount,
    attendRate: 85,
    updatedAt,
  };
}

function existingDoc() {
  return {
    exists: () => true,
    id: 'U-me',
    data: () => ({
      uid: 'U-me', displayName: '王小明', gender: '男', birthday: '2000/01/02', region: '台北市',
    }),
  };
}

const headerDone = (): string | null => document.getElementById('stub-header-done')?.textContent ?? null;
const refreshBtn = (): HTMLButtonElement =>
  document.getElementById('my-records-refresh') as HTMLButtonElement;

describe('ProfilePage + 報名紀錄卡：頁首 summary 競態（T-048 F1）', () => {
  beforeEach(async () => {
    _setDictLoaderForTest(null);
    localStorage.clear();
    await setLocale('zh-TW');
    vi.clearAllMocks();
    firestore.getDoc.mockReset();
    firestore.getDocs.mockReset();
    firestore.getDoc.mockResolvedValue(existingDoc());
    firestore.getDocs.mockResolvedValue({ docs: [] });
    mockedLoadUserStats.mockResolvedValue({ uid: 'U-me', activityRecords: [], attendanceRecords: [] });
    mockedCallFn.mockResolvedValue({ success: true, created: 0, updated: 0 } as never);
  });

  afterEach(() => {
    cleanup();
  });

  it('掛載時的讀取很慢、卡片刷新後的新 summary 先到——慢的晚到不可把頁首退回舊數字', async () => {
    let resolveMount: (v: UserAttendanceSummary | null) => void = () => {};
    const slowMount = new Promise<UserAttendanceSummary | null>((resolve) => {
      resolveMount = resolve;
    });
    mockedLoadSummary.mockImplementation((_uid: string, opts?: { fresh?: boolean }) =>
      opts?.fresh
        ? Promise.resolve(summaryOf(16, new Date(2026, 5, 1, 12, 0, 0)))
        : slowMount,
    );

    render(<ProfilePage />);
    await waitFor(() => expect(refreshBtn()).toBeTruthy());
    // 個人頁與卡片的掛載 effect 都跑過（各發一次掛載讀取）才按，否則卡片會把刷新當成「換 uid 前」的請求丟棄
    await waitFor(() => expect(mockedLoadSummary).toHaveBeenCalledTimes(2));
    expect(headerDone()).toBe('--');

    fireEvent.click(refreshBtn());
    await waitFor(() => expect(headerDone()).toBe('16'));

    // 掛載時那次讀取現在才完成（舊值）：頁首與卡片的「資料更新」都必須維持刷新後的新值
    resolveMount(summaryOf(14, new Date(2026, 0, 1, 8, 0, 0)));
    await new Promise((r) => setTimeout(r, 30));
    expect(headerDone()).toBe('16');
    expect(document.getElementById('my-records-updated-at')?.textContent).toBe('資料更新 2026/06/01 12:00');
  });

  it('沒有刷新時，掛載讀取完成後頁首正常顯示（序號保護不擋第一次套用）', async () => {
    mockedLoadSummary.mockResolvedValue(summaryOf(14, new Date(2026, 0, 1, 8, 0, 0)));

    render(<ProfilePage />);

    await waitFor(() => expect(headerDone()).toBe('14'));
  });
});
