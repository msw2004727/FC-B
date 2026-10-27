import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/preact';
import { _resetFirebaseForTest, isLocalOrPrivateHostname, shouldUseEmulator } from '@/data/firebase';
import { getEventsRepo } from '@/features/events/data/events-repo';
import { _resetUseEventsForTest } from '@/features/events/data/use-events';
import { useViewer, type ViewerView } from '@/features/profile/data/viewer';
import { loadActiveAnnouncements } from '../data/announcements';
import { loadActiveBanners, type BannerDeps, type BannerDoc } from '../data/banners';
import { _resetBannersRestForTest } from '../data/banners-rest';
import {
  BANNERS_SNAPSHOT_KEY,
  _clearHomeSnapshotForTest,
  toPublicBanners,
  writeBannersSnapshot,
} from '../data/home-snapshot';
import { resolveNextActivity } from '../data/next-activity';
import { restActiveFields, restDoc, restEmptyMarker, restStr } from '../data/__fixtures__/banners-rest';
import HomePage from './HomePage';

// T-042d：index.html 內嵌 script 提早發出的 REST（window.__fcbEarlyBanners）由 HomePage 接手：映射、toPublicBanners 白名單、快照寫入守門
// 都還在 HomePage 這一側；暖啟動、emulator、本機網址一律不接手；早期請求失敗只退回 SDK、不補發第二次 REST。
// fetch 全部是假的（預設一呼叫就失敗並計數，用來證明「沒有自己再發」），不對任何線上端點發請求。

vi.mock('@/data/firebase', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/data/firebase')>()),
  shouldUseEmulator: vi.fn(),
  isLocalOrPrivateHostname: vi.fn(),
}));

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

vi.mock('@/features/events/components/event-form/use-event-form-post-save', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/events/components/event-form/use-event-form-post-save')>()),
  useEventFormPostSave: () => vi.fn(),
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
    teamIds: new Set<string>(),
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

const restBanner = (id: string, title: string, extra: Record<string, unknown> = {}): Record<string, unknown> =>
  restDoc(id, restActiveFields({ title: restStr(title), ...extra }));

function sdkConfirmedAfter(gate: Promise<BannerDoc[]>): (deps?: BannerDeps) => Promise<BannerDoc[]> {
  return async (deps) => {
    const list = await gate;
    deps?.onResult?.({ fromCache: false });
    return list;
  };
}

function snapshotIds(): string[] | null {
  const raw = localStorage.getItem(BANNERS_SNAPSHOT_KEY);
  return raw ? (JSON.parse(raw) as { items: Array<{ id: string }> }).items.map((i) => i.id) : null;
}

async function flush(): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });
}

const aboutRest = (spy: { mock: { calls: unknown[][] } }): unknown[][] =>
  spy.mock.calls.filter((args) => /banners?-rest|failed to fetch|runQuery|firestore\.googleapis|AbortError/i.test(args.map(String).join(' ')));
const heading = (name: string): HTMLElement | null => screen.queryByRole('heading', { name });

let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;

beforeEach(() => {
  vi.resetAllMocks();
  _resetBannersRestForTest();
  delete window.__fcbEarlyBanners;
  vi.mocked(shouldUseEmulator).mockReturnValue(false);
  vi.mocked(isLocalOrPrivateHostname).mockReturnValue(false);
  _resetUseEventsForTest();
  _clearHomeSnapshotForTest();
  vi.mocked(useViewer).mockReturnValue(makeViewer('u1'));
  vi.mocked(resolveNextActivity).mockResolvedValue(null);
  vi.mocked(loadActiveAnnouncements).mockResolvedValue([]);
  vi.mocked(loadActiveBanners).mockImplementation(sdkConfirmedAfter(Promise.resolve([])));
  vi.mocked(getEventsRepo).mockReturnValue({
    loadEventsStatic: vi.fn().mockResolvedValue(['events']),
    ensureTerminalEventsLoaded: vi.fn().mockResolvedValue(['events']),
    loadMoreTerminalEvents: vi.fn().mockResolvedValue(0),
    getSnapshot: () => ({ active: [], terminal: [], activeFromCache: false }),
  } as unknown as ReturnType<typeof getEventsRepo>);
  // 任何自己發的 REST 都算一次呼叫（並失敗）：早期請求接手的案例要證明這個計數是 0。
  fetchMock = vi.fn<typeof fetch>(async () => {
    throw new TypeError('Failed to fetch');
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  delete window.__fcbEarlyBanners;
  _resetFirebaseForTest();
  _clearHomeSnapshotForTest();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('HomePage 接手 index.html 提早發出的橫幅請求', () => {
  it('早期回應先到：畫出 hero 並經 toPublicBanners 寫入快照；沒有自己再發 REST；SDK 的正式資料之後取代它', async () => {
    const early = deferred<unknown>();
    window.__fcbEarlyBanners = early.promise;
    const sdk = deferred<BannerDoc[]>();
    vi.mocked(loadActiveBanners).mockImplementation(sdkConfirmedAfter(sdk.promise));

    const { container } = render(<HomePage />);
    expect(container.querySelector('.skeleton-slide')).not.toBeNull();
    expect(snapshotIds()).toBeNull();
    expect(window.__fcbEarlyBanners).toBeUndefined(); // 已被接手

    await act(async () => {
      early.resolve([restBanner('r1', '早期標題', { subtitle: restStr('早期副標') }), restEmptyMarker()]);
    });
    expect(await screen.findByRole('heading', { name: '早期標題' })).toBeTruthy();
    expect(screen.getByText('早期副標')).toBeTruthy();
    expect(container.querySelector('.skeleton-slide')).toBeNull();
    expect(snapshotIds()).toEqual(['r1']);

    await act(async () => {
      sdk.resolve([banner({ id: 's1', title: 'SDK 標題' })]);
    });
    expect(await screen.findByRole('heading', { name: 'SDK 標題' })).toBeTruthy();
    expect(heading('早期標題')).toBeNull();
    expect(snapshotIds()).toEqual(['s1']);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(loadActiveBanners).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['resolve null（內嵌 script 的任何失敗）', () => Promise.resolve(null)],
    ['回應不是陣列', () => Promise.resolve({ documents: [] })],
    ['含 error 元素', () => Promise.resolve([{ error: { code: 403 } }])],
    ['被拒絕（理論上不會發生）', () => Promise.reject(new Error('boom'))],
  ])('早期請求失敗（%s）：沒有任何錯誤顯示、不寫快照、不補發 REST，SDK 路徑照常把橫幅畫出來', async (_name, make) => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'debug').mockImplementation(() => undefined);
    window.__fcbEarlyBanners = make();
    const sdk = deferred<BannerDoc[]>();
    vi.mocked(loadActiveBanners).mockImplementation(sdkConfirmedAfter(sdk.promise));

    const { container } = render(<HomePage />);
    await flush();

    expect(container.querySelector('.skeleton-slide')).not.toBeNull();
    expect(container.querySelector('.banner-fixed-content')).toBeNull();
    expect(snapshotIds()).toBeNull();
    expect(aboutRest(errorSpy)).toEqual([]);
    expect(aboutRest(warnSpy)).toEqual([]);

    await act(async () => {
      sdk.resolve([banner({ id: 's1', title: 'SDK 標題' })]);
    });
    expect(await screen.findByRole('heading', { name: 'SDK 標題' })).toBeTruthy();
    expect(snapshotIds()).toEqual(['s1']);
    expect(fetchMock).not.toHaveBeenCalled(); // 早期失敗也不補發第二次
    expect(loadActiveBanners).toHaveBeenCalledTimes(1);
  });

  it('早期回應有效但沒有可顯示的橫幅（只有空結果標記或全是草稿）：不畫、不寫快照，是否真的沒有橫幅交給 SDK', async () => {
    window.__fcbEarlyBanners = Promise.resolve([restEmptyMarker(), restDoc('d1', { status: restStr('draft'), title: restStr('草稿') })]);
    const { container } = render(<HomePage />);
    await flush();
    expect(container.querySelector('.skeleton-slide')).not.toBeNull();
    expect(heading('草稿')).toBeNull();
    expect(snapshotIds()).toBeNull();
  });

  it('SDK 先回（已確認取代畫面）：晚到的早期結果不覆蓋畫面、不寫快照', async () => {
    const early = deferred<unknown>();
    window.__fcbEarlyBanners = early.promise;
    vi.mocked(loadActiveBanners).mockImplementation(sdkConfirmedAfter(Promise.resolve([banner({ id: 's1', title: 'SDK 標題' })])));

    render(<HomePage />);
    expect(await screen.findByRole('heading', { name: 'SDK 標題' })).toBeTruthy();
    const snapshotBefore = localStorage.getItem(BANNERS_SNAPSHOT_KEY);

    await act(async () => {
      early.resolve([restBanner('r1', '晚到的早期標題')]);
    });
    await flush();

    expect(heading('SDK 標題')).not.toBeNull();
    expect(heading('晚到的早期標題')).toBeNull();
    expect(localStorage.getItem(BANNERS_SNAPSHOT_KEY)).toBe(snapshotBefore);
  });

  it('卸載後才到的早期結果：不寫快照、不動畫面', async () => {
    const early = deferred<unknown>();
    window.__fcbEarlyBanners = early.promise;
    vi.mocked(loadActiveBanners).mockReturnValue(deferred<BannerDoc[]>().promise);

    const { unmount } = render(<HomePage />);
    unmount();
    await act(async () => {
      early.resolve([restBanner('r1', '卸載後才到')]);
    });
    await flush();

    expect(snapshotIds()).toBeNull();
    expect(heading('卸載後才到')).toBeNull();
  });

  it('白名單仍在 HomePage 這一側：原始回應裡的危險欄位、多餘欄位不會進畫面，也不會進快照', async () => {
    window.__fcbEarlyBanners = Promise.resolve([
      restBanner('x1', '<img src=x onerror=alert(1)>', {
        subtitle: restStr('<b>副標</b>'),
        linkUrl: restStr('javascript:alert(1)'),
        image: restStr('javascript:alert(2)'),
        gradient: restStr('linear-gradient(red,blue),url(https://evil.example/x.png)'),
        titleColor: restStr('red;background:url(//evil.example/c.png)'),
        uid: restStr('U-should-not-appear'),
        email: restStr('leak@example.com'),
      }),
    ]);
    vi.mocked(loadActiveBanners).mockReturnValue(deferred<BannerDoc[]>().promise);

    const { container } = render(<HomePage />);
    expect(await screen.findByRole('heading', { name: '<img src=x onerror=alert(1)>' })).toBeTruthy();

    expect(container.querySelector('.banner-copy img')).toBeNull();
    expect(container.querySelector('.banner-copy b')).toBeNull();
    for (const bad of ['evil.example', 'javascript:', 'U-should-not-appear', 'leak@example.com', 'red;background']) {
      expect(container.innerHTML).not.toContain(bad);
      expect(localStorage.getItem(BANNERS_SNAPSHOT_KEY) ?? '').not.toContain(bad);
    }
    expect(snapshotIds()).toEqual(['x1']);
  });
});

describe('早期請求的內容仍要過 HomePage 這一側的白名單（toPublicBanners）', () => {
  it('畫出來的是白名單結果：超過長度上限的標題被丟掉，hero 退回預設標題，也不寫進快照', async () => {
    const longTitle = '長'.repeat(501);
    window.__fcbEarlyBanners = Promise.resolve([restBanner('r1', longTitle, { subtitle: restStr('正常副標題') })]);
    vi.mocked(loadActiveBanners).mockReturnValue(deferred<BannerDoc[]>().promise);

    render(<HomePage />);

    expect(await screen.findByText('正常副標題')).toBeTruthy();
    expect(heading(longTitle)).toBeNull();
    expect(screen.getByRole('heading', { name: '下班揪人一起動' })).toBeTruthy();
    expect(localStorage.getItem(BANNERS_SNAPSHOT_KEY) ?? '').not.toContain(longTitle);
  });
});

describe('HomePage 不接手早期請求的情況（與 canUseBannersRest()／快照條件一致）', () => {
  const sdkRenders = (): void => {
    vi.mocked(loadActiveBanners).mockImplementation(sdkConfirmedAfter(Promise.resolve([banner({ id: 's1', title: 'SDK 標題' })])));
  };

  it('暖啟動（有有效快照）：不用早期結果、不發 REST，快照第一次 render 就畫', () => {
    writeBannersSnapshot(toPublicBanners([banner({ id: 'snap', title: '快照橫幅' })]));
    const early = Promise.resolve([restBanner('r1', '不該出現的早期標題')]);
    window.__fcbEarlyBanners = early;
    vi.mocked(loadActiveBanners).mockReturnValue(deferred<BannerDoc[]>().promise);

    render(<HomePage />);

    expect(screen.getByRole('heading', { name: '快照橫幅' })).toBeTruthy();
    expect(heading('不該出現的早期標題')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(window.__fcbEarlyBanners).toBe(early); // 沒被取走
  });

  it('emulator 模式：不用早期結果（早期 Promise 原封不動留著）、不發 REST；SDK 路徑照常', async () => {
    vi.mocked(shouldUseEmulator).mockReturnValue(true);
    const early = Promise.resolve([restBanner('r1', '不該出現的早期標題')]);
    window.__fcbEarlyBanners = early;
    sdkRenders();

    render(<HomePage />);

    expect(await screen.findByRole('heading', { name: 'SDK 標題' })).toBeTruthy();
    expect(heading('不該出現的早期標題')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    // 沒被取走：若被取走，早期結果會先畫出來再被 SDK 取代，光看畫面看不出來。
    expect(window.__fcbEarlyBanners).toBe(early);
  });

  it('本機／區網網址：不用早期結果（早期 Promise 原封不動留著）、不發 REST', async () => {
    vi.mocked(isLocalOrPrivateHostname).mockReturnValue(true);
    const early = Promise.resolve([restBanner('r1', '不該出現的早期標題')]);
    window.__fcbEarlyBanners = early;
    sdkRenders();

    render(<HomePage />);

    expect(await screen.findByRole('heading', { name: 'SDK 標題' })).toBeTruthy();
    expect(heading('不該出現的早期標題')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(window.__fcbEarlyBanners).toBe(early);
  });

  it('沒有早期請求（內嵌 script 沒發）：照 T-042c 的路徑自己發一次', async () => {
    fetchMock.mockImplementation(async () => {
      throw new TypeError('Failed to fetch');
    });
    vi.spyOn(console, 'debug').mockImplementation(() => undefined);
    vi.mocked(loadActiveBanners).mockReturnValue(deferred<BannerDoc[]>().promise);

    render(<HomePage />);
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('每次頁面載入只取一次：HomePage 重掛不會再接手、也不會自己發', async () => {
    window.__fcbEarlyBanners = Promise.resolve([restBanner('r1', '早期標題')]);
    vi.mocked(loadActiveBanners).mockReturnValue(deferred<BannerDoc[]>().promise);

    const first = render(<HomePage />);
    expect(await screen.findByRole('heading', { name: '早期標題' })).toBeTruthy();
    first.unmount();

    render(<HomePage />);
    await flush();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(loadActiveBanners).toHaveBeenCalledTimes(2);
  });
});
