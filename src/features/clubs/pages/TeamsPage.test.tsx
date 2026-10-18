import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import TeamsPage from './TeamsPage';
import { loadTeams } from '../data/teams-repo';
import type { TeamDoc } from '../data/types';
import { SPORTS } from '@/features/events/data/sports';

vi.mock('../data/teams-repo', () => ({ loadTeams: vi.fn() }));

// 只替換 useT；Text 等元件仍需要真實的 getCurrentLocale 等匯出。
vi.mock('@/i18n/i18n', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/i18n/i18n')>()),
  useT: () => (key: string, values?: Record<string, unknown>) =>
    `${key}${values ? ` ${Object.values(values).join(' ')}` : ''}`,
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const teams: TeamDoc[] = [
  { id: 'alpha', name: 'Alpha', active: true, type: 'competitive', members: 8 },
  { id: 'beta', name: 'Beta', active: true, type: 'education', members: 12 },
  { id: 'casual', name: 'Casual', active: true, type: 'leisure', members: 4 },
  { id: 'none', name: 'Untagged', active: true, type: 'none', members: 2 },
  { id: 'off', name: 'Inactive', active: false, type: 'competitive' },
];

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(loadTeams).mockResolvedValue(teams);
});

afterEach(cleanup);

describe('TeamsPage', () => {
  it('shows loading before resolving and links the whole card', async () => {
    const request = deferred<TeamDoc[]>();
    vi.mocked(loadTeams).mockReturnValue(request.promise);
    render(<TeamsPage />);
    expect(screen.getByRole('status').textContent).toContain('clubs.loading');
    await act(async () => request.resolve(teams));
    expect(screen.getByRole('link', { name: 'Alpha' }).getAttribute('href')).toBe('/teams/alpha');
    expect(screen.queryByRole('link', { name: 'Inactive' })).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('retries a failed load with a new loader call', async () => {
    vi.mocked(loadTeams).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(teams);
    render(<TeamsPage />);
    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: 'clubs.retry' }));
    await screen.findByRole('link', { name: 'Alpha' });
    expect(loadTeams).toHaveBeenCalledTimes(2);
  });

  it('filters all four category tabs and restores all', async () => {
    render(<TeamsPage />);
    await screen.findByRole('link', { name: 'Alpha' });
    for (const [category, name] of [
      ['competitive', 'Alpha'],
      ['education', 'Beta'],
      ['leisure', 'Casual'],
      ['none', 'Untagged'],
    ] as const) {
      fireEvent.click(screen.getByRole('button', { name: `clubs.category.${category}` }));
      expect(screen.getByRole('link', { name })).toBeTruthy();
      expect(screen.getAllByRole('link').filter((link) =>
        link.getAttribute('href')?.startsWith('/teams/'),
      )).toHaveLength(1);
    }
    fireEvent.click(screen.getByRole('button', { name: 'clubs.all' }));
    expect(screen.getAllByRole('link').filter((link) =>
      link.getAttribute('href')?.startsWith('/teams/'),
    )).toHaveLength(4);
  });

  it('searches and explains empty results', async () => {
    render(<TeamsPage />);
    await screen.findByRole('link', { name: 'Alpha' });
    fireEvent.click(screen.getByRole('button', { name: 'clubs.filterToggle' }));
    const input = screen.getByRole('searchbox');
    fireEvent.input(input, { target: { value: 'beta' } });
    expect(screen.getByRole('link', { name: 'Beta' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Alpha' })).toBeNull();
    fireEvent.input(input, { target: { value: 'no-such-club' } });
    expect(screen.getByText('clubs.empty')).toBeTruthy();
    expect(screen.getByText('clubs.emptyHint')).toBeTruthy();
  });

  it('uses native change for the sport select (L-42)', async () => {
    const sport = SPORTS[0];
    if (!sport) throw new Error('SPORTS must contain a selectable sport');
    vi.mocked(loadTeams).mockResolvedValue([
      { ...teams[0], id: 'sport', name: 'Sport club', active: true, sportTag: sport.sportTag },
      { id: 'other', name: 'Other', active: true, sportTag: 'other-sport' },
    ]);
    render(<TeamsPage />);
    await screen.findByRole('link', { name: 'Sport club' });
    fireEvent.click(screen.getByRole('button', { name: 'clubs.filterToggle' }));
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    act(() => {
      select.value = sport.sportTag;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await waitFor(() => expect(screen.queryByRole('link', { name: 'Other' })).toBeNull());
    expect(screen.getByRole('link', { name: 'Sport club' })).toBeTruthy();
  });

  it('sorts pinned teams first and others by name', async () => {
    vi.mocked(loadTeams).mockResolvedValue([
      { id: 'z', name: 'Z', active: true, pinned: true, pinOrder: 2 },
      { id: 'b', name: 'B', active: true },
      { id: 'y', name: 'Y', active: true, pinned: true, pinOrder: 1 },
      { id: 'a', name: 'A', active: true },
    ]);
    render(<TeamsPage />);
    await screen.findByRole('link', { name: 'Y' });
    expect(screen.getAllByRole('link').map((link) => link.getAttribute('href'))
      .filter((href) => href?.startsWith('/teams/')))
      .toEqual(['/teams/y', '/teams/z', '/teams/a', '/teams/b']);
  });
});
