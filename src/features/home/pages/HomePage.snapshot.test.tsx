import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { JSX } from 'preact';
import { act, cleanup, render, screen, waitFor } from '@testing-library/preact';
import { _resetFirebaseForTest } from '@/data/firebase';
import { getEventsRepo } from '@/features/events/data/events-repo';
import { _resetUseEventsForTest, useEvents } from '@/features/events/data/use-events';
import { useViewer, type ViewerView } from '@/features/profile/data/viewer';
import { APP_VERSION } from '@/version';
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

// T-042 首屏快照：回訪時第一次 render 就畫橫幅與運動統計；過期／版本不同只留骨架（掛載後跨過 30 分鐘也要撤掉）；
// 背景讀取照常進行；只有「確認向伺服器新取得」的結果才更新快照；快照為訪客視角的公開資料、沒有帳號歸屬，登入者的最終畫面一律以正式資料取代快照。

let capturedRefresh: (() => void) | null = null;

vi.mock('preact-iso', () => ({
  useLocation: () => ({ url: '/', path: '/', query: {}, route: vi.fn() }),
}));

vi.mock('@/i18n/i18n', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/i18n/i18n')>()),
  useT: () => (key: string) => key,
}));

vi.mock('@/features/events/data/events-repo', () => ({
  getEventsRepo: vi.fn(),
}));

vi.mock('@/features/profile/data/viewer', () => ({
  useViewer: vi.fn(),
}));

vi.mock('@/features/profile/data/profile-model', () => ({
  loadUserProfile: async () => null,
}));

// 開團後重新整理活動的入口（HomePage 把 refresh 傳進來）：抓出來，讓測試可以觸發「重試」。
vi.mock('@/features/events/components/event-form/use-event-form-post-save', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/events/components/event-form/use-event-form-post-save')>()),
  useEventFormPostSave: (options: { refresh: () => void }) => {
    capturedRefresh = options.refresh;
    return vi.fn();
  },
}));

vi.mock('@/features/home/data/next-activity', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/home/data/next-activity')>();
  return { ...actual, resolveNextActivity: vi.fn() };
});

vi.mock('@/features/home/data/banners', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/home/data/banners')>();
  return { ...actual, loadActiveBanners: vi.fn() };
});

vi.mock('@/features/home/data/announcements', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/home/data/announcements')>();
  return { ...actual, loadActiveAnnouncements: vi.fn() };
});

vi.mock('@/features/events/components/EventFormModal', () => ({
  EventFormModal: () => null,
}));

function makeViewer(uid: string | null, roleLevel = 0, teamIds: string[] = []): ViewerView {
  return {
    uid,
    teamIds: new Set(teamIds),
    roleLevel,
    role: roleLevel >= 4 ? 'admin' : 'user',
    displayName: uid,
    pictureUrl: null,
    capabilities: [],
    hasPermission: () => roleLevel >= 4,
  };
}

/** 種橫幅快照：寫入函式只收白名單映射（toPublicBanners）的輸出。 */
function seedBanners(list: BannerDoc[], savedAt?: number): void {
  writeBannersSnapshot(toPublicBanners(list), savedAt);
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

/** 橫幅讀取的實作：回報「確認向伺服器新取得」（fromCache=false）或離線快取（true）後回傳清單。 */
function bannersResult(list: BannerDoc[], fromCache: boolean | 'unknown' = false) {
  return async (deps?: BannerDeps): Promise<BannerDoc[]> => {
    deps?.onResult?.({ fromCache: fromCache === 'unknown' ? undefined : fromCache });
    return list;
  };
}

/** repo 替身：`activeFromCache` 預設 false＝確認新取得；true＝離線時的持久快取。 */
function mockEvents(
  load: () => Promise<unknown>,
  active: object[] = [],
  activeFromCache: boolean | undefined = false,
): void {
  vi.mocked(getEventsRepo).mockReturnValue({
    loadEventsStatic: vi.fn().mockImplementation(load),
    ensureTerminalEventsLoaded: vi.fn().mockResolvedValue(['events']),
    loadMoreTerminalEvents: vi.fn().mockResolvedValue(0),
    getSnapshot: () => ({ active, terminal: [], activeFromCache }),
  } as unknown as ReturnType<typeof getEventsRepo>);
}

/**
 * 「活動請求已處理完」的完成訊號：另一個畫面（witness）共用同一個進行中的請求（useEvents 的 inflight），
 * 它的 loading 變 false 時，先登記的首頁的處理一定已經跑過（同一個 Promise 的 then 依登記順序執行）。
 * 要掛在請求結算「之前」；用在「確認某件事沒有發生」的案例，取代固定次數的 await Promise.resolve()。
 */
function EventsWitness(): JSX.Element {
  const { loading } = useEvents(null, { terminalMode: 'none' });
  return <div data-testid="events-witness" data-done={loading ? '0' : '1'} />;
}
async function waitForWitness(witness: { getByTestId: (id: string) => HTMLElement }): Promise<void> {
  await waitFor(() => expect(witness.getByTestId('events-witness').getAttribute('data-done')).toBe('1'));
}

const MIN = 60 * 1000;
const staleAt = (): number => Date.now() - HOME_SNAPSHOT_MAX_AGE_MS - MIN;
const footballChip = (container: Element): Element | null =>
  container.querySelector('.home-sport-chip[data-home-sport="football"]');
const footballCount = (container: Element): string | undefined =>
  footballChip(container)?.querySelector('.home-sport-chip-count')?.textContent ?? undefined;
const ev = (id: string, extra: Record<string, unknown> = {}): object => ({
  id,
  status: 'open',
  date: '2030/10/20 18:00~20:00',
  sportTag: 'football',
  ...extra,
});

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
  vi.useRealTimers();
});

describe('HomePage 首屏快照：橫幅', () => {
  it('30 分鐘內、同版本的快照在第一次 render 就畫出橫幅文字，網路還沒回來也不顯示骨架；背景讀取照常發出', () => {
    seedBanners([banner({ id: 'b1', title: '週末熱血開踢', subtitle: '立即加入附近球局' })]);
    vi.mocked(loadActiveBanners).mockReturnValue(deferred<BannerDoc[]>().promise);

    const { container } = render(<HomePage />);

    expect(screen.getByRole('heading', { name: '週末熱血開踢' })).toBeTruthy();
    expect(screen.getByText('立即加入附近球局')).toBeTruthy();
    expect(container.querySelector('.skeleton-slide')).toBeNull();
    // 不做離線假設：有快照也照常向伺服器讀（快照只是先畫一版）。
    expect(loadActiveBanners).toHaveBeenCalledTimes(1);
  });

  it('確認向伺服器新取得後換成新的橫幅，並更新快照', async () => {
    seedBanners([banner({ id: 'old', title: '舊橫幅' })], Date.now() - 10 * MIN);
    const pending = deferred<BannerDoc[]>();
    vi.mocked(loadActiveBanners).mockImplementation(async (deps) => {
      const list = await pending.promise;
      deps?.onResult?.({ fromCache: false });
      return list;
    });

    render(<HomePage />);
    expect(screen.getByRole('heading', { name: '舊橫幅' })).toBeTruthy();

    await act(async () => {
      pending.resolve([banner({ id: 'new', title: '新橫幅' })]);
    });

    expect(await screen.findByRole('heading', { name: '新橫幅' })).toBeTruthy();
    const stored = JSON.parse(localStorage.getItem(BANNERS_SNAPSHOT_KEY) as string) as {
      appVersion: string;
      savedAt: number;
      items: Array<{ id: string }>;
    };
    expect(stored.appVersion).toBe(APP_VERSION);
    expect(stored.items.map((i) => i.id)).toEqual(['new']);
    // 時間戳也更新了（原本是 10 分鐘前寫的）
    expect(Date.now() - stored.savedAt).toBeLessThan(MIN);
  });

  it('不是確認新取得（離線時 Firestore 回持久快取）：不更新快照、不取代畫面上的快照橫幅', async () => {
    seedBanners([banner({ id: 'snap', title: '快照橫幅' })], Date.now() - 10 * MIN);
    const before = localStorage.getItem(BANNERS_SNAPSHOT_KEY);
    let result!: Promise<BannerDoc[]>;
    vi.mocked(loadActiveBanners).mockImplementation((deps) => {
      deps?.onResult?.({ fromCache: true });
      result = Promise.resolve([banner({ id: 'cache', title: '快取橫幅' })]);
      return result;
    });

    render(<HomePage />);
    // HomePage 的 .then 先於這裡登記，所以這個 await 回來時它已經跑完。
    await act(async () => {
      await result;
    });

    expect(screen.getByRole('heading', { name: '快照橫幅' })).toBeTruthy();
    expect(screen.queryByText('快取橫幅')).toBeNull();
    expect(localStorage.getItem(BANNERS_SNAPSHOT_KEY)).toBe(before);
  });

  it('沒有任何快照時，離線快取回來的橫幅照常顯示（T-041 以來的行為），但不寫快照', async () => {
    vi.mocked(loadActiveBanners).mockImplementation(bannersResult([banner({ id: 'cache', title: '快取橫幅' })], true));

    render(<HomePage />);

    expect(await screen.findByRole('heading', { name: '快取橫幅' })).toBeTruthy();
    expect(localStorage.getItem(BANNERS_SNAPSHOT_KEY)).toBeNull();
  });

  it('讀不到 fromCache 旗標（undefined）一律當作不是確認新取得，不寫快照', async () => {
    vi.mocked(loadActiveBanners).mockImplementation(bannersResult([banner({ id: 'x', title: '旗標不明' })], 'unknown'));

    render(<HomePage />);

    expect(await screen.findByRole('heading', { name: '旗標不明' })).toBeTruthy();
    expect(localStorage.getItem(BANNERS_SNAPSHOT_KEY)).toBeNull();
  });

  it('超過 30 分鐘的快照只留骨架：不畫橫幅文字', () => {
    seedBanners([banner({ id: 'b1', title: '過期橫幅' })], staleAt());
    vi.mocked(loadActiveBanners).mockReturnValue(deferred<BannerDoc[]>().promise);

    const { container } = render(<HomePage />);

    expect(container.querySelector('.skeleton-slide')).toBeTruthy();
    expect(screen.queryByText('過期橫幅')).toBeNull();
  });

  it('版本不同的快照只留骨架', () => {
    localStorage.setItem(
      BANNERS_SNAPSHOT_KEY,
      JSON.stringify({
        v: 1,
        appVersion: '0.20200101',
        savedAt: Date.now(),
        items: [{ id: 'b1', _docId: 'b1', title: '舊版寫的橫幅' }],
      }),
    );
    vi.mocked(loadActiveBanners).mockReturnValue(deferred<BannerDoc[]>().promise);

    const { container } = render(<HomePage />);

    expect(container.querySelector('.skeleton-slide')).toBeTruthy();
    expect(screen.queryByText('舊版寫的橫幅')).toBeNull();
  });

  it('伺服器讀取失敗時，保留畫面上的快照橫幅，也不動快照', async () => {
    seedBanners([banner({ id: 'b1', title: '快照橫幅' })]);
    const before = localStorage.getItem(BANNERS_SNAPSHOT_KEY);
    let result!: Promise<BannerDoc[]>;
    // 讀取失敗：loadActiveBanners 回 []，而且不回報結果（沒有呼叫 onResult）
    vi.mocked(loadActiveBanners).mockImplementation(() => {
      result = Promise.resolve([]);
      return result;
    });

    render(<HomePage />);
    // HomePage 的 .then 先於這裡登記，所以這個 await 回來時它已經跑完。
    await act(async () => {
      await result;
    });

    expect(screen.getByRole('heading', { name: '快照橫幅' })).toBeTruthy();
    expect(localStorage.getItem(BANNERS_SNAPSHOT_KEY)).toBe(before);
  });

  it('伺服器確認「沒有橫幅」時，清掉畫面上的快照橫幅與快照', async () => {
    seedBanners([banner({ id: 'b1', title: '已下架橫幅' })]);
    const pending = deferred<BannerDoc[]>();
    vi.mocked(loadActiveBanners).mockImplementation(async (deps) => {
      const list = await pending.promise;
      deps?.onResult?.({ fromCache: false });
      return list;
    });

    const { container } = render(<HomePage />);
    expect(screen.getByRole('heading', { name: '已下架橫幅' })).toBeTruthy();

    await act(async () => {
      pending.resolve([]);
    });

    await waitFor(() => expect(container.querySelector('.skeleton-slide')).toBeTruthy());
    expect(localStorage.getItem(BANNERS_SNAPSHOT_KEY)).toBeNull();
  });

  it('畫面卸載後才回來的舊請求不能覆寫快照；兩個畫面先後讀取時，只有現在這個畫面的結果會寫', async () => {
    seedBanners([banner({ id: 'seed', title: '種子' })], Date.now() - 5 * MIN);
    const first = deferred<BannerDoc[]>();
    const second = deferred<BannerDoc[]>();
    const queue = [first, second];
    vi.mocked(loadActiveBanners).mockImplementation(async (deps) => {
      const list = await (queue.shift() as ReturnType<typeof deferred<BannerDoc[]>>).promise;
      deps?.onResult?.({ fromCache: false });
      return list;
    });

    // 第一個畫面還沒收到回應就被卸載，接著第二個畫面開始並先收到回應。
    const view1 = render(<HomePage />);
    view1.unmount();
    cleanup();
    render(<HomePage />);
    await act(async () => {
      second.resolve([banner({ id: 'new', title: '新一輪' })]);
    });
    await screen.findByRole('heading', { name: '新一輪' });

    // 第一個（已卸載）畫面的舊請求晚到：不得覆寫較新的快照。
    await act(async () => {
      first.resolve([banner({ id: 'old', title: '舊一輪' })]);
    });
    const stored = JSON.parse(localStorage.getItem(BANNERS_SNAPSHOT_KEY) as string) as { items: Array<{ id: string }> };
    expect(stored.items.map((i) => i.id)).toEqual(['new']);
    expect(screen.queryByText('舊一輪')).toBeNull();
  });
});

describe('HomePage 首屏快照：掛載後跨過 30 分鐘就撤掉（時間用假時鐘，不真的等）', () => {
  const T0 = Date.UTC(2026, 9, 27, 3, 0, 0);
  // 首頁每分鐘會因為 useEvents 的計時器重新 render 一次（整分鐘對齊掛載時間），而選用快照時會再檢查期限——
  // 所以到期時間刻意放在「整分鐘之間」，並且把頁面其他會觸發 render 的非同步工作先做完（settle）：
  // 這樣到期後畫面能變，就只可能是效期 hook（計時器／可見性）自己撤掉的，不是被別的 render 順便帶掉。
  const settle = async (): Promise<void> => {
    await act(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    });
  };

  it('橫幅：計時器在到期那一刻就撤掉（不等下一分鐘的 render），回到骨架', async () => {
    vi.useFakeTimers({ now: T0 });
    // 到期時間 = T0 + 25 分 17 秒
    seedBanners([banner({ id: 'b1', title: '快到期的橫幅' })], T0 - 5 * MIN + 17_000);
    vi.mocked(loadActiveBanners).mockReturnValue(deferred<BannerDoc[]>().promise);
    mockEvents(() => new Promise(() => undefined));

    const { container } = render(<HomePage />);
    expect(screen.getByText('快到期的橫幅')).toBeTruthy();

    await act(async () => {
      vi.advanceTimersByTime(25 * MIN + 10_000);
    });
    expect(screen.getByText('快到期的橫幅')).toBeTruthy();

    // 25:30——下一次整分鐘的 render 在 26:00，所以這時畫面變了就是計時器撤的
    await act(async () => {
      vi.advanceTimersByTime(20_000);
    });
    expect(screen.queryByText('快到期的橫幅')).toBeNull();
    expect(container.querySelector('.skeleton-slide')).toBeTruthy();
  });

  it('橫幅：背景分頁的計時器被延後時，回到可見（visibilitychange）立刻撤掉', async () => {
    vi.useFakeTimers({ now: T0, toFake: ['Date'] });
    seedBanners([banner({ id: 'b1', title: '快到期的橫幅' })], T0 - 29 * MIN);
    vi.mocked(loadActiveBanners).mockReturnValue(deferred<BannerDoc[]>().promise);
    mockEvents(() => new Promise(() => undefined));

    render(<HomePage />);
    await settle();
    expect(screen.getByText('快到期的橫幅')).toBeTruthy();

    vi.setSystemTime(T0 + 2 * MIN);
    // 時間過了但沒有任何 render：畫面還是舊的
    expect(screen.getByText('快到期的橫幅')).toBeTruthy();
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(screen.queryByText('快到期的橫幅')).toBeNull();
  });

  it('運動統計：計時器在到期那一刻就撤掉「N 活動」，活動一直讀不回來也不再顯示舊統計', async () => {
    vi.useFakeTimers({ now: T0 });
    writeSportsSnapshot(guestRowsOf({ football: 7 }), T0 - 5 * MIN + 17_000);
    mockEvents(() => new Promise(() => undefined));

    const { container } = render(<HomePage />);
    expect(footballCount(container)).toBe('7 活動');

    await act(async () => {
      vi.advanceTimersByTime(25 * MIN + 10_000);
    });
    expect(footballCount(container)).toBe('7 活動');
    await act(async () => {
      vi.advanceTimersByTime(20_000);
    });
    expect(footballChip(container)).toBeNull();
    expect(container.querySelector('#home-sport-entry')?.textContent ?? '').not.toMatch(/\d+\s*活動/);
  });

  it('運動統計：讀取失敗的頁面跨過 30 分鐘後，回到可見（visibilitychange）立刻撤掉', async () => {
    vi.useFakeTimers({ now: T0, toFake: ['Date'] });
    writeSportsSnapshot(guestRowsOf({ football: 7 }), T0 - 29 * MIN);
    mockEvents(() => Promise.reject(new Error('offline')));

    const { container } = render(<HomePage />);
    await settle();
    // 讀取失敗、沒有任何上次資料：沿用快照
    expect(footballCount(container)).toBe('7 活動');

    vi.setSystemTime(T0 + 2 * MIN);
    expect(footballCount(container)).toBe('7 活動');
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(footballChip(container)).toBeNull();
  });
});

describe('HomePage 橫幅圖：<img>（第一張高優先、其餘延遲載入）', () => {
  it('第一張 fetchpriority=high＋eager，其餘 lazy；有 width／height，不再用 background-image', async () => {
    vi.mocked(loadActiveBanners).mockResolvedValue([
      banner({ id: 'b1', title: 'A', image: 'https://example.com/home-1.webp' }),
      banner({ id: 'b2', title: 'B', image: 'https://example.com/home-2.webp' }),
    ]);

    const { container } = render(<HomePage />);
    await waitFor(() => expect(container.querySelectorAll('#banner-track img.banner-slide-img').length).toBe(2));

    const imgs = Array.from(container.querySelectorAll<HTMLImageElement>('#banner-track img.banner-slide-img'));
    expect(imgs[0]?.getAttribute('fetchpriority')).toBe('high');
    expect(imgs[0]?.getAttribute('loading')).toBe('eager');
    expect(imgs[1]?.getAttribute('fetchpriority')).toBeNull();
    expect(imgs[1]?.getAttribute('loading')).toBe('lazy');
    for (const img of imgs) {
      expect(img.getAttribute('width')).toBe('1200');
      expect(img.getAttribute('height')).toBe('545');
      expect(img.getAttribute('alt')).toBe('');
    }
    expect(imgs.map((i) => i.getAttribute('src'))).toEqual([
      'https://example.com/home-1.webp',
      'https://example.com/home-2.webp',
    ]);
    for (const slide of Array.from(container.querySelectorAll<HTMLElement>('#banner-track .banner-slide'))) {
      expect(slide.getAttribute('style') ?? '').not.toContain('background-image');
    }
  });

  it('沒有圖片網址的橫幅仍走漸層底色，不產生 <img>', async () => {
    vi.mocked(loadActiveBanners).mockResolvedValue([
      banner({ id: 'b1', title: 'A', gradient: 'linear-gradient(#000, #333)' }),
    ]);

    const { container } = render(<HomePage />);
    await waitFor(() => expect(container.querySelectorAll('#banner-track .banner-slide').length).toBe(1));

    expect(container.querySelector('#banner-track img')).toBeNull();
    expect(container.querySelector('.banner-placeholder')).toBeTruthy();
  });
});

describe('HomePage 首屏快照：運動統計', () => {
  it('活動還在讀時，用快照的統計先畫（不等登入確認），確認新取得後換成即時結果並更新快照', async () => {
    writeSportsSnapshot(guestRowsOf({ football: 7 }), Date.now() - 10 * MIN);
    const pending = deferred<unknown>();
    mockEvents(() => pending.promise, [
      ev('e1'),
      ev('e2', { date: '2030/10/21 18:00~20:00' }),
      ev('e3', { privateEvent: true, creatorUid: 'u1' }),
    ]);

    const { container } = render(<HomePage />);
    expect(footballCount(container)).toBe('7 活動');

    await act(async () => {
      pending.resolve(['events']);
    });

    await waitFor(() => expect(footballCount(container)).toBe('2 活動'));
    const stored = JSON.parse(localStorage.getItem(SPORTS_SNAPSHOT_KEY) as string) as {
      savedAt: number;
      items: Array<{ key: string; count: number }>;
    };
    expect(stored.items).toEqual([{ key: 'football', count: 2 }]);
    expect(Date.now() - stored.savedAt).toBeLessThan(MIN);
  });

  it('管理員（有最高權限）開首頁寫出的快照也不含私密／俱樂部限定活動：快照內容只可能由訪客視角算出', async () => {
    vi.mocked(useViewer).mockReturnValue(makeViewer('admin1', 4));
    mockEvents(() => Promise.resolve(['events']), [
      ev('e1'),
      ev('e2', { privateEvent: true, creatorUid: 'someone' }),
      ev('e3', { teamOnly: true, creatorUid: 'someone', creatorTeamId: 't1' }),
      ev('e4', { sportTag: 'tennis', privateEvent: true, creatorUid: 'someone' }),
    ]);

    const { container } = render(<HomePage />);
    await waitFor(() => expect(footballCount(container)).toBe('1 活動'));

    const raw = localStorage.getItem(SPORTS_SNAPSHOT_KEY) as string;
    const stored = JSON.parse(raw) as { items: Array<{ key: string; count: number }> };
    expect(stored.items).toEqual([{ key: 'football', count: 1 }]);
    expect(raw).not.toContain('admin1');
    expect(raw).not.toContain('tennis');
  });

  it('超過 30 分鐘的快照只留骨架：不顯示任何「N 活動」', () => {
    writeSportsSnapshot(guestRowsOf({ football: 7 }), staleAt());
    mockEvents(() => new Promise(() => undefined));

    const { container } = render(<HomePage />);

    expect(footballChip(container)).toBeNull();
    expect(container.querySelector('#home-sport-entry')?.textContent ?? '').not.toMatch(/\d+\s*活動/);
  });

  it('確認「目前沒有活動」後不再沿用快照；之後重試（讀取中或失敗）也不會又退回舊統計', async () => {
    writeSportsSnapshot(guestRowsOf({ football: 7 }), Date.now() - 5 * MIN);
    const calls: Array<(value: unknown) => void> = [];
    const rejects: Array<(reason: unknown) => void> = [];
    mockEvents(() => new Promise((resolve, reject) => {
      calls.push(resolve);
      rejects.push(reject);
    }), []);

    const { container } = render(<HomePage />);
    expect(footballCount(container)).toBe('7 活動');

    // events-repo 是動態載入的，等它真的開始查詢才回應
    await waitFor(() => expect(calls).toHaveLength(1));
    await act(async () => {
      calls[0]?.(['events']);
    });
    await waitFor(() => expect(footballChip(container)).toBeNull());

    // 重試（開團存檔後會重新整理）：讀取中
    await act(async () => {
      capturedRefresh?.();
    });
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(footballChip(container)).toBeNull();

    // 重試失敗
    await act(async () => {
      rejects[1]?.(new Error('offline'));
    });
    expect(footballChip(container)).toBeNull();
  });

  it('活動讀取失敗、又沒有任何上次資料時，沿用 30 分鐘內的快照統計', async () => {
    writeSportsSnapshot(guestRowsOf({ football: 7 }));
    let result!: Promise<unknown>;
    mockEvents(() => {
      result = Promise.reject(new Error('offline'));
      return result;
    });

    const { container } = render(<HomePage />);
    await waitFor(() => expect(result).toBeDefined());
    await act(async () => {
      await result.catch(() => undefined);
    });

    expect(footballCount(container)).toBe('7 活動');
  });

  it('不是確認新取得（離線時的持久快取）：有活動就照常顯示、但不更新快照；空的快取不會撤掉快照', async () => {
    writeSportsSnapshot(guestRowsOf({ football: 7 }), Date.now() - 10 * MIN);
    const before = localStorage.getItem(SPORTS_SNAPSHOT_KEY);

    // 快取有 2 場：顯示快取算出的數字，快照不動
    mockEvents(() => Promise.resolve(['events']), [ev('c1'), ev('c2')], true);
    const first = render(<HomePage />);
    await waitFor(() => expect(footballCount(first.container)).toBe('2 活動'));
    expect(localStorage.getItem(SPORTS_SNAPSHOT_KEY)).toBe(before);
    cleanup();

    // 快取是空的：不能當成「確認沒有活動」，繼續用快照
    _resetUseEventsForTest();
    mockEvents(() => Promise.resolve(['events']), [], true);
    const second = render(<HomePage />);
    const witness = render(<EventsWitness />);
    await waitForWitness(witness);
    expect(footballCount(second.container)).toBe('7 活動');
    expect(localStorage.getItem(SPORTS_SNAPSHOT_KEY)).toBe(before);
  });

  it('畫面卸載後才回來的活動結果不寫快照', async () => {
    writeSportsSnapshot(guestRowsOf({ football: 7 }), Date.now() - 10 * MIN);
    const before = localStorage.getItem(SPORTS_SNAPSHOT_KEY);
    const pending = deferred<unknown>();
    mockEvents(() => pending.promise, [ev('late1'), ev('late2'), ev('late3')]);

    const view = render(<HomePage />);
    await waitFor(() => expect(getEventsRepo).toHaveBeenCalled());
    view.unmount();
    const witness = render(<EventsWitness />);
    pending.resolve(['events']);
    await waitForWitness(witness);

    expect(localStorage.getItem(SPORTS_SNAPSHOT_KEY)).toBe(before);
  });
});

describe('HomePage 首屏快照：訪客視角的公開資料，沒有帳號歸屬（顧問裁定 P1-1 採 A）', () => {
  // 伺服器回來的活動：e3 黑名單擋住 u1；e4 私密（u1 自己開的）；e5 俱樂部限定（u1 的球隊）。
  // 首頁運動統計對所有人都不計私密／俱樂部限定活動（既有規則）；黑名單是唯一會讓登入者與訪客視角不同的條件。
  const SERVER_EVENTS = [
    ev('e1'),
    ev('e2', { date: '2030/10/21 18:00~20:00' }),
    ev('e3', { date: '2030/10/22 18:00~20:00', blockedUids: ['u1'] }),
    ev('e4', { privateEvent: true, creatorUid: 'u1' }),
    ev('e5', { teamOnly: true, creatorUid: 'someone', creatorTeamId: 't1' }),
  ];
  const viewers: Array<[string, () => ViewerView]> = [
    ['u1', () => makeViewer('u1', 0, ['t1'])],
    ['u2', () => makeViewer('u2')],
    ['訪客', () => makeViewer(null)],
    ['管理員', () => makeViewer('admin1', 4)],
  ];

  async function snapshotWrittenBy(viewer: ViewerView): Promise<{ items: unknown; raw: string }> {
    _resetUseEventsForTest();
    _clearHomeSnapshotForTest();
    vi.mocked(useViewer).mockReturnValue(viewer);
    vi.mocked(loadActiveBanners).mockImplementation(
      bannersResult([banner({ id: 'b1', title: '公開橫幅', image: 'https://example.com/1.webp', linkUrl: 'https://example.com/go' })]),
    );
    mockEvents(() => Promise.resolve(['events']), SERVER_EVENTS);
    const view = render(<HomePage />);
    await view.findByRole('heading', { name: '公開橫幅' });
    await waitFor(() => expect(localStorage.getItem(SPORTS_SNAPSHOT_KEY)).not.toBeNull());
    await waitFor(() => expect(localStorage.getItem(BANNERS_SNAPSHOT_KEY)).not.toBeNull());
    view.unmount();
    cleanup();
    const sports = JSON.parse(localStorage.getItem(SPORTS_SNAPSHOT_KEY) as string) as { items: unknown; savedAt: number };
    const banners = JSON.parse(localStorage.getItem(BANNERS_SNAPSHOT_KEY) as string) as { items: unknown; savedAt: number };
    // 時間戳每次不同，比對內容時拿掉
    return { items: { sports: sports.items, banners: banners.items }, raw: (localStorage.getItem(SPORTS_SNAPSHOT_KEY) ?? '') + (localStorage.getItem(BANNERS_SNAPSHOT_KEY) ?? '') };
  }

  it('u1／u2／訪客／管理員開首頁，寫出的快照內容完全相同，而且不含任何帳號資料或非訪客可見的資料', async () => {
    const written = [];
    for (const [name, make] of viewers) written.push({ name, ...(await snapshotWrittenBy(make())) });

    const [first, ...rest] = written;
    for (const other of rest) expect(other.items, `${other.name} 與 ${first?.name}`).toEqual(first?.items);
    // 內容就是訪客視角：e1、e2、e3 三場公開活動（e3 的黑名單只擋 u1 的畫面，不影響訪客視角）；私密與俱樂部限定不計
    expect(first?.items).toMatchObject({ sports: [{ key: 'football', count: 3 }] });
    for (const w of written) {
      for (const secret of ['u1', 'u2', 'admin1', 'blockedUids', 'creatorUid', 'teamOnly']) {
        expect(w.raw, `${w.name} 的快照不應含 ${secret}`).not.toContain(secret);
      }
    }
  });

  it('第一位使用者寫的快照，訪客或另一個帳號開啟也直接用（沒有帳號歸屬可言）', async () => {
    await snapshotWrittenBy(makeViewer('u1', 0, ['t1']));

    for (const nextViewer of [makeViewer(null), makeViewer('u2')]) {
      cleanup();
      _resetUseEventsForTest();
      vi.mocked(useViewer).mockReturnValue(nextViewer);
      vi.mocked(loadActiveBanners).mockReturnValue(deferred<BannerDoc[]>().promise);
      mockEvents(() => new Promise(() => undefined));

      const { container } = render(<HomePage />);

      expect(screen.getByRole('heading', { name: '公開橫幅' })).toBeTruthy();
      expect(footballCount(container)).toBe('3 活動');
    }
  });

  it('登入者的最終畫面一律以正式資料取代快照：先看到訪客視角的快照，活動讀回後改成自己看得到的數字；快照維持訪客視角', async () => {
    // 先有一份快照（訪客視角，例如昨天的訪客或別的帳號寫的）：football 7
    writeSportsSnapshot(guestRowsOf({ football: 7 }), Date.now() - 10 * MIN);
    vi.mocked(useViewer).mockReturnValue(makeViewer('u1', 0, ['t1']));
    const pending = deferred<unknown>();
    mockEvents(() => pending.promise, SERVER_EVENTS);

    const { container } = render(<HomePage />);
    // 活動還在讀：登入者先看到快照（訪客視角）——黑名單登入者會短暫看到訪客視角統計，與 T-041 P3-4 同一件事，已接受
    expect(footballCount(container)).toBe('7 活動');

    await act(async () => {
      pending.resolve(['events']);
    });

    // 正式資料：e1、e2 公開；e3 被黑名單擋住（對 u1 不可見）；私密與俱樂部限定活動依首頁既有規則對所有人都不計
    await waitFor(() => expect(footballCount(container)).toBe('2 活動'));
    // 快照本身維持訪客視角（e1、e2、e3＝3），不是 u1 的視角
    const stored = JSON.parse(localStorage.getItem(SPORTS_SNAPSHOT_KEY) as string) as { items: Array<{ key: string; count: number }> };
    expect(stored.items).toEqual([{ key: 'football', count: 3 }]);
  });
});
