import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// 退修 2 P2-1：這組測試走「真的 loadUserProfile」——它會吞掉 getDoc／getDocs 的 I/O 錯誤並回 null
// （profile-model.ts），所以網路暫時失敗時畫面拿到的是 null，不是 status==='error'。
// 因此只 mock Firestore 與 Firebase 入口，不 mock loadUserProfile，也不用 mockRejectedValue 把「loader 會丟錯」鎖進測試。
const related = vi.hoisted(() => ({ calls: [] as string[] }));
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
const summary = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock('../data/attendance-summary', () => ({
  loadUserAttendanceSummary: summary.load,
}));

// 資料讀到之後才會渲染的各張卡，各自有獨立測試，這裡換成空元件。
vi.mock('../components/legacy/LegacyProfileHeader', () => ({
  LegacyProfileTopSection: () => <div id="stub-header" />,
}));
// 測試同步更新：11-06 個人頁改版，頁面改用 useRelatedActivitiesData／useMyTeamApplications 讀資料給圖示列。
vi.mock('../components/legacy/LegacyProfileSocialAndRelated', () => ({
  LegacyRelatedActivities: () => null,
  LegacySocialGrid: () => null,
  useRelatedActivitiesData: (uid: string) => {
    related.calls.push(uid);
    return { state: { status: 'loading' }, retry: () => {}, reload: () => {} };
  },
}));
vi.mock('../components/legacy/LegacyIdentityCard', () => ({ LegacyIdentityCard: () => null }));
vi.mock('../components/legacy/LegacyLineNotifyCard', () => ({ LegacyLineNotifyCard: () => null }));
vi.mock('../components/legacy/LegacyProfileCards', () => ({ LegacyProfileInfoCard: () => null }));
vi.mock('../components/legacy/LegacyFavoritesCard', () => ({ LegacyFavoritesCard: () => null }));
vi.mock('../components/legacy/LegacyApplicationsCard', () => ({
  LegacyApplicationsCard: () => null,
  useMyTeamApplications: () => null,
}));
vi.mock('../components/legacy/LegacyCompanionsCard', () => ({ LegacyCompanionsCard: () => null }));
vi.mock('../components/legacy/LegacyActivityRecordsCard', () => ({ LegacyActivityRecordsCard: () => null }));

import { _setDictLoaderForTest, setLocale } from '@/i18n/i18n';
import ProfilePage from './ProfilePage';

// 顧問 §3.233 ③甲：出席統計與相關活動和個人資料同時開始讀；私密讀取失敗仍是整頁失敗＋重試。

const LOAD_ERROR = '目前無法載入資料，請再試一次。';
const RETRY = '重新嘗試';

function existingDoc() {
  return {
    exists: () => true,
    id: 'U-me',
    data: () => ({ uid: 'U-me', displayName: '王小明', gender: '男', birthday: '2000/01/02', region: '台北市' }),
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

const SUMMARY = { attended: 3, expected: 4, noShow: 0 };

describe('ProfilePage：統計類讀取與個人資料並行', () => {
  beforeEach(async () => {
    _setDictLoaderForTest(null);
    localStorage.clear();
    await setLocale('zh-TW');
    firestore.getDoc.mockReset();
    firestore.getDocs.mockReset();
    summary.load.mockReset();
    related.calls.length = 0;
  });

  afterEach(() => {
    cleanup();
  });

  it('個人資料還沒回：出席統計與相關活動已經開始讀；回來後各只讀一次', async () => {
    const root = deferred<ReturnType<typeof existingDoc>>();
    firestore.getDoc.mockReturnValueOnce(root.promise).mockResolvedValue(existingDoc());
    summary.load.mockResolvedValue(SUMMARY);
    render(<ProfilePage />);

    await waitFor(() => expect(summary.load).toHaveBeenCalledTimes(1));
    expect(summary.load).toHaveBeenCalledWith('U-me');
    expect(related.calls).toContain('U-me');
    expect(document.getElementById('profile-content')).toBeNull();

    await act(async () => { root.resolve(existingDoc()); });
    await waitFor(() => expect(document.getElementById('profile-content')).toBeTruthy());
    expect(summary.load).toHaveBeenCalledTimes(1);
  });

  it('私密讀取失敗：即使統計先成功，仍是整頁「無法載入」＋重試，不顯示個人頁', async () => {
    firestore.getDoc.mockRejectedValue(new Error('offline'));
    firestore.getDocs.mockRejectedValue(new Error('offline'));
    summary.load.mockResolvedValue(SUMMARY);
    render(<ProfilePage />);

    expect(await screen.findByText(LOAD_ERROR)).toBeTruthy();
    expect(screen.getByRole('button', { name: RETRY })).toBeTruthy();
    expect(document.getElementById('profile-content')).toBeNull();
  });

  it('統計讀取失敗：個人資料照常顯示，不連帶整頁失敗', async () => {
    firestore.getDoc.mockResolvedValue(existingDoc());
    summary.load.mockRejectedValue(new Error('stats offline'));
    render(<ProfilePage />);

    await waitFor(() => expect(document.getElementById('profile-content')).toBeTruthy());
    expect(screen.queryByText(LOAD_ERROR)).toBeNull();
  });

  it('私密讀取失敗後按重試：個人資料重讀，統計不重讀（讀取次數與修前相同）', async () => {
    firestore.getDoc.mockRejectedValueOnce(new Error('offline')).mockResolvedValue(existingDoc());
    firestore.getDocs.mockRejectedValue(new Error('offline'));
    summary.load.mockResolvedValue(SUMMARY);
    render(<ProfilePage />);

    fireEvent.click(await screen.findByRole('button', { name: RETRY }));
    await waitFor(() => expect(document.getElementById('profile-content')).toBeTruthy());
    expect(summary.load).toHaveBeenCalledTimes(1);
  });
});
