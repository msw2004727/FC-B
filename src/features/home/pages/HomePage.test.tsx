import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { _setDictLoaderForTest, setLocale, t } from '@/i18n/i18n';
import { getEventsRepo } from '@/features/events/data/events-repo';
import { useViewer } from '@/features/profile/data/viewer';
import { resolveNextActivity, type NextActivityResult } from '../data/next-activity';
import HomePage from './HomePage';

vi.mock('@/features/events/data/events-repo', () => ({
  getEventsRepo: vi.fn(),
}));
vi.mock('@/features/profile/data/viewer', () => ({
  useViewer: vi.fn(),
}));
vi.mock('@/features/home/data/next-activity', () => ({
  resolveNextActivity: vi.fn(),
}));

function viewer(uid: string | null): ReturnType<typeof useViewer> {
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

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

beforeEach(async () => {
  vi.resetAllMocks();
  _setDictLoaderForTest(null);
  await setLocale('zh-TW');
  vi.mocked(useViewer).mockReturnValue(viewer('u1'));
  vi.mocked(resolveNextActivity).mockResolvedValue(null);
  vi.mocked(getEventsRepo).mockReturnValue({
    loadEventsStatic: vi.fn().mockResolvedValue(['events']),
    ensureTerminalEventsLoaded: vi.fn().mockResolvedValue(['events']),
    loadMoreTerminalEvents: vi.fn().mockResolvedValue(0),
    getSnapshot: () => ({ active: [], terminal: [] }),
  });
});

afterEach(() => {
  cleanup();
  _setDictLoaderForTest(null);
});

describe('HomePage', () => {
  it('shows the signed-out guidance without loading personal registrations', async () => {
    vi.mocked(useViewer).mockReturnValue(viewer(null));
    render(<HomePage />);
    expect(screen.getByText(t('home.signedOutTitle'))).toBeTruthy();
    expect(screen.getByText(t('home.signedOutBody'))).toBeTruthy();
    await screen.findByText(t('events.emptyTitle'));
    expect(resolveNextActivity).not.toHaveBeenCalled();
  });

  it('renders the brand and personal skeleton before the request completes', async () => {
    const pending = deferred<NextActivityResult | null>();
    vi.mocked(resolveNextActivity).mockReturnValue(pending.promise);
    render(<HomePage />);
    expect(screen.getByRole('heading', { name: t('home.heroTitle') })).toBeTruthy();
    expect(screen.getByRole('status', { name: t('home.loading') })).toBeTruthy();
    await waitFor(() => expect(resolveNextActivity).toHaveBeenCalledWith({}, 'u1'));
    await act(async () => pending.resolve(null));
    expect(await screen.findByText(t('home.emptyTitle'))).toBeTruthy();
  });

  it('shows the next activity using its public ID', async () => {
    vi.mocked(resolveNextActivity).mockResolvedValue({
      event: {
        id: 'public-next',
        _docId: 'document-next',
        title: 'My next football',
        date: '2030/10/19 18:00~20:00',
        status: 'open',
      },
      registration: { userId: 'u1', eventId: 'public-next', status: 'confirmed' },
      managedRole: '',
    });
    render(<HomePage />);
    const link = await screen.findByRole('link', { name: 'My next football' });
    expect(link.getAttribute('href')).toBe('/events/public-next');
    expect(screen.queryByText(t('home.emptyTitle'))).toBeNull();
  });

  it('shows the empty state and working discovery links', async () => {
    render(<HomePage />);
    expect(await screen.findByText(t('home.emptyTitle'))).toBeTruthy();
    expect(screen.getAllByRole('link', { name: t('home.findActivities') })
      .every((link) => link.getAttribute('href') === '/activities')).toBe(true);
    expect(screen.getByRole('link', { name: t('home.findClubs') })
      .getAttribute('href')).toBe('/teams');
  });

  it('discards the previous identity response after account switching', async () => {
    const first = deferred<NextActivityResult | null>();
    const second = deferred<NextActivityResult | null>();
    vi.mocked(resolveNextActivity)
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const view = render(<HomePage />);
    await waitFor(() => expect(resolveNextActivity).toHaveBeenCalledWith({}, 'u1'));

    vi.mocked(useViewer).mockReturnValue(viewer('u2'));
    view.rerender(<HomePage />);
    await waitFor(() => expect(resolveNextActivity).toHaveBeenCalledWith({}, 'u2'));

    await act(async () => second.resolve(null));
    await act(async () => first.resolve({
      event: { id: 'secret', title: 'Old account activity' },
      registration: null,
      managedRole: '',
    }));
    expect(screen.queryByText('Old account activity')).toBeNull();
    expect(screen.getByText(t('home.emptyTitle'))).toBeTruthy();
  });

  it('retries a rejected personal request', async () => {
    vi.mocked(resolveNextActivity)
      .mockRejectedValueOnce(new Error('private failure'))
      .mockResolvedValueOnce(null);
    render(<HomePage />);
    await screen.findByText(t('home.loadError'));
    fireEvent.click(screen.getByRole('button', { name: t('home.retry') }));
    expect(await screen.findByText(t('home.emptyTitle'))).toBeTruthy();
    expect(resolveNextActivity).toHaveBeenCalledTimes(2);
    expect(screen.queryByText('private failure')).toBeNull();
  });

  it('takes five events only after visibility filtering', async () => {
    const events = Array.from({ length: 7 }, (_, index) => ({
      id: `event-${index}`,
      title: `Preview ${index}`,
      status: 'open',
      date: `2030/10/${10 + index} 18:00~20:00`,
      sportTag: 'football',
      privateEvent: index === 0,
      creatorUid: 'other',
    }));
    vi.mocked(getEventsRepo).mockReturnValue({
      loadEventsStatic: vi.fn().mockResolvedValue(['events']),
      ensureTerminalEventsLoaded: vi.fn().mockResolvedValue(['events']),
      loadMoreTerminalEvents: vi.fn().mockResolvedValue(0),
      getSnapshot: () => ({ active: events, terminal: [] }),
    });
    render(<HomePage />);
    await screen.findByRole('link', { name: 'Preview 1' });
    expect(screen.queryByText('Preview 0')).toBeNull();
    expect(screen.getAllByRole('link', { name: /^Preview / })).toHaveLength(5);
    expect(screen.queryByText('Preview 6')).toBeNull();
    expect(screen.getByRole('link', { name: /足球/ }).getAttribute('href'))
      .toBe('/activities?sport=football');
  });
});
