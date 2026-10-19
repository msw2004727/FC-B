import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import TeamsPage from './TeamsPage';
import { loadTeams } from '../data/teams-repo';
import type { TeamDoc } from '../data/types';
import { SPORTS } from '@/features/events/data/sports';
import { toast } from '@/ui/Toast';

const routeMock = vi.fn();
let canCreatePermission = false;

vi.mock('preact-iso', () => ({
  useLocation: () => ({
    url: '/teams',
    path: '/teams',
    query: {},
    route: routeMock,
  }),
}));

vi.mock('../data/teams-repo', () => ({ loadTeams: vi.fn() }));

vi.mock('@/features/profile/data/viewer', () => ({
  useViewer: () => ({
    uid: 'u1',
    teamIds: new Set<string>(),
    hasPermission: (code: string) => (code === 'team.create' ? canCreatePermission : false),
  }),
}));

vi.mock('@/ui/Toast', () => ({
  toast: {
    show: vi.fn(),
  },
}));

// 只替換 useT；其他匯出（如 lt、getCurrentLocale）維持原樣。
vi.mock('@/i18n/i18n', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/i18n/i18n')>()),
  useT: () => (key: string, values?: Record<string, unknown>) =>
    `${key}${values ? ` ${Object.values(values).join(' ')}` : ''}`,
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const teams: TeamDoc[] = [
  {
    id: 'alpha',
    name: 'Alpha',
    active: true,
    type: 'competitive',
    members: 8,
    region: '台北市',
    teamExp: 2500,
    image: 'https://example.com/alpha.jpg',
  },
  {
    id: 'beta',
    name: 'Beta',
    active: true,
    type: 'education',
    members: 12,
    region: '台中市',
    teamExp: 500,
  },
  {
    id: 'casual',
    name: 'Casual',
    active: true,
    type: 'leisure',
    members: 4,
    region: '高雄市',
  },
  {
    id: 'none',
    name: 'Untagged',
    active: true,
    type: 'none',
    members: 2,
  },
  {
    id: 'off',
    name: 'Inactive',
    active: false,
    type: 'competitive',
  },
];

beforeEach(() => {
  vi.resetAllMocks();
  canCreatePermission = false;
  vi.mocked(loadTeams).mockResolvedValue(teams);
});

afterEach(() => {
  cleanup();
});

describe('TeamsPage (Legacy A DOM & CSS)', () => {
  it('renders legacy #page-teams skeleton while loading, then renders cards and navigates on click', async () => {
    const request = deferred<TeamDoc[]>();
    vi.mocked(loadTeams).mockReturnValue(request.promise);
    const { container } = render(<TeamsPage />);

    expect(container.querySelector('.legacy-ui #page-teams.page.active')).toBeTruthy();
    expect(container.querySelectorAll('#team-list .skeleton.skeleton-team-card')).toHaveLength(2);

    await act(async () => request.resolve(teams));

    const alphaCard = screen.getByRole('link', { name: 'Alpha' });
    expect(alphaCard.classList.contains('tc-card')).toBe(true);
    expect(alphaCard.getAttribute('data-team-id')).toBe('alpha');
    expect(screen.queryByRole('link', { name: 'Inactive' })).toBeNull();

    // 驗證卡片內容（圖片、EXP 等級、斜角標、成員數、地區）
    expect(alphaCard.querySelector('.tc-card-media img')?.getAttribute('src')).toBe(
      'https://example.com/alpha.jpg',
    );
    expect(alphaCard.querySelector('.tc-type-ribbon-competitive')?.textContent).toBe('競技');
    expect(alphaCard.querySelector('.tc-rank-score')?.textContent).toBe('2,500');
    expect(alphaCard.textContent).toContain('8 人');
    expect(alphaCard.textContent).toContain('台北市');

    // 點擊卡片導向 /teams/alpha
    fireEvent.click(alphaCard);
    expect(routeMock).toHaveBeenCalledWith('/teams/alpha');
  });

  it('retries a failed load with a new loader call', async () => {
    vi.mocked(loadTeams).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(teams);
    render(<TeamsPage />);
    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: 'clubs.retry' }));
    await screen.findByRole('link', { name: 'Alpha' });
    expect(loadTeams).toHaveBeenCalledTimes(2);
  });

  it('filters all category tabs (#team-type-tabs) and restores all', async () => {
    const { container } = render(<TeamsPage />);
    await screen.findByRole('link', { name: 'Alpha' });

    const cases: Array<[string, string, string]> = [
      ['none', '無', 'Untagged'],
      ['competitive', '競技', 'Alpha'],
      ['education', '教學', 'Beta'],
      ['leisure', '休閒', 'Casual'],
    ];

    for (const [typeKey, label, expectedName] of cases) {
      const btn = container.querySelector(
        `#team-type-tabs .team-type-tab[data-type="${typeKey}"]`,
      ) as HTMLButtonElement;
      expect(btn?.textContent).toContain(label);
      fireEvent.click(btn);
      expect(btn.classList.contains('active')).toBe(true);
      expect(screen.getByRole('link', { name: expectedName })).toBeTruthy();
      expect(container.querySelectorAll('#team-list .tc-card')).toHaveLength(1);
    }

    const allBtn = container.querySelector(
      '#team-type-tabs .team-type-tab[data-type=""]',
    ) as HTMLButtonElement;
    fireEvent.click(allBtn);
    expect(container.querySelectorAll('#team-list .tc-card')).toHaveLength(4);
  });

  it('toggles #team-filter-panel, searches by keyword, and shows legacy empty text', async () => {
    const { container } = render(<TeamsPage />);
    await screen.findByRole('link', { name: 'Alpha' });

    const toggleBtn = container.querySelector('#team-filter-toggle-btn') as HTMLButtonElement;
    const panel = container.querySelector('#team-filter-panel') as HTMLElement;
    expect(panel.hidden).toBe(true);

    fireEvent.click(toggleBtn);
    expect(panel.hidden).toBe(false);
    expect(toggleBtn.getAttribute('aria-expanded')).toBe('true');

    const input = container.querySelector('#team-search') as HTMLInputElement;
    fireEvent.input(input, { target: { value: 'beta' } });
    expect(screen.getByRole('link', { name: 'Beta' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Alpha' })).toBeNull();

    fireEvent.input(input, { target: { value: 'no-such-club' } });
    expect(screen.getByText('未找到符合條件的俱樂部')).toBeTruthy();
  });

  it('filters by sport and region selects using native change event (L-42)', async () => {
    const sport = SPORTS[0];
    if (!sport) throw new Error('SPORTS must contain a selectable sport');
    vi.mocked(loadTeams).mockResolvedValue([
      {
        ...teams[0],
        id: 'sport',
        name: 'Sport club',
        active: true,
        sportTag: sport.sportTag,
        region: '新北市',
      },
      {
        id: 'other',
        name: 'Other',
        active: true,
        sportTag: 'other-sport',
        region: '桃園市',
      },
    ]);
    const { container } = render(<TeamsPage />);
    await screen.findByRole('link', { name: 'Sport club' });

    fireEvent.click(container.querySelector('#team-filter-toggle-btn') as HTMLButtonElement);

    const sportSelect = container.querySelector('#team-sport-filter') as HTMLSelectElement;
    act(() => {
      sportSelect.value = sport.sportTag;
      sportSelect.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await waitFor(() => expect(screen.queryByRole('link', { name: 'Other' })).toBeNull());
    expect(screen.getByRole('link', { name: 'Sport club' })).toBeTruthy();

    const regionSelect = container.querySelector('#team-region-filter') as HTMLSelectElement;
    act(() => {
      regionSelect.value = '台北市';
      regionSelect.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await waitFor(() => expect(screen.queryByRole('link', { name: 'Sport club' })).toBeNull());
    expect(screen.getByText('未找到符合條件的俱樂部')).toBeTruthy();
  });

  it('sorts pinned teams first with .tc-pin-rail and others by name', async () => {
    vi.mocked(loadTeams).mockResolvedValue([
      { id: 'z', name: 'Z', active: true, pinned: true, pinOrder: 2 },
      { id: 'b', name: 'B', active: true },
      { id: 'y', name: 'Y', active: true, pinned: true, pinOrder: 1 },
      { id: 'a', name: 'A', active: true },
    ]);
    const { container } = render(<TeamsPage />);
    await screen.findByRole('link', { name: 'Y' });

    const cards = Array.from(container.querySelectorAll('#team-list .tc-card'));
    expect(cards.map((el) => el.getAttribute('data-team-id'))).toEqual(['y', 'z', 'a', 'b']);
    expect(cards[0]?.classList.contains('tc-pinned')).toBe(true);
    expect(cards[0]?.querySelector('.tc-pin-rail')?.textContent).toContain('置頂');
  });

  it('shows toast when clicking #team-page-create-btn', async () => {
    canCreatePermission = true;
    const { container } = render(<TeamsPage />);
    await screen.findByRole('link', { name: 'Alpha' });

    const createBtn = container.querySelector('#team-page-create-btn') as HTMLButtonElement;
    expect(createBtn.style.display).not.toBe('none');
    fireEvent.click(createBtn);
    expect(toast.show).toHaveBeenCalledWith({
      message: '此功能尚未開放，請先使用舊版',
    });
  });
});
