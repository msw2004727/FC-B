import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { LocationProvider } from 'preact-iso';
import { emit } from '@/core/events';
import { _setDictLoaderForTest, setLocale, t } from '@/i18n/i18n';
import { getEventsRepo, type EventsRepo } from '../data/events-repo';
import { useViewer } from '@/features/profile/data/viewer';
import type { EventDoc } from '../data/types';
import ActivitiesPage from './ActivitiesPage';

vi.mock('@/features/events/data/events-repo', () => ({
  getEventsRepo: vi.fn(),
}));
vi.mock('@/features/profile/data/viewer', () => ({
  useViewer: vi.fn(),
}));

type SportEvent = EventDoc & { sportTag: string };

const football: SportEvent = {
  id: 'public-football',
  _docId: 'document-football',
  title: 'Visible football',
  status: 'open',
  date: '2030/10/19 18:00~20:00',
  sportTag: 'football',
};

const pickleball: SportEvent = {
  id: 'public-pickleball',
  title: 'Visible pickleball',
  status: 'open',
  date: '2030/10/20 18:00~20:00',
  sportTag: 'pickleball',
};

let active: EventDoc[];
let load: ReturnType<typeof vi.fn<EventsRepo['loadEventsStatic']>>;

function mount(): ReturnType<typeof render> {
  return render(<LocationProvider><ActivitiesPage /></LocationProvider>);
}

beforeEach(async () => {
  vi.resetAllMocks();
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
  _setDictLoaderForTest(null);
  history.replaceState(null, '', '/');
});

describe('ActivitiesPage', () => {
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
    mount();
    await screen.findByRole('link', { name: 'Visible football' });
    expect(screen.getByRole('link', { name: 'Visible owned private' })).toBeTruthy();
    expect(screen.queryByText('Hidden private')).toBeNull();
    expect(screen.queryByText('Hidden team')).toBeNull();
    expect(screen.queryByText('Hidden blocked')).toBeNull();
    expect(load).toHaveBeenCalledWith({ terminalMode: 'preview' });
  });

  it('preselects the sport query and links with public id', async () => {
    history.replaceState(null, '', '/activities?sport=football');
    mount();
    const link = await screen.findByRole('link', { name: 'Visible football' });
    expect(link.getAttribute('href')).toBe('/events/public-football');
    expect(screen.queryByRole('link', { name: 'Visible pickleball' })).toBeNull();
    expect(screen.getByRole('button', { name: t('events.sport.football') })
      .getAttribute('aria-pressed')).toBe('true');
  });

  it('normalizes an ended tab while preserving sport and other query values', async () => {
    history.replaceState(null, '', '/activities?tab=ended&sport=football&source=shared');
    mount();
    await screen.findByRole('link', { name: 'Visible football' });
    await waitFor(() => {
      const query = new URLSearchParams(window.location.search);
      expect(query.get('tab')).toBe('normal');
      expect(query.get('sport')).toBe('football');
      expect(query.get('source')).toBe('shared');
    });
    expect(screen.getByRole('tab', { name: t('events.normal') })
      .getAttribute('aria-selected')).toBe('true');
    expect(screen.getAllByRole('tab')).toHaveLength(1);
  });

  it('opens the sport sheet from the app event and updates the URL', async () => {
    mount();
    await screen.findByRole('link', { name: 'Visible football' });
    await act(() => emit('sport:picker-open', {}));
    const dialog = screen.getByRole('dialog', { name: t('events.chooseSport') });
    fireEvent.click(within(dialog).getByRole('button', { name: t('events.sport.pickleball') }));
    await waitFor(() => {
      expect(new URLSearchParams(window.location.search).get('sport')).toBe('pickleball');
      expect(screen.queryByRole('link', { name: 'Visible football' })).toBeNull();
    });
    expect(screen.getByRole('link', { name: 'Visible pickleball' })).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('shows a skeleton while pending, then retries a rejected request', async () => {
    let reject!: (error: Error) => void;
    load.mockImplementationOnce(() => new Promise<string[]>((_resolve, rejectPromise) => {
      reject = rejectPromise;
    }));
    mount();
    await waitFor(() => expect(load).toHaveBeenCalledOnce());
    expect(screen.getByRole('status', { name: t('events.loading') })).toBeTruthy();
    await act(async () => reject(new Error('private internal error')));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.queryByText('private internal error')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: t('events.retry') }));
    await screen.findByRole('link', { name: 'Visible football' });
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('shows an empty state when a sport has no visible events', async () => {
    history.replaceState(null, '', '/activities?sport=dodgeball');
    mount();
    expect(await screen.findByText(t('events.emptyTitle'))).toBeTruthy();
  });
});
