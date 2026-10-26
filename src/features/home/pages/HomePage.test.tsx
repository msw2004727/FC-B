import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import {
  _resetFirebaseForTest,
  armFirebaseAuthHold,
  whenFirebaseAuthAllowed,
} from '@/data/firebase';
import { getEventsRepo } from '@/features/events/data/events-repo';
import { _resetUseEventsForTest } from '@/features/events/data/use-events';
import { useViewer, type ViewerView } from '@/features/profile/data/viewer';
import { toast } from '@/ui/Toast';
import { loadActiveAnnouncements, type AnnouncementDoc } from '../data/announcements';
import { loadActiveBanners, type BannerDoc } from '../data/banners';
import {
  parseEventDateRange,
  registrationStatusMeta,
  resolveNextActivity,
  type NextActivityResult,
} from '../data/next-activity';
import HomePage from './HomePage';

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

vi.mock('@/features/events/data/events-repo', () => ({
  getEventsRepo: vi.fn(),
}));

vi.mock('@/features/profile/data/viewer', () => ({
  useViewer: vi.fn(),
}));

vi.mock('@/features/home/data/next-activity', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/home/data/next-activity')>();
  return {
    ...actual,
    resolveNextActivity: vi.fn(),
    parseEventDateRange: actual.parseEventDateRange,
    registrationStatusMeta: actual.registrationStatusMeta,
  };
});

vi.mock('@/features/home/data/banners', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/home/data/banners')>();
  return {
    ...actual,
    loadActiveBanners: vi.fn(),
  };
});

vi.mock('@/features/home/data/announcements', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/home/data/announcements')>();
  return {
    ...actual,
    loadActiveAnnouncements: vi.fn(),
  };
});

vi.mock('@/features/events/components/EventFormModal', () => ({
  EventFormModal: ({ open }: { open: boolean }) =>
    open ? <div data-testid="event-form-modal">建立活動對話框</div> : null,
}));

function makeViewer(uid: string | null, role = 'user'): ViewerView {
  return {
    uid,
    teamIds: new Set(),
    roleLevel: role === 'coach' ? 2 : 0,
    role,
    displayName: uid,
    pictureUrl: null,
    capabilities: [],
    hasPermission: () => false,
  };
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeEach(() => {
  vi.resetAllMocks();
  _resetUseEventsForTest();
  vi.mocked(useViewer).mockReturnValue(makeViewer('u1'));
  vi.mocked(resolveNextActivity).mockResolvedValue(null);
  vi.mocked(loadActiveBanners).mockResolvedValue([]);
  vi.mocked(loadActiveAnnouncements).mockResolvedValue([]);
  vi.mocked(getEventsRepo).mockReturnValue({
    loadEventsStatic: vi.fn().mockResolvedValue(['events']),
    ensureTerminalEventsLoaded: vi.fn().mockResolvedValue(['events']),
    loadMoreTerminalEvents: vi.fn().mockResolvedValue(0),
    getSnapshot: () => ({ active: [], terminal: [] }),
  });
});

afterEach(() => {
  cleanup();
  _resetFirebaseForTest();
  vi.useRealTimers();
});

describe('HomePage (legacy A DOM & CSS)', () => {
  it('renders legacy A container structure and key IDs/classes', async () => {
    const { container } = render(<HomePage />);
    expect(container.querySelector('.legacy-ui > section.page.active#page-home')).toBeTruthy();
    expect(container.querySelector('.banner-carousel #banner-track')).toBeTruthy();
    expect(container.querySelector('#banner-dots')).toBeTruthy();
    expect(container.querySelector('.home-hero-actions')).toBeTruthy();
    expect(container.querySelector('#announce-marquee-wrap')).toBeTruthy();
    expect(container.querySelector('#announce-detail-modal')).toBeTruthy();
    expect(container.querySelector('section#home-next-activity')).toBeTruthy();
    expect(container.querySelector('#home-sport-entry')).toBeTruthy();
    expect(container.querySelector('#home-sport-views')?.textContent).toBe('');
    expect(container.querySelector('#home-info-meter')).toBeTruthy();
    expect(container.querySelector('#sponsor-grid')).toBeTruthy();
    expect(container.querySelector('#floating-ads')).toBeTruthy();
  });

  it('shows skeleton slide when there are no banners, then renders slides, overlay, and rotates on interval', async () => {
    vi.useFakeTimers();
    const banners: BannerDoc[] = [
      {
        id: 'b1',
        _docId: 'b1',
        status: 'active',
        title: '週末熱血開踢',
        subtitle: '立即加入附近球局',
        image: 'https://example.com/banner1.jpg',
      },
      {
        id: 'b2',
        _docId: 'b2',
        status: 'active',
        title: '第二張橫幅',
        gradient: 'linear-gradient(#000, #333)',
      },
    ];
    vi.mocked(loadActiveBanners).mockResolvedValue(banners);

    const { container } = render(<HomePage />);

    await waitFor(() => {
      expect(container.querySelectorAll('#banner-track .banner-slide').length).toBe(2);
    });
    // 活動資料是動態載入 events-repo 後才查詢；等它跑完再推進計時器，輪播計時器才不會在推進途中被重新計時。
    await waitFor(() => expect(getEventsRepo).toHaveBeenCalled());
    await act(async () => {
      for (let i = 0; i < 5; i += 1) await Promise.resolve();
    });

    expect(screen.getByRole('heading', { name: '週末熱血開踢' })).toBeTruthy();
    expect(screen.getByText('立即加入附近球局')).toBeTruthy();

    const track = container.querySelector('#banner-track') as HTMLElement;
    expect(track.style.transform).toContain('translateX(-0%)');

    const dots = container.querySelectorAll('#banner-dots .banner-dot');
    expect(dots.length).toBe(2);
    expect(dots[0]?.classList.contains('active')).toBe(true);

    await act(async () => {
      vi.advanceTimersByTime(8000);
    });

    expect(track.style.transform).toContain('translateX(-100%)');
    expect(dots[1]?.classList.contains('active')).toBe(true);
  });

  it('shows unavailable toast when clicking nearby activity map button on banner', async () => {
    const spy = vi.spyOn(toast, 'show');
    vi.mocked(loadActiveBanners).mockResolvedValue([
      {
        id: 'b1',
        _docId: 'b1',
        status: 'active',
        title: 'Banner 1',
      },
    ]);

    render(<HomePage />);
    const mapBtn = await screen.findByRole('button', { name: '尋找附近活動' });
    fireEvent.click(mapBtn);

    expect(spy).toHaveBeenCalledWith({ message: '此功能尚未開放，請先使用舊版' });
  });

  it('renders announcement marquee and opens detail modal on click', async () => {
    const anns: AnnouncementDoc[] = [
      {
        id: 'ann-1',
        _docId: 'ann-1',
        status: 'active',
        title: '場地異動通知',
        content: '本週六改至第一運動場',
        publishAt: '2026/05/01 09:00',
        sortOrder: 1,
      },
    ];
    vi.mocked(loadActiveAnnouncements).mockResolvedValue(anns);

    const { container } = render(<HomePage />);

    await waitFor(() => {
      const items = container.querySelectorAll('.announce-marquee-item');
      expect(items.length).toBe(2);
    });

    const wrap = container.querySelector('#announce-marquee-wrap') as HTMLElement;
    expect(wrap.style.display).not.toBe('none');

    const firstItem = container.querySelector('.announce-marquee-item') as HTMLElement;
    fireEvent.click(firstItem);

    const modalOverlay = container.querySelector('#announce-detail-modal') as HTMLElement;
    expect(modalOverlay.classList.contains('open')).toBe(true);
    expect(container.querySelector('#ann-detail-title')?.textContent).toBe('場地異動通知');
    expect(container.querySelector('#ann-detail-body')?.textContent).toBe('本週六改至第一運動場');
    expect(container.querySelector('#ann-detail-footer')?.textContent).toBe('2026/05/01 09:00');
  });

  it('renders next activity empty state for signed-out viewer without querying Firestore', async () => {
    vi.mocked(useViewer).mockReturnValue(makeViewer(null));
    render(<HomePage />);

    expect(screen.getByText('你目前還沒有報名活動')).toBeTruthy();
    expect(resolveNextActivity).not.toHaveBeenCalled();
  });

  it('renders next activity card with status pill and navigates to event detail on click', async () => {
    const pending = deferred<NextActivityResult | null>();
    vi.mocked(resolveNextActivity).mockReturnValue(pending.promise);

    const { container } = render(<HomePage />);
    expect(container.querySelector('.home-next-loading')).toBeTruthy();

    await act(async () => {
      pending.resolve({
        event: {
          id: 'evt-100',
          _docId: 'doc-100',
          title: '週三夜光足球',
          date: '2030/10/19 19:00~21:00',
          location: '台北市百齡球場',
          status: 'open',
        },
        registration: {
          userId: 'u1',
          eventId: 'evt-100',
          status: 'confirmed',
        },
        managedRole: '',
      });
    });

    expect(await screen.findByText('週三夜光足球')).toBeTruthy();
    expect(screen.getByText('台北市百齡球場')).toBeTruthy();
    expect(container.querySelector('.home-next-status-confirmed')?.textContent).toBe('正取');

    const detailBtns = container.querySelectorAll('[data-home-next-action="detail"]');
    fireEvent.click(detailBtns[1] as HTMLElement);
    expect(mockRoute).toHaveBeenCalledWith('/events/evt-100');

    expect(typeof parseEventDateRange).toBe('function');
    expect(typeof registrationStatusMeta).toBe('function');
  });

  it('renders sport quick entry counts from visible active events and navigates on click', async () => {
    const events = [
      {
        id: 'e1',
        title: 'Football 1',
        status: 'open',
        date: '2030/10/20 18:00~20:00',
        sportTag: 'football',
      },
      {
        id: 'e2',
        title: 'Football 2',
        status: 'open',
        date: '2030/10/21 18:00~20:00',
        sportTag: 'football',
      },
      {
        id: 'e3',
        title: 'Private Football',
        status: 'open',
        date: '2030/10/22 18:00~20:00',
        sportTag: 'football',
        privateEvent: true,
        creatorUid: 'other',
      },
    ];
    vi.mocked(getEventsRepo).mockReturnValue({
      loadEventsStatic: vi.fn().mockResolvedValue(['events']),
      ensureTerminalEventsLoaded: vi.fn().mockResolvedValue(['events']),
      loadMoreTerminalEvents: vi.fn().mockResolvedValue(0),
      getSnapshot: () => ({ active: events, terminal: [] }),
    });

    const { container } = render(<HomePage />);

    const chip = await waitFor(() => {
      const el = container.querySelector('.home-sport-chip[data-home-sport="football"]');
      expect(el).toBeTruthy();
      return el as HTMLElement;
    });

    expect(chip.querySelector('.home-sport-chip-count')?.textContent).toBe('2 活動');
    fireEvent.click(chip);
    expect(mockRoute).toHaveBeenCalledWith('/activities?sport=football');
  });

  it('home loads active events only (terminalMode none, A4); terminal preview is left to the list pages', async () => {
    const loadEventsStatic = vi.fn().mockResolvedValue(['events']);
    vi.mocked(getEventsRepo).mockReturnValue({
      loadEventsStatic,
      ensureTerminalEventsLoaded: vi.fn().mockResolvedValue(['events']),
      loadMoreTerminalEvents: vi.fn().mockResolvedValue(0),
      getSnapshot: () => ({ active: [], terminal: [] }),
    });

    render(<HomePage />);

    await waitFor(() => expect(loadEventsStatic).toHaveBeenCalledTimes(1));
    expect(loadEventsStatic).toHaveBeenCalledWith({ terminalMode: 'none' });
  });

  // 三個公開讀取（events／banners／announcements）都要登記給 Auth 暫緩機制（T-041）。
  // 每個案例讓「其中一個」維持未回來、另外兩個先回來：少登記任何一個，就會在這裡提早放行而被抓到。
  it.each(['events', 'banners', 'announcements'] as const)(
    '%s 讀取還沒回來時不放行 Auth；回來後才放行',
    async (pendingRead) => {
      armFirebaseAuthHold({ settleMs: 5, capMs: 60_000 });
      const pendingEvents = deferred<string[]>();
      const pendingBanners = deferred<BannerDoc[]>();
      const pendingAnnouncements = deferred<AnnouncementDoc[]>();
      vi.mocked(getEventsRepo).mockReturnValue({
        loadEventsStatic: vi.fn().mockReturnValue(
          pendingRead === 'events' ? pendingEvents.promise : Promise.resolve(['events']),
        ),
        ensureTerminalEventsLoaded: vi.fn().mockResolvedValue(['events']),
        loadMoreTerminalEvents: vi.fn().mockResolvedValue(0),
        getSnapshot: () => ({ active: [], terminal: [] }),
      });
      vi.mocked(loadActiveBanners).mockReturnValue(
        pendingRead === 'banners' ? pendingBanners.promise : Promise.resolve([]),
      );
      vi.mocked(loadActiveAnnouncements).mockReturnValue(
        pendingRead === 'announcements' ? pendingAnnouncements.promise : Promise.resolve([]),
      );
      let allowed = false;
      void whenFirebaseAuthAllowed().then(() => {
        allowed = true;
      });

      render(<HomePage />);
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 80));
      });
      expect(allowed).toBe(false);

      pendingEvents.resolve(['events']);
      pendingBanners.resolve([]);
      pendingAnnouncements.resolve([]);
      await waitFor(() => expect(allowed).toBe(true));
    },
  );

});
