import type { JSX } from 'preact';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { LocationProvider, Route, Router } from 'preact-iso';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from '@/ui/Toast';
import { loadTeams } from '../data/teams-repo';
import type { TeamDoc } from '../data/types';
import { resetClubListFilters } from './clubs-list-session';
import TeamDetailPage from './TeamDetailPage';
import TeamsPage from './TeamsPage';

const authUid = vi.hoisted(() => ({ value: undefined as string | null | undefined }));
const viewerUid = vi.hoisted(() => ({ value: 'u1' as string | null }));
const signIn = vi.hoisted(() => vi.fn());
const isLoginRedirectingError = vi.hoisted(() => vi.fn());

vi.mock('@/data/auth', () => ({
  getLastKnownAuthUid: () => authUid.value,
  signIn,
  isLoginRedirectingError,
}));

vi.mock('@/features/profile/data/viewer', () => ({
  useViewer: () => ({
    uid: viewerUid.value,
    teamIds: new Set<string>(),
    role: viewerUid.value ? 'user' : 'guest',
    roleLevel: viewerUid.value ? 1 : 0,
    displayName: null,
    pictureUrl: null,
    capabilities: [] as string[],
    hasPermission: () => false,
  }),
}));

vi.mock('../data/teams-repo', () => ({
  loadTeams: vi.fn(),
  loadTeam: vi.fn(),
  loadTeamMembers: vi.fn(),
}));

vi.mock('../data/membership', () => ({
  requestTeamJoin: vi.fn(),
  leaveTeam: vi.fn(),
}));

vi.mock('@/features/events/data/events-repo', () => ({ getEventsRepo: vi.fn() }));
vi.mock('@/features/events/data/viewer-registrations', () => ({
  loadViewerRegistrations: vi.fn(),
}));

vi.mock('@/ui/Toast', () => ({
  toast: { show: vi.fn() },
}));

vi.mock('@/i18n/i18n', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/i18n/i18n')>()),
  useT: () => (key: string) => key,
}));

const teams: TeamDoc[] = [
  { id: 'alpha', name: 'Alpha', active: true, type: 'competitive', members: 8, region: '台北市' },
];

const authUser = { uid: 'u1', displayName: null, pictureUrl: null };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function DetailStub({ id }: { id?: string }): JSX.Element {
  return <div data-testid="detail-stub">{id ?? ''}</div>;
}

function renderList(): void {
  render(
    <LocationProvider>
      <Router>
        <Route path="/teams" component={TeamsPage} />
        <Route path="/teams/:id" component={DetailStub} />
      </Router>
    </LocationProvider>,
  );
}

describe('TeamsPage login return route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetClubListFilters();
    authUid.value = undefined;
    viewerUid.value = 'u1';
    vi.mocked(loadTeams).mockResolvedValue(teams);
    signIn.mockResolvedValue(authUser);
    isLoginRedirectingError.mockImplementation((err: unknown) => (
      Boolean(err && typeof err === 'object' && (err as { isRedirecting?: unknown }).isRedirecting === true)
    ));
    window.history.replaceState(null, '', '/teams');
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    window.history.replaceState(null, '', '/');
  });

  it('guest card routes to the detail path before signIn and only via preact-iso', async () => {
    // 測試同步更新：真 loginForClubs。pathname 改在 signIn 邊界記錄。
    authUid.value = null;
    viewerUid.value = null;
    const paths: string[] = [];
    const originalPush = window.history.pushState.bind(window.history);
    const pushSpy = vi.spyOn(window.history, 'pushState');
    const replaceSpy = vi.spyOn(window.history, 'replaceState');
    pushSpy.mockImplementation((data, unused, url) => {
      expect(toast.show).toHaveBeenCalledWith({ message: '請先登入 LINE 帳號' });
      originalPush(data, unused, url);
    });
    signIn.mockImplementation(() => {
      paths.push(window.location.pathname);
      return Promise.resolve(authUser);
    });

    renderList();
    await screen.findByRole('link', { name: 'Alpha' });
    pushSpy.mockClear();
    replaceSpy.mockClear();

    fireEvent.click(screen.getByRole('link', { name: 'Alpha' }));

    await waitFor(() => expect(signIn).toHaveBeenCalledTimes(1));
    expect(paths).toEqual(['/teams/alpha']);
    expect(window.location.pathname).toBe('/teams/alpha');
    expect(pushSpy).toHaveBeenCalledTimes(1);
    expect(pushSpy).toHaveBeenCalledWith(null, '', '/teams/alpha');
    expect(replaceSpy).not.toHaveBeenCalled();
    expect(await screen.findByTestId('detail-stub')).toBeTruthy();
    expect(screen.getByTestId('detail-stub').textContent).toBe('alpha');
  });

  it('logged-in card does not call login', async () => {
    // 測試同步更新：登入斷言改看真 loginForClubs 裡的 signIn。
    viewerUid.value = 'u1';
    authUid.value = 'u1';
    const pushSpy = vi.spyOn(window.history, 'pushState');
    const replaceSpy = vi.spyOn(window.history, 'replaceState');

    renderList();
    await screen.findByRole('link', { name: 'Alpha' });
    pushSpy.mockClear();
    replaceSpy.mockClear();

    fireEvent.click(screen.getByRole('link', { name: 'Alpha' }));

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(signIn).not.toHaveBeenCalled();
    expect(toast.show).not.toHaveBeenCalled();
    expect(window.location.pathname).toBe('/teams/alpha');
    expect(pushSpy).toHaveBeenCalledTimes(1);
    expect(replaceSpy).not.toHaveBeenCalled();
  });

  it('does not call login when auth uid is still unknown', async () => {
    // 測試同步更新：登入斷言改看真 loginForClubs 裡的 signIn。
    viewerUid.value = null;
    authUid.value = undefined;
    const pushSpy = vi.spyOn(window.history, 'pushState');

    renderList();
    await screen.findByRole('link', { name: 'Alpha' });
    pushSpy.mockClear();

    fireEvent.click(screen.getByRole('link', { name: 'Alpha' }));

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(signIn).not.toHaveBeenCalled();
    expect(toast.show).not.toHaveBeenCalled();
    expect(window.location.pathname).toBe('/teams/alpha');
    expect(pushSpy).toHaveBeenCalledTimes(1);
  });

  it('calls signIn once when the same card is clicked twice, then again after login settles', async () => {
    authUid.value = null;
    viewerUid.value = null;
    const pending = deferred<typeof authUser>();
    signIn.mockImplementation(() => pending.promise);
    const pushSpy = vi.spyOn(window.history, 'pushState');

    render(
      <LocationProvider>
        <TeamsPage />
      </LocationProvider>,
    );
    await screen.findByRole('link', { name: 'Alpha' });
    pushSpy.mockClear();

    const card = screen.getByRole('link', { name: 'Alpha' });
    fireEvent.click(card);
    fireEvent.click(card);

    expect(toast.show).toHaveBeenCalledTimes(1);
    expect(toast.show).toHaveBeenCalledWith({ message: '請先登入 LINE 帳號' });
    expect(pushSpy).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(signIn).toHaveBeenCalledTimes(1));

    pending.resolve(authUser);
    await act(async () => {
      await pending.promise;
    });

    fireEvent.click(card);
    await waitFor(() => expect(signIn).toHaveBeenCalledTimes(2));
    expect(toast.show).toHaveBeenCalledTimes(2);
  });

  it('shows the action error and unlocks after signIn fails', async () => {
    authUid.value = null;
    viewerUid.value = null;
    signIn.mockRejectedValue(new Error('nope'));

    render(
      <LocationProvider>
        <TeamsPage />
      </LocationProvider>,
    );
    await screen.findByRole('link', { name: 'Alpha' });
    const card = screen.getByRole('link', { name: 'Alpha' });
    fireEvent.click(card);

    await waitFor(() =>
      expect(toast.show).toHaveBeenCalledWith({ message: 'clubs.actionError', tone: 'error' }),
    );
    expect(signIn).toHaveBeenCalledTimes(1);

    fireEvent.click(card);
    await waitFor(() => expect(signIn).toHaveBeenCalledTimes(2));
  });

  it('shares one signIn between the list card and the detail login button', async () => {
    authUid.value = null;
    viewerUid.value = null;
    const paths: string[] = [];
    const pending = deferred<typeof authUser>();
    signIn.mockImplementation(() => {
      paths.push(window.location.pathname);
      return pending.promise;
    });

    render(
      <LocationProvider>
        <Router>
          <Route path="/teams" component={TeamsPage} />
          <Route path="/teams/:id" component={TeamDetailPage} />
        </Router>
      </LocationProvider>,
    );
    await screen.findByRole('link', { name: 'Alpha' });
    fireEvent.click(screen.getByRole('link', { name: 'Alpha' }));

    expect(await screen.findByText('請先登入 LINE 帳號')).toBeTruthy();
    await waitFor(() => expect(signIn).toHaveBeenCalledTimes(1));
    expect(paths).toEqual(['/teams/alpha']);

    fireEvent.click(screen.getByRole('button', { name: '登入' }));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(signIn).toHaveBeenCalledTimes(1);

    pending.resolve(authUser);
    await waitFor(() =>
      expect((screen.getByRole('button', { name: '登入' }) as HTMLButtonElement).disabled).toBe(false),
    );

    fireEvent.click(screen.getByRole('button', { name: '登入' }));
    await waitFor(() => expect(signIn).toHaveBeenCalledTimes(2));
    expect(paths[1]).toBe('/teams/alpha');
  });

  it('does not sign in again when the gate is shown after LoginRedirectingError', async () => {
    authUid.value = null;
    viewerUid.value = null;
    const redirectErr = new Error('redirect');
    (redirectErr as Error & { isRedirecting: boolean }).isRedirecting = true;
    signIn.mockRejectedValue(redirectErr);

    window.history.replaceState(null, '', '/teams/alpha');
    const tree = (
      <LocationProvider>
        <Router>
          <Route path="/teams" component={TeamsPage} />
          <Route path="/teams/:id" component={TeamDetailPage} />
        </Router>
      </LocationProvider>
    );
    const view = render(tree);

    expect(await screen.findByText('請先登入 LINE 帳號')).toBeTruthy();
    expect(signIn).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '登入' }));
    await waitFor(() => expect(signIn).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect((screen.getByRole('button', { name: '登入' }) as HTMLButtonElement).disabled).toBe(false),
    );
    expect(toast.show).not.toHaveBeenCalled();

    view.unmount();
    render(tree);
    expect(await screen.findByText('請先登入 LINE 帳號')).toBeTruthy();
    await act(async () => {
      await Promise.resolve();
    });
    expect(signIn).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: '登入' }));
    await waitFor(() => expect(signIn).toHaveBeenCalledTimes(2));
  });
});
