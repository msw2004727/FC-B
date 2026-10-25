import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, waitFor, fireEvent } from '@testing-library/preact';

import type { UserProfile } from '../../data/profile-model';

// ── mock：資料層與相依 ────────────────────────────────
vi.mock('@/ui/Toast', () => ({
  toast: { show: vi.fn(), dismiss: vi.fn(), clear: vi.fn() },
}));
vi.mock('@/features/events/data/favorites', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/features/events/data/favorites')>();
  return {
    ...orig,
    loadFavorites: vi.fn(),
    saveFavorites: vi.fn(),
  };
});
vi.mock('@/features/events/data/event-detail', () => ({
  loadEventDetail: vi.fn(),
}));
vi.mock('@/features/events/data/viewer-registrations', () => ({
  loadViewerRegistrations: vi.fn(),
}));
vi.mock('@/features/events/data/visibility', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/features/events/data/visibility')>();
  return {
    ...orig,
    canListPrivateEvent: vi.fn(() => true),
  };
});
vi.mock('@/features/profile/data/viewer', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/features/profile/data/viewer')>();
  return {
    ...orig,
    useViewer: vi.fn(),
  };
});
vi.mock('preact-iso', () => ({ useLocation: vi.fn() }));
vi.mock('./ProfileInfoButton', () => ({
  ProfileInfoButton: () => <button class="edu-info-btn">?</button>,
}));

// eslint-disable-next-line import/first
import { toast } from '@/ui/Toast';
// eslint-disable-next-line import/first
import {
  loadFavorites,
  saveFavorites,
} from '@/features/events/data/favorites';
// eslint-disable-next-line import/first
import { loadEventDetail } from '@/features/events/data/event-detail';
// eslint-disable-next-line import/first
import { loadViewerRegistrations } from '@/features/events/data/viewer-registrations';
// eslint-disable-next-line import/first
import { canListPrivateEvent } from '@/features/events/data/visibility';
// eslint-disable-next-line import/first
import { useViewer } from '@/features/profile/data/viewer';
// eslint-disable-next-line import/first
import { useLocation } from 'preact-iso';
// eslint-disable-next-line import/first
import { LegacyFavoritesCard } from './LegacyFavoritesCard';

const uid = 'u1';
const profile = { uid, name: 'Alice', _docId: uid, lastActive: null } as unknown as UserProfile;

function makeDetail(eventId: string, extra: Record<string, unknown> = {}) {
  return {
    event: {
      id: eventId,
      title: `Event ${eventId}`,
      date: '2024-06-01 10:00',
      status: 'open',
      privateEvent: false,
      ...extra,
    },
    eventDocId: `doc-${eventId}`,
  };
}

beforeEach(() => {
  document.documentElement.lang = 'zh-TW';
  vi.mocked(loadFavorites).mockReset();
  vi.mocked(saveFavorites).mockReset();
  vi.mocked(loadEventDetail).mockReset();
  vi.mocked(loadViewerRegistrations).mockReset();
  vi.mocked(loadViewerRegistrations).mockResolvedValue([]);
  vi.mocked(canListPrivateEvent).mockImplementation(() => true);
  vi.mocked(toast.show).mockClear();
  vi.mocked(useViewer).mockReturnValue({
    uid,
    teamIds: new Set<string>(),
    hasPermission: () => false,
    roleLevel: 0,
    role: 'member',
    displayName: null,
    pictureUrl: null,
    capabilities: [],
  });
  // ASSUMPTION: `useLocation()` 的回傳型別未在附件公開；以最低必要欄位 `route` 代替。
  vi.mocked(useLocation).mockReturnValue({ route: vi.fn() } as never);
});

afterEach(() => {
  cleanup();
});

describe('LegacyFavoritesCard', () => {
  it('沒有收藏時整張卡不顯示', async () => {
    vi.mocked(loadFavorites).mockResolvedValue({ events: [], tournaments: [] });
    const { container } = render(<LegacyFavoritesCard uid={uid} profile={profile} />);
    await waitFor(() => {
      expect(loadFavorites).toHaveBeenCalled();
    });
    expect(container.querySelector('#profile-favorites-card')).toBeNull();
  });

  it('有收藏且可見時 badge 數字正確，預設收起', async () => {
    vi.mocked(loadFavorites).mockResolvedValue({ events: ['e1', 'e2'], tournaments: [] });
    vi.mocked(loadEventDetail).mockImplementation(async (id: string) => makeDetail(id) as never);
    vi.mocked(loadViewerRegistrations).mockResolvedValue([]);

    const { container } = render(<LegacyFavoritesCard uid={uid} profile={profile} />);

    await waitFor(() => {
      expect(container.querySelector('#fav-count-badge')?.textContent).toBe('2');
    });
    const list = container.querySelector('#profile-favorites-list') as HTMLElement | null;
    expect(list).not.toBeNull();
    expect(list?.style.display).toBe('none');
    // 標題 aria-expanded=false
    const toggle = container.querySelector('.profile-collapse-toggle') as HTMLElement | null;
    expect(toggle?.getAttribute('aria-expanded')).toBe('false');
  });

  it('看不見的收藏不列入 badge（只顯示目前可見活動）', async () => {
    vi.mocked(canListPrivateEvent).mockImplementation((e: unknown) => {
      return (e as { id?: string }).id === 'e1';
    });

    vi.mocked(loadFavorites).mockResolvedValue({ events: ['e1', 'e2'], tournaments: [] });
    vi.mocked(loadEventDetail).mockImplementation(async (id: string) => makeDetail(id) as never);
    vi.mocked(loadViewerRegistrations).mockResolvedValue([]);

    const { container } = render(<LegacyFavoritesCard uid={uid} profile={profile} />);

    await waitFor(() => {
      expect(container.querySelector('#fav-count-badge')?.textContent).toBe('1');
    });
  });

  it('展開後按移除，會以新清單呼叫 saveFavorites', async () => {
    vi.mocked(loadFavorites).mockResolvedValue({ events: ['e1', 'e2'], tournaments: [] });
    vi.mocked(loadEventDetail).mockImplementation(async (id: string) => makeDetail(id) as never);
    vi.mocked(loadViewerRegistrations).mockResolvedValue([]);

    const { container } = render(<LegacyFavoritesCard uid={uid} profile={profile} />);

    await waitFor(() => {
      expect(container.querySelector('#fav-count-badge')?.textContent).toBe('2');
    });

    const toggle = container.querySelector('.profile-collapse-toggle') as HTMLElement;
    fireEvent.click(toggle);

    const removeBtns = container.querySelectorAll('.fav-remove-btn');
    expect(removeBtns.length).toBe(2);

    fireEvent.click(removeBtns[0] as Element);

    await waitFor(() => {
      expect(saveFavorites).toHaveBeenCalledTimes(1);
    });
    const [calledUid, calledNext] = vi.mocked(saveFavorites).mock.calls[0] ?? [];
    expect(calledUid).toBe(uid);
    expect(calledNext).toEqual({ events: ['e2'], tournaments: [] });
  });

  it('Enter 與 Space 可切換展開', async () => {
    vi.mocked(loadFavorites).mockResolvedValue({ events: ['e1'], tournaments: [] });
    vi.mocked(loadEventDetail).mockImplementation(async (id: string) => makeDetail(id) as never);
    vi.mocked(loadViewerRegistrations).mockResolvedValue([]);

    const { container } = render(<LegacyFavoritesCard uid={uid} profile={profile} />);
    await waitFor(() => {
      expect(container.querySelector('#fav-count-badge')?.textContent).toBe('1');
    });
    const toggle = container.querySelector('.profile-collapse-toggle') as HTMLElement;

    fireEvent.keyDown(toggle, { key: 'Enter' });
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    fireEvent.keyDown(toggle, { key: ' ' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
  });

  it('展開時標題列加 open class（箭頭才會轉向下，照 A toggleClass open；T-038）', async () => {
    vi.mocked(loadFavorites).mockResolvedValue({ events: ['e1'], tournaments: [] });
    vi.mocked(loadEventDetail).mockImplementation(async (id: string) => makeDetail(id) as never);
    vi.mocked(loadViewerRegistrations).mockResolvedValue([]);

    const { container } = render(<LegacyFavoritesCard uid={uid} profile={profile} />);
    await waitFor(() => {
      expect(container.querySelector('#fav-count-badge')?.textContent).toBe('1');
    });
    const toggle = container.querySelector('.profile-collapse-toggle') as HTMLElement;
    expect(toggle.classList.contains('open')).toBe(false);
    fireEvent.click(toggle);
    expect(toggle.classList.contains('open')).toBe(true);
    fireEvent.click(toggle);
    expect(toggle.classList.contains('open')).toBe(false);
  });

  it('登入者報名狀態覆蓋 fallback badge（confirmed → 已報名／class open）', async () => {
    vi.mocked(loadFavorites).mockResolvedValue({ events: ['e1'], tournaments: [] });
    vi.mocked(loadEventDetail).mockImplementation(async (id: string) => makeDetail(id) as never);
    vi.mocked(loadViewerRegistrations).mockResolvedValue([
      { eventId: 'e1', userId: uid, status: 'confirmed' } as never,
    ]);

    const { container } = render(<LegacyFavoritesCard uid={uid} profile={profile} />);
    await waitFor(() => {
      expect(container.querySelector('#fav-count-badge')?.textContent).toBe('1');
    });
    const toggle = container.querySelector('.profile-collapse-toggle') as Element;
    fireEvent.click(toggle);

    const badge = container.querySelector('.fav-item .tl-event-status');
    expect(badge?.textContent).toBe('已報名');
    expect(badge?.classList.contains('open')).toBe(true);
  });

  it('排序選項使用 A i18n key（按時間／按狀態／按名稱），fireEvent.change 可切換', async () => {
    vi.mocked(loadFavorites).mockResolvedValue({ events: ['e1'], tournaments: [] });
    vi.mocked(loadEventDetail).mockImplementation(async (id: string) => makeDetail(id) as never);
    vi.mocked(loadViewerRegistrations).mockResolvedValue([]);

    const { container } = render(<LegacyFavoritesCard uid={uid} profile={profile} />);
    await waitFor(() => {
      expect(container.querySelector('#fav-count-badge')?.textContent).toBe('1');
    });
    fireEvent.click(container.querySelector('.profile-collapse-toggle') as Element);

    const select = container.querySelector('#fav-sort') as HTMLSelectElement | null;
    expect(select).not.toBeNull();
    const opts = Array.from((select as HTMLSelectElement).querySelectorAll('option'));
    expect(opts.map((o) => o.textContent)).toEqual(['按時間', '按狀態', '按名稱']);

    fireEvent.change(select as HTMLSelectElement, { target: { value: 'name' } });
    expect((select as HTMLSelectElement).value).toBe('name');
  });

  it('移除後呼叫共用 toast.show（key=toast.favoriteRemoved）', async () => {
    vi.mocked(loadFavorites).mockResolvedValue({ events: ['e1'], tournaments: [] });
    vi.mocked(loadEventDetail).mockImplementation(async (id: string) => makeDetail(id) as never);
    vi.mocked(loadViewerRegistrations).mockResolvedValue([]);

    const { container } = render(<LegacyFavoritesCard uid={uid} profile={profile} />);
    await waitFor(() => {
      expect(container.querySelector('#fav-count-badge')?.textContent).toBe('1');
    });
    fireEvent.click(container.querySelector('.profile-collapse-toggle') as Element);

    const removeBtn = container.querySelector('.fav-remove-btn') as Element;
    fireEvent.click(removeBtn);

    await waitFor(() => {
      expect(saveFavorites).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(toast.show).toHaveBeenCalledWith({ message: '已取消收藏' });
    });
  });

  it('移除鈕 title 使用 lt("toast.favoriteRemoved", "已取消收藏")', async () => {
    vi.mocked(loadFavorites).mockResolvedValue({ events: ['e1'], tournaments: [] });
    vi.mocked(loadEventDetail).mockImplementation(async (id: string) => makeDetail(id) as never);
    vi.mocked(loadViewerRegistrations).mockResolvedValue([]);

    const { container } = render(<LegacyFavoritesCard uid={uid} profile={profile} />);
    await waitFor(() => {
      expect(container.querySelector('#fav-count-badge')?.textContent).toBe('1');
    });
    fireEvent.click(container.querySelector('.profile-collapse-toggle') as Element);

    const removeBtn = container.querySelector('.fav-remove-btn') as Element;
    expect(removeBtn.getAttribute('title')).toBe('已取消收藏');
  });
});
