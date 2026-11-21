// 新外觀清-3：沒有切換的三種情況（功能開關關閉、閘門沒過、閘門不回應），#page-tournaments 的標記逐字相等，
// 而且最外層都帶 data-d2。保護的是「不管閘門怎麼樣，沒有切換的人看到同一個畫面」。一般用戶與管理者各一組。
// 站長 11-21 預設站內後，沒有 ?src 時閘門不回應會先畫切換列與站內骨架（不是沒有切換的情況），
// 所以「閘門不回應」這組改從 ?src=ext 進頁；功能開關關閉、閘門沒過仍從沒有 ?src 進頁。
import { cleanup, render, screen, waitFor } from '@testing-library/preact';
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

const flags = vi.hoisted(() => ({ enabled: true, gate: 'closed' as 'closed' | 'hold' }));

vi.mock('@/feature-overrides', () => ({
  get COMPETITIONS_ENABLED() {
    return flags.enabled;
  },
  FEATURE_OVERRIDES: { competitions: true },
}));

vi.mock('@/features/competitions/components/InAppSection', async () => {
  const { useEffect } = await import('preact/hooks');
  return {
    InAppSection: (props: { onGate?: (open: boolean, reason?: 'denied') => void }) => {
      useEffect(() => {
        if (flags.gate === 'closed') props.onGate?.(false, 'denied');
      }, [props.onGate]);
      return null;
    },
  };
});

vi.mock('@/i18n/i18n', () => ({
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
vi.mock('@/data/auth', () => ({ getLastKnownAuthUid: () => mockUseViewer().uid ?? null }));

const sdk = {
  getDocs: vi.fn(),
  getDoc: vi.fn(),
  collection: vi.fn((_db: unknown, name: string) => ({ collection: name })),
  orderBy: vi.fn((field: string, dir: string) => ({ orderBy: [field, dir] })),
  limit: vi.fn((n: number) => ({ limit: n })),
  query: vi.fn((c: unknown, ...rest: unknown[]) => ({ c, rest })),
};
vi.mock('@/data/firestore-sdk', () => ({ loadFirestoreSdk: async () => sdk }));
vi.mock('@/data/firebase', () => ({ getFirebase: async () => ({ db: {} }), shouldUseEmulator: () => false }));
vi.mock('@/ui/AppConfirm', () => ({ appConfirm: async () => true }));
vi.mock('@/ui/Toast', () => ({ toast: { show: () => undefined } }));
vi.mock('@/features/events/components/event-form/ImageCropper', async () => {
  const { h } = await import('preact');
  return { ImageCropper: () => h('div', {}) };
});

const DOCS = [
  { id: 'tc_league', data: { name: '2027 春季聯賽', type: 'league', startDate: '2027-03-06', endDate: '2027-05-29', url: 'https://league.example.com/', image: 'https://storage.example/league.webp' } },
  { id: 'tc_feda', data: { name: 'FEDA CUP 2026 飛達盃', type: 'cup', startDate: '2026-10-09', endDate: '2026-10-11', url: 'https://cup.example.com/' } },
  { id: 'tc_friendly', data: { name: '週末友誼賽', type: 'friendly', startDate: '2026-11-15', endDate: '2026-11-15', url: 'https://friendly.example.com/' } },
];

function viewer(manager: boolean): ViewerView {
  return {
    uid: manager ? 'u_admin' : 'u_user',
    role: manager ? 'admin' : 'user',
    roleLevel: 0,
    teamIds: new Set(),
    capabilities: [],
    displayName: '用戶',
    pictureUrl: null,
    hasPermission: (code: string) => manager && code === 'admin.tournaments.manage_all',
  };
}

beforeEach(() => {
  resetCardsCacheForTest();
  history.replaceState(null, '', '/tournaments');
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-02T04:00:00Z'));
  localStorage.clear();
  sdk.getDocs.mockResolvedValue({ docs: DOCS.map((doc) => ({ id: doc.id, data: () => doc.data })) });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  history.replaceState(null, '', '/');
});

async function markup(enabled: boolean, gate: 'closed' | 'hold', url = '/tournaments'): Promise<{ html: string; d2: string | null; cpGate: string | null }> {
  flags.enabled = enabled;
  flags.gate = gate;
  history.replaceState(null, '', url);
  render(
    <LocationProvider>
      <TournamentsPage />
    </LocationProvider>,
  );
  await waitFor(() => expect(screen.getByText('2027 春季聯賽')).toBeTruthy());
  const root = document.querySelector('.tournaments-root');
  if (enabled) {
    const expected = gate === 'closed' ? 'closed' : 'pending';
    await waitFor(() => expect(root?.getAttribute('data-cp-gate')).toBe(expected));
  }
  const out = {
    // 先畫站內時切換列一進頁就在，閘門沒過後 preact 把 tabpanel 的 id 屬性設成空字串（不是拿掉），畫面與行為無差別，比對時去掉。
    html: (document.getElementById('page-tournaments')?.innerHTML ?? '').replace(' id=""', ''),
    d2: root?.getAttribute('data-d2') ?? null,
    cpGate: root?.getAttribute('data-cp-gate') ?? null,
  };
  cleanup();
  return out;
}

describe('沒有切換的三種情況畫面相同', () => {
  it.each([
    ['一般用戶', false],
    ['管理者', true],
  ])('%s：功能開關關閉、閘門沒過、閘門不回應的 #page-tournaments 逐字相等，最外層都帶 data-d2', async (_label, manager) => {
    mockUseViewer.mockReturnValue(viewer(manager));
    const off = await markup(false, 'closed');
    const closed = await markup(true, 'closed');
    const hold = await markup(true, 'hold', '/tournaments?src=ext');
    expect(off.cpGate).toBeNull();
    expect(closed.cpGate).toBe('closed');
    expect(hold.cpGate).toBe('pending');
    for (const view of [off, closed, hold]) expect(view.d2).toBe('1');
    expect(closed.html).toBe(off.html);
    expect(hold.html).toBe(off.html);
    expect(off.html).not.toContain('cpl-src');
    expect(off.html).not.toContain('d2-ext');
    expect(off.html.includes('tc-add-btn')).toBe(manager);
  });
});
