// 顧問 11-20 方案 2：這台裝置上次閘門有過（fcb:cp-inapp-seen:v1）、上次是登入狀態（fcb:signed-in）時，
// 賽事頁一進來就先畫站內（切換列＋站內骨架），不先閃外部清單。四個條件：
// 1. 沒有線索的人走原路徑；2. 逾時只讓這一次退回外部、不清線索，伺服器明確判定看不到才清；
// 3. 點過的那一側寫進網址，重新整理留得住；4. 外部清單仍只讀一次。
// 只對有線索的人取代 §3.373「預設一律停在外部」；沒有線索的情境另由 gate／gate-timeout 測試守住。
import { act, cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { LocationProvider } from 'preact-iso';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ViewerView } from '@/features/profile/data/viewer';
import zhTw from '../locales/zh-TW.json';
import TournamentsPage, { COMPETITIONS_GATE_TIMEOUT_MS, COMPETITIONS_PREFER_IN_CAP_MS, TOURNAMENTS_LOAD_TIMEOUT_MS } from './TournamentsPage';
import { resetCardsCacheForTest } from '../data/cards-cache';
import { CP_INAPP_HINT_KEY } from '../inapp-hint';

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

function seed(signedIn = true): void {
  localStorage.setItem(CP_INAPP_HINT_KEY, '1');
  if (signedIn) localStorage.setItem('fcb:signed-in', '1');
}

beforeEach(async () => {
  await import('@/features/competitions/components/InAppSection');
  resetCardsCacheForTest();
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
  vi.restoreAllMocks();
  vi.useRealTimers();
  localStorage.clear();
  history.replaceState(null, '', '/');
});

describe('沒有線索：路徑不變（條件 1）', () => {
  it.each([
    ['完全沒有線索', () => undefined],
    ['只有登入線索', () => localStorage.setItem('fcb:signed-in', '1')],
    ['有站內線索但上次未登入', () => seed(false)],
  ])('%s：先畫外部清單、閘門等外部讀完才開始、沒有切換列', async (_label, prep) => {
    prep();
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
    expect(sdk.getDocs).toHaveBeenCalledTimes(1);
  });

  it('網址明確 ?src=ext：即使有線索，外部讀完前也不開始閘門', async () => {
    seed();
    history.replaceState(null, '', '/tournaments?src=ext');
    sdk.getDocs.mockReturnValue(new Promise(() => undefined));
    draw();
    await tick();
    expect(gateCtl.mounts).toBe(0);
    expect(pendingSkeleton()).toBeNull();
    expect(srcTab('站內賽事')).toBeNull();
  });

  it('網址明確 ?src=ext：即使有線索也走原路徑', async () => {
    seed();
    history.replaceState(null, '', '/tournaments?src=ext');
    draw();
    expect(pendingSkeleton()).toBeNull();
    expect(gateCtl.mounts).toBe(0);
    await tick();
    expect(extCard()).toBeTruthy();
    await report(true);
    expect(srcTab('外部賽事')?.getAttribute('aria-selected')).toBe('true');
    expect(inApp()).toBeNull();
  });

  it('localStorage 讀寫丟例外：當成沒有線索，畫面照原路徑、不報錯', async () => {
    seed();
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    draw();
    expect(pendingSkeleton()).toBeNull();
    await tick();
    expect(extCard()).toBeTruthy();
    await report(true);
    expect(srcTab('外部賽事')?.getAttribute('aria-selected')).toBe('true');
  });

  it('沒有線索、閘門通過：記下線索（只存 1），畫面仍停在外部', async () => {
    draw();
    await tick();
    await report(true);
    expect(hint()).toBe('1');
    expect(srcTab('外部賽事')?.getAttribute('aria-selected')).toBe('true');
    expect(extCard()).toBeTruthy();
  });
});

describe('有線索：先畫站內', () => {
  it('第一個畫面就是站內切換列＋骨架、沒有外部卡；閘門同時開始；外部清單仍只讀一次（條件 4）', async () => {
    seed();
    draw();
    expect(srcTab('站內賽事')?.getAttribute('aria-selected')).toBe('true');
    expect(pendingSkeleton()).toBeTruthy();
    expect(extCard()).toBeNull();
    await tick();
    expect(gateCtl.mounts).toBe(1);
    expect(extCard()).toBeNull();
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
    expect(location.search).toBe('');
    expect(sdk.getDocs).toHaveBeenCalledTimes(1);
    expect(hint()).toBe('1');
  });

  it('點外部寫 ?src=ext；重新整理（重掛）仍停在外部（條件 3）', async () => {
    seed();
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
    seed();
    draw();
    await tick();
    await report(true);
    fireEvent.click(srcTab('外部賽事')!);
    fireEvent.click(srcTab('站內賽事')!);
    expect(location.search).toBe('?src=in');
    expect(inApp()).toBeTruthy();
  });

  // 改寫：顧問 11-20 退修取代「有線索時閘門 2 秒逾時就退回外部」——staging 冷開閘門要 7～8 秒，
  // 有線索的路徑不再用 2 秒逾時，骨架與切換列留到閘門定案。
  it('冷開閘門慢（6 秒才通過）：2 秒、5 秒時仍是骨架＋切換列、沒有外部卡；通過且讀好後直接站內（條件 2）', async () => {
    seed();
    draw();
    await tick(COMPETITIONS_GATE_TIMEOUT_MS + 1);
    expect(pendingSkeleton()).toBeTruthy();
    expect(srcTab('站內賽事')?.getAttribute('aria-selected')).toBe('true');
    expect(extCard()).toBeNull();
    await tick(3_000);
    expect(pendingSkeleton()).toBeTruthy();
    expect(extCard()).toBeNull();
    await tick(1_000);
    await report(true);
    expect(pendingSkeleton()).toBeNull();
    expect(inApp()).toBeTruthy();
    expect(extCard()).toBeNull();
    // 上限時間過了也不會再改看外部。
    await tick(COMPETITIONS_PREFER_IN_CAP_MS);
    expect(inApp()).toBeTruthy();
    expect(extCard()).toBeNull();
    expect(hint()).toBe('1');
  });

  it('等待中切換列可用：點外部立刻看外部清單、切換列留著；再點站內回到骨架', async () => {
    seed();
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

  it('讀取失敗（沒有 denied）：退回外部、線索不清（條件 2）', async () => {
    seed();
    draw();
    await tick();
    await report(false);
    expect(extCard()).toBeTruthy();
    expect(srcTab('站內賽事')).toBeNull();
    expect(hint()).toBe('1');
  });

  it('伺服器明確判定看不到：退回外部並清掉線索（條件 2）', async () => {
    seed();
    draw();
    await tick();
    await report(false, 'denied');
    expect(extCard()).toBeTruthy();
    expect(srcTab('站內賽事')).toBeNull();
    expect(hint()).toBeNull();
  });

  it('在站內時登出（閘門重判 denied）：退回外部並清線索，下次進來走原路徑', async () => {
    seed();
    draw();
    await tick();
    await report(true);
    expect(inApp()).toBeTruthy();
    await report(false, 'denied');
    expect(inApp()).toBeNull();
    expect(extCard()).toBeTruthy();
    expect(hint()).toBeNull();
    cleanup();
    gateCtl.mounts = 0;
    draw();
    expect(pendingSkeleton()).toBeNull();
    expect(gateCtl.mounts).toBe(0);
  });
});

// 單一上限（顧問 11-20 退修）：從進頁起算，涵蓋「閘門定案＋站內清單讀好」；取代閘門 2 秒逾時與通過後另計 8 秒（Opus 審 P2-2）。
describe('有線索：從進頁起算的單一上限', () => {
  // 顧問 11-20 上限裁定：12 秒，不與外部清單的 8 秒共用。
  it('上限是 12 秒，與外部清單的 8 秒是不同常數', () => {
    expect(COMPETITIONS_PREFER_IN_CAP_MS).toBe(12_000);
    expect(COMPETITIONS_PREFER_IN_CAP_MS).not.toBe(TOURNAMENTS_LOAD_TIMEOUT_MS);
  });

  it('冷開閘門 10 秒才通過（超過外部清單的 8 秒）：仍直接落在站內，外部清單不出現', async () => {
    seed();
    draw();
    await tick(TOURNAMENTS_LOAD_TIMEOUT_MS + 500);
    expect(pendingSkeleton()).toBeTruthy();
    expect(extCard()).toBeNull();
    await tick(1_500);
    await report(true);
    expect(inApp()).toBeTruthy();
    expect(extCard()).toBeNull();
  });

  it('外部清單不回應：閘門照樣進頁就開始，骨架留到上限前都在，外部只讀一次', async () => {
    seed();
    sdk.getDocs.mockReturnValue(new Promise(() => undefined));
    draw();
    await tick();
    expect(gateCtl.mounts).toBe(1);
    await tick(COMPETITIONS_PREFER_IN_CAP_MS - 100);
    expect(pendingSkeleton()).toBeTruthy();
    expect(sdk.getDocs).toHaveBeenCalledTimes(1);
  });

  it('閘門到上限都沒定案：這一次改看外部、切換列留著、線索不清；晚到的通過不搶回站內', async () => {
    seed();
    draw();
    await tick(COMPETITIONS_PREFER_IN_CAP_MS - 100);
    expect(pendingSkeleton()).toBeTruthy();
    expect(extCard()).toBeNull();
    await tick(200);
    expect(pendingSkeleton()).toBeNull();
    expect(extCard()).toBeTruthy();
    expect(srcTab('外部賽事')?.getAttribute('aria-selected')).toBe('true');
    expect(hint()).toBe('1');
    await report(true);
    expect(srcTab('外部賽事')?.getAttribute('aria-selected')).toBe('true');
    expect(inApp()).toBeNull();
  });

  it('閘門通過但站內清單一直沒好：上限從進頁算（不是從通過算），之後讀好也不搶回站內', async () => {
    seed();
    draw();
    await tick(5_000);
    await reportOpenOnly();
    expect(pendingSkeleton()).toBeTruthy();
    await tick(COMPETITIONS_PREFER_IN_CAP_MS - 5_000 + 100);
    expect(pendingSkeleton()).toBeNull();
    expect(extCard()).toBeTruthy();
    expect(srcTab('外部賽事')?.getAttribute('aria-selected')).toBe('true');
    expect(hint()).toBe('1');
    await act(async () => {
      gateCtl.ready?.();
    });
    await tick();
    expect(srcTab('外部賽事')?.getAttribute('aria-selected')).toBe('true');
  });

  it('網址明確 ?src=in（自己選的）：到上限也不改成外部', async () => {
    seed();
    history.replaceState(null, '', '/tournaments?src=in');
    draw();
    await tick();
    await reportOpenOnly();
    await tick(COMPETITIONS_PREFER_IN_CAP_MS + 100);
    expect(srcTab('站內賽事')?.getAttribute('aria-selected')).toBe('true');
    expect(extCard()).toBeNull();
  });
});
