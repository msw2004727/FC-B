// 冷開（直接連結或重新整理）時序：登入判定中 → uid 到了 → 代表清單（快取為空）才讀完。
// 正式頁走真的 LiveBoundary；viewer、代表清單、repo 換成可控的假資料。鎖住每頁的讀取次數（Opus 審 P2、顧問 §3.440）。
import { act, cleanup, render, screen } from '@testing-library/preact';
import type { ComponentType } from 'preact';
import { LocationProvider, Route, Router } from 'preact-iso';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ViewerView } from '@/features/profile/data/viewer';
import type { CpClub } from '../access';
import type { MatchDoc } from '../data/types';
import { taipeiMs } from '../format';
import { loadCompetitionsDict } from '../i18n';
import { createFakeCpRepo, type FakeCpRepo } from '../testing/fake-cp-repo';
import { adultDivision, competition } from '../testing/screen-fixtures';
import HostMatchesPage from './HostMatchesPage';
import HostSchedulePage from './HostSchedulePage';
import StaffAssignPage from './StaffAssignPage';
import StaffInvitePage from './StaffInvitePage';
import StaffPage from './StaffPage';

const box = vi.hoisted(() => ({
  viewer: null as unknown,
  repo: null as unknown,
  clubCalls: 0,
  resolveClubs: null as null | ((rows: CpClub[]) => void),
  listeners: new Set<() => void>(),
}));

vi.mock('@/features/profile/data/viewer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/profile/data/viewer')>();
  const hooks = await import('preact/hooks');
  // 像正式的 useViewer 一樣可訂閱：換 viewer 時通知重繪。
  function useViewer() {
    const [, bump] = hooks.useState(0);
    hooks.useEffect(() => {
      const fire = () => bump((n) => n + 1);
      box.listeners.add(fire);
      return () => {
        box.listeners.delete(fire);
      };
    }, []);
    return box.viewer;
  }
  return { ...actual, useViewer, useSettledViewerRole: () => 'user' };
});

vi.mock('@/features/admin-users/data/viewer-ready', () => ({
  isViewerPermissionsLoaded: (viewer: { uid: string | null }) => !!viewer.uid,
}));

vi.mock('../rep-clubs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../rep-clubs')>();
  return {
    ...actual,
    loadRepClubs: () => {
      box.clubCalls += 1;
      return new Promise<CpClub[]>((resolve) => {
        box.resolveClubs = resolve;
      });
    },
  };
});

vi.mock('../data/cp-repo', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../data/cp-repo')>();
  return { ...actual, getCompetitionsRepo: () => box.repo };
});

const UID = 'uid_cap';

function viewerOf(uid: string | null, authPending: boolean): ViewerView {
  return {
    uid,
    teamIds: [],
    staffTeams: [],
    hasPermission: () => false,
    roleLevel: 0,
    role: uid ? 'user' : 'guest',
    displayName: null,
    pictureUrl: null,
    capabilities: [],
    isRestricted: false,
    authPending,
  } as unknown as ViewerView;
}

function match(id: string): MatchDoc {
  return {
    id, divisionId: 'dv_adult', stageId: 'group', groupId: 'A', round: 1, matchNo: 1, label: null, matchKey: null,
    kickoffAt: taipeiMs(2027, 1, 9, 9, 0), venueIdx: 0, venueName: null,
    home: { teamId: 'en_h', name: '海風隊' }, away: { teamId: 'en_a', name: '山貓隊' }, teamIds: ['en_h', 'en_a'],
    score: { home: 0, away: 0 }, penaltyScore: null, status: 'scheduled', rev: 0, resetRev: 0, lock: { locked: false },
    clockBase: { startedAt: null, pausedSec: 0, running: false, period: 'pre' }, finishedAt: null, confirmedAt: null,
    walkoverSide: null, result: null, resultSource: null, updatedAt: null, cancelReason: null, cancelledAt: null,
  };
}

function repoOf(): FakeCpRepo {
  // 俱樂部賽事，代表沒有 staff 文件；場次沒有場地名，要用賽事的 venues。
  return createFakeCpRepo({
    competitions: [competition({ id: 'cup' })],
    divisions: { cup: [adultDivision] },
    assignments: { cup: [{ uid: 'uid_a', roles: ['scorer'], matchIds: ['mt_1'], expiresAt: null, memberNo: 2 }] },
    matches: { cup: [match('mt_1')] },
  });
}

async function flush(): Promise<void> {
  for (let i = 0; i < 5; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

async function coldOpen(Page: ComponentType, path: string): Promise<{ beforeClubs: string[]; after: string[]; alertBeforeClubs: boolean }> {
  window.history.replaceState(null, '', path);
  const repo = repoOf();
  box.repo = repo;
  box.viewer = viewerOf(null, true);
  render(
    <LocationProvider>
      <Page />
    </LocationProvider>,
  );
  await flush();
  await act(async () => {
    box.viewer = viewerOf(UID, false);
    for (const fire of box.listeners) fire();
  });
  await flush();
  const beforeClubs = [...repo.calls()];
  const alertBeforeClubs = screen.queryByRole('alert') != null;
  await act(async () => {
    box.resolveClubs?.([{ id: 'club_host', name: '示範俱樂部' }]);
  });
  await flush();
  return { beforeClubs, after: [...repo.calls()], alertBeforeClubs };
}

beforeAll(async () => {
  await loadCompetitionsDict('zh-TW');
});

afterEach(() => {
  cleanup();
  box.viewer = null;
  box.repo = null;
  box.clubCalls = 0;
  box.resolveClubs = null;
  box.listeners.clear();
  window.history.replaceState(null, '', '/');
});

// 不能用注入環境（會跳過 LiveBoundary），改用 Router 讓 useRoute 拿到 cid。

function routed(Page: ComponentType, pattern: string): ComponentType {
  return function Wrapped() {
    return (
      <Router>
        {[<Route key="page" path={pattern} component={Page} />]}
      </Router>
    );
  };
}

describe('冷開讀取次數（代表、代表清單快取為空）', () => {
  it('人員頁：清單讀完前不讀；之後 4 讀', async () => {
    const { beforeClubs, after } = await coldOpen(routed(StaffPage, '/competitions/:cid/staff'), '/competitions/cup/staff');
    expect(beforeClubs).toEqual([]);
    expect(after).toEqual(['getStaff', 'getCompetition', 'listStaff', 'listInvites']);
    expect(box.clubCalls).toBe(1);
    expect(await screen.findByText('我自己')).toBeTruthy();
  });

  it('指派頁：清單讀完前不讀；之後 4 讀，場地沿用已讀的賽事', async () => {
    const { beforeClubs, after } = await coldOpen(routed(StaffAssignPage, '/competitions/:cid/staff/assign'), '/competitions/cup/staff/assign');
    expect(beforeClubs).toEqual([]);
    expect(after).toEqual(['getStaff', 'getCompetition', 'listStaff', 'listMatches']);
  });

  it('邀請頁：清單讀完前不讀；之後 3 讀', async () => {
    const { beforeClubs, after } = await coldOpen(routed(StaffInvitePage, '/competitions/:cid/staff/invite'), '/competitions/cup/staff/invite');
    expect(beforeClubs).toEqual([]);
    expect(after).toEqual(['getStaff', 'getCompetition', 'listMatches']);
  });

  it('賽程管理：登入判定中與清單讀完前不讀；之後一輪 5 讀', async () => {
    const { beforeClubs, after } = await coldOpen(routed(HostMatchesPage, '/competitions/:cid/matches'), '/competitions/cup/matches');
    expect(beforeClubs).toEqual([]);
    expect([...after].sort()).toEqual(['getCompetition', 'getStaff', 'listDivisions', 'listEntriesForCrest', 'listMatches']);
  });

  it('排賽程：uid 到了讀一輪 3 讀、不重讀；清單讀完前轉圈，不閃沒有權限', async () => {
    const { beforeClubs, after, alertBeforeClubs } = await coldOpen(routed(HostSchedulePage, '/competitions/:cid/schedule'), '/competitions/cup/schedule');
    expect([...beforeClubs].sort()).toEqual(['getCompetition', 'getStaff', 'listDivisions']);
    expect(alertBeforeClubs).toBe(false);
    expect(after).toEqual(beforeClubs);
    expect(await screen.findByRole('button', { name: '預覽' })).toBeTruthy();
  });
});
