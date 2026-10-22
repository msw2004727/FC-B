import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { LocationProvider } from 'preact-iso';
import { ACTIVE_SPORT_STORAGE_KEY, _resetSportFilterForTest, setActiveSport } from '@/core/sport-filter';
import { _resetUseEventsForTest } from '../data/use-events';
import { _clearEventsSnapshotForTest } from '../data/events-snapshot-cache';
import { _setDictLoaderForTest, setLocale, t } from '@/i18n/i18n';
import { getToasts, toast } from '@/ui/Toast';
import { getEventsRepo, type EventsRepo } from '../data/events-repo';
import { loadViewerRegistrations } from '../data/viewer-registrations';
import { useViewer } from '@/features/profile/data/viewer';
import type { EventDoc } from '../data/types';
import * as favoritesMod from '../data/favorites';
import ActivitiesPage from './ActivitiesPage';

vi.mock('@/i18n/i18n', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/i18n/i18n')>()),
  useT: () => t,
}));
vi.mock('@/features/events/data/events-repo', () => ({
  getEventsRepo: vi.fn(),
}));
vi.mock('../data/favorites', () => ({
  loadFavorites: vi.fn(),
  saveFavorites: vi.fn(),
  toggleEventInFavorites: vi.fn(),
}));
vi.mock('../data/viewer-registrations', () => ({
  loadViewerRegistrations: vi.fn(),
}));
vi.mock('@/features/profile/data/viewer', () => ({
  useViewer: vi.fn(),
}));

type SportEvent = EventDoc & {
  sportTag: string;
  current?: number;
  max?: number;
  pinned?: boolean;
  region?: string;
  regionEnabled?: boolean;
  allowedGender?: string;
};

const football: SportEvent = {
  id: 'public-football',
  _docId: 'document-football',
  title: 'Visible football',
  status: 'open',
  date: '2030/10/19 18:00~20:00',
  location: '桃園市青埔足球場',
  sportTag: 'football',
  current: 6,
  max: 12,
  image: '/cover.webp',
};

const pickleball: SportEvent = {
  id: 'public-pickleball',
  title: 'Visible pickleball',
  status: 'open',
  date: '2030/10/20 18:00~20:00',
  location: '台北市大安運動中心',
  sportTag: 'pickleball',
  current: 4,
  max: 8,
};

let active: EventDoc[];
let load: ReturnType<typeof vi.fn<EventsRepo['loadEventsStatic']>>;

function mount(): ReturnType<typeof render> {
  return render(<LocationProvider><ActivitiesPage /></LocationProvider>);
}

beforeEach(async () => {
  // 運動選擇會記在 localStorage（照 A），每案先清掉再重設全站狀態。
  try { localStorage.removeItem(ACTIVE_SPORT_STORAGE_KEY); } catch { /* ignore */ }
  _resetSportFilterForTest();
  // stale-first：上一案載入的活動留在記憶體／本機快照，每案先清掉。
  _resetUseEventsForTest();
  _clearEventsSnapshotForTest();
  vi.resetAllMocks();
  toast.clear();
  _setDictLoaderForTest(null);
  await setLocale('zh-TW');
  history.replaceState(null, '', '/activities');
  active = [football, pickleball];
  load = vi.fn<EventsRepo['loadEventsStatic']>().mockResolvedValue(['events']);
  vi.mocked(getEventsRepo).mockReturnValue({
    loadEventsStatic: load,
    ensureTerminalEventsLoaded: vi.fn().mockResolvedValue(['events']),
    loadMoreTerminalEvents: vi.fn().mockResolvedValue(0),
    getSnapshot: () => ({ active, terminal: [] }),
  });
  vi.mocked(loadViewerRegistrations).mockResolvedValue([]);
  // M-076：收藏讀寫 mock（避免 jsdom 觸發 Firestore）
  vi.mocked(favoritesMod.loadFavorites).mockResolvedValue({ events: [], tournaments: [] });
  vi.mocked(favoritesMod.saveFavorites).mockResolvedValue(undefined);
  vi.mocked(favoritesMod.toggleEventInFavorites).mockImplementation((cur, eventId) => {
    const events = [...cur.events];
    const idx = events.indexOf(eventId);
    const added = idx < 0;
    if (added) events.push(eventId); else events.splice(idx, 1);
    return { next: { events, tournaments: [...cur.tournaments] }, added };
  });
  vi.mocked(useViewer).mockReturnValue({
    uid: 'viewer',
    teamIds: new Set(),
    roleLevel: 0,
    role: 'user',
    displayName: 'Viewer',
    pictureUrl: null,
    capabilities: [],
    hasPermission: () => false,
  });
});

afterEach(() => {
  cleanup();
  toast.clear();
  _setDictLoaderForTest(null);
  history.replaceState(null, '', '/');
});

describe('ActivitiesPage (Legacy A DOM & CSS)', () => {
  it('renders legacy A skeleton ids, classes, month header, date column, and card fields', async () => {
    const { container } = mount();
    await waitFor(() => {
      expect(container.querySelector('.tl-event-row')).toBeTruthy();
    });

    expect(container.querySelector('.legacy-ui')).toBeTruthy();
    expect(container.querySelector('#page-activities.page.active')).toBeTruthy();
    expect(container.querySelector('#filter-toggle')).toBeTruthy();
    expect(container.querySelector('#activity-share-url-btn')).toBeTruthy();
    expect(container.querySelector('#filter-bar')).toBeTruthy();
    expect(container.querySelector('#activity-tabs')).toBeTruthy();
    expect(container.querySelector('#activity-region-tabs')).toBeTruthy();
    expect(container.querySelector('#activity-list.timeline-calendar')).toBeTruthy();
    expect(container.querySelector('#activity-calendar')).toBeTruthy();

    const monthHeader = container.querySelector('.tl-month-header');
    expect(monthHeader?.textContent).toBe('2030 年 10 月');

    const dayGroup = container.querySelector('.tl-day-group[data-date-anchor="2030-10-19"]');
    expect(dayGroup).toBeTruthy();
    expect(dayGroup?.querySelector('.tl-day-num')?.textContent).toBe('19');
    expect(dayGroup?.querySelector('.tl-day-name')?.textContent).toBe('週六');

    const card = container.querySelector('.tl-event-row[data-event-id="public-football"]');
    expect(card).toBeTruthy();
    expect(card?.querySelector('.tl-event-title')?.textContent).toContain('Visible football');
    expect(card?.querySelector('.tl-event-meta')?.textContent).toContain('友誼 · 18:00~20:00 · 青埔足球場 · 6/12人');
    expect(card?.querySelector('.tl-event-status.open')?.textContent).toBe('報名中');
    expect(card?.querySelector('.fav-heart')).toBeTruthy();
    expect(card?.querySelector('.tl-event-sport-corner')).toBeTruthy();

    const img = card?.querySelector('.tl-event-thumb img');
    expect(img?.getAttribute('src')).toBe('/cover.webp');
    expect(img?.getAttribute('width')).toBe('48');
    expect(img?.getAttribute('height')).toBe('48');
    expect(img?.getAttribute('loading')).toBe('lazy');
    expect(img?.getAttribute('decoding')).toBe('async');
  });

  it('uses the actual visibility function for private, team and blocked events', async () => {
    active.push(
      { ...football, id: 'private', title: 'Hidden private', privateEvent: true, creatorUid: 'other' },
      { ...football, id: 'team', title: 'Hidden team', teamOnly: true, creatorTeamId: 'other-team' },
      { ...football, id: 'blocked', title: 'Hidden blocked', blockedUids: ['viewer'] },
      {
        ...football,
        id: 'owned',
        title: 'Visible owned private',
        privateEvent: true,
        creatorUid: 'viewer',
      },
    );
    const { container } = mount();
    await waitFor(() => {
      expect(container.querySelector('[data-event-id="public-football"]')).toBeTruthy();
    });
    expect(container.querySelector('[data-event-id="owned"]')).toBeTruthy();
    expect(container.querySelector('[data-event-id="owned"] .tl-stamp-private')?.textContent).toBe('不公開');
    expect(screen.queryByText('Hidden private')).toBeNull();
    expect(screen.queryByText('Hidden team')).toBeNull();
    expect(screen.queryByText('Hidden blocked')).toBeNull();
    expect(load).toHaveBeenCalledWith({ terminalMode: 'preview' });
  });

  it('shows a blocked event when the viewer only has a cancelled registration', async () => {
    active.push({
      ...football,
      id: 'blocked-with-cancelled-registration',
      _docId: 'document-blocked-with-cancelled-registration',
      title: 'Visible blocked after cancelled',
      blockedUids: ['viewer'],
    });
    vi.mocked(loadViewerRegistrations).mockResolvedValue([
      {
        eventId: 'blocked-with-cancelled-registration',
        userId: 'viewer',
        status: 'cancelled',
      },
    ]);

    const { container } = mount();
    await waitFor(() => {
      expect(container.querySelector('[data-event-id="blocked-with-cancelled-registration"]')).toBeTruthy();
    });
    expect(loadViewerRegistrations).toHaveBeenCalledWith('viewer');
  });

  // 測試同步更新：照 A（M-077），tl-pending 有 150ms 延遲。
  it('marks card with tl-pending after 150ms delay and navigates to /events/{id} when clicked', async () => {
    const { container } = mount();
    const card = await waitFor(() => {
      const el = container.querySelector('.tl-event-row[data-event-id="public-football"]');
      if (!el) throw new Error('card not ready');
      return el as HTMLElement;
    });

    fireEvent.click(card);
    await waitFor(() => {
      expect(card.classList.contains('tl-pending')).toBe(true);
    });
    await waitFor(() => {
      expect(window.location.pathname).toBe('/events/public-football');
    });
  });

  // 測試同步更新：照 A（M-073、M-075、M-078 未涵蓋部分不動）；
  // 分享鈕改走 shareCurrentActivityUrl（jsdom 無 navigator.share／clipboard → 顯示複製失敗）；
  // 附近活動地圖在 B 一律停用外觀 → 顯示「附近活動地圖尚未開啟」。
  // 測試同步更新：照 A（M-076），愛心改用收藏切換，不再顯示「尚未開放」。
  // 測試同步更新：照 A（M-071）月曆已開放，改由下方月曆案例驗證。
  it('opens the calendar tab lazily and writes tab=calendar to the URL (M-071)', async () => {
    const { container } = mount();
    await waitFor(() => {
      expect(container.querySelector('.tl-event-row')).toBeTruthy();
    });
    fireEvent.click(container.querySelector('[data-atab="calendar"]') as HTMLElement);
    await waitFor(() => {
      expect(new URLSearchParams(window.location.search).get('tab')).toBe('calendar');
      expect((container.querySelector('#activity-list') as HTMLElement).hidden).toBe(true);
      expect((container.querySelector('#activity-calendar') as HTMLElement).hidden).toBe(false);
      expect(container.querySelector('[data-atab="calendar"]')?.classList.contains('active')).toBe(true);
      expect(container.querySelector('#activity-calendar .evt-cal-skeleton')).toBeNull();
    });
  });

  it('shows toast when clicking unavailable features (share, beginner tab, nearby)', async () => {
    const { container } = mount();
    await waitFor(() => {
      expect(container.querySelector('.tl-event-row')).toBeTruthy();
    });

    const shareBtn = container.querySelector('#activity-share-url-btn') as HTMLElement;
    fireEvent.click(shareBtn);
    await waitFor(() => {
      expect(getToasts().at(-1)?.message).toBe('複製失敗，請手動複製');
    });

    toast.clear();
    const beginnerTab = container.querySelector('[data-atab="beginner"]') as HTMLElement;
    fireEvent.click(beginnerTab);
    expect(getToasts().at(-1)?.message).toBe('此功能尚未開放，請先使用舊版');

    toast.clear();
    const nearbyBtn = container.querySelector('#region-tab-nearby-activity') as HTMLElement;
    fireEvent.click(nearbyBtn);
    expect(getToasts().at(-1)?.message).toBe('附近活動地圖尚未開啟');

    // 測試同步更新：照 A（M-076）愛心改為收藏切換，不開啟詳情。
    toast.clear();
    const favBtn = container.querySelector('.fav-heart') as HTMLElement;
    fireEvent.click(favBtn);
    expect(window.location.pathname).toBe('/activities');
    await waitFor(() => {
      expect(getToasts().at(-1)?.message).toBe('已加入收藏');
    });
  });

  it('normalizes an ended tab while preserving sport and other query values', async () => {
    history.replaceState(null, '', '/activities?tab=ended&sport=football&source=shared');
    const { container } = mount();
    await waitFor(() => {
      expect(container.querySelector('[data-event-id="public-football"]')).toBeTruthy();
    });
    await waitFor(() => {
      const query = new URLSearchParams(window.location.search);
      expect(query.get('tab')).toBe('normal');
      expect(query.get('sport')).toBe('football');
      expect(query.get('source')).toBe('shared');
    });
    expect(container.querySelector('[data-event-id="public-pickleball"]')).toBeNull();
  });

  // 測試同步更新（R-QA-005）：照 A，運動改由頂部下拉選（全站共用狀態），活動頁不再有自己的置中彈窗（M-019、M-020）。
  it('follows the top-bar sport picker and writes the sport into the URL', async () => {
    const { container } = mount();
    await waitFor(() => {
      expect(container.querySelector('[data-event-id="public-football"]')).toBeTruthy();
    });
    await act(() => { setActiveSport('pickleball'); });
    await waitFor(() => {
      expect(new URLSearchParams(window.location.search).get('sport')).toBe('pickleball');
      expect(container.querySelector('[data-event-id="public-football"]')).toBeNull();
    });
    expect(container.querySelector('[data-event-id="public-pickleball"]')).toBeTruthy();
  });

  it('shows legacy loading skeleton while pending, then retries a rejected request', async () => {
    let reject!: (error: Error) => void;
    load.mockImplementationOnce(() => new Promise<string[]>((_resolve, rejectPromise) => {
      reject = rejectPromise;
    }));
    const { container } = mount();
    await waitFor(() => expect(load).toHaveBeenCalledOnce());
    expect(container.querySelector('.activity-list-loading[data-activity-loading="initial"]')).toBeTruthy();
    await act(async () => reject(new Error('private internal error')));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.queryByText('private internal error')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: t('events.retry') }));
    await waitFor(() => {
      expect(container.querySelector('[data-event-id="public-football"]')).toBeTruthy();
    });
    expect(load).toHaveBeenCalledTimes(2);
  });

  // 測試同步更新（R-QA-005）：空狀態文字照 A，並有站長同意的「清除篩選」（U-026）。
  it('shows legacy empty text and clears filters when no events match', async () => {
    history.replaceState(null, '', '/activities?sport=dodgeball');
    const { container } = mount();
    expect(await screen.findByText('請確認「右上角」活動類別，當前沒有活動')).toBeTruthy();
    fireEvent.click(screen.getByText('清除篩選'));
    await waitFor(() => {
      expect(new URLSearchParams(window.location.search).get('sport')).toBeNull();
      expect(container.querySelector('[data-event-id="public-football"]')).toBeTruthy();
    });
  });
});

// 本單新增：U-027 搜尋延遲與清除（不改既有案例）。
describe('ActivitiesPage (U-027 搜尋延遲與清除)', () => {
  it('delays keyword filtering by 150ms and keeps the input controlled', async () => {
    const { container } = mount();
    await waitFor(() => {
      expect(container.querySelector('[data-event-id="public-football"]')).toBeTruthy();
    });
    const input = container.querySelector('#activity-filter-keyword') as HTMLInputElement;
    fireEvent.input(input, { target: { value: 'pickleball' } });
    expect(input.value).toBe('pickleball');
    // 尚未 150ms，列表不變
    expect(container.querySelector('[data-event-id="public-football"]')).toBeTruthy();
    expect(container.querySelector('[data-event-id="public-pickleball"]')).toBeTruthy();
    await waitFor(() => {
      expect(container.querySelector('[data-event-id="public-football"]')).toBeNull();
    }, { timeout: 400 });
    expect(container.querySelector('[data-event-id="public-pickleball"]')).toBeTruthy();
  });

  it('shows a clear button after typing, and clicking it clears immediately and refocuses', async () => {
    const { container } = mount();
    await waitFor(() => {
      expect(container.querySelector('[data-event-id="public-football"]')).toBeTruthy();
    });
    // 實際使用時搜尋列是展開的；收合（hidden）時瀏覽器不允許 focus。
    fireEvent.click(container.querySelector('#filter-toggle') as HTMLElement);
    // 照 A layout.css：面板要有 .visible 才會顯示
    expect(container.querySelector('#filter-bar')?.classList.contains('visible')).toBe(true);
    const input = container.querySelector('#activity-filter-keyword') as HTMLInputElement;
    fireEvent.input(input, { target: { value: 'pickleball' } });
    const clearBtn = await waitFor(() => {
      const btn = container.querySelector('.activity-filter-clear-btn') as HTMLElement;
      if (!btn) throw new Error('clear button not ready');
      return btn;
    });
    fireEvent.click(clearBtn);
    expect(input.value).toBe('');
    await waitFor(() => {
      expect(container.querySelector('[data-event-id="public-football"]')).toBeTruthy();
    });
    expect(document.activeElement).toBe(input);
  });

  it('clears keyword and pending debounce when clicking 清除篩選', async () => {
    history.replaceState(null, '', '/activities?sport=dodgeball');
    const { container } = mount();
    await screen.findByText('請確認「右上角」活動類別，當前沒有活動');
    const input = container.querySelector('#activity-filter-keyword') as HTMLInputElement;
    fireEvent.input(input, { target: { value: 'football' } });
    fireEvent.click(screen.getByText('清除篩選'));
    expect(input.value).toBe('');
    await waitFor(() => {
      expect(container.querySelector('[data-event-id="public-football"]')).toBeTruthy();
      expect(container.querySelector('[data-event-id="public-pickleball"]')).toBeTruthy();
    });
    // 超過延遲時間，確認舊關鍵字沒有被套用
    await new Promise((r) => setTimeout(r, 200));
    expect(container.querySelector('[data-event-id="public-pickleball"]')).toBeTruthy();
  });
});
