import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/preact';
import { _resetFirebaseForTest } from '@/data/firebase';
import { getEventsRepo } from '@/features/events/data/events-repo';
import { _resetUseEventsForTest } from '@/features/events/data/use-events';
import { useViewer, type ViewerView } from '@/features/profile/data/viewer';
import { APP_VERSION } from '@/version';
import { loadActiveAnnouncements } from '../data/announcements';
import { loadActiveBanners, type BannerDoc } from '../data/banners';
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

// T-042 首屏快照：回訪時第一次 render 就畫橫幅與運動統計；過期／版本不同只留骨架；背景讀取照常進行；與帳號無關。

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

function mockEvents(load: () => Promise<unknown>, active: object[] = []): void {
  vi.mocked(getEventsRepo).mockReturnValue({
    loadEventsStatic: vi.fn().mockImplementation(load),
    ensureTerminalEventsLoaded: vi.fn().mockResolvedValue(['events']),
    loadMoreTerminalEvents: vi.fn().mockResolvedValue(0),
    getSnapshot: () => ({ active, terminal: [] }),
  } as unknown as ReturnType<typeof getEventsRepo>);
}

const STALE_AT = (): number => Date.now() - HOME_SNAPSHOT_MAX_AGE_MS - 60_000;

async function flush(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 8; i += 1) await Promise.resolve();
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  _resetUseEventsForTest();
  _clearHomeSnapshotForTest();
  vi.mocked(useViewer).mockReturnValue(makeViewer('u1'));
  vi.mocked(resolveNextActivity).mockResolvedValue(null);
  vi.mocked(loadActiveBanners).mockResolvedValue([]);
  vi.mocked(loadActiveAnnouncements).mockResolvedValue([]);
  mockEvents(() => Promise.resolve(['events']));
});

afterEach(() => {
  cleanup();
  _resetFirebaseForTest();
  _clearHomeSnapshotForTest();
});

describe('HomePage 首屏快照：橫幅', () => {
  it('30 分鐘內、同版本的快照在第一次 render 就畫出橫幅文字，網路還沒回來也不顯示骨架；背景讀取照常發出', () => {
    writeBannersSnapshot([banner({ id: 'b1', title: '週末熱血開踢', subtitle: '立即加入附近球局' })]);
    const pending = deferred<BannerDoc[]>();
    vi.mocked(loadActiveBanners).mockReturnValue(pending.promise);

    const { container } = render(<HomePage />);

    expect(screen.getByRole('heading', { name: '週末熱血開踢' })).toBeTruthy();
    expect(screen.getByText('立即加入附近球局')).toBeTruthy();
    expect(container.querySelector('.skeleton-slide')).toBeNull();
    // 不做離線假設：有快照也照常向伺服器讀（快照只是先畫一版）。
    expect(loadActiveBanners).toHaveBeenCalledTimes(1);
  });

  it('伺服器讀回後換成新的橫幅，並更新快照', async () => {
    writeBannersSnapshot([banner({ id: 'old', title: '舊橫幅' })]);
    const pending = deferred<BannerDoc[]>();
    vi.mocked(loadActiveBanners).mockReturnValue(pending.promise);

    render(<HomePage />);
    expect(screen.getByRole('heading', { name: '舊橫幅' })).toBeTruthy();

    await act(async () => {
      pending.resolve([banner({ id: 'new', title: '新橫幅' })]);
    });

    expect(await screen.findByRole('heading', { name: '新橫幅' })).toBeTruthy();
    const stored = JSON.parse(localStorage.getItem(BANNERS_SNAPSHOT_KEY) as string) as {
      appVersion: string;
      items: Array<{ id: string }>;
    };
    expect(stored.appVersion).toBe(APP_VERSION);
    expect(stored.items.map((i) => i.id)).toEqual(['new']);
  });

  it('超過 30 分鐘的快照只留骨架：不畫橫幅文字', () => {
    writeBannersSnapshot([banner({ id: 'b1', title: '過期橫幅' })], STALE_AT());
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
    vi.mocked(loadActiveBanners).mockImplementation(async (deps) => {
      deps?.onFailure?.(new Error('offline'));
      return [];
    });

    render(<HomePage />);
    await flush();

    expect(screen.getByRole('heading', { name: '快照橫幅' })).toBeTruthy();
    expect(localStorage.getItem(BANNERS_SNAPSHOT_KEY)).toBe(before);
  });

  it('伺服器成功回傳「沒有橫幅」時，清掉畫面上的快照橫幅與快照', async () => {
    writeBannersSnapshot([banner({ id: 'b1', title: '已下架橫幅' })]);
    const pending = deferred<BannerDoc[]>();
    vi.mocked(loadActiveBanners).mockReturnValue(pending.promise);

    const { container } = render(<HomePage />);
    expect(screen.getByRole('heading', { name: '已下架橫幅' })).toBeTruthy();

    await act(async () => {
      pending.resolve([]);
    });

    await waitFor(() => expect(container.querySelector('.skeleton-slide')).toBeTruthy());
    expect(localStorage.getItem(BANNERS_SNAPSHOT_KEY)).toBeNull();
  });
});

describe('HomePage 橫幅圖：<img>（第一張高優先、其餘延遲載入）', () => {
  it('第一張 fetchpriority=high＋eager，其餘 lazy；有 width／height，不再用 background-image', async () => {
    vi.mocked(loadActiveBanners).mockResolvedValue([
      banner({ id: 'b1', title: 'A', image: 'https://example.com/1.webp' }),
      banner({ id: 'b2', title: 'B', image: 'https://example.com/2.webp' }),
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
      'https://example.com/1.webp',
      'https://example.com/2.webp',
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
  const FOOTBALL = { key: 'football', label: '足球', symbol: '⚽' };

  it('活動還在讀時，用快照的統計先畫（不等登入確認），讀回後換成即時結果並更新快照', async () => {
    writeSportsSnapshot([{ ...FOOTBALL, count: 7 }]);
    const pending = deferred<unknown>();
    mockEvents(() => pending.promise, [
      { id: 'e1', status: 'open', date: '2030/10/20 18:00~20:00', sportTag: 'football' },
      { id: 'e2', status: 'open', date: '2030/10/21 18:00~20:00', sportTag: 'football' },
      { id: 'e3', status: 'open', date: '2030/10/22 18:00~20:00', sportTag: 'football', privateEvent: true, creatorUid: 'u1' },
    ]);

    const { container } = render(<HomePage />);

    const chip = container.querySelector('.home-sport-chip[data-home-sport="football"]');
    expect(chip?.querySelector('.home-sport-chip-count')?.textContent).toBe('7 活動');

    await act(async () => {
      pending.resolve(['events']);
    });

    await waitFor(() => {
      expect(
        container.querySelector('.home-sport-chip[data-home-sport="football"] .home-sport-chip-count')?.textContent,
      ).toBe('2 活動');
    });
    const stored = JSON.parse(localStorage.getItem(SPORTS_SNAPSHOT_KEY) as string) as {
      items: Array<{ key: string; count: number }>;
    };
    expect(stored.items).toEqual([{ key: 'football', count: 2 }]);
  });

  it('超過 30 分鐘的快照只留骨架：不顯示任何「N 活動」', () => {
    writeSportsSnapshot([{ ...FOOTBALL, count: 7 }], STALE_AT());
    mockEvents(() => new Promise(() => undefined));

    const { container } = render(<HomePage />);

    expect(container.querySelector('.home-sport-chip[data-home-sport="football"]')).toBeNull();
    expect(container.querySelector('#home-sport-entry')?.textContent ?? '').not.toMatch(/\d+\s*活動/);
  });

  it('讀回「目前沒有活動」時，不再沿用快照的統計', async () => {
    writeSportsSnapshot([{ ...FOOTBALL, count: 7 }]);
    const pending = deferred<unknown>();
    mockEvents(() => pending.promise, []);

    const { container } = render(<HomePage />);
    expect(container.querySelector('.home-sport-chip[data-home-sport="football"]')).toBeTruthy();

    await act(async () => {
      pending.resolve(['events']);
    });

    await waitFor(() => expect(container.querySelector('.home-sport-chip[data-home-sport="football"]')).toBeNull());
  });

  it('活動讀取失敗、又沒有任何上次資料時，沿用 30 分鐘內的快照統計', async () => {
    writeSportsSnapshot([{ ...FOOTBALL, count: 7 }]);
    mockEvents(() => Promise.reject(new Error('offline')));

    const { container } = render(<HomePage />);
    await flush();

    expect(
      container.querySelector('.home-sport-chip[data-home-sport="football"] .home-sport-chip-count')?.textContent,
    ).toBe('7 活動');
  });
});

describe('HomePage 首屏快照：與帳號無關', () => {
  it.each([
    ['訪客', null],
    ['換成另一個帳號', 'u2'],
  ] as const)('第一位使用者寫的快照，%s 開啟也直接用，且快照裡沒有任何帳號資料', async (_label, nextUid) => {
    vi.mocked(loadActiveBanners).mockResolvedValue([
      banner({ id: 'b1', title: '公開橫幅', image: 'https://example.com/1.webp' }),
    ]);
    mockEvents(() => Promise.resolve(['events']), [
      { id: 'e1', status: 'open', date: '2030/10/20 18:00~20:00', sportTag: 'football' },
      { id: 'e2', status: 'open', date: '2030/10/21 18:00~20:00', sportTag: 'football', privateEvent: true, creatorUid: 'u1' },
    ]);

    // 第一位使用者（u1）：讀回後寫快照。
    const first = render(<HomePage />);
    await first.findByRole('heading', { name: '公開橫幅' });
    await waitFor(() => expect(localStorage.getItem(SPORTS_SNAPSHOT_KEY)).not.toBeNull());
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
    expect(
      container.querySelector('.home-sport-chip[data-home-sport="football"] .home-sport-chip-count')?.textContent,
    ).toBe('1 活動');
  });
});
