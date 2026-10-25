import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// 退修 2 P2-1：這組測試走「真的 loadUserProfile」——它會吞掉 getDoc／getDocs 的 I/O 錯誤並回 null
// （profile-model.ts），所以網路暫時失敗時畫面拿到的是 null，不是 status==='error'。
// 因此只 mock Firestore 與 Firebase 入口，不 mock loadUserProfile，也不用 mockRejectedValue 把「loader 會丟錯」鎖進測試。
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
vi.mock('../data/attendance-summary', () => ({
  loadUserAttendanceSummary: vi.fn(async () => null),
}));

// 資料讀到之後才會渲染的各張卡，各自有獨立測試，這裡換成空元件。
vi.mock('../components/legacy/LegacyProfileHeader', () => ({
  LegacyProfileTopSection: () => <div id="stub-header" />,
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
vi.mock('../components/legacy/LegacyActivityRecordsCard', () => ({ LegacyActivityRecordsCard: () => null }));

import { _setDictLoaderForTest, setLocale } from '@/i18n/i18n';
import ProfilePage from './ProfilePage';

const UNAVAILABLE = '找不到資料，或此資料未公開。';
const LOAD_ERROR = '目前無法載入資料，請再試一次。';
const RETRY = '重新嘗試';

function existingDoc() {
  return {
    exists: () => true,
    id: 'U-me',
    data: () => ({
      uid: 'U-me', displayName: '王小明', gender: '男', birthday: '2000/01/02', region: '台北市',
    }),
  };
}

const missingDoc = { exists: () => false, id: 'U-me', data: () => undefined };
const emptyQuery = { docs: [] };

describe('ProfilePage：個人資料讀取失敗／查無資料（真的 loadUserProfile）', () => {
  beforeEach(async () => {
    _setDictLoaderForTest(null);
    localStorage.clear();
    await setLocale('zh-TW');
    firestore.getDoc.mockReset();
    firestore.getDocs.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it('網路暫時失敗（getDoc／getDocs 都丟錯，loader 吞掉回 null）：單一區塊＝找不到資料＋重試鈕，沒有「無法載入」alert', async () => {
    firestore.getDoc.mockRejectedValue(new Error('offline'));
    firestore.getDocs.mockRejectedValue(new Error('offline'));
    render(<ProfilePage />);

    expect(await screen.findByText(UNAVAILABLE)).toBeTruthy();
    expect(screen.getByRole('button', { name: RETRY })).toBeTruthy();
    expect(screen.queryByText(LOAD_ERROR)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(document.querySelectorAll('.profile-state')).toHaveLength(1);
    // 文字與重試鈕在同一個區塊內
    const block = document.querySelector('.profile-state');
    expect(block?.textContent).toContain(UNAVAILABLE);
    expect(block?.querySelector('button')?.textContent).toContain(RETRY);
  });

  it('點重試會再呼叫載入；這次讀得到就顯示個人頁（不再是找不到資料）', async () => {
    firestore.getDoc.mockRejectedValueOnce(new Error('offline')).mockResolvedValue(existingDoc());
    firestore.getDocs.mockRejectedValue(new Error('offline'));
    render(<ProfilePage />);

    fireEvent.click(await screen.findByRole('button', { name: RETRY }));
    await waitFor(() => expect(document.getElementById('profile-content')).toBeTruthy());
    expect(firestore.getDoc).toHaveBeenCalledTimes(2);
    expect(screen.queryByText(UNAVAILABLE)).toBeNull();
    expect(screen.queryByRole('button', { name: RETRY })).toBeNull();
  });

  it('真的查無此人（文件不存在、欄位查詢也沒有）：同樣是單一區塊＋重試鈕', async () => {
    firestore.getDoc.mockResolvedValue(missingDoc);
    firestore.getDocs.mockResolvedValue(emptyQuery);
    render(<ProfilePage />);

    expect(await screen.findByText(UNAVAILABLE)).toBeTruthy();
    expect(screen.getByRole('button', { name: RETRY })).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(document.querySelectorAll('.profile-state')).toHaveLength(1);

    const callsBefore = firestore.getDoc.mock.calls.length;
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: RETRY }));
    });
    await waitFor(() => expect(firestore.getDoc.mock.calls.length).toBeGreaterThan(callsBefore));
  });
});
