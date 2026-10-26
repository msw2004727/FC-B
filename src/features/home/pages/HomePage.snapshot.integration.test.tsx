import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, waitFor } from '@testing-library/preact';
import { getDocs } from 'firebase/firestore';
import { getEventsRepo } from '@/features/events/data/events-repo';
import { _resetUseEventsForTest } from '@/features/events/data/use-events';
import { useViewer, type ViewerView } from '@/features/profile/data/viewer';
import { loadActiveAnnouncements } from '../data/announcements';
import { loadActiveBanners } from '../data/banners';
import { SPORTS_SNAPSHOT_KEY, _clearHomeSnapshotForTest } from '../data/home-snapshot';
import { resolveNextActivity } from '../data/next-activity';
import HomePage from './HomePage';

// 真實的 events-repo → useEvents → 首頁 writer 串接（只換掉 Firestore SDK 的 getDocs）：
// 先成功寫入快照，之後「失敗」或「被較新的請求取代」都不能替舊資料重新蓋上新的 savedAt（舊資料不能被反覆續期）。

let capturedRefresh: (() => void) | null = null;

vi.mock('firebase/firestore', () => ({
  collection: vi.fn((_db: unknown, path: string) => ({ kind: 'collection', path })),
  collectionGroup: vi.fn(),
  query: vi.fn((base: unknown, ...constraints: unknown[]) => ({ base, constraints })),
  where: vi.fn(),
  orderBy: vi.fn(),
  limit: vi.fn(),
  startAfter: vi.fn(),
  getDocs: vi.fn(),
  doc: vi.fn(),
  getDoc: vi.fn(),
}));

vi.mock('@/data/firebase', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/data/firebase')>()),
  getFirebase: vi.fn(async () => ({ db: {} })),
  getFirebaseCore: vi.fn(async () => ({ db: {} })),
}));

vi.mock('preact-iso', () => ({
  useLocation: () => ({ url: '/', path: '/', query: {}, route: vi.fn() }),
}));
vi.mock('@/i18n/i18n', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/i18n/i18n')>()),
  useT: () => (key: string) => key,
}));
vi.mock('@/features/profile/data/viewer', () => ({ useViewer: vi.fn() }));
vi.mock('@/features/profile/data/profile-model', () => ({ loadUserProfile: async () => null }));
vi.mock('@/features/events/components/event-form/use-event-form-post-save', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/events/components/event-form/use-event-form-post-save')>()),
  useEventFormPostSave: (options: { refresh: () => void }) => {
    capturedRefresh = options.refresh;
    return vi.fn();
  },
}));
vi.mock('@/features/home/data/next-activity', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/home/data/next-activity')>()),
  resolveNextActivity: vi.fn(),
}));
vi.mock('@/features/home/data/banners', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/home/data/banners')>()),
  loadActiveBanners: vi.fn(),
}));
vi.mock('@/features/home/data/announcements', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/home/data/announcements')>()),
  loadActiveAnnouncements: vi.fn(),
}));
vi.mock('@/features/events/components/EventFormModal', () => ({ EventFormModal: () => null }));

const MIN = 60 * 1000;
const T0 = Date.UTC(2026, 9, 27, 3, 0, 0);

function viewer(uid: string): ViewerView {
  return {
    uid,
    teamIds: new Set(),
    roleLevel: 0,
    role: 'user',
    displayName: uid,
    pictureUrl: null,
    capabilities: [],
    hasPermission: () => false,
  };
}

function doc(id: string): { id: string; data: () => Record<string, unknown>; ref: { id: string } } {
  return { id, data: () => ({ status: 'open', date: '2030/10/20 18:00~20:00', sportTag: 'football' }), ref: { id } };
}

function snapshotOf(ids: string[], fromCache: boolean): unknown {
  return { docs: ids.map(doc), metadata: { fromCache } };
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (reason: unknown) => void } {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

/** 等所有已排入的 Promise 工作做完（setTimeout 是巨集任務，會在微任務佇列清空之後才執行）。 */
async function settle(): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });
}

const stored = (): string | null => localStorage.getItem(SPORTS_SNAPSHOT_KEY);
const count = (container: Element): string | undefined =>
  container.querySelector('.home-sport-chip[data-home-sport="football"] .home-sport-chip-count')?.textContent ?? undefined;

beforeEach(() => {
  vi.useFakeTimers({ now: T0, toFake: ['Date'] });
  vi.mocked(getDocs).mockReset();
  capturedRefresh = null;
  _resetUseEventsForTest();
  _clearHomeSnapshotForTest();
  vi.mocked(useViewer).mockReturnValue(viewer('u1'));
  vi.mocked(resolveNextActivity).mockResolvedValue(null);
  vi.mocked(loadActiveBanners).mockImplementation(async (deps) => {
    deps?.onResult?.({ fromCache: false });
    return [];
  });
  vi.mocked(loadActiveAnnouncements).mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  _clearHomeSnapshotForTest();
});

describe('首頁快照寫入：真實 repo → hook → 首頁 writer', () => {
  it('先成功寫入；之後讀取失敗、或被較新的請求取代，快照的 savedAt 都不能變（舊資料不能被續期）；下一次真的成功才更新', async () => {
    const getDocsMock = vi.mocked(getDocs);

    // ① 第一次：確認向伺服器新取得（fromCache=false）→ 寫入
    getDocsMock.mockResolvedValueOnce(snapshotOf(['e1', 'e2'], false) as never);
    const { container } = render(<HomePage />);
    await waitFor(() => expect(count(container)).toBe('2 活動'));
    await waitFor(() => expect(stored()).not.toBeNull());
    const firstWrite = stored();
    expect(JSON.parse(firstWrite as string).savedAt).toBe(T0);
    expect(capturedRefresh).not.toBeNull();

    // ② 10 分鐘後重試，這次讀取失敗：不得更新快照
    vi.setSystemTime(T0 + 10 * MIN);
    getDocsMock.mockRejectedValueOnce(new Error('offline'));
    await act(async () => {
      capturedRefresh?.();
    });
    await waitFor(() => expect(getDocsMock).toHaveBeenCalledTimes(2));
    await settle();
    expect(stored()).toBe(firstWrite);

    // ③ 20 分鐘後再重試，但這一輪（A）在途中被較新的請求（B）取代：repo 對 A 回傳 []，
    //    共用 snapshot 還留著第一次的 fromCache=false，不能因此把 A 當成「這次新取得」。
    vi.setSystemTime(T0 + 20 * MIN);
    const requestA = deferred<unknown>();
    const requestB = deferred<unknown>();
    getDocsMock.mockReturnValueOnce(requestA.promise as never).mockReturnValueOnce(requestB.promise as never);
    await act(async () => {
      capturedRefresh?.();
    });
    await waitFor(() => expect(getDocsMock).toHaveBeenCalledTimes(3));
    const supersede = getEventsRepo().loadEventsStatic({ terminalMode: 'none' });
    await waitFor(() => expect(getDocsMock).toHaveBeenCalledTimes(4));
    requestA.resolve(snapshotOf(['e1', 'e2', 'e3'], false));
    await settle();
    expect(stored()).toBe(firstWrite);

    // 較新的請求（B）完成，畫面的 hook 並不是呼叫它的人，同樣不寫
    requestB.resolve(snapshotOf(['e1', 'e2', 'e3', 'e4'], false));
    await supersede;
    await settle();
    expect(stored()).toBe(firstWrite);

    // ④ 之後畫面自己的一次重試真的成功（fromCache=false）→ 才更新，savedAt 變成現在
    vi.setSystemTime(T0 + 25 * MIN);
    getDocsMock.mockResolvedValueOnce(snapshotOf(['e1', 'e2', 'e3', 'e4'], false) as never);
    await act(async () => {
      capturedRefresh?.();
    });
    await waitFor(() => expect(JSON.parse(stored() as string).savedAt).toBe(T0 + 25 * MIN));
    expect(JSON.parse(stored() as string).items).toEqual([{ key: 'football', count: 4 }]);
    await waitFor(() => expect(count(container)).toBe('4 活動'));
  });
});
