import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/preact';
import { _resetFirebaseForTest, isFirebaseDegraded } from '@/data/firebase';
import { getEventsRepo } from '@/features/events/data/events-repo';
import { _resetUseEventsForTest } from '@/features/events/data/use-events';
import { useViewer, type ViewerView } from '@/features/profile/data/viewer';
import { loadActiveAnnouncements } from '../data/announcements';
import { loadActiveBanners, type BannerDeps, type BannerDoc } from '../data/banners';
import { guestRowsOf } from '../data/__fixtures__/guest-rows';
import {
  BANNERS_SNAPSHOT_KEY,
  HOME_SNAPSHOT_MAX_AGE_MS,
  SPORTS_SNAPSHOT_KEY,
  _clearHomeSnapshotForTest,
  toPublicBanners,
  writeBannersSnapshot,
  writeSportsSnapshot,
} from '../data/home-snapshot';
import { resolveNextActivity } from '../data/next-activity';
import HomePage from './HomePage';

// 首屏快照的時間與身分：選用當下的期限檢查、到期回呼核對、同一個掛載內的身分轉換、降級旗標×來源 metadata×儲存可用性。
// （基本行為在 HomePage.snapshot.test.tsx；真實 repo 串接在 HomePage.snapshot.integration.test.tsx。）

let capturedRefresh: (() => void) | null = null;

// 快照路徑的設計判斷是「不讀降級旗標」：換成可控制的替身，組合測試確認它從沒被呼叫。
vi.mock('@/data/firebase', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/data/firebase')>()),
  isFirebaseDegraded: vi.fn(() => false),
}));
vi.mock('preact-iso', () => ({
  useLocation: () => ({ url: '/', path: '/', query: {}, route: vi.fn() }),
}));
vi.mock('@/i18n/i18n', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/i18n/i18n')>()),
  useT: () => (key: string) => key,
}));
vi.mock('@/features/events/data/events-repo', () => ({ getEventsRepo: vi.fn() }));
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

function makeViewer(uid: string | null): ViewerView {
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

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function banner(partial: Partial<BannerDoc> & { id: string }): BannerDoc {
  return { _docId: partial.id, status: 'active', ...partial };
}

function seedBanners(list: BannerDoc[], savedAt?: number): void {
  writeBannersSnapshot(toPublicBanners(list), savedAt);
}

function bannersResult(list: BannerDoc[], fromCache: boolean | 'unknown' = false) {
  return async (deps?: BannerDeps): Promise<BannerDoc[]> => {
    deps?.onResult?.({ fromCache: fromCache === 'unknown' ? undefined : fromCache });
    return list;
  };
}

function mockEvents(
  load: () => Promise<unknown>,
  active: object[] = [],
  activeFromCache: boolean | 'unknown' = false,
): void {
  vi.mocked(getEventsRepo).mockReturnValue({
    loadEventsStatic: vi.fn().mockImplementation(load),
    ensureTerminalEventsLoaded: vi.fn().mockResolvedValue(['events']),
    loadMoreTerminalEvents: vi.fn().mockResolvedValue(0),
    getSnapshot: () => ({ active, terminal: [], activeFromCache: activeFromCache === 'unknown' ? undefined : activeFromCache }),
  } as unknown as ReturnType<typeof getEventsRepo>);
}

const ev = (id: string, extra: Record<string, unknown> = {}): object => ({
  id,
  status: 'open',
  date: '2030/10/20 18:00~20:00',
  sportTag: 'football',
  ...extra,
});
const footballChip = (container: Element): Element | null =>
  container.querySelector('.home-sport-chip[data-home-sport="football"]');
const footballCount = (container: Element): string | undefined =>
  footballChip(container)?.querySelector('.home-sport-chip-count')?.textContent ?? undefined;

beforeEach(() => {
  vi.resetAllMocks();
  capturedRefresh = null;
  _resetUseEventsForTest();
  _clearHomeSnapshotForTest();
  vi.mocked(useViewer).mockReturnValue(makeViewer('u1'));
  vi.mocked(resolveNextActivity).mockResolvedValue(null);
  vi.mocked(loadActiveBanners).mockImplementation(bannersResult([]));
  vi.mocked(loadActiveAnnouncements).mockResolvedValue([]);
  mockEvents(() => Promise.resolve(['events']));
});

afterEach(() => {
  cleanup();
  _resetFirebaseForTest();
  _clearHomeSnapshotForTest();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('選用快照當下的期限檢查', () => {
  it('時鐘往前跳、計時器還沒醒（也沒有 visibilitychange）：之後任何一次重新 render 都不能再選到已過期的統計快照', async () => {
    vi.useFakeTimers({ now: T0, toFake: ['Date'] });
    writeSportsSnapshot(guestRowsOf({ football: 7 }), T0 - 5 * MIN);
    mockEvents(() => new Promise(() => undefined));
    const { container } = render(<HomePage />);
    expect(footballCount(container)).toBe('7 活動');

    vi.setSystemTime(T0 + 26 * MIN);
    await act(async () => {
      capturedRefresh?.();
    });
    expect(footballChip(container)).toBeNull();
  });

  it('時鐘往前跳：畫面上來自快照的橫幅在下一次 render 就不畫，不等計時器', async () => {
    vi.useFakeTimers({ now: T0, toFake: ['Date'] });
    seedBanners([banner({ id: 'b1', title: '快照橫幅' })], T0 - 5 * MIN);
    vi.mocked(loadActiveBanners).mockReturnValue(deferred<BannerDoc[]>().promise);
    mockEvents(() => new Promise(() => undefined));
    const { container } = render(<HomePage />);
    expect(screen.getByRole('heading', { name: '快照橫幅' })).toBeTruthy();

    vi.setSystemTime(T0 + 26 * MIN);
    await act(async () => {
      capturedRefresh?.();
    });
    expect(screen.queryByText('快照橫幅')).toBeNull();
    expect(container.querySelector('.skeleton-slide')).toBeTruthy();
  });
});

describe('正式資料取代快照與舊到期時間交錯', () => {
  it('橫幅：正式資料在快照到期前一刻取代它；舊的到期時間之後到了，不會把正式資料清掉', async () => {
    vi.useFakeTimers({ now: T0 });
    seedBanners([banner({ id: 'snap', title: '快照橫幅' })], T0);
    const pending = deferred<BannerDoc[]>();
    vi.mocked(loadActiveBanners).mockImplementation(async (deps) => {
      const list = await pending.promise;
      deps?.onResult?.({ fromCache: false });
      return list;
    });
    render(<HomePage />);

    await act(async () => {
      vi.advanceTimersByTime(HOME_SNAPSHOT_MAX_AGE_MS - 1000);
    });
    expect(screen.getByText('快照橫幅')).toBeTruthy();
    await act(async () => {
      pending.resolve([banner({ id: 'server', title: '正式橫幅' })]);
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByText('正式橫幅')).toBeTruthy();

    // 跨過快照原本的到期時間，並讓頁面「回到可見」
    await act(async () => {
      vi.advanceTimersByTime(10_000);
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(screen.getByText('正式橫幅')).toBeTruthy();
  });

  it('運動統計：同上——正式資料取代後，舊的到期時間到了也不會清掉', async () => {
    vi.useFakeTimers({ now: T0 });
    writeSportsSnapshot(guestRowsOf({ football: 7 }), T0);
    const pending = deferred<unknown>();
    mockEvents(() => pending.promise, [ev('e1'), ev('e2')]);
    const { container } = render(<HomePage />);
    expect(footballCount(container)).toBe('7 活動');

    await act(async () => {
      vi.advanceTimersByTime(HOME_SNAPSHOT_MAX_AGE_MS - 1000);
    });
    await act(async () => {
      pending.resolve(['events']);
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(footballCount(container)).toBe('2 活動');

    await act(async () => {
      vi.advanceTimersByTime(10_000);
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(footballCount(container)).toBe('2 活動');
  });
});

describe('正式資料在快照到期前一刻取代它（臨界時間點）', () => {
  // 到期回呼自己會核對「畫面上的資料還是不是快照」（ref 同步更新），防的是 Preact 被動 effect 清理（下一次繪製後才執行）與舊計時器交錯。
  // 誠實註記：這個交錯在 vitest 的假時鐘下無法穩定重現（拿掉核對，這兩個案例仍然通過），所以它們驗的是臨界時間點的最終狀態，
  // 核對本身是縱深防禦；變異驗證把它列為「單測抓不到的等價變異」。
  it('橫幅：到期前 5 ms 正式資料取代快照，之後不會被舊到期時間清掉', async () => {
    vi.useFakeTimers({ now: T0 });
    seedBanners([banner({ id: 'snap', title: '快照橫幅' })], T0);
    const pending = deferred<BannerDoc[]>();
    vi.mocked(loadActiveBanners).mockImplementation(async (deps) => {
      const list = await pending.promise;
      deps?.onResult?.({ fromCache: false });
      return list;
    });
    render(<HomePage />);
    await act(async () => {
      vi.advanceTimersByTime(HOME_SNAPSHOT_MAX_AGE_MS - 5);
    });

    pending.resolve([banner({ id: 'server', title: '正式橫幅' })]);
    await vi.advanceTimersByTimeAsync(30);

    expect(screen.queryByText('快照橫幅')).toBeNull();
    expect(screen.getByText('正式橫幅')).toBeTruthy();
  });

  it('運動統計：到期前 5 ms 正式資料取代快照，之後不會被舊到期時間清掉', async () => {
    vi.useFakeTimers({ now: T0 });
    writeSportsSnapshot(guestRowsOf({ football: 7 }), T0);
    const pending = deferred<unknown>();
    mockEvents(() => pending.promise, [ev('e1'), ev('e2')]);
    const { container } = render(<HomePage />);
    await act(async () => {
      vi.advanceTimersByTime(HOME_SNAPSHOT_MAX_AGE_MS - 5);
    });

    pending.resolve(['events']);
    await vi.advanceTimersByTimeAsync(30);

    expect(footballCount(container)).toBe('2 活動');
  });
});

describe('同一個掛載內的身分轉換：不復活快照', () => {
  it('訪客→登入→換帳號→登出→被黑名單全擋成零筆：快照只在正式資料回來之前用；之後每次都以正式資料用目前的身分重算', async () => {
    writeSportsSnapshot(guestRowsOf({ football: 7 }), Date.now() - 5 * MIN);
    const pending = deferred<unknown>();
    mockEvents(() => pending.promise, [
      ev('e1', { blockedUids: ['uz'] }),
      ev('e2', { date: '2030/10/21 18:00~20:00', blockedUids: ['uz', 'u1'] }),
      ev('e3', { date: '2030/10/22 18:00~20:00', blockedUids: ['uz', 'u1', 'u2'] }),
    ]);
    vi.mocked(useViewer).mockReturnValue(makeViewer(null));
    const view = render(<HomePage />);
    expect(footballCount(view.container)).toBe('7 活動');

    // 登入（正式資料還沒回來）：快照與帳號無關，仍然是快照
    vi.mocked(useViewer).mockReturnValue(makeViewer('u1'));
    view.rerender(<HomePage />);
    expect(footballCount(view.container)).toBe('7 活動');

    // 正式資料回來：u1 被 e2、e3 擋住
    await act(async () => {
      pending.resolve(['events']);
    });
    await waitFor(() => expect(footballCount(view.container)).toBe('1 活動'));

    const switchTo = async (uid: string | null, expected: string | undefined): Promise<void> => {
      vi.mocked(useViewer).mockReturnValue(makeViewer(uid));
      view.rerender(<HomePage />);
      await waitFor(() => expect(footballCount(view.container)).toBe(expected));
    };
    await switchTo('u2', '2 活動'); // 被 e3 擋住
    await switchTo(null, '3 活動'); // 登出：訪客視角
    await switchTo('uz', undefined); // 三場都擋住 → 零筆，不會回頭用 7 的快照
    expect(footballChip(view.container)).toBeNull();
    await switchTo('u1', '1 活動');
  });
});

describe('降級旗標 × 來源 metadata × 儲存可用性（快照路徑不讀降級旗標）', () => {
  const cases: Array<[boolean, boolean | 'unknown', 'ok' | 'unavailable']> = [];
  for (const degraded of [false, true]) {
    for (const fromCache of [false, true, 'unknown'] as const) {
      for (const storage of ['ok', 'unavailable'] as const) cases.push([degraded, fromCache, storage]);
    }
  }

  it.each(cases)('降級=%s／fromCache=%s／儲存=%s：畫面照常；只有「確認新取得且儲存可用」才寫快照；降級旗標從沒被讀', async (degraded, fromCache, storage) => {
    vi.mocked(isFirebaseDegraded).mockReturnValue(degraded);
    mockEvents(() => Promise.resolve(['events']), [ev('e1'), ev('e2')], fromCache);
    vi.mocked(loadActiveBanners).mockImplementation(bannersResult([banner({ id: 'b1', title: '公開橫幅' })], fromCache));
    if (storage === 'unavailable') {
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('denied');
      });
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('denied');
      });
      vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
        throw new Error('denied');
      });
    }

    const { container } = render(<HomePage />);
    // 畫面不受影響：活動算出 2 場、橫幅照常顯示
    await waitFor(() => expect(footballCount(container)).toBe('2 活動'));
    expect(await screen.findByRole('heading', { name: '公開橫幅' })).toBeTruthy();

    vi.restoreAllMocks(); // 還原 Storage 的替身，才能讀實際儲存內容
    const shouldWrite = fromCache === false && storage === 'ok';
    expect(localStorage.getItem(SPORTS_SNAPSHOT_KEY) !== null).toBe(shouldWrite);
    expect(localStorage.getItem(BANNERS_SNAPSHOT_KEY) !== null).toBe(shouldWrite);
    expect(isFirebaseDegraded).not.toHaveBeenCalled();
  });
});
