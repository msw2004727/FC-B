import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, waitFor } from '@testing-library/preact';
import type { EventDoc } from '@/features/events/data/types';
import type { ViewerView } from '@/features/profile/data/viewer';
import { _resetFirebaseForTest } from '@/data/firebase';
import { useViewer } from '@/features/profile/data/viewer';
import { loadActiveAnnouncements } from '../data/announcements';
import { loadActiveBanners } from '../data/banners';
import { _clearHomeSnapshotForTest, writeSportsSnapshot } from '../data/home-snapshot';
import { resolveNextActivity } from '../data/next-activity';
import HomePage from './HomePage';

// 批次 A §4.5 P-2（R-1）＋ §9：只觸發 onConfirmedActive、不觸發 onFresh 時，
// 卡片仍拿到清單（resolveNextActivity 收到的 deps 帶 activeEvents，不是 {}），且首屏快照沒被重寫。
//
// 這裡直接替身 useEvents，把 options 留給測試觸發（不經真實 events-repo 走 B 情境），
// 這樣可以精準驗證 HomePage 對 onConfirmedActive 的接線，也避免依賴 TTL 單例跨案例殘留。

const mockUseEventsOptions = vi.hoisted(() => ({
  latest: null as
    | {
        onFresh?: (events: EventDoc[]) => void;
        onConfirmedActive?: (events: EventDoc[]) => void;
        terminalMode?: string;
      }
    | null,
}));

vi.mock('@/features/events/data/use-events', () => ({
  useEvents: (
    _viewerUid: string | null,
    options: {
      onFresh?: (events: EventDoc[]) => void;
      onConfirmedActive?: (events: EventDoc[]) => void;
      terminalMode?: string;
    },
  ) => {
    mockUseEventsOptions.latest = options;
    return {
      events: [],
      loading: false,
      error: false,
      refreshing: true,
      retry: vi.fn(),
    };
  },
  _resetUseEventsForTest: vi.fn(),
}));

const mockRoute = vi.fn();

vi.mock('preact-iso', () => ({
  useLocation: () => ({
    url: '/',
    path: '/',
    query: {},
    route: mockRoute,
  }),
}));

vi.mock('@/i18n/i18n', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/i18n/i18n')>()),
  useT: () => (key: string) => key,
}));

vi.mock('@/features/profile/data/viewer', () => ({
  useViewer: vi.fn(),
}));

// 首頁的開團入口 hook（use-create-event-entry）掛載時會預讀個人資料；這個檔不測開團流程。
vi.mock('@/features/profile/data/profile-model', () => ({
  loadUserProfile: async () => null,
}));

vi.mock('@/core/hidden-features', () => ({
  SHOW_FAVORITES: true,
  SHOW_ANNOUNCEMENTS: false,
}));

vi.mock('@/core/open-external', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/core/open-external')>();
  return { ...actual, openExternal: vi.fn() };
});

vi.mock('../data/next-activity', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../data/next-activity')>();
  return { ...actual, resolveNextActivity: vi.fn() };
});

vi.mock('../data/banners', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../data/banners')>();
  return { ...actual, loadActiveBanners: vi.fn() };
});

vi.mock('../data/announcements', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../data/announcements')>();
  return { ...actual, loadActiveAnnouncements: vi.fn() };
});

vi.mock('../data/home-snapshot', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../data/home-snapshot')>();
  return { ...actual, writeSportsSnapshot: vi.fn() };
});

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

beforeEach(() => {
  vi.resetAllMocks();
  mockUseEventsOptions.latest = null;
  _clearHomeSnapshotForTest();
  vi.mocked(useViewer).mockReturnValue(makeViewer('u1'));
  vi.mocked(resolveNextActivity).mockResolvedValue(null);
  vi.mocked(loadActiveBanners).mockResolvedValue([]);
  vi.mocked(loadActiveAnnouncements).mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
  _resetFirebaseForTest();
});

describe('HomePage：onConfirmedActive 餵下一場（R-1）', () => {
  it('只觸發 onConfirmedActive、不觸發 onFresh 時，卡片仍拿到清單；首屏快照沒被重寫', async () => {
    const activeEvents: EventDoc[] = [
      { id: 'e1', _docId: 'e1', title: '活動一', status: 'open', date: '2099/06/01 19:00~21:00' },
    ];

    render(<HomePage />);
    expect(mockUseEventsOptions.latest).not.toBeNull();
    expect(typeof mockUseEventsOptions.latest?.onConfirmedActive).toBe('function');
    expect(typeof mockUseEventsOptions.latest?.onFresh).toBe('function');

    // 只觸發 onConfirmedActive（模擬 R-1 情境 B：共用請求沿用剛確認的 active、onFresh 不呼叫）。
    await act(async () => {
      mockUseEventsOptions.latest?.onConfirmedActive?.(activeEvents);
    });

    await waitFor(() => expect(resolveNextActivity).toHaveBeenCalled());
    const calls = vi.mocked(resolveNextActivity).mock.calls;
    const withActive = calls.find((call) => {
      const deps = call[0] as { activeEvents?: unknown };
      return Array.isArray(deps.activeEvents);
    });
    expect(withActive).toBeTruthy();
    expect((withActive?.[0] as { activeEvents: EventDoc[] }).activeEvents).toEqual(activeEvents);

    // 首屏快照（handleFreshEvents → writeSportsSnapshot）只在 onFresh 時寫；沒觸發 onFresh 就不該被重寫。
    expect(writeSportsSnapshot).not.toHaveBeenCalled();
  });
});
