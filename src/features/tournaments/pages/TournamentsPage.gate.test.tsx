import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { LocationProvider } from 'preact-iso';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ViewerView } from '@/features/profile/data/viewer';
import zhTw from '../locales/zh-TW.json';
import TournamentsPage from './TournamentsPage';
import { resetCardsCacheForTest } from '../data/cards-cache';

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

const slot = vi.hoisted(() => ({
  open: true,
  mounts: 0,
  holdGate: false,
}));

vi.mock('@/features/competitions/components/InAppSection', async () => {
  const { useEffect } = await import('preact/hooks');
  const { h } = await import('preact');
  return {
    InAppSection: (props: { tab: string; active: boolean; onGate?: (open: boolean) => void; onReady?: () => void }) => {
      useEffect(() => {
        slot.mounts += 1;
        if (slot.holdGate) return;
        props.onGate?.(slot.open);
        // 正式元件通過後讀好清單才 onReady；站長 11-21 預設站內後，沒有 ?src 也走「骨架留到站內讀好」的路徑。
        if (slot.open) props.onReady?.();
      }, [props.onGate]);
      if (!slot.open) return null;
      return h('div', {
        'data-inapp': 'mock',
        'data-tab': props.tab,
        'data-active': props.active ? '1' : '0',
      });
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
  { id: 'tc_feda', data: { name: 'FEDA CUP 2026 飛達盃', type: 'cup', startDate: '2026-10-09', endDate: '2026-10-11', url: 'https://cup.example.com/' } },
  { id: 'tc_friendly', data: { name: '週末友誼賽', type: 'friendly', startDate: '2026-11-15', endDate: '2026-11-15', url: 'https://friendly.example.com/' } },
];

function viewer(): ViewerView {
  return {
    uid: 'u_user',
    role: 'user',
    roleLevel: 0,
    teamIds: new Set(),
    capabilities: [],
    displayName: '用戶',
    pictureUrl: null,
    hasPermission: () => false,
  };
}

function draw(): void {
  render(
    <LocationProvider>
      <TournamentsPage />
    </LocationProvider>,
  );
}

// 站內區塊是動態載入；切換列一進頁就在（先畫站內），要等站內區塊掛上、清單讀好才算站內畫面出來。
async function inAppShown(): Promise<void> {
  await waitFor(() => expect(document.querySelector('[data-inapp="mock"]')?.getAttribute('data-active')).toBe('1'));
  expect(screen.getByRole('tab', { name: '站內賽事' }).getAttribute('aria-selected')).toBe('true');
}

beforeEach(() => {
  resetCardsCacheForTest();
  slot.open = true;
  slot.mounts = 0;
  slot.holdGate = false;
  history.replaceState(null, '', '/tournaments');
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-02T04:00:00Z'));
  // 閘門通過會寫「上次有過」線索（顧問 11-20 方案 2）；每案清掉，避免前一案影響下一案。
  localStorage.clear();
  sdk.getDocs.mockClear();
  sdk.getDocs.mockResolvedValue({ docs: DOCS.map((doc) => ({ id: doc.id, data: () => doc.data })) });
  mockUseViewer.mockReturnValue(viewer());
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  history.replaceState(null, '', '/');
});

// 站長 11-21 指示「預設是站內賽事」：取代顧問 §3.373「預設停在外部，閘門通過只補切換」。
// 沒有 ?src 時先畫站內；點選後兩側都明確寫 ?src（顧問 11-20 方案 2 條件 3）；網址帶 ?src=ext 進頁仍停在外部。
describe('開關打開時的來源與讀取', () => {
  it('?src= 用 replace 記在目前這筆歷史；切來源、分類都不重讀，站內區不重掛', async () => {
    draw();
    await inAppShown();
    expect(location.search).toBe('');
    expect(document.querySelector('[data-inapp="mock"]')?.getAttribute('data-active')).toBe('1');
    expect(screen.queryByText('2027 春季聯賽')).toBeNull();

    const replace = vi.spyOn(history, 'replaceState');
    const push = vi.spyOn(history, 'pushState');
    fireEvent.click(screen.getByRole('tab', { name: '外部賽事' }));
    expect(location.search).toBe('?src=ext');
    expect(push).not.toHaveBeenCalled();
    expect(replace).toHaveBeenCalled();
    replace.mockRestore();
    push.mockRestore();
    expect(await screen.findByText('2027 春季聯賽')).toBeTruthy();
    expect(document.querySelector('[data-inapp="mock"]')?.getAttribute('data-active')).toBe('0');
    // 新外觀（清-3）：外部列沒有膠囊、分類不上色，看得到分類字。
    expect(document.querySelector('[data-card-id="tc_league"] .cpl-xrow__cat')?.textContent).toBe('聯賽');

    fireEvent.click(screen.getByRole('tab', { name: '盃賽' }));
    expect(screen.getByText('FEDA CUP 2026 飛達盃')).toBeTruthy();
    expect(screen.queryByText('2027 春季聯賽')).toBeNull();
    expect(document.querySelector('[data-tab]')?.getAttribute('data-tab')).toBe('cup');

    fireEvent.click(screen.getByRole('tab', { name: '站內賽事' }));
    expect(location.search).toBe('?src=in');
    expect(screen.getByRole('tab', { name: '站內賽事' }).getAttribute('aria-selected')).toBe('true');
    expect(document.querySelector('[data-active]')?.getAttribute('data-active')).toBe('1');
    expect(document.querySelector('[data-tab]')?.getAttribute('data-tab')).toBe('cup');
    expect(screen.queryByText('FEDA CUP 2026 飛達盃')).toBeNull();

    fireEvent.click(screen.getByRole('tab', { name: '外部賽事' }));
    expect(location.search).toBe('?src=ext');
    expect(document.querySelector('[data-active]')?.getAttribute('data-active')).toBe('0');
    expect(screen.getByText('FEDA CUP 2026 飛達盃')).toBeTruthy();
    expect(slot.mounts).toBe(1);
    expect(sdk.getDocs).toHaveBeenCalledTimes(1);
  });

  it('站長 11-21：開關打開、閘門通過、沒有 ?src：站內是第一個畫面，切換選在站內、外部清單不畫', async () => {
    draw();
    await inAppShown();
    await waitFor(() => expect(sdk.getDocs).toHaveBeenCalledTimes(1));
    expect(document.querySelector('.tournaments-root')?.getAttribute('data-cp-gate')).toBe('open');
    expect(screen.getByRole('tab', { name: '站內賽事' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tab', { name: '外部賽事' }).getAttribute('aria-selected')).toBe('false');
    expect(screen.queryByText('2027 春季聯賽')).toBeNull();
    expect(document.querySelector('[data-inapp="mock"]')?.getAttribute('data-active')).toBe('1');
    expect(location.search).toBe('');
  });

  it('不認得的 src 回到站內（站長 11-21 預設），其他參數留著', async () => {
    history.replaceState(null, '', '/tournaments?src=nope&keep=1');
    draw();
    await inAppShown();
    expect(screen.queryByText('2027 春季聯賽')).toBeNull();
    expect(location.search).toBe('?src=nope&keep=1');
    fireEvent.click(screen.getByRole('tab', { name: '外部賽事' }));
    expect(location.search).toBe('?src=ext&keep=1');
    expect(await screen.findByText('2027 春季聯賽')).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: '站內賽事' }));
    expect(location.search).toBe('?src=in&keep=1');
    expect(sdk.getDocs).toHaveBeenCalledTimes(1);
  });

  it('模擬返回（popstate）後仍停在點選的那一側（?src=ext 不被搶回站內、?src=in 留在站內）', async () => {
    draw();
    await inAppShown();
    fireEvent.click(screen.getByRole('tab', { name: '外部賽事' }));
    expect(location.search).toBe('?src=ext');
    window.dispatchEvent(new PopStateEvent('popstate'));
    expect(location.search).toBe('?src=ext');
    expect(screen.getByRole('tab', { name: '外部賽事' }).getAttribute('aria-selected')).toBe('true');
    expect(await screen.findByText('2027 春季聯賽')).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: '站內賽事' }));
    expect(location.search).toBe('?src=in');
    window.dispatchEvent(new PopStateEvent('popstate'));
    expect(location.search).toBe('?src=in');
    expect(screen.getByRole('tab', { name: '站內賽事' }).getAttribute('aria-selected')).toBe('true');
    expect(document.querySelector('[data-active]')?.getAttribute('data-active')).toBe('1');
    expect(screen.queryByText('2027 春季聯賽')).toBeNull();
  });

  it('外部列的 class 不含 card.type 的原字串（不認得的類型也不會變成 class）', async () => {
    const odd = ['playoff', 'league cup', '"><img', 'cpl-chip--x'];
    sdk.getDocs.mockResolvedValue({
      docs: [
        ...DOCS.map((doc) => ({ id: doc.id, data: () => doc.data })),
        ...odd.map((type, i) => ({
          id: `tc_odd${i}`,
          data: () => ({ name: `奇怪類型${i}`, type, startDate: '2027-03-06', endDate: '2027-03-06', url: 'https://odd.example.com/' }),
        })),
      ],
    });
    history.replaceState(null, '', '/tournaments?src=ext');
    draw();
    await waitFor(() => expect(screen.getByText('2027 春季聯賽')).toBeTruthy());
    const rows = [...document.querySelectorAll('[data-card-id]')];
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      const classes = [row, ...row.querySelectorAll('*')].map((el) => el.getAttribute('class') ?? '').join(' ');
      for (const type of ['league', 'cup', 'friendly', ...odd]) expect(classes).not.toContain(type);
    }
  });

  it('直接打開 ?src=in 且閘門通過時直接站內，進頁仍只查一次', async () => {
    history.replaceState(null, '', '/tournaments?src=in');
    draw();
    await inAppShown();
    expect(document.querySelector('[data-active]')?.getAttribute('data-active')).toBe('1');
    expect(screen.queryByText('週末友誼賽')).toBeNull();
    expect(location.search).toBe('?src=in');
    expect(sdk.getDocs).toHaveBeenCalledTimes(1);
    expect(slot.mounts).toBe(1);
  });

  it('網址 ?src=ext 進頁仍停在外部（不被搶回站內），改選站內寫成 ?src=in', async () => {
    history.replaceState(null, '', '/tournaments?src=ext');
    draw();
    await waitFor(() => expect(screen.getByRole('tab', { name: '外部賽事' }).getAttribute('aria-selected')).toBe('true'));
    expect(screen.getByText('週末友誼賽')).toBeTruthy();
    expect(document.querySelector('[data-active]')?.getAttribute('data-active')).toBe('0');
    fireEvent.click(screen.getByRole('tab', { name: '站內賽事' }));
    expect(location.search).toBe('?src=in');
    expect(sdk.getDocs).toHaveBeenCalledTimes(1);
    expect(slot.mounts).toBe(1);
  });

  it('閘門沒過不畫切換，標題「賽事」看得見、不帶 d2-ext', async () => {
    slot.open = false;
    draw();
    await waitFor(() => expect(screen.getByText('2027 春季聯賽')).toBeTruthy());
    await waitFor(() => expect(slot.mounts).toBe(1));
    const root = document.querySelector('.tournaments-root');
    expect(root?.hasAttribute('data-v2')).toBe(false);
    expect(document.querySelector('.cpl-src')).toBeNull();
    expect(document.querySelector('.cpl-chip')).toBeNull();
    expect(document.querySelector('[data-inapp]')).toBeNull();
    expect(root?.textContent ?? '').not.toContain('站內賽事');
    const heading = screen.getByRole('heading', { name: '賽事' });
    expect(heading.classList.contains('cpl-vh')).toBe(false);
    expect(document.getElementById('page-tournaments')?.classList.contains('d2-ext')).toBe(false);
    expect(sdk.getDocs).toHaveBeenCalledTimes(1);
  });

  // 顧問 §3.368 P2-1：判定中照開關關閉時畫外部清單。站長 11-21 預設站內後只剩網址 ?src=ext 走這條。
  it('?src=ext、閘門判定中照常畫外部清單，不顯示切換', async () => {
    history.replaceState(null, '', '/tournaments?src=ext');
    slot.holdGate = true;
    draw();
    await waitFor(() => expect(slot.mounts).toBe(1));
    await waitFor(() => expect(screen.getByText('2027 春季聯賽')).toBeTruthy());
    expect(screen.getByText('週末友誼賽')).toBeTruthy();
    expect(document.querySelector('.cpl-src')).toBeNull();
    expect(document.querySelector('.reg-loading-skeleton')).toBeNull();
  });

  it('站長 11-21：沒有 ?src、閘門判定中：先畫切換列（選在站內）與站內骨架，外部清單不畫（不先閃外部）', async () => {
    slot.holdGate = true;
    draw();
    expect(document.querySelector('[data-cp-pending-in]')).toBeTruthy();
    expect(screen.getByRole('tab', { name: '站內賽事' }).getAttribute('aria-selected')).toBe('true');
    await waitFor(() => expect(slot.mounts).toBe(1));
    await waitFor(() => expect(sdk.getDocs).toHaveBeenCalledTimes(1));
    expect(screen.queryByText('2027 春季聯賽')).toBeNull();
    expect(document.querySelector('[data-cp-pending-in]')).toBeTruthy();
  });

  it('新外觀：最外層帶 data-d2；切換在標題列裡；<h2>「賽事」還在、視覺隱藏、沒有 hidden；外部頁帶 d2-ext、站內頁不帶', async () => {
    draw();
    await waitFor(() => expect(document.querySelector('.cpl-src')).toBeTruthy());
    expect(document.querySelector('.tournaments-root')?.getAttribute('data-d2')).toBe('1');
    expect(document.querySelector('.cpl-head > .cpl-src')).toBeTruthy();
    const heading = document.querySelector('#page-tournaments h2');
    expect(heading?.textContent).toBe('賽事');
    expect(heading?.hasAttribute('hidden')).toBe(false);
    expect(heading?.classList.contains('cpl-vh')).toBe(true);
    const page = document.getElementById('page-tournaments');
    expect(page?.classList.contains('d2-ext')).toBe(false);
    fireEvent.click(screen.getByRole('tab', { name: '外部賽事' }));
    expect(page?.classList.contains('d2-ext')).toBe(true);
    fireEvent.click(screen.getByRole('tab', { name: '站內賽事' }));
    expect(page?.classList.contains('d2-ext')).toBe(false);
  });

  it('?src=ext、閘門判定中（沒有切換）最外層也帶 data-d2、不帶 d2-ext', async () => {
    history.replaceState(null, '', '/tournaments?src=ext');
    slot.holdGate = true;
    draw();
    await waitFor(() => expect(screen.getByText('2027 春季聯賽')).toBeTruthy());
    expect(document.querySelector('.tournaments-root')?.getAttribute('data-d2')).toBe('1');
    expect(document.getElementById('page-tournaments')?.classList.contains('d2-ext')).toBe(false);
  });

  it('來源切換有 aria-controls，左右鍵切換', async () => {
    draw();
    await inAppShown();
    const inbound = screen.getByRole('tab', { name: '站內賽事' });
    const outbound = screen.getByRole('tab', { name: '外部賽事' });
    expect(inbound.getAttribute('aria-selected')).toBe('true');
    expect(inbound.getAttribute('aria-controls')).toBe('tournaments-source-panel');
    expect(outbound.getAttribute('aria-controls')).toBe('tournaments-source-panel');
    expect(document.getElementById('tournaments-source-panel')).toBeTruthy();
    expect(document.querySelector('.cpl-src')?.getAttribute('aria-label')).toBe('賽事來源');
    inbound.focus();
    fireEvent.keyDown(inbound, { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: '外部賽事' }).getAttribute('aria-selected')).toBe('true');
    expect(location.search).toBe('?src=ext');
    expect(await screen.findByText('2027 春季聯賽')).toBeTruthy();
    fireEvent.keyDown(screen.getByRole('tab', { name: '外部賽事' }), { key: 'ArrowLeft' });
    expect(screen.getByRole('tab', { name: '站內賽事' }).getAttribute('aria-selected')).toBe('true');
    expect(location.search).toBe('?src=in');
    expect(screen.queryByText('2027 春季聯賽')).toBeNull();
  });
});

describe('「＋ 新增賽事」只在外部分頁（站長 11-20：站內不要出現兩顆新增鈕）', () => {
  function manager(): ViewerView {
    return { ...viewer(), uid: 'u_super', role: 'super_admin', roleLevel: 9 };
  }

  it('閘門通過：預設站內不出現；切到外部出現、切回站內消失', async () => {
    mockUseViewer.mockReturnValue(manager());
    draw();
    await waitFor(() => expect(document.querySelector('.cpl-src')).toBeTruthy());
    await waitFor(() => expect(sdk.getDocs).toHaveBeenCalledTimes(1));
    expect(screen.queryByText('＋ 新增賽事')).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: '外部賽事' }));
    await waitFor(() => expect(screen.getByText('＋ 新增賽事')).toBeTruthy());
    fireEvent.click(screen.getByRole('tab', { name: '站內賽事' }));
    await waitFor(() => expect(screen.queryByText('＋ 新增賽事')).toBeNull());
    expect(document.getElementById('tc-add-btn')).toBeNull();
  });

  it('直接開 ?src=in：站內分頁不出現', async () => {
    history.replaceState(null, '', '/tournaments?src=in');
    mockUseViewer.mockReturnValue(manager());
    draw();
    await waitFor(() => expect(document.querySelector('.cpl-src')).toBeTruthy());
    await inAppShown();
    expect(screen.queryByText('＋ 新增賽事')).toBeNull();
  });

  it('閘門沒過（沒有切換列）：管理者照舊看得到', async () => {
    slot.open = false;
    mockUseViewer.mockReturnValue(manager());
    draw();
    await waitFor(() => expect(screen.getByText('＋ 新增賽事')).toBeTruthy());
    expect(document.querySelector('.cpl-src')).toBeNull();
  });
});
