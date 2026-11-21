// 顧問 §3.368 P2-1：開關打開時，外部清單（含本機快取）不等閘門；閘門 2 秒逾時先當沒過，
// 晚到的通過仍補上切換；讀取失敗、文件不存在都不顯示切換。
// 顧問 §3.373：不論 2 秒內或逾時後通過，都停在外部、只補切換，點「站內」才換（網址寫 ?src=in）；
// 網址帶 ?src=in 才直接進站內（取代原「2 秒內通過照預設停在站內」）。
// 站內區塊用假元件代替：照正式 InAppSection 的順序呼叫 getLaunch，再用正式的 canSeeInAppSection 判定，
// 讀取失敗走 onGate(false)（與正式元件的 catch 相同）。
// 站長 11-21 指示「預設是站內賽事」：沒有 ?src 改走先畫站內的路徑（見 TournamentsPage.inapp-hint.test.tsx），
// 本檔的「外部先畫、閘門延後開始、2 秒逾時」只剩網址明確 ?src=ext 時才走，所以每案預設從 ?src=ext 進頁；
// ?src=in 進頁改成一進頁就開始閘門、先畫骨架（取代 §3.377 對 ?src=in 的「先等外部清單」）。
import { act, cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { LocationProvider } from 'preact-iso';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ViewerView } from '@/features/profile/data/viewer';
import zhTw from '../locales/zh-TW.json';
import TournamentsPage, { COMPETITIONS_GATE_TIMEOUT_MS } from './TournamentsPage';
import { resetCardsCacheForTest, writeCardsCache } from '../data/cards-cache';
import type { TournamentCard } from '../data/card-model';

function flatten(obj: Record<string, unknown>, prefix: string, out: Record<string, string> = {}) {
  for (const [key, value] of Object.entries(obj)) {
    const path = `${prefix}.${key}`;
    if (value && typeof value === 'object') flatten(value as Record<string, unknown>, path, out);
    else out[path] = String(value);
  }
  return out;
}
const dict = flatten(zhTw as Record<string, unknown>, 'tournaments');

vi.mock('@/feature-overrides', () => ({
  COMPETITIONS_ENABLED: true,
  FEATURE_OVERRIDES: { competitions: true },
}));

type Launch = { isPublic: boolean | null; bannedWords: string[] } | null;

const gateCtl = vi.hoisted(() => ({
  getLaunch: (() => new Promise(() => undefined)) as () => Promise<unknown>,
  calls: 0,
  mounts: 0,
}));

vi.mock('@/features/competitions/components/InAppSection', async () => {
  const { useEffect, useRef } = await import('preact/hooks');
  const { h } = await import('preact');
  const { canSeeInAppSection } = await import('@/features/competitions/access');
  return {
    InAppSection: (props: { active: boolean; onGate?: (open: boolean) => void; onReady?: () => void }) => {
      const onGate = useRef(props.onGate);
      onGate.current = props.onGate;
      const onReady = useRef(props.onReady);
      onReady.current = props.onReady;
      useEffect(() => {
        gateCtl.mounts += 1;
        let alive = true;
        gateCtl.calls += 1;
        void gateCtl.getLaunch().then((launch) => {
          const isPublic = launch ? (launch as { isPublic: boolean | null }).isPublic : null;
          if (!alive) return;
          const open = canSeeInAppSection({ isPublic, isTester: false, isAdmin: false });
          onGate.current?.(open);
          // 正式元件通過後讀好清單才 onReady；這裡通過就一起送。
          if (open) onReady.current?.();
        }).catch(() => {
          if (alive) onGate.current?.(false);
        });
        return () => {
          alive = false;
        };
      }, []);
      return props.active ? h('div', { 'data-inapp': 'mock' }) : null;
    },
  };
});

vi.mock('@/i18n/i18n', () => ({
  // 「＋ 新增賽事」改用站內 Button（內含 Text，會讀目前語系）。
  getCurrentLocale: () => 'zh-TW',
  useT: () => (key: string, params?: Record<string, unknown>) => {
    let text = dict[key] ?? key;
    for (const [name, value] of Object.entries(params ?? {})) text = text.replace(`{${name}}`, String(value));
    return text;
  },
  lt: (_key: string, fallback?: string) => fallback ?? _key,
  useLegacyT: () => (_key: string, fallback?: string) => fallback ?? _key,
}));

const mockUseViewer = vi.hoisted(() => vi.fn<() => ViewerView>());
vi.mock('@/features/profile/data/viewer', () => ({ useViewer: () => mockUseViewer() }));
vi.mock('@/data/auth', () => ({
  getLastKnownAuthUid: () => mockUseViewer().uid ?? null,
}));

const sdk = {
  getDocs: vi.fn(),
  getDoc: vi.fn(),
  collection: vi.fn((_db: unknown, name: string) => ({ collection: name })),
  orderBy: vi.fn((field: string, dir: string) => ({ orderBy: [field, dir] })),
  limit: vi.fn((n: number) => ({ limit: n })),
  query: vi.fn((c: unknown, ...rest: unknown[]) => ({ c, rest })),
};
vi.mock('@/data/firestore-sdk', () => ({ loadFirestoreSdk: async () => sdk }));
vi.mock('@/data/firebase', () => ({
  getFirebase: async () => ({ db: {} }),
  shouldUseEmulator: () => false,
}));
vi.mock('@/ui/AppConfirm', () => ({ appConfirm: async () => true }));
vi.mock('@/ui/Toast', () => ({ toast: { show: () => undefined } }));
vi.mock('@/features/events/components/event-form/ImageCropper', async () => {
  const { h } = await import('preact');
  return { ImageCropper: () => h('div', {}) };
});

const DOCS = [
  { id: 'tc_league', data: { name: '2027 春季聯賽', type: 'league', startDate: '2027-03-06', endDate: '2027-05-29', url: 'https://league.example.com/' } },
  { id: 'tc_friendly', data: { name: '週末友誼賽', type: 'friendly', startDate: '2026-11-15', endDate: '2026-11-15', url: 'https://friendly.example.com/' } },
];

const CACHED: TournamentCard[] = [{
  id: 'tc_cached',
  name: '快取裡的盃賽',
  type: 'cup',
  startDate: '2027-01-01',
  endDate: '2027-01-02',
  url: 'https://cached.example.com/',
  image: '',
  imagePath: '',
}];

function viewer(uid: string | null): ViewerView {
  return {
    uid,
    role: uid ? 'user' : 'guest',
    roleLevel: 0,
    teamIds: new Set(),
    capabilities: [],
    displayName: uid ? '用戶' : null,
    pictureUrl: null,
    hasPermission: () => false,
  } as ViewerView;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function draw(): void {
  render(
    <LocationProvider>
      <TournamentsPage />
    </LocationProvider>,
  );
}

/**
 * 推進假時鐘，再讓出幾輪真實的 setImmediate（沒有假造），讓 import()、promise 鏈與 preact 重畫都跑完。
 * 分兩次 act：preact 的 act 結束時才跑 useEffect，effect 裡發出的 promise 要第二輪才收得到。
 */
async function tick(ms = 0): Promise<void> {
  for (let round = 0; round < 2; round += 1) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(round === 0 ? ms : 0);
      for (let i = 0; i < 5; i += 1) {
        await new Promise<void>((resolve) => setImmediate(resolve));
        await vi.advanceTimersByTimeAsync(0);
      }
    });
  }
}

function gateAttr(): string | null {
  return document.querySelector('.tournaments-root')?.getAttribute('data-cp-gate') ?? null;
}

beforeEach(async () => {
  // 先把（假的）站內區塊模組載入，元件裡的 import() 才不必等真實 I/O。
  await import('@/features/competitions/components/InAppSection');
  resetCardsCacheForTest();
  gateCtl.calls = 0;
  gateCtl.mounts = 0;
  gateCtl.getLaunch = () => new Promise(() => undefined);
  history.replaceState(null, '', '/tournaments?src=ext');
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
  vi.setSystemTime(new Date('2026-11-02T04:00:00Z'));
  // 閘門通過會寫「上次有過」線索（顧問 11-20 方案 2）；每案清掉，避免前一案影響下一案。
  localStorage.clear();
  sdk.getDocs.mockReset();
  sdk.getDocs.mockResolvedValue({ docs: DOCS.map((doc) => ({ id: doc.id, data: () => doc.data })) });
  mockUseViewer.mockReturnValue(viewer('u_user'));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  history.replaceState(null, '', '/');
});

describe.each([
  ['已登入', 'u_user'],
  ['訪客', null],
] as const)('閘門不回應（%s）', (_label, uid) => {
  it('?src=ext：本機快取第一個畫面就出現；伺服器清單到了照畫；2 秒後仍無切換', async () => {
    mockUseViewer.mockReturnValue(viewer(uid));
    writeCardsCache(uid, CACHED);
    draw();
    // 還沒推進任何時間、閘門也還在判定：快取已經畫出來，沒有骨架。
    expect(screen.getByText('快取裡的盃賽')).toBeTruthy();
    expect(document.querySelector('.reg-loading-skeleton')).toBeNull();
    expect(gateAttr()).toBe('pending');

    await tick();
    expect(gateCtl.calls).toBe(1);
    expect(screen.getByText('2027 春季聯賽')).toBeTruthy();
    expect(document.querySelector('.cpl-src')).toBeNull();

    await tick(COMPETITIONS_GATE_TIMEOUT_MS - 1);
    expect(gateAttr()).toBe('pending');
    await tick(1);
    expect(gateAttr()).toBe('closed');
    expect(document.querySelector('.cpl-src')).toBeNull();
    expect(document.querySelector('[data-inapp]')).toBeNull();
    expect(screen.getByText('週末友誼賽')).toBeTruthy();
    expect(gateCtl.calls).toBe(1);
    expect(sdk.getDocs).toHaveBeenCalledTimes(1);
  });
});

describe('閘門結果', () => {
  it('?src=ext：2 秒內通過補上切換但仍停在外部，不自動切到站內；點站內才換', async () => {
    const launch = deferred<Launch>();
    gateCtl.getLaunch = () => launch.promise;
    draw();
    await tick();
    expect(screen.getByText('2027 春季聯賽')).toBeTruthy();
    await tick(1_500);
    launch.resolve({ isPublic: true, bannedWords: [] });
    await tick();
    expect(gateAttr()).toBe('open');
    expect(document.querySelector('.cpl-src')).toBeTruthy();
    expect(screen.getByRole('tab', { name: '外部賽事' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tab', { name: '站內賽事' }).getAttribute('aria-selected')).toBe('false');
    expect(document.querySelector('[data-inapp]')).toBeNull();
    expect(screen.getByText('2027 春季聯賽')).toBeTruthy();
    expect(location.search).toBe('?src=ext');

    // 逾時點過了也不會自己換。
    await tick(COMPETITIONS_GATE_TIMEOUT_MS);
    expect(gateAttr()).toBe('open');
    expect(screen.getByRole('tab', { name: '外部賽事' }).getAttribute('aria-selected')).toBe('true');

    fireEvent.click(screen.getByRole('tab', { name: '站內賽事' }));
    await tick();
    expect(location.search).toBe('?src=in');
    expect(screen.getByRole('tab', { name: '站內賽事' }).getAttribute('aria-selected')).toBe('true');
    expect(document.querySelector('[data-inapp]')).toBeTruthy();
    expect(screen.queryByText('2027 春季聯賽')).toBeNull();
    expect(gateCtl.calls).toBe(1);
    expect(sdk.getDocs).toHaveBeenCalledTimes(1);
  });

  it('?src=ext：逾時後晚到的通過仍補上切換；同樣停在外部，點站內才換', async () => {
    const launch = deferred<Launch>();
    gateCtl.getLaunch = () => launch.promise;
    draw();
    // 閘門等外部清單有結果才開始（11-20 冷開修正），先讓清單讀完，2 秒逾時從閘門開始時起算。
    await tick();
    await tick(COMPETITIONS_GATE_TIMEOUT_MS);
    expect(gateAttr()).toBe('closed');
    expect(document.querySelector('.cpl-src')).toBeNull();

    await tick(3_000);
    launch.resolve({ isPublic: true, bannedWords: [] });
    await tick();
    expect(gateAttr()).toBe('open');
    expect(document.querySelector('.cpl-src')).toBeTruthy();
    expect(screen.getByRole('tab', { name: '外部賽事' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByText('2027 春季聯賽')).toBeTruthy();
    expect(document.querySelector('[data-inapp]')).toBeNull();

    expect(location.search).toBe('?src=ext');

    fireEvent.click(screen.getByRole('tab', { name: '站內賽事' }));
    await tick();
    expect(location.search).toBe('?src=in');
    expect(screen.getByRole('tab', { name: '站內賽事' }).getAttribute('aria-selected')).toBe('true');
    expect(document.querySelector('[data-inapp]')).toBeTruthy();
    expect(screen.queryByText('2027 春季聯賽')).toBeNull();
    expect(gateCtl.calls).toBe(1);
  });

  it.each([
    ['讀取失敗', () => Promise.reject(new Error('offline'))],
    ['文件不存在', () => Promise.resolve(null)],
    ['未公開（非測試者）', () => Promise.resolve({ isPublic: false, bannedWords: [] })],
  ] as const)('?src=ext、%s：不顯示切換，外部清單照常', async (_label, impl) => {
    gateCtl.getLaunch = impl;
    draw();
    await tick();
    await tick();
    expect(gateAttr()).toBe('closed');
    expect(document.querySelector('.cpl-src')).toBeNull();
    expect(document.querySelector('[data-inapp]')).toBeNull();
    expect(screen.getByText('2027 春季聯賽')).toBeTruthy();
    await tick(COMPETITIONS_GATE_TIMEOUT_MS * 2);
    expect(document.querySelector('.cpl-src')).toBeNull();
    expect(gateCtl.calls).toBe(1);
  });

  // 站長 11-21：?src=in 進頁走先畫站內的路徑（取代「判定中照常先畫外部清單」），不先閃外部。
  it('?src=in 進頁：判定中先畫骨架、不畫外部清單；通過直接站內', async () => {
    history.replaceState(null, '', '/tournaments?src=in');
    const launch = deferred<Launch>();
    gateCtl.getLaunch = () => launch.promise;
    draw();
    expect(document.querySelector('[data-cp-pending-in]')).toBeTruthy();
    await tick(500);
    expect(screen.queryByText('2027 春季聯賽')).toBeNull();
    expect(document.querySelector('[data-cp-pending-in]')).toBeTruthy();
    launch.resolve({ isPublic: true, bannedWords: [] });
    await tick();
    expect(gateAttr()).toBe('open');
    expect(screen.getByRole('tab', { name: '站內賽事' }).getAttribute('aria-selected')).toBe('true');
    expect(document.querySelector('[data-inapp]')).toBeTruthy();
    expect(screen.queryByText('2027 春季聯賽')).toBeNull();
    expect(location.search).toBe('?src=in');
  });

  it('?src=in 明確指定、閘門超過 2 秒才通過：不套 2 秒逾時，骨架留著，通過後照網址站內', async () => {
    history.replaceState(null, '', '/tournaments?src=in');
    const launch = deferred<Launch>();
    gateCtl.getLaunch = () => launch.promise;
    draw();
    await tick(COMPETITIONS_GATE_TIMEOUT_MS + 500);
    expect(gateAttr()).toBe('pending');
    expect(screen.queryByText('2027 春季聯賽')).toBeNull();
    launch.resolve({ isPublic: true, bannedWords: [] });
    await tick();
    expect(screen.getByRole('tab', { name: '站內賽事' }).getAttribute('aria-selected')).toBe('true');
    expect(document.querySelector('[data-inapp]')).toBeTruthy();
  });

  it('?src=ext 冷開：外部清單還在讀時不載入站內區塊、不讀閘門；清單有結果後才開始（11-20 staging 冷開修正）', async () => {
    const cardsReady = deferred<{ docs: Array<{ id: string; data: () => unknown }> }>();
    sdk.getDocs.mockReset();
    sdk.getDocs.mockReturnValue(cardsReady.promise);
    gateCtl.getLaunch = () => Promise.resolve({ isPublic: true, bannedWords: [] });
    draw();
    await tick(5_000);
    expect(gateCtl.mounts).toBe(0);
    expect(gateCtl.calls).toBe(0);
    expect(gateAttr()).toBe('pending');
    cardsReady.resolve({ docs: DOCS.map((doc) => ({ id: doc.id, data: () => doc.data })) });
    await tick();
    await tick();
    expect(screen.getByText('2027 春季聯賽')).toBeTruthy();
    expect(gateCtl.calls).toBe(1);
    expect(gateAttr()).toBe('open');
    expect(screen.getByRole('tab', { name: '外部賽事' }).getAttribute('aria-selected')).toBe('true');
  });

  // 站長 11-21 取代 §3.377 對 ?src=in 的延後：?src=in 走先畫站內的路徑，進頁就開始閘門（與原本有線索的路徑相同）。
  it('冷開帶 ?src=in：不等外部清單，進頁就開始閘門；外部清單仍只讀一次', async () => {
    history.replaceState(null, '', '/tournaments?src=in');
    const cardsReady = deferred<{ docs: Array<{ id: string; data: () => unknown }> }>();
    sdk.getDocs.mockReset();
    sdk.getDocs.mockReturnValue(cardsReady.promise);
    gateCtl.getLaunch = () => Promise.resolve({ isPublic: true, bannedWords: [] });
    draw();
    await tick();
    expect(gateCtl.mounts).toBe(1);
    expect(gateCtl.calls).toBe(1);
    expect(gateAttr()).toBe('open');
    expect(screen.getByRole('tab', { name: '站內賽事' }).getAttribute('aria-selected')).toBe('true');
    expect(document.querySelector('[data-inapp]')).toBeTruthy();
    cardsReady.resolve({ docs: DOCS.map((doc) => ({ id: doc.id, data: () => doc.data })) });
    await tick();
    expect(sdk.getDocs).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('2027 春季聯賽')).toBeNull();
  });

  it('?src=ext：8 秒逾時也算外部清單結束：之後才開始閘門', async () => {
    sdk.getDocs.mockReset();
    sdk.getDocs.mockReturnValue(new Promise(() => undefined));
    gateCtl.getLaunch = () => Promise.resolve({ isPublic: true, bannedWords: [] });
    draw();
    await tick(7_900);
    expect(gateCtl.calls).toBe(0);
    await tick(200);
    await tick();
    expect(gateCtl.calls).toBe(1);
  });

  it('?src=ext、有快取、伺服器還沒回：不得啟動閘門；伺服器回來才啟動（顧問 §3.381）', async () => {
    mockUseViewer.mockReturnValue(viewer(null));
    writeCardsCache(null, CACHED);
    const cardsReady = deferred<{ docs: Array<{ id: string; data: () => unknown }> }>();
    sdk.getDocs.mockReset();
    sdk.getDocs.mockReturnValue(cardsReady.promise);
    gateCtl.getLaunch = () => Promise.resolve({ isPublic: true, bannedWords: [] });
    draw();
    expect(screen.getByText('快取裡的盃賽')).toBeTruthy();
    await tick(5_000);
    expect(gateCtl.mounts).toBe(0);
    expect(gateCtl.calls).toBe(0);
    expect(gateAttr()).toBe('pending');
    cardsReady.resolve({ docs: DOCS.map((doc) => ({ id: doc.id, data: () => doc.data })) });
    await tick();
    await tick();
    expect(gateCtl.calls).toBe(1);
    expect(gateAttr()).toBe('open');
  });
});
