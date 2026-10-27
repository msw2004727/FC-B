import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { _resetFirebaseForTest } from '@/data/firebase';
import { FIREBASE_CONFIG } from '@/data/firebase-config';
import { getEventsRepo } from '@/features/events/data/events-repo';
import { _resetUseEventsForTest } from '@/features/events/data/use-events';
import { useViewer, type ViewerView } from '@/features/profile/data/viewer';
import { loadActiveAnnouncements } from '../data/announcements';
import { loadActiveBanners, type BannerDeps, type BannerDoc } from '../data/banners';
import {
  BANNERS_SNAPSHOT_KEY,
  _clearHomeSnapshotForTest,
  toPublicBanners,
  writeBannersSnapshot,
} from '../data/home-snapshot';
import { resolveNextActivity } from '../data/next-activity';
import { fakeResponse, jsonResponse, restActiveFields, restDoc, restEmptyMarker, restStr } from '../data/__fixtures__/banners-rest';
import HomePage from './HomePage';

// T-042c：冷啟動（沒有有效首屏快照）時，橫幅清單在第一次 render 就用 Firestore REST 匿名讀取，比 SDK 更早畫出 hero 並寫入快照；
// SDK 之後的正式資料照舊取代它；REST 任何失敗都靜默退回 SDK 路徑；SDK 已確認取代後晚到的 REST 結果不覆蓋、不寫快照。
// 這個檔案的 fetch 全部是假的（vi.stubGlobal），不對任何線上端點發請求。

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

// 只換掉 SDK 路徑的 loadActiveBanners；REST 模組與共用映射（mapBannerDoc）維持真實實作。
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

/** REST 回應：一或多個文件；沒有文件＝空結果標記。 */
function restOk(...docs: Array<Record<string, unknown>>): Response {
  return jsonResponse(docs.length > 0 ? docs : [restEmptyMarker()]).response;
}

const restBanner = (id: string, title: string, extra: Record<string, unknown> = {}): Record<string, unknown> =>
  restDoc(id, restActiveFields({ title: restStr(title), ...extra }));

/** SDK 路徑的替身：等 `gate` 後回報「確認向伺服器新取得」並回傳清單。 */
function sdkConfirmedAfter(gate: Promise<BannerDoc[]>): (deps?: BannerDeps) => Promise<BannerDoc[]> {
  return async (deps) => {
    const list = await gate;
    deps?.onResult?.({ fromCache: false });
    return list;
  };
}

/** 永遠等不到回應、但會依 signal 中止的 fetch（讓卸載／逾時後計時器能收乾淨）。 */
function hangingUntilAborted(): typeof fetch {
  return (_input, init) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    });
}

function snapshotIds(): string[] | null {
  const raw = localStorage.getItem(BANNERS_SNAPSHOT_KEY);
  return raw ? (JSON.parse(raw) as { items: Array<{ id: string }> }).items.map((i) => i.id) : null;
}

/** 讓出一個巨集任務：當下微任務佇列裡的工作（fetch 假回應、讀取、解析、setState）都已跑完。 */
async function flush(): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });
}

const aboutRest = (spy: { mock: { calls: unknown[][] } }): unknown[][] =>
  spy.mock.calls.filter((args) => /banners?-rest|failed to fetch|runQuery|firestore\.googleapis|AbortError/i.test(args.map(String).join(' ')));
const heading = (name: string): HTMLElement | null => screen.queryByRole('heading', { name });
const preloads = (): HTMLLinkElement[] =>
  Array.from(document.head.querySelectorAll<HTMLLinkElement>('link[rel="preload"][as="image"]'));

let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;

beforeEach(() => {
  vi.resetAllMocks();
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
  // 預設：REST 立刻失敗（沒有網路）。需要別的行為的測試自己覆寫。
  fetchMock = vi.fn<typeof fetch>(async () => {
    throw new TypeError('Failed to fetch');
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  for (const link of preloads()) link.remove();
  _resetFirebaseForTest();
  _clearHomeSnapshotForTest();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('HomePage 冷啟動：橫幅 REST 讀取', () => {
  it('第一次 render 就發出一個匿名 REST 請求：網址、body、credentials omit，沒有 Authorization／API key', () => {
    fetchMock.mockImplementation(hangingUntilAborted());
    vi.mocked(loadActiveBanners).mockReturnValue(deferred<BannerDoc[]>().promise);

    render(<HomePage />);

    // render 回來（effect 都還沒機會等到任何非同步工作）請求就已經發出，與 SDK 載入並行。
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(loadActiveBanners).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls[0];
    const url = String(call?.[0]);
    const init = call?.[1] ?? {};
    expect(url).toBe(
      `https://firestore.googleapis.com/v1/projects/${FIREBASE_CONFIG.projectId}/databases/(default)/documents:runQuery`,
    );
    expect(url).not.toMatch(/[?&]key=/i);
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('omit');
    expect(JSON.parse(String(init.body))).toEqual({
      structuredQuery: { from: [{ collectionId: 'banners' }], limit: 200 },
    });
    const headerNames = Object.keys((init.headers ?? {}) as Record<string, string>).map((k) => k.toLowerCase());
    expect(headerNames).toEqual(['content-type']);
    expect(JSON.stringify([url, init])).not.toContain(FIREBASE_CONFIG.apiKey);
  });

  it('REST 先回：先畫出 hero 並寫入快照；SDK 的正式資料回來後取代畫面並更新快照', async () => {
    const rest = deferred<Response>();
    fetchMock.mockImplementation(() => rest.promise);
    const sdk = deferred<BannerDoc[]>();
    vi.mocked(loadActiveBanners).mockImplementation(sdkConfirmedAfter(sdk.promise));

    const { container } = render(<HomePage />);
    expect(container.querySelector('.skeleton-slide')).not.toBeNull();
    expect(snapshotIds()).toBeNull();

    await act(async () => {
      rest.resolve(restOk(restBanner('r1', 'REST 標題', { subtitle: restStr('REST 副標') })));
    });
    expect(await screen.findByRole('heading', { name: 'REST 標題' })).toBeTruthy();
    expect(screen.getByText('REST 副標')).toBeTruthy();
    expect(container.querySelector('.skeleton-slide')).toBeNull();
    // SDK 還沒回來，快照已經由 REST 結果寫入（走 toPublicBanners 白名單）。
    expect(snapshotIds()).toEqual(['r1']);

    await act(async () => {
      sdk.resolve([banner({ id: 's1', title: 'SDK 標題' })]);
    });
    expect(await screen.findByRole('heading', { name: 'SDK 標題' })).toBeTruthy();
    expect(heading('REST 標題')).toBeNull();
    expect(snapshotIds()).toEqual(['s1']);
    // 沒有多發請求：REST 一次、SDK 一次。
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(loadActiveBanners).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['網路錯誤（fetch 被拒絕）', () => Promise.reject(new TypeError('Failed to fetch'))],
    ['AbortError', () => Promise.reject(new DOMException('Aborted', 'AbortError'))],
    ['HTTP 500', () => Promise.resolve(jsonResponse([], { status: 500 }).response)],
    ['HTTP 403', () => Promise.resolve(jsonResponse([{ error: { code: 403 } }], { status: 403 }).response)],
    ['JSON 損毀', () => Promise.resolve(fakeResponse('[{"document":').response)],
    ['空回應', () => Promise.resolve(fakeResponse('').response)],
    ['回應格式不符（不是陣列）', () => Promise.resolve(jsonResponse({ documents: [] }).response)],
  ])('REST 失敗（%s）：沒有任何錯誤顯示、不寫快照，SDK 路徑照常把橫幅畫出來', async (_name, respond) => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'debug').mockImplementation(() => undefined);
    fetchMock.mockImplementation(respond);
    const sdk = deferred<BannerDoc[]>();
    vi.mocked(loadActiveBanners).mockImplementation(sdkConfirmedAfter(sdk.promise));

    const { container } = render(<HomePage />);
    await flush();

    // REST 已經失敗並結算：畫面仍是原本的骨架（沒有 hero、沒有錯誤訊息），也沒有寫快照。
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(container.querySelector('.skeleton-slide')).not.toBeNull();
    expect(container.querySelector('.banner-fixed-content')).toBeNull();
    expect(snapshotIds()).toBeNull();
    // 沒有任何和這次讀取有關的 console.error／warn（其他元件自己的紀錄不在此限）。
    expect(aboutRest(errorSpy)).toEqual([]);
    expect(aboutRest(warnSpy)).toEqual([]);

    // SDK 路徑與沒有 REST 時完全一樣：確認新取得 → 畫面＋快照。
    await act(async () => {
      sdk.resolve([banner({ id: 's1', title: 'SDK 標題' })]);
    });
    expect(await screen.findByRole('heading', { name: 'SDK 標題' })).toBeTruthy();
    expect(snapshotIds()).toEqual(['s1']);
    expect(loadActiveBanners).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('SDK 先回（已確認取代畫面）：晚到的 REST 結果不覆蓋畫面、不寫快照（快照內容與時間戳都不變）', async () => {
    const rest = deferred<Response>();
    fetchMock.mockImplementation(() => rest.promise);
    vi.mocked(loadActiveBanners).mockImplementation(sdkConfirmedAfter(Promise.resolve([banner({ id: 's1', title: 'SDK 標題' })])));

    render(<HomePage />);
    expect(await screen.findByRole('heading', { name: 'SDK 標題' })).toBeTruthy();
    const snapshotBefore = localStorage.getItem(BANNERS_SNAPSHOT_KEY);
    expect(snapshotIds()).toEqual(['s1']);

    await act(async () => {
      rest.resolve(restOk(restBanner('r1', '晚到的 REST 標題')));
    });
    await flush();

    expect(heading('SDK 標題')).not.toBeNull();
    expect(heading('晚到的 REST 標題')).toBeNull();
    expect(localStorage.getItem(BANNERS_SNAPSHOT_KEY)).toBe(snapshotBefore);
  });

  it('SDK 查詢失敗（沒有確認結果）先回、REST 後到：REST 的橫幅照樣畫出並寫快照（REST 是比空白更好的暫時畫面）', async () => {
    const rest = deferred<Response>();
    fetchMock.mockImplementation(() => rest.promise);
    // SDK 路徑失敗：loadActiveBanners 回 []、沒有回報結果。
    vi.mocked(loadActiveBanners).mockResolvedValue([]);

    const { container } = render(<HomePage />);
    await flush();
    expect(container.querySelector('.skeleton-slide')).not.toBeNull();

    await act(async () => {
      rest.resolve(restOk(restBanner('r1', 'REST 標題')));
    });
    expect(await screen.findByRole('heading', { name: 'REST 標題' })).toBeTruthy();
    expect(snapshotIds()).toEqual(['r1']);
  });

  it('REST 已畫出後，SDK 回的是離線快取（fromCache=true，未確認）：不取代畫面、不動快照', async () => {
    const rest = deferred<Response>();
    fetchMock.mockImplementation(() => rest.promise);
    const sdk = deferred<BannerDoc[]>();
    vi.mocked(loadActiveBanners).mockImplementation(async (deps) => {
      const list = await sdk.promise;
      deps?.onResult?.({ fromCache: true });
      return list;
    });

    render(<HomePage />);
    await act(async () => {
      rest.resolve(restOk(restBanner('r1', 'REST 標題')));
    });
    expect(await screen.findByRole('heading', { name: 'REST 標題' })).toBeTruthy();
    const snapshotBefore = localStorage.getItem(BANNERS_SNAPSHOT_KEY);

    await act(async () => {
      sdk.resolve([banner({ id: 'cache', title: '離線快取橫幅' })]);
    });
    await flush();

    expect(heading('REST 標題')).not.toBeNull();
    expect(heading('離線快取橫幅')).toBeNull();
    expect(localStorage.getItem(BANNERS_SNAPSHOT_KEY)).toBe(snapshotBefore);
  });

  it.each([
    ['空結果（只有 readTime 標記）', () => restOk()],
    ['全是非 active（草稿）', () => restOk(restDoc('d1', { status: restStr('draft'), title: restStr('草稿') }))],
  ])('REST 回應有效但沒有可顯示的橫幅（%s）：不畫、不寫快照，是否真的沒有橫幅交給 SDK', async (_name, respond) => {
    fetchMock.mockImplementation(async () => respond());
    const sdk = deferred<BannerDoc[]>();
    vi.mocked(loadActiveBanners).mockImplementation(sdkConfirmedAfter(sdk.promise));

    const { container } = render(<HomePage />);
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(container.querySelector('.skeleton-slide')).not.toBeNull();
    expect(heading('草稿')).toBeNull();
    expect(snapshotIds()).toBeNull();

    // SDK 的確認結果照常處理（這裡 SDK 確認有一張橫幅）。
    await act(async () => {
      sdk.resolve([banner({ id: 's1', title: 'SDK 標題' })]);
    });
    expect(await screen.findByRole('heading', { name: 'SDK 標題' })).toBeTruthy();
    expect(snapshotIds()).toEqual(['s1']);
  });
});

describe('HomePage 暖啟動與卸載', () => {
  it('已有有效快照（暖啟動）：不發 REST 請求，快照照常第一次 render 就畫', () => {
    writeBannersSnapshot(toPublicBanners([banner({ id: 'snap', title: '快照橫幅' })]));
    vi.mocked(loadActiveBanners).mockReturnValue(deferred<BannerDoc[]>().promise);

    render(<HomePage />);

    expect(screen.getByRole('heading', { name: '快照橫幅' })).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
    // SDK 背景讀取照舊。
    expect(loadActiveBanners).toHaveBeenCalledTimes(1);
  });

  it('快照過期（等同冷啟動）：照樣發 REST', () => {
    writeBannersSnapshot(toPublicBanners([banner({ id: 'old', title: '過期橫幅' })]), Date.now() - 31 * 60 * 1000);
    fetchMock.mockImplementation(hangingUntilAborted());
    vi.mocked(loadActiveBanners).mockReturnValue(deferred<BannerDoc[]>().promise);

    render(<HomePage />);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(heading('過期橫幅')).toBeNull();
  });

  it('卸載：中止進行中的請求；卸載後才回來的 REST 結果不寫快照、不動畫面', async () => {
    const rest = deferred<Response>();
    fetchMock.mockImplementation(() => rest.promise);
    vi.mocked(loadActiveBanners).mockReturnValue(deferred<BannerDoc[]>().promise);

    const { unmount } = render(<HomePage />);
    const init = fetchMock.mock.calls[0]?.[1];
    expect(init?.signal?.aborted).toBe(false);

    unmount();
    expect(init?.signal?.aborted).toBe(true);

    // 這個假 fetch 不理會 signal，照樣把有效資料送回來——元件已卸載，結果必須被忽略。
    await act(async () => {
      rest.resolve(restOk(restBanner('r1', '卸載後才到')));
    });
    await flush();
    expect(snapshotIds()).toBeNull();
    expect(heading('卸載後才到')).toBeNull();
  });
});

describe('REST 結果進 DOM 的注入面：沿用既有白名單，不直接序列化 REST 物件', () => {
  it('標題／副標題走文字節點；危險連結、漸層、顏色字串都被擋下；快照內容也乾淨', async () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    const hostile = restBanner('x1', '<img src=x onerror=alert(1)>', {
      subtitle: restStr('<b>副標</b>'),
      linkUrl: restStr('javascript:alert(1)'),
      gradient: restStr('linear-gradient(red,blue),url(https://evil.example/x.png)'),
      titleColor: restStr('red;background:url(//evil.example/c.png)'),
      uid: restStr('U-should-not-appear'),
    });
    fetchMock.mockImplementation(async () => restOk(hostile));
    vi.mocked(loadActiveBanners).mockReturnValue(deferred<BannerDoc[]>().promise);

    const { container } = render(<HomePage />);
    expect(await screen.findByRole('heading', { name: '<img src=x onerror=alert(1)>' })).toBeTruthy();

    // 文字就是文字：沒有被解析成元素。
    expect(container.querySelector('.banner-copy img')).toBeNull();
    expect(container.querySelector('.banner-copy b')).toBeNull();
    expect(screen.getByText('<b>副標</b>')).toBeTruthy();
    // 漸層不合格 → 預設底色；沒有連結 → 沒有 cursor；顏色字串不合格 → 預設白色。
    const slide = container.querySelector<HTMLElement>('.banner-slide.banner-placeholder');
    const slideStyle = slide?.getAttribute('style') ?? '';
    expect(slideStyle).toContain('var(--bg-elevated)');
    expect(slideStyle).not.toContain('cursor');
    fireEvent.click(slide as HTMLElement);
    expect(openSpy).not.toHaveBeenCalled();
    for (const bad of ['evil.example', 'javascript:', 'U-should-not-appear', 'red;background']) {
      expect(container.innerHTML).not.toContain(bad);
      expect(localStorage.getItem(BANNERS_SNAPSHOT_KEY) ?? '').not.toContain(bad);
    }
  });

  it('畫出來的是白名單結果（與下次暖啟動讀快照畫的一致）：超過長度上限的標題被丟掉，hero 退回預設標題，也不寫進快照', async () => {
    const longTitle = '長'.repeat(501);
    fetchMock.mockImplementation(async () => restOk(restBanner('r1', longTitle, { subtitle: restStr('正常副標題') })));
    vi.mocked(loadActiveBanners).mockReturnValue(deferred<BannerDoc[]>().promise);

    render(<HomePage />);
    expect(await screen.findByText('正常副標題')).toBeTruthy();
    expect(heading(longTitle)).toBeNull();
    expect(screen.getByRole('heading', { name: '下班揪人一起動' })).toBeTruthy();
    expect(localStorage.getItem(BANNERS_SNAPSHOT_KEY) ?? '').not.toContain(longTitle);
  });

  it('第一張橫幅圖的 preload link 沿用既有 effect：網址與 slide 背景圖網址一字不差', async () => {
    const image = 'https://example.com/hero.webp?v=2&x=1';
    fetchMock.mockImplementation(async () => restOk(restBanner('r1', 'REST 標題', { image: restStr(image) })));
    vi.mocked(loadActiveBanners).mockReturnValue(deferred<BannerDoc[]>().promise);

    const { container } = render(<HomePage />);
    expect(await screen.findByRole('heading', { name: 'REST 標題' })).toBeTruthy();

    // preload link 由元件既有的 effect 在畫面提交後加入（effect 不一定在 heading 出現的同一刻跑完），所以等它出現。
    await waitFor(() => expect(preloads().map((l) => l.getAttribute('href'))).toEqual([image]));
    expect(preloads()[0]?.getAttribute('fetchpriority')).toBe('high');
    expect(container.querySelector('.banner-slide')?.getAttribute('data-bg-src')).toBe(image);
  });
});
