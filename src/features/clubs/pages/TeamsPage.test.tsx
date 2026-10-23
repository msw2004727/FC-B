import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import TeamsPage from './TeamsPage';
import { resetClubListFilters } from './clubs-list-session';
import { loginForClubs } from './clubs-session';
import { loadTeams } from '../data/teams-repo';
import type { TeamDoc } from '../data/types';
import { SPORTS } from '@/features/events/data/sports';
import { useViewer } from '@/features/profile/data/viewer';
import { toast } from '@/ui/Toast';

const routeMock = vi.fn();
const authUid = vi.hoisted(() => ({ value: undefined as string | null | undefined }));
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

// 測試同步更新：useViewer 改成可切換，才能覆蓋訪客閘門與登入狀態未定。
vi.mock('@/features/profile/data/viewer', () => ({
  useViewer: vi.fn(),
}));

vi.mock('@/data/auth', () => ({
  getLastKnownAuthUid: () => authUid.value,
}));

vi.mock('./clubs-session', () => ({
  loginForClubs: vi.fn(),
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

function listViewer(uid: string | null): ReturnType<typeof useViewer> {
  return {
    uid,
    teamIds: new Set<string>(),
    hasPermission: (code: string) => (code === 'team.create' ? canCreatePermission : false),
    role: uid ? 'user' : 'guest',
    roleLevel: uid ? 1 : 0,
    displayName: null,
    pictureUrl: null,
    capabilities: [],
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  resetClubListFilters();
  canCreatePermission = false;
  authUid.value = undefined;
  vi.mocked(useViewer).mockReturnValue(listViewer('u1'));
  vi.mocked(loadTeams).mockResolvedValue(teams);
  vi.mocked(loginForClubs).mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

async function advance(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

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
      // 測試同步更新：頁籤 active 立刻變，列表等 300ms 去抖。
      expect(btn.classList.contains('active')).toBe(true);
      await waitFor(() => {
        expect(screen.getByRole('link', { name: expectedName })).toBeTruthy();
        expect(container.querySelectorAll('#team-list .tc-card')).toHaveLength(1);
      });
    }

    const allBtn = container.querySelector(
      '#team-type-tabs .team-type-tab[data-type=""]',
    ) as HTMLButtonElement;
    fireEvent.click(allBtn);
    expect(allBtn.classList.contains('active')).toBe(true);
    await waitFor(() => {
      expect(container.querySelectorAll('#team-list .tc-card')).toHaveLength(4);
    });
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
    // 測試同步更新：輸入框立刻變，列表等 300ms 去抖。
    expect(input.value).toBe('beta');
    expect(screen.getByRole('link', { name: 'Alpha' })).toBeTruthy();
    await waitFor(() => {
      expect(screen.queryByRole('link', { name: 'Alpha' })).toBeNull();
    });
    expect(screen.getByRole('link', { name: 'Beta' })).toBeTruthy();

    fireEvent.input(input, { target: { value: 'no-such-club' } });
    await waitFor(() => {
      expect(screen.getByText('找不到符合的俱樂部')).toBeTruthy();
    });
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
    // 測試同步更新：下拉立刻顯示，列表等 300ms 去抖。
    expect(sportSelect.value).toBe(sport.sportTag);
    expect(screen.getByRole('link', { name: 'Other' })).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole('link', { name: 'Other' })).toBeNull());
    expect(screen.getByRole('link', { name: 'Sport club' })).toBeTruthy();

    const regionSelect = container.querySelector('#team-region-filter') as HTMLSelectElement;
    act(() => {
      regionSelect.value = '台北市';
      regionSelect.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(regionSelect.value).toBe('台北市');
    await waitFor(() => expect(screen.queryByRole('link', { name: 'Sport club' })).toBeNull());
    expect(screen.getByText('找不到符合的俱樂部')).toBeTruthy();
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

  it('shows toast when clicking #team-page-create-btn（測試同步更新）', async () => {
    canCreatePermission = true;
    const { container } = render(<TeamsPage />);
    await screen.findByRole('link', { name: 'Alpha' });

    const createBtn = container.querySelector<HTMLButtonElement>('#team-page-create-btn');
    if (!createBtn) throw new Error('缺少新增俱樂部按鈕');
    expect(createBtn.style.display).not.toBe('none');
    expect(screen.queryByRole('dialog')).toBeNull();

    vi.mocked(toast.show).mockClear();
    fireEvent.click(createBtn);

    const dialog = await screen.findByRole('dialog');
    expect(dialog.isConnected).toBe(true);
    expect(dialog.querySelector<HTMLInputElement>('#ct-team-name')).not.toBeNull();
    expect(toast.show).not.toHaveBeenCalledWith(
      expect.objectContaining({
        message: '此功能尚未開放，請先使用舊版',
      }),
    );
    expect(screen.queryByText('此功能尚未開放，請先使用舊版')).toBeNull();
  });
});

describe('TeamsPage M-114 filters', () => {
  it('focuses #team-search after expanding the filter panel', async () => {
    const { container } = render(<TeamsPage />);
    await screen.findByRole('link', { name: 'Alpha' });
    vi.useFakeTimers();

    const toggleBtn = container.querySelector('#team-filter-toggle-btn') as HTMLButtonElement;
    const panel = container.querySelector('#team-filter-panel') as HTMLElement;
    const input = container.querySelector('#team-search') as HTMLInputElement;
    const focus = vi.spyOn(HTMLInputElement.prototype, 'focus');

    fireEvent.click(toggleBtn);
    expect(panel.hidden).toBe(false);
    expect(document.activeElement).not.toBe(input);

    await advance(32);
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(document.activeElement).toBe(input);

    focus.mockClear();
    fireEvent.click(toggleBtn);
    expect(panel.hidden).toBe(true);
    await advance(32);
    expect(focus).not.toHaveBeenCalled();
    focus.mockRestore();
  });

  it('applies search after 300ms and keeps only the last burst', async () => {
    const { container } = render(<TeamsPage />);
    await screen.findByRole('link', { name: 'Alpha' });
    vi.useFakeTimers();

    const input = container.querySelector('#team-search') as HTMLInputElement;
    fireEvent.input(input, { target: { value: 'beta' } });
    expect(input.value).toBe('beta');
    expect(screen.getByRole('link', { name: 'Alpha' })).toBeTruthy();

    await advance(299);
    expect(screen.getByRole('link', { name: 'Alpha' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Beta' })).toBeTruthy();

    await advance(1);
    expect(screen.queryByRole('link', { name: 'Alpha' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Beta' })).toBeTruthy();

    fireEvent.input(input, { target: { value: 'b' } });
    await advance(200);
    fireEvent.input(input, { target: { value: 'no-such-club' } });
    await advance(299);
    expect(screen.getByRole('link', { name: 'Beta' })).toBeTruthy();
    await advance(1);
    expect(screen.queryByRole('link', { name: 'Beta' })).toBeNull();
    expect(screen.getByText('找不到符合的俱樂部')).toBeTruthy();
  });

  it('updates the type tab immediately and the list after 300ms', async () => {
    const { container } = render(<TeamsPage />);
    await screen.findByRole('link', { name: 'Alpha' });
    vi.useFakeTimers();

    const btn = container.querySelector(
      '#team-type-tabs .team-type-tab[data-type="education"]',
    ) as HTMLButtonElement;
    fireEvent.click(btn);
    expect(btn.classList.contains('active')).toBe(true);
    expect(container.querySelectorAll('#team-list .tc-card')).toHaveLength(4);

    await advance(299);
    expect(container.querySelectorAll('#team-list .tc-card')).toHaveLength(4);
    await advance(1);
    expect(container.querySelectorAll('#team-list .tc-card')).toHaveLength(1);
    expect(screen.getByRole('link', { name: 'Beta' })).toBeTruthy();
  });

  it('restores live filters after remount and clears them with resetClubListFilters', async () => {
    const sport = SPORTS[0];
    if (!sport) throw new Error('SPORTS must contain a selectable sport');
    const first = render(<TeamsPage />);
    await screen.findByRole('link', { name: 'Alpha' });

    const toggleBtn = document.querySelector('#team-filter-toggle-btn') as HTMLButtonElement;
    fireEvent.click(toggleBtn);
    const input = document.querySelector('#team-search') as HTMLInputElement;
    fireEvent.input(input, { target: { value: 'alp' } });
    const regionSelect = document.querySelector('#team-region-filter') as HTMLSelectElement;
    act(() => {
      regionSelect.value = '台北市';
      regionSelect.dispatchEvent(new Event('change', { bubbles: true }));
    });
    const sportSelect = document.querySelector('#team-sport-filter') as HTMLSelectElement;
    act(() => {
      sportSelect.value = sport.sportTag;
      sportSelect.dispatchEvent(new Event('change', { bubbles: true }));
    });
    const tab = document.querySelector(
      '#team-type-tabs .team-type-tab[data-type="competitive"]',
    ) as HTMLButtonElement;
    fireEvent.click(tab);
    expect(tab.classList.contains('active')).toBe(true);

    first.unmount();
    render(<TeamsPage />);
    await screen.findByRole('link', { name: 'Alpha' });

    const restoredInput = document.querySelector('#team-search') as HTMLInputElement;
    const restoredRegion = document.querySelector('#team-region-filter') as HTMLSelectElement;
    const restoredSport = document.querySelector('#team-sport-filter') as HTMLSelectElement;
    const restoredPanel = document.querySelector('#team-filter-panel') as HTMLElement;
    const restoredTab = document.querySelector(
      '#team-type-tabs .team-type-tab[data-type="competitive"]',
    ) as HTMLButtonElement;
    expect(restoredInput.value).toBe('alp');
    expect(restoredRegion.value).toBe('台北市');
    expect(restoredPanel.hidden).toBe(false);
    expect(restoredTab.classList.contains('active')).toBe(true);
    // 運動不進 session，重新掛載回到全站值（測試環境為全部）。
    expect(restoredSport.value).toBe('');
    expect(document.querySelectorAll('#team-list .tc-card')).toHaveLength(1);

    cleanup();
    resetClubListFilters();
    const { container } = render(<TeamsPage />);
    await screen.findByRole('link', { name: 'Alpha' });
    expect((container.querySelector('#team-search') as HTMLInputElement).value).toBe('');
    expect((container.querySelector('#team-region-filter') as HTMLSelectElement).value).toBe('');
    expect((container.querySelector('#team-filter-panel') as HTMLElement).hidden).toBe(true);
    expect(
      container.querySelector('#team-type-tabs .team-type-tab[data-type=""]')?.classList.contains('active'),
    ).toBe(true);
    expect(container.querySelectorAll('#team-list .tc-card')).toHaveLength(4);
  });

  it('shows no-match copy only when applied filters exclude every club', async () => {
    vi.mocked(loadTeams).mockResolvedValue([
      { id: 'alpha', name: 'Alpha', active: true, type: 'competitive', region: '台北市' },
    ]);
    const { container } = render(<TeamsPage />);
    await screen.findByRole('link', { name: 'Alpha' });
    vi.useFakeTimers();

    const leisure = container.querySelector(
      '#team-type-tabs .team-type-tab[data-type="leisure"]',
    ) as HTMLButtonElement;
    fireEvent.click(leisure);
    await advance(299);
    expect(screen.getByRole('link', { name: 'Alpha' })).toBeTruthy();
    await advance(1);
    // 測試同步更新：只選類型頁籤也算篩過，無結果改顯示 team.noMatch。
    expect(screen.getByText('找不到符合的俱樂部')).toBeTruthy();
    expect(screen.queryByText('此類型尚無俱樂部')).toBeNull();

    const toggleBtn = container.querySelector('#team-filter-toggle-btn') as HTMLButtonElement;
    fireEvent.click(toggleBtn);
    const input = container.querySelector('#team-search') as HTMLInputElement;
    fireEvent.input(input, { target: { value: 'no-such-club' } });
    await advance(300);
    expect(screen.getByText('找不到符合的俱樂部')).toBeTruthy();
  });

  it('keeps the unfiltered empty copy when the club list itself is empty', async () => {
    vi.mocked(loadTeams).mockResolvedValue([]);
    render(<TeamsPage />);
    expect(await screen.findByText('此類型尚無俱樂部')).toBeTruthy();
    expect(screen.queryByText('找不到符合的俱樂部')).toBeNull();
  });

  it('marks #team-list aria-busy while the skeleton is showing', async () => {
    const request = deferred<TeamDoc[]>();
    vi.mocked(loadTeams).mockReturnValue(request.promise);
    const { container } = render(<TeamsPage />);
    const list = container.querySelector('#team-list');
    expect(list?.getAttribute('aria-busy')).toBe('true');
    expect(container.querySelectorAll('#team-list .skeleton.skeleton-team-card')).toHaveLength(2);

    await act(async () => {
      request.resolve(teams);
    });
    expect(container.querySelector('#team-list')?.hasAttribute('aria-busy')).toBe(false);
    expect(screen.getByRole('link', { name: 'Alpha' })).toBeTruthy();
  });
});

describe('TeamsPage M-115 card pending', () => {
  async function renderReady(): Promise<HTMLElement> {
    const { container } = render(<TeamsPage />);
    await screen.findByRole('link', { name: 'Alpha' });
    vi.useFakeTimers();
    return container as HTMLElement;
  }

  function fillWidth(card: Element): number {
    const fill = card.querySelector('.tc-loading-fill') as HTMLElement | null;
    return Number((fill?.style.width || '0').replace('%', ''));
  }

  it('shows the loading chrome 150ms after click and advances progress to 85', async () => {
    const container = await renderReady();
    const card = container.querySelector('[data-team-id="alpha"]') as HTMLElement;
    fireEvent.click(card);
    expect(routeMock).toHaveBeenCalledTimes(1);
    expect(routeMock).toHaveBeenCalledWith('/teams/alpha');
    expect(card.classList.contains('is-pending')).toBe(false);

    await advance(149);
    expect(card.classList.contains('is-pending')).toBe(false);
    expect(card.querySelector('.tc-loading-bar')).toBeNull();
    expect(card.querySelector('.tc-loading-panel')).toBeNull();

    await advance(1);
    expect(card.classList.contains('is-pending')).toBe(true);
    expect(card.getAttribute('aria-busy')).toBe('true');
    expect(card.querySelector('.tc-card-media .tc-loading-bar')).toBeTruthy();
    expect(card.querySelector('.tc-loading-panel')).toBeTruthy();
    expect(card.querySelector('.tc-loading-copy strong')?.textContent).toBe('資料更新中');
    expect(card.querySelector('.tc-loading-copy span')?.textContent).toBe('正在整理俱樂部最新內容');

    const widths: number[] = [];
    for (let i = 0; i < 120; i += 1) {
      await advance(100);
      const value = fillWidth(card);
      widths.push(value);
      if (value >= 85) break;
    }
    expect(widths[0]).toBe(4);
    expect(widths[1]).toBe(8);
    expect(widths[widths.length - 1]).toBe(85);
    expect(Math.max(...widths)).toBe(85);
    expect(card.classList.contains('is-pending')).toBe(true);
  });

  it('routes once for a repeated click and moves pending state to another card', async () => {
    const container = await renderReady();
    const alpha = container.querySelector('[data-team-id="alpha"]') as HTMLElement;
    const beta = container.querySelector('[data-team-id="beta"]') as HTMLElement;

    fireEvent.click(alpha);
    fireEvent.click(alpha);
    fireEvent.keyDown(alpha, { key: 'Enter' });
    fireEvent.keyDown(alpha, { key: ' ' });
    expect(routeMock).toHaveBeenCalledTimes(1);

    await advance(150);
    expect(alpha.classList.contains('is-pending')).toBe(true);

    fireEvent.click(beta);
    expect(routeMock).toHaveBeenCalledTimes(2);
    expect(routeMock).toHaveBeenLastCalledWith('/teams/beta');
    expect(alpha.classList.contains('is-pending')).toBe(false);
    expect(alpha.querySelector('.tc-loading-bar')).toBeNull();
    expect(beta.classList.contains('is-pending')).toBe(false);

    await advance(150);
    expect(beta.classList.contains('is-pending')).toBe(true);
    expect(beta.querySelector('.tc-card-media.tc-img-placeholder .tc-loading-bar')).toBeTruthy();
    expect(alpha.classList.contains('is-pending')).toBe(false);
  });

  it('clears pending timers on unmount', async () => {
    const { unmount } = render(<TeamsPage />);
    await screen.findByRole('link', { name: 'Alpha' });
    vi.useFakeTimers();
    fireEvent.click(screen.getByRole('link', { name: 'Alpha' }));
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('clears the feedback and toasts when navigation is still pending after 10s', async () => {
    const container = await renderReady();
    const card = container.querySelector('[data-team-id="alpha"]') as HTMLElement;
    fireEvent.click(card);
    await advance(150);
    expect(card.classList.contains('is-pending')).toBe(true);

    await advance(10_000 - 150);
    expect(card.classList.contains('is-pending')).toBe(false);
    expect(card.hasAttribute('aria-busy')).toBe(false);
    expect(card.querySelector('.tc-loading-panel')).toBeNull();
    expect(toast.show).toHaveBeenCalledWith({
      message: '俱樂部頁面載入失敗，請稍後再試',
      tone: 'error',
    });
  });
});

describe('TeamsPage M-119 detail login gate', () => {
  async function renderReady(): Promise<HTMLElement> {
    const { container } = render(<TeamsPage />);
    await screen.findByRole('link', { name: 'Alpha' });
    return container as HTMLElement;
  }

  it('known guest toasts, routes, then logs in without card pending', async () => {
    authUid.value = null;
    vi.mocked(useViewer).mockReturnValue(listViewer(null));
    const pushSpy = vi.spyOn(window.history, 'pushState');
    const replaceSpy = vi.spyOn(window.history, 'replaceState');
    const container = await renderReady();
    vi.useFakeTimers();

    fireEvent.click(screen.getByRole('link', { name: 'Alpha' }));

    expect(toast.show).toHaveBeenCalledWith({ message: '請先登入 LINE 帳號' });
    expect(routeMock).toHaveBeenCalledWith('/teams/alpha');
    expect(loginForClubs).toHaveBeenCalledTimes(1);
    expect(pushSpy).not.toHaveBeenCalled();
    expect(replaceSpy).not.toHaveBeenCalled();

    await advance(200);
    const card = container.querySelector('[data-team-id="alpha"]');
    expect(card?.classList.contains('is-pending')).toBe(false);
    expect(card?.querySelector('.tc-loading-bar')).toBeNull();
    pushSpy.mockRestore();
    replaceSpy.mockRestore();
  });

  it('shows the existing action error when guest login fails', async () => {
    authUid.value = null;
    vi.mocked(useViewer).mockReturnValue(listViewer(null));
    vi.mocked(loginForClubs).mockRejectedValue(new Error('nope'));
    await renderReady();

    fireEvent.click(screen.getByRole('link', { name: 'Alpha' }));

    await waitFor(() =>
      expect(toast.show).toHaveBeenCalledWith({ message: 'clubs.actionError', tone: 'error' }),
    );
  });

  it('logged-in card does not call login', async () => {
    authUid.value = 'u1';
    await renderReady();
    const pushSpy = vi.spyOn(window.history, 'pushState');
    const replaceSpy = vi.spyOn(window.history, 'replaceState');

    fireEvent.click(screen.getByRole('link', { name: 'Alpha' }));

    expect(loginForClubs).not.toHaveBeenCalled();
    expect(routeMock).toHaveBeenCalledWith('/teams/alpha');
    expect(pushSpy).not.toHaveBeenCalled();
    expect(replaceSpy).not.toHaveBeenCalled();
    pushSpy.mockRestore();
    replaceSpy.mockRestore();
  });

  it('does not call login while auth uid is unknown', async () => {
    authUid.value = undefined;
    vi.mocked(useViewer).mockReturnValue(listViewer(null));
    await renderReady();

    fireEvent.click(screen.getByRole('link', { name: 'Alpha' }));

    expect(loginForClubs).not.toHaveBeenCalled();
    expect(toast.show).not.toHaveBeenCalled();
    expect(routeMock).toHaveBeenCalledWith('/teams/alpha');
  });
});
