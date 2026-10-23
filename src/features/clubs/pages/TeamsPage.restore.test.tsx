import type { JSX } from 'preact';
import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { LocationProvider, Route, Router } from 'preact-iso';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadTeams } from '../data/teams-repo';
import type { TeamDoc } from '../data/types';
import { resetClubListFilters } from './clubs-list-session';
import TeamsPage from './TeamsPage';

vi.mock('../data/teams-repo', () => ({ loadTeams: vi.fn() }));

vi.mock('@/features/profile/data/viewer', () => ({
  useViewer: () => ({
    uid: 'u1',
    teamIds: new Set<string>(),
    hasPermission: () => false,
  }),
}));

vi.mock('@/ui/Toast', () => ({
  toast: { show: vi.fn() },
}));

const teams: TeamDoc[] = [
  {
    id: 'alpha',
    name: 'Alpha',
    active: true,
    type: 'competitive',
    members: 8,
    region: '台北市',
  },
  {
    id: 'beta',
    name: 'Beta',
    active: true,
    type: 'education',
    members: 3,
    region: '台中市',
  },
];

function FakeTeamDetail({ id }: { id?: string }): JSX.Element {
  return <div data-testid="fake-team-detail">{id ?? ''}</div>;
}

function TeamsRoute(): JSX.Element {
  return <TeamsPage />;
}

describe('TeamsPage filter restore across routes', () => {
  beforeEach(() => {
    resetClubListFilters();
    vi.mocked(loadTeams).mockResolvedValue(teams);
    window.history.replaceState(null, '', '/teams');
  });

  afterEach(() => {
    cleanup();
    resetClubListFilters();
    window.history.replaceState(null, '', '/');
  });

  it('keeps filters when location.route opens a detail and history.back returns', async () => {
    render(
      <LocationProvider>
        <Router>
          <Route path="/teams" component={TeamsRoute} />
          <Route path="/teams/:id" component={FakeTeamDetail} />
        </Router>
      </LocationProvider>,
    );

    await screen.findByRole('link', { name: 'Alpha' });
    fireEvent.click(document.querySelector('#team-filter-toggle-btn') as HTMLButtonElement);
    fireEvent.input(document.querySelector('#team-search') as HTMLInputElement, {
      target: { value: 'alp' },
    });
    const regionSelect = document.querySelector('#team-region-filter') as HTMLSelectElement;
    regionSelect.value = '台北市';
    regionSelect.dispatchEvent(new Event('change', { bubbles: true }));
    fireEvent.click(document.querySelector(
      '#team-type-tabs .team-type-tab[data-type="competitive"]',
    ) as HTMLButtonElement);

    fireEvent.click(screen.getByRole('link', { name: 'Alpha' }));
    expect(await screen.findByTestId('fake-team-detail')).toBeTruthy();
    expect(screen.getByTestId('fake-team-detail').textContent).toBe('alpha');
    expect(screen.queryByRole('link', { name: 'Alpha' })).toBeNull();

    window.history.back();
    await screen.findByRole('link', { name: 'Alpha' });
    expect(window.location.pathname).toBe('/teams');
    expect((document.querySelector('#team-search') as HTMLInputElement).value).toBe('alp');
    expect((document.querySelector('#team-region-filter') as HTMLSelectElement).value).toBe('台北市');
    expect((document.querySelector('#team-filter-panel') as HTMLElement).hidden).toBe(false);
    expect(
      document.querySelector('#team-type-tabs .team-type-tab[data-type="competitive"]')
        ?.classList.contains('active'),
    ).toBe(true);
  });
});
