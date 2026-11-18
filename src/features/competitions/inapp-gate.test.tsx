import { cleanup, render, waitFor } from '@testing-library/preact';
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
  listMine: vi.fn(async (_uid: string) => []),
  listPublic: vi.fn(async (_includeInternal?: boolean) => []),
  listByHostTeam: vi.fn(async (_teamId: string, _publicOnly: boolean) => []),
}));

vi.mock('@/features/profile/data/viewer', () => ({
  useViewer: () => viewerBox.current,
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
});
