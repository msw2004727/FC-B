import { cleanup, render, screen, waitFor } from '@testing-library/preact';
import { LocationProvider } from 'preact-iso';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CompetitionsRepo } from './data/cp-repo';
import { InAppSection } from './components/InAppSection';

const gateBox = vi.hoisted(() => ({
  isPublic: false as boolean | null,
}));

const viewerBox = vi.hoisted(() => ({
  current: {
    uid: 'uid_user' as string | null,
    authPending: false,
    role: 'user',
    displayName: '王示範',
    staffTeams: [] as { id: string; name: string }[],
    teamIds: new Set<string>(),
  },
}));

const loadBox = vi.hoisted(() => ({
  load: vi.fn(async (_uid: string) => [] as { id: string; name: string }[]),
}));

const repoBox = vi.hoisted(() => ({
  getLaunch: vi.fn(async () => ({ isPublic: gateBox.isPublic, bannedWords: [] as string[] })),
  getLaunchTester: vi.fn(async (_uid: string) => false),
  listMine: vi.fn(async (_uid: string): Promise<Array<{ id: string; cid: string; roles: string[]; host: boolean; name?: string }>> => []),
  listPublic: vi.fn(async (_includeInternal?: boolean) => []),
  listByHostTeam: vi.fn(async (_teamId: string, _publicOnly: boolean) => []),
}));

// createMinimalViewer 保留真的：live.tsx 用它辨認「角色還沒讀到」的最小 viewer。
const settledBox = vi.hoisted(() => ({ role: null as string | null }));

vi.mock('@/features/profile/data/viewer', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/profile/data/viewer')>()),
  useViewer: () => viewerBox.current,
  // 「users 文件已讀到、角色已確定」訊號（顧問 11-20）。預設沒有。
  useSettledViewerRole: (uid: string | null | undefined) => (uid ? settledBox.role : null),
}));

vi.mock('./rep-clubs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./rep-clubs')>();
  return {
    ...actual,
    loadRepClubs: (uid: string) => loadBox.load(uid),
  };
});

vi.mock('./data/cp-repo', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./data/cp-repo')>();
  return {
    ...actual,
    getCompetitionsRepo: () => repoBox as unknown as CompetitionsRepo,
  };
});

function draw() {
  return render(
    <LocationProvider>
      <InAppSection />
    </LocationProvider>,
  );
}

afterEach(() => {
  cleanup();
  settledBox.role = null;
  gateBox.isPublic = false;
  viewerBox.current.role = 'user';
  viewerBox.current.uid = 'uid_user';
  viewerBox.current.authPending = false;
  loadBox.load.mockClear();
  repoBox.getLaunch.mockClear();
  repoBox.getLaunchTester.mockClear();
  repoBox.listMine.mockClear();
  repoBox.listPublic.mockClear();
  repoBox.listByHostTeam.mockClear();
});

describe('站內賽事閘門才查代表俱樂部', () => {
  it('閘門關閉不查俱樂部清單，也不讀我的賽事', async () => {
    draw();
    await waitFor(() => expect(repoBox.getLaunch).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(repoBox.getLaunchTester).toHaveBeenCalledTimes(1));
    expect(loadBox.load).not.toHaveBeenCalled();
    expect(repoBox.listMine).not.toHaveBeenCalled();
    expect(repoBox.listPublic).not.toHaveBeenCalled();
    expect(repoBox.listByHostTeam).not.toHaveBeenCalled();
  });

  it('閘門通過後才查俱樂部清單', async () => {
    gateBox.isPublic = true;
    draw();
    await waitFor(() => expect(loadBox.load).toHaveBeenCalledTimes(1));
    expect(loadBox.load).toHaveBeenCalledWith('uid_user');
    await waitFor(() => expect(repoBox.listMine).toHaveBeenCalledTimes(1));
    expect(repoBox.listPublic).toHaveBeenCalledTimes(1);
    expect(repoBox.getLaunchTester).not.toHaveBeenCalled();
  });

  it('換 uid 立刻清掉上一個人的賽事，並改查新的人', async () => {
    gateBox.isPublic = true;
    repoBox.listMine.mockImplementation(async (uid: string) => (
      uid === 'uid_user'
        ? [{ id: 'm1', cid: 'c1', roles: ['host'], host: true, name: '舊人賽事' }]
        : []
    ));
    const view = draw();
    expect(await screen.findByText('舊人賽事')).toBeTruthy();
    await waitFor(() => expect(loadBox.load).toHaveBeenCalledWith('uid_user'));

    viewerBox.current = { ...viewerBox.current, uid: 'uid_next' };
    view.rerender(
      <LocationProvider>
        <InAppSection />
      </LocationProvider>,
    );
    expect(view.container.textContent ?? '').not.toContain('舊人賽事');
    await waitFor(() => expect(loadBox.load).toHaveBeenCalledWith('uid_next'));
    expect(view.container.textContent ?? '').not.toContain('舊人賽事');
    repoBox.listMine.mockImplementation(async () => []);
  });
});

// 顧問 11-20 方案 2：賽事頁只在伺服器明確判定看不到時清「上次有過」線索（reason='denied'），
// 讀取失敗不帶 reason；清單讀好才 onReady，賽事頁把站內骨架留到這時。
describe('閘門結果帶原因、清單讀好才 onReady', () => {
  function drawWith(onGate: (open: boolean, reason?: string) => void, onReady: () => void) {
    return render(
      <LocationProvider>
        <InAppSection onGate={onGate} onReady={onReady} />
      </LocationProvider>,
    );
  }

  it('未公開又不是測試員：onGate(false, denied)，不 onReady', async () => {
    const onGate = vi.fn();
    const onReady = vi.fn();
    drawWith(onGate, onReady);
    await waitFor(() => expect(onGate).toHaveBeenCalledWith(false, 'denied'));
    expect(onReady).not.toHaveBeenCalled();
  });

  it('已公開：先 onGate(true)，清單讀好才 onReady 一次', async () => {
    gateBox.isPublic = true;
    let release!: () => void;
    repoBox.listPublic.mockImplementationOnce(() => new Promise((resolve) => {
      release = () => resolve([]);
    }));
    const onGate = vi.fn();
    const onReady = vi.fn();
    drawWith(onGate, onReady);
    await waitFor(() => expect(onGate).toHaveBeenCalledWith(true, undefined));
    expect(onReady).not.toHaveBeenCalled();
    release();
    await waitFor(() => expect(onReady).toHaveBeenCalledTimes(1));
  });

  it('讀 launch 失敗：onGate(false) 不帶 denied', async () => {
    repoBox.getLaunch.mockImplementationOnce(async () => {
      throw new Error('offline');
    });
    const onGate = vi.fn();
    drawWith(onGate, vi.fn());
    await waitFor(() => expect(onGate).toHaveBeenCalled());
    expect(onGate).toHaveBeenCalledWith(false, undefined);
    expect(onGate).not.toHaveBeenCalledWith(false, 'denied');
  });
});

// 11-20 Opus 審 P2-1：登入後先拿到最小 viewer（role 暫為 'user'），真正角色晚到。
// 這段空檔不得判成看不到（否則賽事頁清掉線索又跳回外部），等角色讀到再判。
describe('角色還沒讀到不判定閘門', () => {
  it('最小 viewer 期間不送 onGate；角色讀到是管理員才判定通過', async () => {
    const { createMinimalViewer } = await import('@/features/profile/data/viewer');
    const minimalSources = createMinimalViewer('uid_user').permissionSources;
    const saved = viewerBox.current;
    viewerBox.current = { ...saved, role: 'user', permissionSources: minimalSources } as typeof saved;
    const onGate = vi.fn();
    try {
      const view = render(
        <LocationProvider>
          <InAppSection onGate={onGate} />
        </LocationProvider>,
      );
      await waitFor(() => expect(repoBox.getLaunch).toHaveBeenCalled());
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(onGate).not.toHaveBeenCalled();
      expect(repoBox.getLaunchTester).not.toHaveBeenCalled();

      viewerBox.current = { ...saved, role: 'admin', permissionSources: { rolePermissions: null, userGrants: [], customRoles: [] } } as typeof saved;
      view.rerender(
        <LocationProvider>
          <InAppSection onGate={onGate} />
        </LocationProvider>,
      );
      await waitFor(() => expect(onGate).toHaveBeenCalledWith(true, undefined));
      expect(onGate).not.toHaveBeenCalledWith(false, 'denied');
    } finally {
      viewerBox.current = saved;
    }
  });
});

// 顧問 11-20：閘門只等角色確定（users 文件），不等球隊掃描等其餘 viewer 欄位。
describe('角色一確定就判定，不等完整 viewer', () => {
  async function minimalViewer() {
    const { createMinimalViewer } = await import('@/features/profile/data/viewer');
    return createMinimalViewer('uid_user').permissionSources;
  }

  it('完整 viewer 還沒到、角色已確定是管理員：直接通過，不讀測試員名單', async () => {
    const saved = viewerBox.current;
    viewerBox.current = { ...saved, role: 'user', permissionSources: await minimalViewer() } as typeof saved;
    settledBox.role = 'super_admin';
    const onGate = vi.fn();
    try {
      render(
        <LocationProvider>
          <InAppSection onGate={onGate} />
        </LocationProvider>,
      );
      await waitFor(() => expect(onGate).toHaveBeenCalledWith(true, undefined));
      expect(repoBox.getLaunchTester).not.toHaveBeenCalled();
    } finally {
      viewerBox.current = saved;
    }
  });

  it('完整 viewer 還沒到、角色已確定是一般用戶且未公開：照常查測試員，不是就 denied', async () => {
    const saved = viewerBox.current;
    viewerBox.current = { ...saved, role: 'user', permissionSources: await minimalViewer() } as typeof saved;
    settledBox.role = 'user';
    const onGate = vi.fn();
    try {
      render(
        <LocationProvider>
          <InAppSection onGate={onGate} />
        </LocationProvider>,
      );
      await waitFor(() => expect(onGate).toHaveBeenCalledWith(false, 'denied'));
      expect(repoBox.getLaunchTester).toHaveBeenCalledWith('uid_user');
    } finally {
      viewerBox.current = saved;
    }
  });

  it('完整 viewer 到了以它的角色為準（已確定的角色只是先行）', async () => {
    const saved = viewerBox.current;
    viewerBox.current = { ...saved, role: 'super_admin', permissionSources: { rolePermissions: null, userGrants: [], customRoles: [] } } as typeof saved;
    settledBox.role = 'user';
    const onGate = vi.fn();
    try {
      render(
        <LocationProvider>
          <InAppSection onGate={onGate} />
        </LocationProvider>,
      );
      await waitFor(() => expect(onGate).toHaveBeenCalledWith(true, undefined));
      expect(repoBox.getLaunchTester).not.toHaveBeenCalled();
    } finally {
      viewerBox.current = saved;
    }
  });
});

// 顧問 §3.612：LiveBoundary 用 canHostCompetition(viewer) 組 actor.canHost。
describe('主辦賽事開關接到站內清單', () => {
  it('完整 viewer 的 disabledCodes 含 user 碼就沒有建立鈕；不含就有', async () => {
    gateBox.isPublic = true;
    const saved = viewerBox.current;
    const sources = (disabledCodes: string[] | null) => ({ rolePermissions: null, userGrants: [], customRoles: [], disabledCodes });
    viewerBox.current = { ...saved, permissionSources: sources(['user.competition.host']) } as typeof saved;
    try {
      const off = draw();
      await waitFor(() => expect(repoBox.listPublic).toHaveBeenCalled());
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(screen.queryByRole('button', { name: '建立賽事' })).toBeNull();
      off.unmount();

      viewerBox.current = { ...saved, permissionSources: sources(null) } as typeof saved;
      const failed = draw();
      await waitFor(() => expect(repoBox.listPublic).toHaveBeenCalledTimes(2));
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(screen.queryByRole('button', { name: '建立賽事' })).toBeNull();
      failed.unmount();

      viewerBox.current = { ...saved, permissionSources: sources(['competition.host']) } as typeof saved;
      draw();
      expect(await screen.findByRole('button', { name: '建立賽事' })).toBeTruthy();
    } finally {
      viewerBox.current = saved;
    }
  });
});
