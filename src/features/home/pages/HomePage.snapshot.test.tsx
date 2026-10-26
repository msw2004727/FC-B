import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/preact';
import { _resetFirebaseForTest } from '@/data/firebase';
import { getEventsRepo } from '@/features/events/data/events-repo';
import { _resetUseEventsForTest } from '@/features/events/data/use-events';
import { useViewer, type ViewerView } from '@/features/profile/data/viewer';
import { APP_VERSION } from '@/version';
import { loadActiveAnnouncements } from '../data/announcements';
import { loadActiveBanners, type BannerDeps, type BannerDoc } from '../data/banners';
import {
  BANNERS_SNAPSHOT_KEY,
  HOME_SNAPSHOT_MAX_AGE_MS,
  SPORTS_SNAPSHOT_KEY,
  _clearHomeSnapshotForTest,
  writeBannersSnapshot,
  writeSportsSnapshot,
} from '../data/home-snapshot';
import { resolveNextActivity } from '../data/next-activity';
import HomePage from './HomePage';

// T-042 首屏快照：回訪時第一次 render 就畫橫幅與運動統計；過期／版本不同只留骨架（掛載後跨過 30 分鐘也要撤掉）；
// 背景讀取照常進行；只有「確認向伺服器新取得」的結果才更新快照；與帳號無關。

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

function makeViewer(uid: string | null, roleLevel = 0): ViewerView {
  return {
    uid,
    teamIds: new Set(),
    roleLevel,
    role: roleLevel >= 4 ? 'admin' : 'user',
    displayName: uid,
    pictureUrl: null,
    capabilities: [],
    hasPermission: () => roleLevel >= 4,
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

const MIN = 60 * 1000;
const staleAt = (): number => Date.now() - HOME_SNAPSHOT_MAX_AGE_MS - MIN;
const FOOTBALL = { key: 'football', label: '足球', symbol: '⚽' };
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
    writeBannersSnapshot([banner({ id: 'b1', title: '週末熱血開踢', subtitle: '立即加入附近球局' })]);
    vi.mocked(loadActiveBanners).mockReturnValue(deferred<BannerDoc[]>().promise);

    const { container } = render(<HomePage />);

    expect(screen.getByRole('heading', { name: '週末熱血開踢' })).toBeTruthy();
    expect(screen.getByText('立即加入附近球局')).toBeTruthy();
    expect(container.querySelector('.skeleton-slide')).toBeNull();
    // 不做離線假設：有快照也照常向伺服器讀（快照只是先畫一版）。
    expect(loadActiveBanners).toHaveBeenCalledTimes(1);
  });

  it('確認向伺服器新取得後換成新的橫幅，並更新快照', async () => {
    writeBannersSnapshot([banner({ id: 'old', title: '舊橫幅' })], Date.now() - 10 * MIN);
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
    writeBannersSnapshot([banner({ id: 'snap', title: '快照橫幅' })], Date.now() - 10 * MIN);
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
    writeBannersSnapshot([banner({ id: 'b1', title: '過期橫幅' })], staleAt());
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
    writeBannersSnapshot([banner({ id: 'b1', title: '快照橫幅' })]);
    const before = localStorage.getItem(BANNERS_SNAPSHOT_KEY);
    let result!: Promise<BannerDoc[]>;
    vi.mocked(loadActiveBanners).mockImplementation((deps) => {
      deps?.onFailure?.(new Error('offline'));
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
    writeBannersSnapshot([banner({ id: 'b1', title: '已下架橫幅' })]);
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
    writeBannersSnapshot([banner({ id: 'seed', title: '種子' })], Date.now() - 5 * MIN);
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

  it('橫幅：計時器到期後撤掉，回到骨架', async () => {
    vi.useFakeTimers({ now: T0 });
    writeBannersSnapshot([banner({ id: 'b1', title: '快到期的橫幅' })], T0);
    vi.mocked(loadActiveBanners).mockReturnValue(deferred<BannerDoc[]>().promise);

    const { container } = render(<HomePage />);
    expect(screen.getByText('快到期的橫幅')).toBeTruthy();

    await act(async () => {
      vi.advanceTimersByTime(HOME_SNAPSHOT_MAX_AGE_MS - 1000);
    });
    expect(screen.getByText('快到期的橫幅')).toBeTruthy();

    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    expect(screen.queryByText('快到期的橫幅')).toBeNull();
    expect(container.querySelector('.skeleton-slide')).toBeTruthy();
  });

  it('橫幅：背景分頁的計時器被延後時，回到可見（visibilitychange）立刻撤掉', async () => {
    vi.useFakeTimers({ now: T0, toFake: ['Date'] });
    writeBannersSnapshot([banner({ id: 'b1', title: '快到期的橫幅' })], T0 - 29 * MIN);
    vi.mocked(loadActiveBanners).mockReturnValue(deferred<BannerDoc[]>().promise);

    render(<HomePage />);
    expect(screen.getByText('快到期的橫幅')).toBeTruthy();

    vi.setSystemTime(T0 + 2 * MIN);
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(screen.queryByText('快到期的橫幅')).toBeNull();
  });

  it('運動統計：計時器到期後撤掉「N 活動」，活動一直讀不回來也不再顯示舊統計', async () => {
    vi.useFakeTimers({ now: T0 });
    writeSportsSnapshot([{ ...FOOTBALL, count: 7 }], T0);
    mockEvents(() => new Promise(() => undefined));

    const { container } = render(<HomePage />);
    expect(footballCount(container)).toBe('7 活動');

    await act(async () => {
      vi.advanceTimersByTime(HOME_SNAPSHOT_MAX_AGE_MS + 1000);
    });
    expect(footballChip(container)).toBeNull();
    expect(container.querySelector('#home-sport-entry')?.textContent ?? '').not.toMatch(/\d+\s*活動/);
  });

  it('運動統計：讀取失敗的頁面跨過 30 分鐘後也撤掉（visibilitychange）', async () => {
    vi.useFakeTimers({ now: T0, toFake: ['Date'] });
    writeSportsSnapshot([{ ...FOOTBALL, count: 7 }], T0 - 29 * MIN);
    mockEvents(() => Promise.reject(new Error('offline')));

    const { container } = render(<HomePage />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(footballCount(container)).toBe('7 活動');

    vi.setSystemTime(T0 + 2 * MIN);
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
    writeSportsSnapshot([{ ...FOOTBALL, count: 7 }], Date.now() - 10 * MIN);
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
    writeSportsSnapshot([{ ...FOOTBALL, count: 7 }], staleAt());
    mockEvents(() => new Promise(() => undefined));

    const { container } = render(<HomePage />);

    expect(footballChip(container)).toBeNull();
    expect(container.querySelector('#home-sport-entry')?.textContent ?? '').not.toMatch(/\d+\s*活動/);
  });

  it('確認「目前沒有活動」後不再沿用快照；之後重試（讀取中或失敗）也不會又退回舊統計', async () => {
    writeSportsSnapshot([{ ...FOOTBALL, count: 7 }], Date.now() - 5 * MIN);
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
    writeSportsSnapshot([{ ...FOOTBALL, count: 7 }]);
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
    writeSportsSnapshot([{ ...FOOTBALL, count: 7 }], Date.now() - 10 * MIN);
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
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(footballCount(second.container)).toBe('7 活動');
    expect(localStorage.getItem(SPORTS_SNAPSHOT_KEY)).toBe(before);
  });

  it('畫面卸載後才回來的活動結果不寫快照', async () => {
    writeSportsSnapshot([{ ...FOOTBALL, count: 7 }], Date.now() - 10 * MIN);
    const before = localStorage.getItem(SPORTS_SNAPSHOT_KEY);
    const pending = deferred<unknown>();
    mockEvents(() => pending.promise, [ev('late1'), ev('late2'), ev('late3')]);

    const view = render(<HomePage />);
    await waitFor(() => expect(getEventsRepo).toHaveBeenCalled());
    view.unmount();
    cleanup();
    pending.resolve(['events']);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(localStorage.getItem(SPORTS_SNAPSHOT_KEY)).toBe(before);
  });
});

describe('HomePage 首屏快照：與帳號無關', () => {
  it.each([
    ['訪客', null],
    ['換成另一個帳號', 'u2'],
  ] as const)('第一位使用者寫的快照，%s 開啟也直接用，且快照裡沒有任何帳號資料', async (_label, nextUid) => {
    vi.mocked(loadActiveBanners).mockImplementation(
      bannersResult([banner({ id: 'b1', title: '公開橫幅', image: 'https://example.com/1.webp' })]),
    );
    mockEvents(() => Promise.resolve(['events']), [ev('e1'), ev('e2', { privateEvent: true, creatorUid: 'u1' })]);

    // 第一位使用者（u1）：確認新取得後寫快照。
    const first = render(<HomePage />);
    await first.findByRole('heading', { name: '公開橫幅' });
    await waitFor(() => expect(localStorage.getItem(SPORTS_SNAPSHOT_KEY)).not.toBeNull());
    await waitFor(() => expect(localStorage.getItem(BANNERS_SNAPSHOT_KEY)).not.toBeNull());
    first.unmount();
    cleanup();

    for (const key of [BANNERS_SNAPSHOT_KEY, SPORTS_SNAPSHOT_KEY]) {
      expect(localStorage.getItem(key) as string).not.toContain('u1');
    }

    // 下一位：網路都還沒回來，第一次 render 就要有畫面。
    _resetUseEventsForTest();
    vi.mocked(useViewer).mockReturnValue(makeViewer(nextUid));
    vi.mocked(loadActiveBanners).mockReturnValue(deferred<BannerDoc[]>().promise);
    mockEvents(() => new Promise(() => undefined));

    const { container } = render(<HomePage />);

    expect(screen.getByRole('heading', { name: '公開橫幅' })).toBeTruthy();
    expect(footballCount(container)).toBe('1 活動');
  });
});
