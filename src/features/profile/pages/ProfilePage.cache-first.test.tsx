import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// PROFILE-SPEED F2：本組測試走「快取先畫、伺服器後到換新」。
// 以 profile-model 的兩個 vi.fn 手動控制 server／cache 完成順序；
// related-activities 的兩個函式也以 vi.fn 控管（避免真的去讀 Firestore）；
// viewer 用可切換的 hoisted state 驗「換帳號不串資料」。

const profileModel = vi.hoisted(() => ({
  loadOwnUserProfile: vi.fn(),
  loadOwnUserProfileFromCache: vi.fn(),
}));
const relatedActivities = vi.hoisted(() => ({
  loadRelatedActivities: vi.fn(),
  loadRelatedActivitiesFromCache: vi.fn(),
}));
const summarySpy = vi.hoisted(() => vi.fn());
const useMyTeamApplicationsSpy = vi.hoisted(() => vi.fn(() => null));
const viewerState = vi.hoisted(() => ({ uid: 'U-me' }));

vi.mock('firebase/firestore', () => ({
  doc: vi.fn(() => ({})),
  collection: vi.fn(() => ({})),
  query: vi.fn(() => ({})),
  where: vi.fn(() => ({})),
  limit: vi.fn(() => ({})),
  getDoc: vi.fn(),
  getDocs: vi.fn(),
}));
vi.mock('@/data/firebase', () => ({
  getFirebase: vi.fn(async () => ({ db: {} })),
}));
vi.mock('preact-iso', () => ({
  useLocation: () => ({ route: vi.fn(), query: {} }),
}));
vi.mock('../data/viewer', () => ({
  useViewer: () => ({
    uid: viewerState.uid,
    role: 'user',
    roleLevel: 1,
    teamIds: new Set<string>(),
    capabilities: [],
    displayName: null,
    pictureUrl: null,
    hasPermission: () => false,
  }),
}));
vi.mock('../data/profile-model', () => ({
  loadOwnUserProfile: profileModel.loadOwnUserProfile,
  loadOwnUserProfileFromCache: profileModel.loadOwnUserProfileFromCache,
}));
vi.mock('../data/related-activities', () => ({
  loadRelatedActivities: relatedActivities.loadRelatedActivities,
  loadRelatedActivitiesFromCache: relatedActivities.loadRelatedActivitiesFromCache,
}));
vi.mock('../data/attendance-summary', () => ({
  loadUserAttendanceSummary: summarySpy,
}));

// LegacyProfileTopSection 換成只顯示 profile.name 的替身，直接鎖「畫面上現在畫誰」。
vi.mock('../components/legacy/LegacyProfileHeader', () => ({
  LegacyProfileTopSection: ({ profile }: { profile: { name?: string } | null }) => (
    <div id="stub-profile-name">{profile?.name ?? ''}</div>
  ),
}));
// ProfileInfoCard 也換成顯示 profile.name 的替身，驗「展開並顯示伺服器值」。
vi.mock('../components/legacy/LegacyProfileCards', () => ({
  LegacyProfileInfoCard: ({ profile }: { profile: { name?: string } }) => (
    <div id="stub-info-card-name">{profile?.name ?? ''}</div>
  ),
}));
vi.mock('../components/legacy/LegacyIdentityCard', () => ({ LegacyIdentityCard: () => null }));
vi.mock('../components/legacy/LegacyLineNotifyCard', () => ({ LegacyLineNotifyCard: () => null }));
vi.mock('../components/legacy/LegacyFavoritesCard', () => ({ LegacyFavoritesCard: () => null }));
vi.mock('../components/legacy/LegacyCompanionsCard', () => ({ LegacyCompanionsCard: () => null }));
vi.mock('../components/legacy/LegacyApplicationsCard', () => ({
  LegacyApplicationsCard: () => null,
  useMyTeamApplications: useMyTeamApplicationsSpy,
}));
vi.mock('../components/legacy/LegacyActivityRecordsCard', () => ({
  LegacyActivityRecordsCard: () => null,
}));

import { _setDictLoaderForTest, setLocale } from '@/i18n/i18n';
import ProfilePage from './ProfilePage';

interface FakeProfile {
  uid: string;
  name: string;
  displayName: string;
}

function profileOf(name: string, uid = 'U-me'): FakeProfile {
  return { uid, name, displayName: name };
}

function summaryOf(): unknown {
  return {
    uid: 'U-me',
    exists: true,
    sourceVersion: 1,
    expectedCount: 0,
    attendedCount: 0,
    completedCount: 0,
    attendRate: 0,
    updatedAt: new Date(0),
  };
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (v: T) => void;
  reject: (e: unknown) => void;
} {
  let resolve: (v: T) => void = () => {};
  let reject: (e: unknown) => void = () => {};
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const nameNode = (): string => document.getElementById('stub-profile-name')?.textContent ?? '';
const infoCardNode = (): HTMLElement | null => document.getElementById('stub-info-card-name');

describe('ProfilePage 快取先畫、伺服器後到換新（PROFILE-SPEED F2）', () => {
  beforeEach(async () => {
    _setDictLoaderForTest(null);
    localStorage.clear();
    await setLocale('zh-TW');

    profileModel.loadOwnUserProfile.mockReset();
    profileModel.loadOwnUserProfileFromCache.mockReset();
    relatedActivities.loadRelatedActivities.mockReset();
    relatedActivities.loadRelatedActivitiesFromCache.mockReset();
    summarySpy.mockReset();
    useMyTeamApplicationsSpy.mockReset();

    // 預設：相關活動空資料、快取沒有、申請無資料。
    relatedActivities.loadRelatedActivities.mockResolvedValue({ registered: [], hosted: [] } as never);
    relatedActivities.loadRelatedActivitiesFromCache.mockResolvedValue(null as never);
    summarySpy.mockResolvedValue(summaryOf() as never);
    useMyTeamApplicationsSpy.mockReturnValue(null as never);
    viewerState.uid = 'U-me';
  });

  afterEach(() => {
    cleanup();
  });

  it('快取先畫、伺服器值後到換新', async () => {
    const cache = deferred<FakeProfile | null>();
    const server = deferred<FakeProfile | null>();
    profileModel.loadOwnUserProfileFromCache.mockReturnValue(cache.promise as never);
    profileModel.loadOwnUserProfile.mockReturnValue(server.promise as never);

    render(<ProfilePage />);

    await act(async () => {
      cache.resolve(profileOf('舊名'));
      await Promise.resolve();
    });
    await waitFor(() => expect(nameNode()).toBe('舊名'));

    await act(async () => {
      server.resolve(profileOf('新名'));
      await Promise.resolve();
    });
    await waitFor(() => expect(nameNode()).toBe('新名'));
  });

  it('晚到的快取不蓋伺服器', async () => {
    const cache = deferred<FakeProfile | null>();
    const server = deferred<FakeProfile | null>();
    profileModel.loadOwnUserProfileFromCache.mockReturnValue(cache.promise as never);
    profileModel.loadOwnUserProfile.mockReturnValue(server.promise as never);

    render(<ProfilePage />);

    await act(async () => {
      server.resolve(profileOf('新名'));
      await Promise.resolve();
    });
    await waitFor(() => expect(nameNode()).toBe('新名'));

    await act(async () => {
      cache.resolve(profileOf('舊名'));
      await Promise.resolve();
    });
    // 給幾幀時間讓晚到的快取有機會套用（若未挡就会被寫入）；之後仍必須是新名。
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    expect(nameNode()).toBe('新名');
  });

  it('伺服器失敗保留快取資料，按重試成功後換新（重試提示消失）', async () => {
    const cache = deferred<FakeProfile | null>();
    const serverFail = deferred<FakeProfile | null>();
    profileModel.loadOwnUserProfileFromCache.mockReturnValue(cache.promise as never);
    profileModel.loadOwnUserProfile.mockReturnValue(serverFail.promise as never);

    render(<ProfilePage />);

    await act(async () => {
      cache.resolve(profileOf('舊名'));
      await Promise.resolve();
    });
    await waitFor(() => expect(nameNode()).toBe('舊名'));

    await act(async () => {
      serverFail.reject(new Error('offline'));
      await serverFail.promise.catch(() => undefined);
    });
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(nameNode()).toBe('舊名');

    const serverOk = deferred<FakeProfile | null>();
    profileModel.loadOwnUserProfile.mockReturnValue(serverOk.promise as never);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '重新嘗試' }));
    });
    await act(async () => {
      serverOk.resolve(profileOf('新名'));
      await Promise.resolve();
    });
    await waitFor(() => expect(nameNode()).toBe('新名'));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('換帳號不串資料：A 的結果晚到也不蓋 B', async () => {
    const aCache = deferred<FakeProfile | null>();
    const aServer = deferred<FakeProfile | null>();
    const bCache = deferred<FakeProfile | null>();
    const bServer = deferred<FakeProfile | null>();

    profileModel.loadOwnUserProfileFromCache.mockImplementation((uid: string) => {
      if (uid === 'U-me') return aCache.promise as never;
      if (uid === 'U-other') return bCache.promise as never;
      return Promise.resolve(null) as never;
    });
    profileModel.loadOwnUserProfile.mockImplementation((uid: string) => {
      if (uid === 'U-me') return aServer.promise as never;
      if (uid === 'U-other') return bServer.promise as never;
      return Promise.resolve(null) as never;
    });

    viewerState.uid = 'U-me';
    const { rerender } = render(<ProfilePage />);
    await waitFor(() => expect(profileModel.loadOwnUserProfile).toHaveBeenCalledTimes(1));

    viewerState.uid = 'U-other';
    rerender(<ProfilePage />);
    await waitFor(() => expect(profileModel.loadOwnUserProfile).toHaveBeenCalledTimes(2));

    // A 的結果晚到：不能出現在畫面
    await act(async () => {
      aCache.resolve(profileOf('A名', 'U-me'));
      aServer.resolve(profileOf('A名', 'U-me'));
      await Promise.resolve();
    });
    expect(screen.queryByText('A名')).toBeNull();

    // B 的快取回來後應顯示 B 名
    await act(async () => {
      bCache.resolve(profileOf('B名', 'U-other'));
      await Promise.resolve();
    });
    await waitFor(() => expect(nameNode()).toBe('B名'));
  });

  it('伺服器值到之前不能編輯：按快捷列資料不展開；伺服器值到後才展開並顯示伺服器值', async () => {
    const cache = deferred<FakeProfile | null>();
    const server = deferred<FakeProfile | null>();
    profileModel.loadOwnUserProfileFromCache.mockReturnValue(cache.promise as never);
    profileModel.loadOwnUserProfile.mockReturnValue(server.promise as never);

    render(<ProfilePage />);

    await act(async () => {
      cache.resolve(profileOf('舊名'));
      await Promise.resolve();
    });
    await waitFor(() => expect(nameNode()).toBe('舊名'));

    const infoBtn = document.getElementById('profile-quick-btn-info') as HTMLButtonElement | null;
    expect(infoBtn).toBeTruthy();
    await act(async () => {
      fireEvent.click(infoBtn!);
    });
    // 未 fresh 前按了：不展開，編輯內容未出現
    expect(infoCardNode()).toBeNull();

    await act(async () => {
      server.resolve(profileOf('新名'));
      await Promise.resolve();
    });
    await waitFor(() => expect(nameNode()).toBe('新名'));

    // 伺服器值到、deferred 解除後自動展開，顯示伺服器值（新名，不是快取舊名）
    await waitFor(() => expect(infoCardNode()).toBeTruthy());
    expect(infoCardNode()?.textContent).toBe('新名');
  });

  it('編輯中不被覆蓋：伺服器值到後打開資料卡，晚到的快取不改卡片內容', async () => {
    // PROFILE-SPEED（PM 驗收補）：顧問 §3.930 條件 3「編輯中不被覆蓋」。
    const cache = deferred<FakeProfile | null>();
    profileModel.loadOwnUserProfileFromCache.mockReturnValue(cache.promise as never);
    profileModel.loadOwnUserProfile.mockResolvedValue(profileOf('新名') as never);

    render(<ProfilePage />);
    await waitFor(() => expect(nameNode()).toBe('新名'));

    await act(async () => {
      fireEvent.click(document.getElementById('profile-quick-btn-info') as HTMLButtonElement);
    });
    await waitFor(() => expect(infoCardNode()?.textContent).toBe('新名'));

    await act(async () => {
      cache.resolve(profileOf('舊名'));
      await Promise.resolve();
    });
    expect(infoCardNode()?.textContent).toBe('新名');
    expect(nameNode()).toBe('新名');
  });

  it('讀取不增加：loadOwnUserProfile 1 次、useMyTeamApplications 在 fresh 前為 false、summary 1 次', async () => {
    // PROFILE-SPEED（PM 驗收修正）：要經過「快取先畫」那一段才有 fresh=false 的 render，原寫法快取回 null 永遠不會出現 false。
    const server = deferred<FakeProfile | null>();
    profileModel.loadOwnUserProfileFromCache.mockResolvedValue(profileOf('舊名') as never);
    profileModel.loadOwnUserProfile.mockReturnValue(server.promise as never);

    render(<ProfilePage />);

    await waitFor(() => expect(nameNode()).toBe('舊名'));
    await act(async () => {
      server.resolve(profileOf('小明'));
      await Promise.resolve();
    });
    await waitFor(() => expect(nameNode()).toBe('小明'));
    expect(profileModel.loadOwnUserProfile).toHaveBeenCalledTimes(1);
    // 整頁掛載後只發一次 summary；卡片沿用頁面的 summaryTask 不再多讀。
    expect(summarySpy).toHaveBeenCalledTimes(1);

    // useMyTeamApplications：伺服器值到前 enabled=false（不讀），之後 enabled=true。
    const calls = useMyTeamApplicationsSpy.mock.calls as unknown[][];
    expect(calls.some((c) => c[2] === false)).toBe(true);
    expect(calls[calls.length - 1]?.[2]).toBe(true);
    // PROFILE-SPEED（MiMo A5）：enabled=true 的每一次都必須已是伺服器值的 profile，
    // 否則 hook 會先用快取 profile 讀一次、換物件後再讀一次（收件匣多讀）。
    const enabledCalls = calls.filter((c) => c[2] === true);
    expect(enabledCalls.length).toBeGreaterThan(0);
    const enabledProfiles = new Set(enabledCalls.map((c) => c[1]));
    expect(enabledProfiles.size).toBe(1);
    expect((enabledCalls[0]?.[1] as { displayName?: string }).displayName).toBe('小明');
  });

  it('第一次開（快取沒有）：先轉圈，伺服器回來才畫', async () => {
    const cache = deferred<FakeProfile | null>();
    const server = deferred<FakeProfile | null>();
    profileModel.loadOwnUserProfileFromCache.mockReturnValue(cache.promise as never);
    profileModel.loadOwnUserProfile.mockReturnValue(server.promise as never);

    render(<ProfilePage />);

    await act(async () => {
      cache.resolve(null);
      await Promise.resolve();
    });
    // 快取回 null：仍是 loading（stub 內沒有名字）
    expect(nameNode()).toBe('');

    await act(async () => {
      server.resolve(profileOf('新名'));
      await Promise.resolve();
    });
    await waitFor(() => expect(nameNode()).toBe('新名'));
  });
});
