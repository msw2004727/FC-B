import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// T-037 退修 2：報名紀錄卡刷新成功後要通知 ProfilePage，頁首應到／完成／出席率才會跟著更新（A 的 renderActivityRecords
// 會同時更新頁首三格）。這裡只驗 ProfilePage 的接線：卡片呼叫 onSummaryRefreshed → 頁首拿到新的 summary。
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

const summaryOf = (completedCount: number) => ({
  uid: 'U-me',
  exists: true,
  sourceVersion: 1,
  expectedCount: 26,
  attendedCount: 22,
  completedCount,
  attendRate: 85,
  updatedAt: null,
});

vi.mock('../data/attendance-summary', () => ({
  loadUserAttendanceSummary: vi.fn(async () => summaryOf(14)),
}));

// 頁首換成只顯示「完成場次」的替身，直接證明 ProfilePage 傳下去的 summary 有沒有更新。
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
vi.mock('../components/legacy/LegacyActivityRecordsCard', () => ({
  LegacyActivityRecordsCard: ({
    onSummaryRefreshed,
  }: {
    onSummaryRefreshed?: (s: ReturnType<typeof summaryOf>) => void;
  }) => (
    <button type="button" id="stub-refresh" onClick={() => onSummaryRefreshed?.(summaryOf(16))}>
      refresh
    </button>
  ),
}));

import { _setDictLoaderForTest, setLocale } from '@/i18n/i18n';
import ProfilePage from './ProfilePage';

function existingDoc() {
  return {
    exists: () => true,
    id: 'U-me',
    data: () => ({
      uid: 'U-me', displayName: '王小明', gender: '男', birthday: '2000/01/02', region: '台北市',
    }),
  };
}

describe('ProfilePage：報名紀錄卡刷新後頁首統計一併更新', () => {
  beforeEach(async () => {
    _setDictLoaderForTest(null);
    localStorage.clear();
    await setLocale('zh-TW');
    firestore.getDoc.mockReset();
    firestore.getDocs.mockReset();
    firestore.getDoc.mockResolvedValue(existingDoc());
    firestore.getDocs.mockResolvedValue({ docs: [] });
  });

  afterEach(() => {
    cleanup();
  });

  it('掛載時頁首顯示讀到的 summary；卡片回報刷新後的新 summary → 頁首立刻換成新數字', async () => {
    render(<ProfilePage />);

    await waitFor(() => expect(document.getElementById('stub-header-done')?.textContent).toBe('14'));

    await act(async () => {
      fireEvent.click(screen.getByText('refresh'));
    });

    await waitFor(() => expect(document.getElementById('stub-header-done')?.textContent).toBe('16'));
  });
});
