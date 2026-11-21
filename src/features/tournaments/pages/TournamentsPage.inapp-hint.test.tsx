// 站長 11-21 指示「我要預設是站內賽事」（點底部「賽事」頁籤進來就看到站內）：沒有 ?src 的人一律先畫站內
// （切換列＋站內骨架），不先閃外部清單。取代顧問 11-20 方案 2「這台裝置上次閘門有過（fcb:cp-inapp-seen:v1）、
// 上次是登入狀態（fcb:signed-in）才先畫站內」；賽事頁不再讀寫那個本機線索。檔名沿用，內容改成預設站內的五種情況：
// 1. 閘門判定沒過 → 外部，切換列照原本條件；2. 閘門逾時／讀取不回 → 12 秒上限退回外部，不卡骨架；
// 3. 點過切換（?src=in／?src=ext）以網址為準；4. 返回或從外部連結回來不搶回站內；5. 不先閃外部清單。
import { act, cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { LocationProvider, Route, Router } from 'preact-iso';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ViewerView } from '@/features/profile/data/viewer';
import zhTw from '../locales/zh-TW.json';
import TournamentsPage, { COMPETITIONS_GATE_TIMEOUT_MS, COMPETITIONS_PREFER_IN_CAP_MS, TOURNAMENTS_LOAD_TIMEOUT_MS } from './TournamentsPage';
import { resetCardsCacheForTest } from '../data/cards-cache';
import { CP_INAPP_HINT_KEY } from '../inapp-hint';
import { manifest as tournamentsManifest } from '../index';
import { BottomNav } from '@/ui/BottomNav';
import { _resetForTest, registerFeatures } from '@/core/feature-registry';

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

type Report = (open: boolean, reason?: 'denied') => void;
const gateCtl = vi.hoisted(() => ({
  mounts: 0,
  report: null as null | ((open: boolean, reason?: 'denied') => void),
  ready: null as null | (() => void),
}));

vi.mock('@/features/competitions/components/InAppSection', async () => {
  const { useEffect, useRef } = await import('preact/hooks');
  const { h } = await import('preact');
  return {
    InAppSection: (props: { active: boolean; onGate?: Report; onReady?: () => void }) => {
      const onGate = useRef(props.onGate);
      onGate.current = props.onGate;
      const onReady = useRef(props.onReady);
      onReady.current = props.onReady;
      useEffect(() => {
        gateCtl.mounts += 1;
        gateCtl.report = (open, reason) => onGate.current?.(open, reason);
        gateCtl.ready = () => onReady.current?.();
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
];

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

function draw(): void {
  render(
    <LocationProvider>
      <TournamentsPage />
    </LocationProvider>,
  );
}

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

async function report(open: boolean, reason?: 'denied'): Promise<void> {
  await act(async () => {
    gateCtl.report?.(open, reason);
    // 正式元件通過後還要讀清單才 onReady；這裡預設一起送，需要分開的案例用 reportOpenOnly。
    if (open) gateCtl.ready?.();
  });
  await tick();
}

async function reportOpenOnly(): Promise<void> {
  await act(async () => {
    gateCtl.report?.(true);
  });
  await tick();
}

function hint(): string | null {
  return localStorage.getItem(CP_INAPP_HINT_KEY);
}
function srcTab(name: '站內賽事' | '外部賽事'): HTMLElement | null {
  return screen.queryByRole('tab', { name });
}
const pendingSkeleton = (): Element | null => document.querySelector('[data-cp-pending-in]');
const inApp = (): Element | null => document.querySelector('[data-inapp]');
const extCard = (): HTMLElement | null => screen.queryByText('2027 春季聯賽');

/** 舊版留下的本機線索（站長 11-21 起賽事頁不再讀寫，只用來確認有沒有都一樣）。 */
function seedOldHint(): void {
  localStorage.setItem(CP_INAPP_HINT_KEY, '1');
  localStorage.setItem('fcb:signed-in', '1');
}

/** 第一個畫面：切換列選在站內、站內骨架、沒有外部卡（情況 5：不先閃外部）。 */
function expectFirstFrameInApp(): void {
  expect(srcTab('站內賽事')?.getAttribute('aria-selected')).toBe('true');
  expect(pendingSkeleton()).toBeTruthy();
  expect(extCard()).toBeNull();
}

beforeEach(async () => {
  await import('@/features/competitions/components/InAppSection');
  resetCardsCacheForTest();
  _resetForTest();
  localStorage.clear();
  gateCtl.mounts = 0;
  gateCtl.report = null;
  gateCtl.ready = null;
  history.replaceState(null, '', '/tournaments');
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
  vi.setSystemTime(new Date('2026-11-02T04:00:00Z'));
  sdk.getDocs.mockReset();
  sdk.getDocs.mockResolvedValue({ docs: DOCS.map((doc) => ({ id: doc.id, data: () => doc.data })) });
  mockUseViewer.mockReturnValue(viewer('u_user'));
});

afterEach(() => {
  cleanup();
  _resetForTest();
  vi.restoreAllMocks();
  vi.useRealTimers();
  localStorage.clear();
  history.replaceState(null, '', '/');
});

const ARRIVALS: Array<[string, string | null, () => void]> = [
  ['訪客、第一次來（沒有任何本機線索）', null, () => undefined],
  ['已登入、沒有站內線索', 'u_user', () => localStorage.setItem('fcb:signed-in', '1')],
  ['已登入、有舊的站內線索', 'u_user', seedOldHint],
  ['訪客、清過快取後只剩舊站內線索', null, () => localStorage.setItem(CP_INAPP_HINT_KEY, '1')],
];

describe('站長 11-21：沒有 ?src 一律預設站內', () => {
  it.each(ARRIVALS)('%s：第一個畫面就是站內切換列＋骨架；閘門進頁就開始；讀好後站內；外部只讀一次', async (_label, uid, prep) => {
    mockUseViewer.mockReturnValue(viewer(uid));
    prep();
    const before = hint();
    draw();
    expectFirstFrameInApp();
    await tick();
    expect(gateCtl.mounts).toBe(1);
    expectFirstFrameInApp();
    // 閘門通過、站內清單還沒讀好：骨架留著，不空白、也不畫外部。
    await reportOpenOnly();
    expect(pendingSkeleton()).toBeTruthy();
    expect(extCard()).toBeNull();
    await act(async () => {
      gateCtl.ready?.();
    });
    await tick();
    expect(pendingSkeleton()).toBeNull();
    expect(inApp()).toBeTruthy();
    expect(extCard()).toBeNull();
    expect(srcTab('外部賽事')).toBeTruthy();
    expect(location.search).toBe('');
    expect(sdk.getDocs).toHaveBeenCalledTimes(1);
    // 站長 11-21 起不再讀寫本機線索：有沒有、通過後都不變。
    expect(hint()).toBe(before);
  });

  it('從底部頁籤「賽事」進來（BottomNav 帶的是 /tournaments、沒有 ?src）：預設站內', async () => {
    registerFeatures([tournamentsManifest]);
    history.replaceState(null, '', '/');
    render(
      <LocationProvider>
        <Router>
          <Route path="/tournaments" component={TournamentsPage} />
          <Route default component={() => null} />
        </Router>
        <BottomNav />
      </LocationProvider>,
    );
    const tab = document.querySelector<HTMLElement>('.bot-tab[data-page="page-tournaments"]');
    expect(tab).toBeTruthy();
    await act(async () => {
      fireEvent.click(tab!);
    });
    await tick();
    expect(location.pathname).toBe('/tournaments');
    expect(location.search).toBe('');
    expectFirstFrameInApp();
    expect(gateCtl.mounts).toBe(1);
    await report(true);
    expect(inApp()).toBeTruthy();
    expect(srcTab('站內賽事')?.getAttribute('aria-selected')).toBe('true');
    expect(extCard()).toBeNull();
  });

  it('localStorage 讀寫丟例外：照樣預設站內、不報錯', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    draw();
    expectFirstFrameInApp();
    await tick();
    await report(true);
    expect(inApp()).toBeTruthy();
  });

  it('站內 0 場（閘門通過、清單讀好）時切換列仍在，點「外部賽事」看得到外部清單', async () => {
    draw();
    await tick();
    await report(true);
    // 假元件不畫卡（等同 0 場）；空狀態那一行由 InAppSection.list.test.tsx 鎖住。
    expect(srcTab('站內賽事')?.getAttribute('aria-selected')).toBe('true');
    expect(srcTab('外部賽事')).toBeTruthy();
    fireEvent.click(srcTab('外部賽事')!);
    await tick();
    expect(extCard()).toBeTruthy();
  });
});

describe('情況 1：閘門判定沒過 → 外部，切換列照原本的條件（閘門沒過就不畫）', () => {
  // 功能開關關閉另由 TournamentsPage.gate-off.test.tsx 與 TournamentsPage.test.tsx（開關固定關閉）鎖住。
  it('伺服器明確判定看不到（denied）：退回外部、沒有切換列', async () => {
    draw();
    await tick();
    await report(false, 'denied');
    expect(extCard()).toBeTruthy();
    expect(pendingSkeleton()).toBeNull();
    expect(srcTab('站內賽事')).toBeNull();
    expect(srcTab('外部賽事')).toBeNull();
  });

  it('讀取失敗（沒有 denied）：退回外部、沒有切換列', async () => {
    draw();
    await tick();
    await report(false);
    expect(extCard()).toBeTruthy();
    expect(pendingSkeleton()).toBeNull();
    expect(srcTab('站內賽事')).toBeNull();
  });

  it('在站內時閘門重判 denied（例如登出）：退回外部；晚到的通過不搶回站內', async () => {
    draw();
    await tick();
    await report(true);
    expect(inApp()).toBeTruthy();
    await report(false, 'denied');
    expect(inApp()).toBeNull();
    expect(extCard()).toBeTruthy();
    expect(srcTab('站內賽事')).toBeNull();
    await report(true);
    expect(srcTab('外部賽事')?.getAttribute('aria-selected')).toBe('true');
    expect(inApp()).toBeNull();
  });
});

describe('情況 5：不先閃外部清單再跳站內', () => {
  it('冷開閘門慢（6 秒才通過）：2 秒、5 秒時仍是骨架＋切換列、沒有外部卡；通過且讀好後直接站內', async () => {
    draw();
    await tick(COMPETITIONS_GATE_TIMEOUT_MS + 1);
    expectFirstFrameInApp();
    await tick(3_000);
    expectFirstFrameInApp();
    await tick(1_000);
    await report(true);
    expect(pendingSkeleton()).toBeNull();
    expect(inApp()).toBeTruthy();
    expect(extCard()).toBeNull();
    // 上限時間過了也不會再改看外部。
    await tick(COMPETITIONS_PREFER_IN_CAP_MS);
    expect(inApp()).toBeTruthy();
    expect(extCard()).toBeNull();
  });

  it('冷開閘門 10 秒才通過（超過外部清單的 8 秒）：仍直接落在站內，外部清單不出現', async () => {
    draw();
    await tick(TOURNAMENTS_LOAD_TIMEOUT_MS + 500);
    expectFirstFrameInApp();
    await tick(1_500);
    await report(true);
    expect(inApp()).toBeTruthy();
    expect(extCard()).toBeNull();
  });

  it('等待中切換列可用：點外部立刻看外部清單、切換列留著；再點站內回到骨架', async () => {
    draw();
    await tick();
    fireEvent.click(srcTab('外部賽事')!);
    await tick();
    expect(location.search).toBe('?src=ext');
    expect(pendingSkeleton()).toBeNull();
    expect(extCard()).toBeTruthy();
    expect(srcTab('外部賽事')?.getAttribute('aria-selected')).toBe('true');
    fireEvent.click(srcTab('站內賽事')!);
    await tick();
    expect(location.search).toBe('?src=in');
    expect(pendingSkeleton()).toBeTruthy();
    expect(extCard()).toBeNull();
  });
});

describe('情況 3：使用者點過切換（網址有 ?src）以網址為準', () => {
  it('點外部寫 ?src=ext；重新整理（重掛）仍停在外部', async () => {
    draw();
    await tick();
    await report(true);
    fireEvent.click(srcTab('外部賽事')!);
    expect(location.search).toBe('?src=ext');
    expect(extCard()).toBeTruthy();
    cleanup();
    gateCtl.mounts = 0;
    draw();
    expect(pendingSkeleton()).toBeNull();
    await tick();
    await report(true);
    expect(srcTab('外部賽事')?.getAttribute('aria-selected')).toBe('true');
    expect(extCard()).toBeTruthy();
    expect(inApp()).toBeNull();
  });

  it('點站內寫 ?src=in', async () => {
    draw();
    await tick();
    await report(true);
    fireEvent.click(srcTab('外部賽事')!);
    fireEvent.click(srcTab('站內賽事')!);
    expect(location.search).toBe('?src=in');
    expect(inApp()).toBeTruthy();
  });

  it('網址 ?src=ext 進頁：先畫外部、閘門等外部讀完才開始、沒有骨架；通過也停在外部', async () => {
    history.replaceState(null, '', '/tournaments?src=ext');
    let release!: () => void;
    sdk.getDocs.mockReturnValue(new Promise((resolve) => {
      release = () => resolve({ docs: DOCS.map((doc) => ({ id: doc.id, data: () => doc.data })) });
    }));
    draw();
    await tick();
    expect(pendingSkeleton()).toBeNull();
    expect(srcTab('站內賽事')).toBeNull();
    expect(gateCtl.mounts).toBe(0);
    release();
    await tick();
    expect(extCard()).toBeTruthy();
    expect(gateCtl.mounts).toBe(1);
    await report(true);
    expect(srcTab('外部賽事')?.getAttribute('aria-selected')).toBe('true');
    expect(inApp()).toBeNull();
    expect(sdk.getDocs).toHaveBeenCalledTimes(1);
  });

  it('網址 ?src=in 進頁：同樣先畫站內骨架，通過讀好後站內', async () => {
    history.replaceState(null, '', '/tournaments?src=in');
    draw();
    expectFirstFrameInApp();
    await tick();
    await report(true);
    expect(inApp()).toBeTruthy();
    expect(location.search).toBe('?src=in');
  });
});

describe('情況 4：從外部連結或返回鍵回來，不把使用者搶回站內（照 ?src 寫入規則）', () => {
  it('看外部時離開再回來（網址留著 ?src=ext）：仍是外部，閘門通過也不換', async () => {
    draw();
    await tick();
    await report(true);
    fireEvent.click(srcTab('外部賽事')!);
    expect(location.search).toBe('?src=ext');
    // 模擬點外部賽事卡離站後按返回：同一個網址重新掛頁。
    cleanup();
    gateCtl.mounts = 0;
    draw();
    expect(pendingSkeleton()).toBeNull();
    expect(srcTab('站內賽事')).toBeNull();
    await tick();
    expect(extCard()).toBeTruthy();
    await report(true);
    expect(srcTab('外部賽事')?.getAttribute('aria-selected')).toBe('true');
    expect(inApp()).toBeNull();
  });

  it('返回（popstate）不改來源：看外部時 popstate 仍是外部', async () => {
    draw();
    await tick();
    await report(true);
    fireEvent.click(srcTab('外部賽事')!);
    window.dispatchEvent(new PopStateEvent('popstate'));
    await tick();
    expect(location.search).toBe('?src=ext');
    expect(srcTab('外部賽事')?.getAttribute('aria-selected')).toBe('true');
    expect(extCard()).toBeTruthy();
  });
});

// 單一上限（顧問 11-20 退修）：從進頁起算，涵蓋「閘門定案＋站內清單讀好」；取代閘門 2 秒逾時與通過後另計 8 秒（Opus 審 P2-2）。
describe('情況 2：閘門逾時或讀取不回 → 12 秒上限退回外部，不卡骨架', () => {
  // 顧問 11-20 上限裁定：12 秒，不與外部清單的 8 秒共用。
  it('上限是 12 秒，與外部清單的 8 秒是不同常數', () => {
    expect(COMPETITIONS_PREFER_IN_CAP_MS).toBe(12_000);
    expect(COMPETITIONS_PREFER_IN_CAP_MS).not.toBe(TOURNAMENTS_LOAD_TIMEOUT_MS);
  });

  it('外部清單不回應：閘門照樣進頁就開始，骨架留到上限前都在，外部只讀一次', async () => {
    sdk.getDocs.mockReturnValue(new Promise(() => undefined));
    draw();
    await tick();
    expect(gateCtl.mounts).toBe(1);
    await tick(COMPETITIONS_PREFER_IN_CAP_MS - 100);
    expect(pendingSkeleton()).toBeTruthy();
    expect(sdk.getDocs).toHaveBeenCalledTimes(1);
  });

  it('閘門到上限都沒定案：這一次改看外部、切換列留著；晚到的通過不搶回站內', async () => {
    draw();
    await tick(COMPETITIONS_PREFER_IN_CAP_MS - 100);
    expectFirstFrameInApp();
    await tick(200);
    expect(pendingSkeleton()).toBeNull();
    expect(extCard()).toBeTruthy();
    expect(srcTab('外部賽事')?.getAttribute('aria-selected')).toBe('true');
    await report(true);
    expect(srcTab('外部賽事')?.getAttribute('aria-selected')).toBe('true');
    expect(inApp()).toBeNull();
  });

  it('閘門通過但站內清單一直沒好：上限從進頁算（不是從通過算），之後讀好也不搶回站內', async () => {
    draw();
    await tick(5_000);
    await reportOpenOnly();
    expect(pendingSkeleton()).toBeTruthy();
    await tick(COMPETITIONS_PREFER_IN_CAP_MS - 5_000 + 100);
    expect(pendingSkeleton()).toBeNull();
    expect(extCard()).toBeTruthy();
    expect(srcTab('外部賽事')?.getAttribute('aria-selected')).toBe('true');
    await act(async () => {
      gateCtl.ready?.();
    });
    await tick();
    expect(srcTab('外部賽事')?.getAttribute('aria-selected')).toBe('true');
  });

  it('網址明確 ?src=in、閘門已通過但清單還在讀：到上限仍以網址為準（不改成外部）', async () => {
    history.replaceState(null, '', '/tournaments?src=in');
    draw();
    await tick();
    await reportOpenOnly();
    await tick(COMPETITIONS_PREFER_IN_CAP_MS + 100);
    expect(srcTab('站內賽事')?.getAttribute('aria-selected')).toBe('true');
    expect(extCard()).toBeNull();
  });

  it('網址 ?src=in、閘門到上限都沒定案：當作沒過退回外部（不畫切換、不卡骨架）；晚到的通過照網址回站內', async () => {
    history.replaceState(null, '', '/tournaments?src=in');
    draw();
    await tick(COMPETITIONS_PREFER_IN_CAP_MS - 100);
    expectFirstFrameInApp();
    await tick(200);
    expect(pendingSkeleton()).toBeNull();
    expect(extCard()).toBeTruthy();
    expect(srcTab('站內賽事')).toBeNull();
    expect(document.querySelector('.tournaments-root')?.getAttribute('data-cp-gate')).toBe('closed');
    await report(true);
    expect(srcTab('站內賽事')?.getAttribute('aria-selected')).toBe('true');
    expect(inApp()).toBeTruthy();
  });
});
