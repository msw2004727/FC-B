// 顧問 §3.368 P2-1：開關關閉時與現行完全相同——不載入站內區塊、不呼叫 getLaunch、沒有閘門逾時計時器、
// 外部清單（含本機快取）直接畫、沒有切換也沒有 data-cp-gate。
import { act, cleanup, render, screen } from '@testing-library/preact';
import { LocationProvider } from 'preact-iso';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ViewerView } from '@/features/profile/data/viewer';
import zhTw from '../locales/zh-TW.json';
import TournamentsPage, { COMPETITIONS_GATE_TIMEOUT_MS } from './TournamentsPage';
import { resetCardsCacheForTest, writeCardsCache } from '../data/cards-cache';

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
  COMPETITIONS_ENABLED: false,
  FEATURE_OVERRIDES: { competitions: false },
}));

const loaded = vi.hoisted(() => ({ inApp: 0, getLaunch: 0 }));

vi.mock('@/features/competitions/components/InAppSection', () => {
  loaded.inApp += 1;
  return {
    InAppSection: () => {
      loaded.getLaunch += 1;
      return null;
    },
  };
});

vi.mock('@/i18n/i18n', () => ({
  useT: () => (key: string) => dict[key] ?? key,
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

beforeEach(() => {
  resetCardsCacheForTest();
  history.replaceState(null, '', '/tournaments');
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
  vi.setSystemTime(new Date('2026-11-02T04:00:00Z'));
  sdk.getDocs.mockReset();
  sdk.getDocs.mockResolvedValue({
    docs: [{ id: 'tc_league', data: () => ({ name: '2027 春季聯賽', type: 'league', startDate: '2027-03-06', endDate: '2027-05-29', url: 'https://league.example.com/' }) }],
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  history.replaceState(null, '', '/');
});

describe.each([
  ['已登入', 'u_user'],
  ['訪客', null],
] as const)('開關關閉（%s）', (_label, uid) => {
  it('不載入站內區塊、不呼叫 getLaunch、只有外部清單的讀取計時器', async () => {
    mockUseViewer.mockReturnValue(viewer(uid));
    writeCardsCache(uid, [{
      id: 'tc_cached', name: '快取裡的盃賽', type: 'cup', startDate: '2027-01-01', endDate: '2027-01-02',
      url: 'https://cached.example.com/', image: '', imagePath: '',
    }]);
    render(
      <LocationProvider>
        <TournamentsPage />
      </LocationProvider>,
    );
    expect(screen.getByText('快取裡的盃賽')).toBeTruthy();
    // 進頁時只有外部清單 8 秒逾時這一個計時器；沒有閘門的 2 秒計時器。
    expect(vi.getTimerCount()).toBe(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(COMPETITIONS_GATE_TIMEOUT_MS * 2);
    });
    expect(screen.getByText('2027 春季聯賽')).toBeTruthy();
    const root = document.querySelector('.tournaments-root');
    expect(root?.hasAttribute('data-cp-gate')).toBe(false);
    expect(root?.hasAttribute('data-v2')).toBe(false);
    expect(document.querySelector('.cpl-src')).toBeNull();
    expect(document.querySelector('.cpl-chip')).toBeNull();
    expect(loaded.inApp).toBe(0);
    expect(loaded.getLaunch).toBe(0);
    expect(sdk.getDocs).toHaveBeenCalledTimes(1);
  });
});
