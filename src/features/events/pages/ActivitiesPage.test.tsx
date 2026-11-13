import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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

const hiddenFeatures = vi.hoisted(() => ({
  showFavorites: true,
  showAnnouncements: true,
}));

vi.mock('@/core/hidden-features', () => ({
  get SHOW_FAVORITES() { return hiddenFeatures.showFavorites; },
  get SHOW_ANNOUNCEMENTS() { return hiddenFeatures.showAnnouncements; },
}));

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
  hiddenFeatures.showFavorites = true;
  hiddenFeatures.showAnnouncements = true;
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
  it('收藏關閉時不渲染愛心，也不讀取收藏', async () => {
    hiddenFeatures.showFavorites = false;

    const { container } = mount();
    await waitFor(() => {
      expect(container.querySelector('.tl-event-row[data-event-id="public-football"]')).toBeTruthy();
      expect(loadViewerRegistrations).toHaveBeenCalledWith('viewer');
    });

    expect(container.querySelector('.fav-heart')).toBeNull();
    expect(favoritesMod.loadFavorites).not.toHaveBeenCalled();
  });

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
    expect(load).toHaveBeenCalledWith(expect.objectContaining({ terminalMode: 'preview' }));
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
    // 月曆是 lazy chunk：機器滿載（並行兩套全測）時載入會超過預設 1 秒，放寬到 10 秒（T-005b）。
    await waitFor(() => {
      expect(new URLSearchParams(window.location.search).get('tab')).toBe('calendar');
      expect((container.querySelector('#activity-list') as HTMLElement).hidden).toBe(true);
      expect((container.querySelector('#activity-calendar') as HTMLElement).hidden).toBe(false);
      expect(container.querySelector('[data-atab="calendar"]')?.classList.contains('active')).toBe(true);
      expect(container.querySelector('#activity-calendar .evt-cal-skeleton')).toBeNull();
    }, { timeout: 10_000 });
  }, 15_000);

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


describe('T-054c AP1：時間軸的台北今天', () => {
  it.each(['2026-10-19T00:30:00+08:00', '2026-10-19T23:30:00+08:00'])(
    '%s 的 today class 落在台北 10/19', async (now) => {
      // 直接注入 Date.now；不啟用 fake timers，也不改正式頁面的介面。
      const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.parse(now));
      try {
        active = [
          { id: 'evtA', _docId: 'evtA', title: 'evtA', date: '2026/10/19 23:00~23:59', status: 'open' },
          { id: 'targetA', _docId: 'targetA', title: 'targetA', date: '2026/10/20 23:00~23:59', status: 'open' },
        ];
        const { container } = mount();
        await waitFor(() => {
          expect(container.querySelector('.tl-day-group[data-date-anchor="2026-10-19"]')).not.toBeNull();
          expect(container.querySelector('.tl-day-group[data-date-anchor="2026-10-20"]')).not.toBeNull();
        });
        expect(container.querySelectorAll('.tl-date-col.today')).toHaveLength(1);
        expect(container.querySelector('[data-date-anchor="2026-10-19"] .tl-date-col')?.classList.contains('today')).toBe(true);
        expect(container.querySelector('[data-date-anchor="2026-10-20"] .tl-date-col')?.classList.contains('today')).toBe(false);
      } finally {
        cleanup();
        clock.mockRestore();
      }
    },
  );
});

// 2026-11-13 站長選定：計量條風格 A（同長、不寫人數）、已結束收合、篩選列＋月份黏頂。
describe('ActivitiesPage 計量條／已結束收合／黏頂（2026-11-13）', () => {
  // 測試同步更新（2026-11-13 顧問 §3.136）：收合改看「結束時間已過或已取消」，不再只看 status。
  // 本組固定台北 2030/10/19 12:00；「已結束」場次用當天 08:00~10:00（結束已過、仍在 6 小時內留在列表）。
  const ENDED_MORNING = '2030/10/19 08:00~10:00';
  let fixedNow: ReturnType<typeof vi.spyOn> | null = null;
  beforeEach(() => {
    fixedNow = vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2030-10-19T12:00:00+08:00'));
  });
  afterEach(() => {
    fixedNow?.mockRestore();
    fixedNow = null;
  });
  const ROOT = resolve(__dirname, '../../../..');
  const readCss = (file: string): string => readFileSync(resolve(ROOT, file), 'utf8');

  /** 去掉註解、壓平空白後拆成 { 選擇器清單, 宣告 }，CSS 測試不逐字比對排版。 */
  function cssRules(file: string): Array<{ selectors: string[]; body: string }> {
    const flat = readCss(file).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ');
    return [...flat.matchAll(/([^{}]+)\{([^}]*)\}/g)].map((m) => ({
      selectors: m[1]!.split(',').map((s) => s.trim()).filter(Boolean),
      body: m[2]!.trim(),
    }));
  }
  function ruleFor(file: string, selector: string): string {
    const rule = cssRules(file).find((r) => r.selectors.includes(selector));
    if (!rule) throw new Error(`找不到 ${selector}`);
    return rule.body;
  }
  function decl(body: string, prop: string): string | undefined {
    return body.split(';').map((d) => d.trim()).find((d) => d.startsWith(`${prop}:`))?.slice(prop.length + 1).trim();
  }

  function mountWith(events: EventDoc[]): ReturnType<typeof render> {
    active = events;
    return mount();
  }

  it('計量條：不寫人數、讀屏有人數；有縮圖與沒縮圖的卡用同一條規則對齊（同起點、同長度）', async () => {
    const full = {
      ...football,
      id: 'full-team',
      title: 'Full with team',
      status: 'full',
      current: 27,
      max: 27,
      realCurrent: 23,
      waitlist: 7,
      teamReservationSummaries: [{ teamId: 't', reservedSlots: 8, usedSlots: 4, remainingSlots: 4 }],
    } as SportEvent;
    const { container } = mountWith([football, pickleball, full]);
    await waitFor(() => expect(container.querySelector('.tl-event-row[data-event-id="full-team"]')).toBeTruthy());

    const withThumb = container.querySelector('.tl-event-row[data-event-id="public-football"]')!;
    const wrap = withThumb.querySelector('.tl-gbar-wrap')!;
    expect(wrap).toBeTruthy();
    expect(wrap.classList.contains('is-no-thumb')).toBe(false);
    expect(wrap.querySelector('.tl-gbar')?.getAttribute('aria-hidden')).toBe('true');
    // 條旁不寫人數：外框裡只有讀屏文字（專案既有 .fcb-sr-only）
    const sr = wrap.querySelector('.tl-gbar-sr')!;
    expect(sr.classList.contains('fcb-sr-only')).toBe(true);
    expect(sr.textContent).toBe('已報 6／12 人');
    expect(wrap.textContent).toBe('已報 6／12 人');
    // 條下方那行不動
    expect(withThumb.querySelector('.tl-event-meta')?.textContent).toContain('6/12人');

    const noThumb = container.querySelector('.tl-event-row[data-event-id="public-pickleball"]')!;
    expect(noThumb.querySelector('.tl-event-thumb')).toBeNull();
    expect(noThumb.querySelector('.tl-gbar-wrap')?.classList.contains('is-no-thumb')).toBe(true);

    // 口徑同詳情頁：實際正取 23（realCurrent），團隊保留、候補只給讀屏
    expect(container.querySelector('.tl-event-row[data-event-id="full-team"] .tl-gbar-sr')?.textContent)
      .toBe('已報 23／27 人，團隊保留 4，候補 7');
    expect(container.querySelector('.tl-event-row[data-event-id="full-team"] .tl-event-status.full')?.textContent).toBe('已額滿');

    // 同長：沒縮圖的卡讓出的寬度＝縮圖寬＋卡片 gap（與 A 的 activity.css 對照，任一邊改了測試會紅）
    const activityCss = 'src/features/events/legacy/activity.css';
    const thumbW = decl(ruleFor(activityCss, '.tl-event-thumb'), 'width');
    const rowGap = decl(ruleFor(activityCss, '.tl-event-row'), 'gap');
    const cardCss = 'src/features/events/components/legacy/timeline-card-extra.css';
    expect(decl(ruleFor(cardCss, '.tl-gbar-wrap.is-no-thumb'), 'margin-left')).toBe(`calc(${thumbW} + ${rowGap})`);
    expect(decl(ruleFor(cardCss, '.tl-gbar'), 'flex')).toBe('1 1 auto');
  });

  it('沒有上限（max＝0）：條只剩軌道、讀屏只讀已報人數', async () => {
    const noMax: SportEvent = { ...football, id: 'no-max', title: 'No max', current: 3, max: 0 };
    const { container } = mountWith([noMax]);
    await waitFor(() => expect(container.querySelector('[data-event-id="no-max"] .tl-gbar')).toBeTruthy());
    expect(container.querySelector('[data-event-id="no-max"] .tl-gbar')?.getAttribute('style')).toBeFalsy();
    expect(container.querySelector('[data-event-id="no-max"] .tl-gbar-sr')?.textContent).toBe('已報 3 人');
  });

  it('已結束／已取消以日期群組收成一行，點開才畫卡片；aria-controls 指向展開區；語系切換跟著換', async () => {
    const ended: SportEvent = { ...football, id: 'ended-1', title: 'Ended one', status: 'ended', date: ENDED_MORNING };
    const cancelled: SportEvent = { ...football, id: 'cancel-1', title: 'Cancelled one', status: 'cancelled' };
    const cancelledOther: SportEvent = { ...pickleball, id: 'cancel-2', title: 'Cancelled two', status: 'cancelled' };
    const { container } = mountWith([football, ended, cancelled, pickleball, cancelledOther]);
    await waitFor(() => expect(container.querySelector('.tl-ended-fold-btn')).toBeTruthy());

    const day19 = container.querySelector('.tl-day-group[data-date-anchor="2030-10-19"]')!;
    const btn19 = day19.querySelector('.tl-ended-fold-btn') as HTMLButtonElement;
    expect(btn19.textContent).toBe('已結束或取消 2 場▸');
    expect(btn19.getAttribute('aria-expanded')).toBe('false');
    const list = container.querySelector(`#${btn19.getAttribute('aria-controls')}`) as HTMLElement;
    expect(list).toBeTruthy();
    expect(list.hidden).toBe(true);
    expect(day19.querySelector('[data-event-id="ended-1"]')).toBeNull();
    expect(day19.querySelector('[data-event-id="cancel-1"]')).toBeNull();
    expect(day19.querySelector('[data-event-id="public-football"]')).toBeTruthy();
    // 收合列在當天最前面
    expect(day19.querySelector('.tl-events-col')?.firstElementChild?.classList.contains('tl-ended-fold')).toBe(true);

    const day20 = container.querySelector('.tl-day-group[data-date-anchor="2030-10-20"]')!;
    expect(day20.querySelector('.tl-ended-fold-btn')?.textContent).toBe('已取消 1 場▸');

    // 鍵盤可操作：原生 button（Enter／空白鍵由瀏覽器轉成 click），可取得焦點
    expect(btn19.tagName).toBe('BUTTON');
    expect(btn19.getAttribute('type')).toBe('button');
    btn19.focus();
    expect(document.activeElement).toBe(btn19);

    fireEvent.click(btn19);
    await waitFor(() => expect(list.querySelector('[data-event-id="ended-1"]')).toBeTruthy());
    expect(list.hidden).toBe(false);
    expect(list.querySelector('[data-event-id="cancel-1"]')).toBeTruthy();
    expect(btn19.getAttribute('aria-expanded')).toBe('true');
    expect(btn19.textContent).toBe('已結束或取消 2 場▾');
    // 已結束的卡沒有計量條
    expect(day19.querySelector('[data-event-id="ended-1"] .tl-gbar-wrap')).toBeNull();

    await act(async () => { await setLocale('en'); });
    await waitFor(() => expect(day20.querySelector('.tl-ended-fold-btn')?.textContent).toBe('1 cancelled▸'));
    expect(btn19.textContent).toBe('2 ended/cancelled▾');
    expect(day19.querySelector('[data-event-id="public-football"] .tl-gbar-sr')?.textContent).toBe('6 of 12 signed up');
  });

  it('進行中（已開始、未結束）不收合，卡片狀態膠囊照舊顯示「已結束」；結束後才收合（顧問 §3.136）', async () => {
    const live: SportEvent = { ...football, id: 'live', title: 'Live now', date: '2030/10/19 11:00~13:00' };
    const done: SportEvent = { ...football, id: 'done', title: 'Done', date: ENDED_MORNING };
    const { container } = mountWith([live, done, football]);
    await waitFor(() => expect(container.querySelector('.tl-ended-fold-btn')).toBeTruthy());
    expect(container.querySelector('.tl-ended-fold-btn')?.textContent).toBe('已結束 1 場▸');
    const liveCard = container.querySelector('.tl-events-col > [data-event-id="live"]');
    expect(liveCard).toBeTruthy();
    expect(liveCard?.querySelector('.tl-event-status')?.textContent).toBe('已結束');
    expect(container.querySelector('[data-event-id="done"]')).toBeNull();
  });

  it('沒有已結束場次時不出收合列', async () => {
    const { container } = mountWith([football, pickleball]);
    await waitFor(() => expect(container.querySelector('.tl-event-row')).toBeTruthy());
    expect(container.querySelector('.tl-ended-fold')).toBeNull();
  });

  it('切換篩選讓收合的場次改變時，展開狀態重置（不跟位置走）', async () => {
    const north: SportEvent = { ...football, id: 'ended-north', title: 'Ended north', status: 'ended', date: ENDED_MORNING, regionEnabled: true, region: '北部' };
    const south: SportEvent = { ...football, id: 'ended-south', title: 'Ended south', status: 'ended', date: ENDED_MORNING, regionEnabled: true, region: '南部' };
    const { container } = mountWith([football, north, south]);
    await waitFor(() => expect(container.querySelector('.tl-ended-fold-btn')?.textContent).toBe('已結束 2 場▸'));
    fireEvent.click(container.querySelector('.tl-ended-fold-btn') as HTMLElement);
    await waitFor(() => expect(container.querySelector('.tl-ended-fold-btn')?.getAttribute('aria-expanded')).toBe('true'));

    // 測試同步更新：2026-11-13 C 方案地區改為下拉，先打開地區鈕再選。
    fireEvent.click(container.querySelector('.activity-region-btn') as HTMLElement);
    fireEvent.click(container.querySelector('.activity-region-item[data-region="北部"]') as HTMLElement);
    await waitFor(() => expect(container.querySelector('.tl-ended-fold-btn')?.textContent).toBe('已結束 1 場▸'));
    expect(container.querySelector('.tl-ended-fold-btn')?.getAttribute('aria-expanded')).toBe('false');
    expect(container.querySelector('[data-event-id="ended-north"]')).toBeNull();
  });

  it('跨月且整天都已結束：日期錨點與今天標記保留；月曆跳日仍捲到該日', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2030-10-19T12:00:00+08:00'));
    const scrollIntoView = vi.fn();
    const original = (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView = scrollIntoView;
    try {
      const endedToday: SportEvent = { ...football, id: 'ended-today', title: 'Ended today', status: 'ended', date: ENDED_MORNING };
      const nextMonth: SportEvent = { ...pickleball, id: 'next-month', title: 'Next month', date: '2030/11/01 18:00~20:00' };
      const { container } = mountWith([endedToday, pickleball, nextMonth]);
      await waitFor(() => expect(container.querySelector('.tl-day-group[data-date-anchor="2030-11-01"]')).toBeTruthy());
      expect([...container.querySelectorAll('.tl-month-header')].map((h) => h.textContent)).toEqual(['2030 年 10 月', '2030 年 11 月']);
      const today = container.querySelector('.tl-day-group[data-date-anchor="2030-10-19"]')!;
      expect(today.querySelector('.tl-date-col')?.classList.contains('today')).toBe(true);
      expect(today.querySelector('.tl-ended-fold-btn')?.textContent).toBe('已結束 1 場▸');
      expect(today.querySelector('.tl-event-row')).toBeNull();

      fireEvent.click(container.querySelector('[data-atab="calendar"]') as HTMLElement);
      await waitFor(() => {
        expect(container.querySelector('.evt-cal-sport-summary[data-jump-date="2030-10-19"]')).toBeTruthy();
      }, { timeout: 10_000 });
      fireEvent.click(container.querySelector('.evt-cal-sport-summary[data-jump-date="2030-10-19"]') as HTMLElement);
      await waitFor(() => expect(scrollIntoView).toHaveBeenCalled());
      expect(scrollIntoView.mock.contexts[0]).toBe(container.querySelector('.tl-day-group[data-date-anchor="2030-10-19"]'));
    } finally {
      (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView = original;
      clock.mockRestore();
    }
  }, 15_000);

  it('黏頂：頁籤列＋地區列包在黏頂外框；量到篩選列高度後月份標題 top 貼在它下方', async () => {
    const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const h = this.classList.contains('activity-sticky-filters') ? 80 : 0;
      return { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: h, width: 0, height: h, toJSON: () => ({}) } as DOMRect;
    });
    try {
      const { container } = mountWith([football]);
      await waitFor(() => expect(container.querySelector('.tl-month-header')).toBeTruthy());
      const sticky = container.querySelector('#page-activities > .activity-sticky-filters')!;
      expect(sticky.querySelector('#activity-tabs')).toBeTruthy();
      expect(sticky.querySelector('#activity-region-tabs')).toBeTruthy();
      expect(container.querySelector('.legacy-ui.activities-root')).toBeTruthy();
      await waitFor(() => expect(container.querySelector('.tl-month-header')?.getAttribute('style') ?? '').toContain('78px'));
      // 新手友善／高強度維持灰色未開放
      expect(container.querySelector('[data-atab="beginner"]')?.classList.contains('activity-tab-unavailable')).toBe(true);
      expect(container.querySelector('[data-atab="high-intensity"]')?.classList.contains('activity-tab-unavailable')).toBe(true);
    } finally {
      rect.mockRestore();
    }
  });

  it('黏頂量測：ResizeObserver 觀察篩選列，頁面卸載時 disconnect', async () => {
    const observe = vi.fn();
    const disconnect = vi.fn();
    vi.stubGlobal('ResizeObserver', class {
      observe = observe;
      unobserve = vi.fn();
      disconnect = disconnect;
    });
    try {
      const { container, unmount } = mountWith([football]);
      await waitFor(() => expect(container.querySelector('.tl-event-row')).toBeTruthy());
      expect(observe).toHaveBeenCalledWith(container.querySelector('.activity-sticky-filters'));
      unmount();
      expect(disconnect).toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('樣式：只覆寫活動列表三層的 overflow（保留 hidden 再以 clip 覆蓋）；月份標題層級高於卡片印章', () => {
    const file = 'src/features/events/components/legacy/activity-list-extra.css';
    const overflowRules = cssRules(file).filter((r) => /overflow-[xy]?:|overflow:/.test(r.body) && !r.selectors.some((s) => s.includes('tl-ended')));
    expect(overflowRules.flatMap((r) => r.selectors).sort())
      .toEqual(['#page-activities', '#page-activities .timeline-calendar', '.legacy-ui.activities-root'].sort());
    const body = overflowRules[0]!.body;
    expect(body.indexOf('overflow-x: hidden')).toBeGreaterThanOrEqual(0);
    expect(body.indexOf('overflow-x: clip')).toBeGreaterThan(body.indexOf('overflow-x: hidden'));
    expect(decl(body, 'overflow-y')).toBe('visible');

    expect(ruleFor(file, '#page-activities.page > .activity-sticky-filters')).toContain('position: sticky');
    const month = ruleFor(file, '#page-activities .tl-month-header');
    expect(month).toContain('position: sticky');
    // 卡片印章、開啟中遮罩最高 5（activity.css），月份標題要更高
    const stampZ = ['.tl-stamp-confirmed', '.tl-stamp-waitlisted', '.tl-stamp-private']
      .map((s) => Number(decl(ruleFor('src/features/events/legacy/activity.css', s), 'z-index') ?? 0));
    expect(Number(decl(month, 'z-index'))).toBeGreaterThan(Math.max(...stampZ, 5));
    // 不得自創 CSS 變數（只用既有的 --topbar-h／--qa-*／--bg-root…）
    expect(cssRules(file).some((r) => /(^|;)\s*--[\w-]+\s*:/.test(r.body))).toBe(false);
    // 收合鈕不讓瀏覽器自動斷行，caret 不縮
    expect(decl(ruleFor(file, '.tl-ended-fold-btn'), 'white-space')).toBe('nowrap');
    expect(decl(ruleFor(file, '.tl-ended-fold-caret'), 'flex-shrink')).toBe('0');
  });
});

describe('ActivitiesPage 頂部精簡 C 方案：地區下拉（2026-11-13）', () => {
  const central: SportEvent = { ...pickleball, id: 'central-only', title: 'Central only', regionEnabled: true, region: '中部' };
  const north: SportEvent = { ...football, id: 'north-only', title: 'North only', regionEnabled: true, region: '北部' };

  it('地區鈕在頁籤同一列右側；點開是直式選單（全部、中部、北部、南部、東部&外島，最下面尋找附近活動），選了寫網址並收起', async () => {
    active = [central, north];
    const { container } = mount();
    await waitFor(() => expect(container.querySelector('[data-event-id="north-only"]')).toBeTruthy());

    const sticky = container.querySelector('#page-activities > .activity-sticky-filters')!;
    const btn = sticky.querySelector('.activity-region-btn') as HTMLButtonElement;
    expect(sticky.lastElementChild?.contains(btn)).toBe(true);
    expect(btn.textContent).toBe('全部');
    expect(btn.getAttribute('aria-label')).toBe('地區 全部');
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    const menu = container.querySelector('#activity-region-menu') as HTMLElement;
    expect(menu.hidden).toBe(true);
    // 舊的整列地區頁籤已拿掉
    expect(container.querySelector('.region-tab')).toBeNull();

    fireEvent.click(btn);
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    expect(menu.hidden).toBe(false);
    const items = [...menu.querySelectorAll('.activity-region-item')].map((el) => el.textContent);
    expect(items).toEqual(['全部', '中部', '北部', '南部', '東部&外島', '尋找附近活動']);
    expect(menu.querySelector('[data-region="全部"]')?.getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(menu.querySelector('[data-region="中部"]') as HTMLElement);
    await waitFor(() => expect(new URLSearchParams(window.location.search).get('region')).toBe('central'));
    expect(menu.hidden).toBe(true);
    expect(btn.textContent).toBe('中部');
    expect(btn.classList.contains('active')).toBe(true);
    await waitFor(() => expect(container.querySelector('[data-event-id="north-only"]')).toBeNull());
    expect(container.querySelector('[data-event-id="central-only"]')).toBeTruthy();
  });

  it('點選單外或按 Esc 收起；Esc 後焦點回地區鈕', async () => {
    const { container } = mount();
    await waitFor(() => expect(container.querySelector('.tl-event-row')).toBeTruthy());
    const btn = container.querySelector('.activity-region-btn') as HTMLButtonElement;
    const menu = container.querySelector('#activity-region-menu') as HTMLElement;

    fireEvent.click(btn);
    fireEvent.pointerDown(menu.querySelector('[data-region="北部"]') as HTMLElement);
    expect(menu.hidden).toBe(false);
    fireEvent.pointerDown(document.body);
    await waitFor(() => expect(menu.hidden).toBe(true));

    fireEvent.click(btn);
    expect(menu.hidden).toBe(false);
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(menu.hidden).toBe(true));
    expect(document.activeElement).toBe(btn);
  });

  it('網址帶 region 進站時鈕上顯示該地區；尋找附近活動點了收起並提示未開啟', async () => {
    history.replaceState(null, '', '/activities?region=east-islands');
    const { container } = mount();
    await waitFor(() => expect(container.querySelector('.activity-region-btn')?.textContent).toBe('東部&外島'));
    const btn = container.querySelector('.activity-region-btn') as HTMLButtonElement;
    fireEvent.click(btn);
    toast.clear();
    fireEvent.click(container.querySelector('#region-tab-nearby-activity') as HTMLElement);
    expect(getToasts().at(-1)?.message).toBe('附近活動地圖尚未開啟');
    expect((container.querySelector('#activity-region-menu') as HTMLElement).hidden).toBe(true);
  });

  it('地區鈕與選單跟語系翻譯（英文）', async () => {
    await setLocale('en');
    const { container } = mount();
    await waitFor(() => expect(container.querySelector('.tl-event-row')).toBeTruthy());
    const btn = container.querySelector('.activity-region-btn') as HTMLButtonElement;
    expect(btn.textContent).toBe('All');
    expect(btn.getAttribute('aria-label')).toBe('Region All');
    const items = [...container.querySelectorAll('#activity-region-menu .activity-region-item')].map((el) => el.textContent);
    expect(items).toEqual(['All', 'Central', 'North', 'South', 'East & Islands', 'Find nearby activities']);
  });

  it('沒有開團權限時不放點擊延伸區', async () => {
    const { container } = mount();
    await waitFor(() => expect(container.querySelector('.tl-event-row')).toBeTruthy());
    expect(container.querySelector('.activity-create-hit')).toBeNull();
  });

  it('我要開團加一層光澤（不攔點擊、讀屏略過）；點擊延伸區（label）等於點按鈕', async () => {
    vi.mocked(useViewer).mockReturnValue({
      uid: 'viewer',
      teamIds: new Set(),
      roleLevel: 0,
      role: 'user',
      displayName: 'Viewer',
      pictureUrl: null,
      capabilities: ['user.activity.basic_create'],
      hasPermission: () => false,
    });
    const { container } = mount();
    await waitFor(() => expect(container.querySelector('.tl-event-row')).toBeTruthy());
    const gloss = container.querySelector('#activity-create-btn > .activity-create-gloss');
    expect(gloss).toBeTruthy();
    expect(gloss?.getAttribute('aria-hidden')).toBe('true');

    const btn = container.querySelector('#activity-create-btn') as HTMLButtonElement;
    const hit = container.querySelector('label.activity-create-hit') as HTMLLabelElement;
    expect(hit).toBeTruthy();
    expect(hit.htmlFor).toBe('activity-create-btn');
    expect(hit.getAttribute('aria-hidden')).toBe('true');
    expect(hit.control).toBe(btn);
    const clicks = vi.fn();
    btn.addEventListener('click', clicks);
    fireEvent.click(hit);
    expect(clicks).toHaveBeenCalledTimes(1);
  });
});
