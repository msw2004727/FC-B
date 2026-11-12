import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent, waitFor } from '@testing-library/preact';

import { _setDictLoaderForTest, setLocale } from '@/i18n/i18n';
import type { UserProfile } from '../../data/profile-model';
import type { LatestTeamApplication } from '../../data/profile-applications';
import type { TeamDoc } from '@/features/clubs/data/types';

vi.mock('@/data/firebase', () => ({
  getFirebase: vi.fn(async () => ({ db: {} })),
}));

vi.mock('firebase/firestore', () => ({
  collection: vi.fn(() => ({})),
  query: vi.fn(() => ({})),
  orderBy: vi.fn(() => ({})),
  limit: vi.fn(() => ({})),
  getDocs: vi.fn(),
}));

vi.mock('@/features/clubs/data/teams-repo', () => ({
  loadTeams: vi.fn(),
}));

// eslint-disable-next-line import/first
import { getDocs } from 'firebase/firestore';
// eslint-disable-next-line import/first
import { loadTeams } from '@/features/clubs/data/teams-repo';
// eslint-disable-next-line import/first
import { LegacyApplicationsCard } from './LegacyApplicationsCard';

type DocsSnap = Awaited<ReturnType<typeof getDocs>>;

const uid = 'u1';
const profile = { uid, name: 'Alice', _docId: uid, lastActive: null } as unknown as UserProfile;

function makeSnap(docs: Array<{ id: string; data: Record<string, unknown> }>): DocsSnap {
  return {
    forEach: (cb: (doc: { id: string; data: () => unknown }) => void) => {
      for (const d of docs) cb({ id: d.id, data: () => d.data });
    },
  } as unknown as DocsSnap;
}

function makeTeam(id: string, name: string): TeamDoc {
  return { id, name, _docId: id } as unknown as TeamDoc;
}

beforeEach(() => {
  document.documentElement.lang = 'zh-TW';
  vi.mocked(getDocs).mockReset();
  vi.mocked(loadTeams).mockReset();
});

afterEach(() => {
  cleanup();
});

describe('LegacyApplicationsCard', () => {
  it('沒有任何申請 → 整張不顯示', async () => {
    vi.mocked(loadTeams).mockResolvedValue([]);
    vi.mocked(getDocs).mockResolvedValue(makeSnap([]));

    const { container } = render(<LegacyApplicationsCard uid={uid} profile={profile} />);
    // 等一輪微任務，確認確實執行過
    await waitFor(() => {
      expect(getDocs).toHaveBeenCalled();
    });
    expect(container.querySelector('#profile-applications-card')).toBeNull();
  });

  it('有 pending 申請 → 顯示卡片與 badge=1', async () => {
    vi.mocked(loadTeams).mockResolvedValue([makeTeam('t1', 'Alpha')]);
    vi.mocked(getDocs).mockResolvedValue(
      makeSnap([
        {
          id: 'm-1',
          data: {
            actionType: 'team_join_request',
            actionStatus: 'pending',
            createdAt: 1000,
            meta: { applicantUid: 'u1', teamId: 't1', teamName: 'Alpha' },
          },
        },
      ]),
    );

    const { container } = render(<LegacyApplicationsCard uid={uid} profile={profile} />);

    await waitFor(() => {
      expect(container.querySelector('#app-count-badge')?.textContent).toBe('1');
    });
    const card = container.querySelector('#profile-applications-card');
    expect(card).not.toBeNull();
    const toggle = container.querySelector('.profile-collapse-toggle') as HTMLElement;
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
  });

  it('展開時標題列加 open class（箭頭才會轉向下，照 A toggleClass open；T-038）', async () => {
    vi.mocked(loadTeams).mockResolvedValue([makeTeam('t1', 'Alpha')]);
    vi.mocked(getDocs).mockResolvedValue(
      makeSnap([
        {
          id: 'm-1',
          data: {
            actionType: 'team_join_request',
            actionStatus: 'pending',
            createdAt: 1000,
            meta: { applicantUid: 'u1', teamId: 't1', teamName: 'Alpha' },
          },
        },
      ]),
    );

    const { container } = render(<LegacyApplicationsCard uid={uid} profile={profile} />);
    await waitFor(() => {
      expect(container.querySelector('#app-count-badge')?.textContent).toBe('1');
    });
    const toggle = container.querySelector('.profile-collapse-toggle') as HTMLElement;
    expect(toggle.classList.contains('open')).toBe(false);
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(toggle.classList.contains('open')).toBe(true);
    fireEvent.click(toggle);
    expect(toggle.classList.contains('open')).toBe(false);
  });

  it('讀取失敗收成空陣列，卡片不出現', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(loadTeams).mockRejectedValue(new Error('offline'));
    vi.mocked(getDocs).mockResolvedValue(makeSnap([]));

    const { container } = render(<LegacyApplicationsCard uid={uid} profile={profile} />);
    await waitFor(() => expect(errSpy).toHaveBeenCalled());
    expect(String(errSpy.mock.calls[0]?.[0])).toContain('[LegacyApplicationsCard] load failed');
    expect(container.querySelector('#profile-applications-card')).toBeNull();
    expect(container.querySelector('.reg-loading')).toBeNull();
    errSpy.mockRestore();
  });

  it('非嵌入且 items 為 null 不畫卡', () => {
    const { container } = render(<LegacyApplicationsCard uid={uid} profile={profile} items={null} />);
    expect(container.querySelector('#profile-applications-card')).toBeNull();
    expect(container.querySelector('.reg-loading')).toBeNull();
  });

  it('嵌入且還在讀時有 .reg-loading，0 筆拿掉，有資料換成清單', async () => {
    _setDictLoaderForTest(async () => ({ 'profile.loading': '載入中…' }));
    await setLocale('zh-TW');
    const item: LatestTeamApplication = {
      messageId: 'm1',
      teamId: 't1',
      teamName: 'Alpha',
      status: 'pending',
      timeMs: 1000,
    };
    const view = render(<LegacyApplicationsCard embedded uid={uid} profile={profile} items={null} />);
    const loading = view.container.querySelector('.reg-loading');
    expect(loading?.getAttribute('role')).toBe('status');
    expect(loading?.textContent).toContain('載入中…');

    view.rerender(<LegacyApplicationsCard embedded uid={uid} profile={profile} items={[]} />);
    expect(view.container.querySelector('#profile-applications-card')).toBeNull();
    expect(view.container.querySelector('.reg-loading')).toBeNull();

    view.rerender(<LegacyApplicationsCard embedded uid={uid} profile={profile} items={[item]} />);
    expect(view.container.querySelector('.reg-loading')).toBeNull();
    expect(view.container.textContent).toContain('Alpha');
    _setDictLoaderForTest(null);
  });
});
