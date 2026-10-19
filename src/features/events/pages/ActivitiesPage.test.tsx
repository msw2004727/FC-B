import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { LocationProvider } from 'preact-iso';
import { emit } from '@/core/events';
import { _resetUseEventsForTest } from '../data/use-events';
import { _clearEventsSnapshotForTest } from '../data/events-snapshot-cache';
import { _setDictLoaderForTest, setLocale, t } from '@/i18n/i18n';
import { getToasts, toast } from '@/ui/Toast';
import { getEventsRepo, type EventsRepo } from '../data/events-repo';
import { loadViewerRegistrations } from '../data/viewer-registrations';
import { useViewer } from '@/features/profile/data/viewer';
import type { EventDoc } from '../data/types';
import ActivitiesPage from './ActivitiesPage';

vi.mock('@/i18n/i18n', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/i18n/i18n')>()),
  useT: () => t,
}));
vi.mock('@/features/events/data/events-repo', () => ({
  getEventsRepo: vi.fn(),
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

  it('marks card with tl-pending and navigates to /events/{id} when clicked', async () => {
    const { container } = mount();
    const card = await waitFor(() => {
      const el = container.querySelector('.tl-event-row[data-event-id="public-football"]');
      if (!el) throw new Error('card not ready');
      return el as HTMLElement;
    });

    fireEvent.click(card);
    expect(card.classList.contains('tl-pending')).toBe(true);
    await waitFor(() => {
      expect(window.location.pathname).toBe('/events/public-football');
    });
  });

  it('shows toast when clicking unavailable features (share, calendar tab, beginner tab, nearby, favorite heart)', async () => {
    const { container } = mount();
    await waitFor(() => {
      expect(container.querySelector('.tl-event-row')).toBeTruthy();
    });

    const shareBtn = container.querySelector('#activity-share-url-btn') as HTMLElement;
    fireEvent.click(shareBtn);
    expect(getToasts().at(-1)?.message).toBe('此功能尚未開放，請先使用舊版');

    toast.clear();
    const calTab = container.querySelector('[data-atab="calendar"]') as HTMLElement;
    fireEvent.click(calTab);
    expect(getToasts().at(-1)?.message).toBe('此功能尚未開放，請先使用舊版');

    toast.clear();
    const beginnerTab = container.querySelector('[data-atab="beginner"]') as HTMLElement;
    fireEvent.click(beginnerTab);
    expect(getToasts().at(-1)?.message).toBe('此功能尚未開放，請先使用舊版');

    toast.clear();
    const nearbyBtn = container.querySelector('#region-tab-nearby-activity') as HTMLElement;
    fireEvent.click(nearbyBtn);
    expect(getToasts().at(-1)?.message).toBe('此功能尚未開放，請先使用舊版');

    toast.clear();
    const favBtn = container.querySelector('.fav-heart') as HTMLElement;
    fireEvent.click(favBtn);
    expect(getToasts().at(-1)?.message).toBe('此功能尚未開放，請先使用舊版');
    expect(window.location.pathname).toBe('/activities');
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

  it('opens the sport dialog from the app event and updates the URL', async () => {
    const { container } = mount();
    await waitFor(() => {
      expect(container.querySelector('[data-event-id="public-football"]')).toBeTruthy();
    });
    await act(() => emit('sport:picker-open', {}));
    const dialog = screen.getByRole('dialog', { name: t('events.chooseSport') });
    fireEvent.click(within(dialog).getByRole('button', { name: new RegExp(t('events.sport.pickleball')) }));
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

  it('shows legacy empty text when no events match', async () => {
    history.replaceState(null, '', '/activities?sport=dodgeball');
    mount();
    expect(await screen.findByText('沒有符合條件的活動')).toBeTruthy();
  });
});
