// 建賽頁照開賽閘門：內部期只給管理員與測試者，對外公開後給所有已登入會員；未登入改給登入鈕。
// 站內清單的「建立賽事」鈕條件相同。登入、角色或閘門還沒定案時只轉圈，不先閃表單。
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import type { ComponentChildren } from 'preact';
import { LocationProvider } from 'preact-iso';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { CompetitionsRepo } from '../data/cp-repo';
import type { LaunchDoc } from '../data/types';
import { CpEnvProvider, type CpActor, type CpInjectedEnv } from '../env';
import { loadCompetitionsDict } from '../i18n';
import { createFakeCpRepo } from '../testing/fake-cp-repo';
import { NOW, adminActor, competition, editBundle, hostActor, idleActions, memberActor, screenEnv } from '../testing/screen-fixtures';
import { InAppSection } from '../components/InAppSection';
import NewCompetitionPage from './NewCompetitionPage';

const box = vi.hoisted(() => ({
  actor: null as CpActor | null,
  repo: null as unknown,
  loadClubs: [] as boolean[],
  signIn: 0,
}));

// 正式頁的 LiveBoundary 換成可控的角色與 repo，順便記下每一層要不要查代表俱樂部。
vi.mock('../live', () => ({
  LiveBoundary: ({ children, loadClubs = true }: {
    children: (actor: CpActor, repo: unknown) => ComponentChildren;
    loadClubs?: boolean;
  }) => {
    box.loadClubs.push(loadClubs);
    return <>{children(box.actor as CpActor, box.repo)}</>;
  },
}));

vi.mock('@/data/auth', () => ({
  signIn: async () => {
    box.signIn += 1;
    return { uid: 'x' };
  },
}));

beforeAll(async () => {
  await loadCompetitionsDict('zh-TW');
});

afterEach(() => {
  cleanup();
  box.actor = null;
  box.repo = null;
  box.loadClubs = [];
  box.signIn = 0;
  window.history.replaceState(null, '', '/');
});

const NOT_OPEN = '建立賽事尚未開放';
const NEED_LOGIN = '登入後才能建立賽事';
const INTERNAL: LaunchDoc = { isPublic: false, bannedWords: [] };
const PUBLIC: LaunchDoc = { isPublic: true, bannedWords: [] };

const member: CpActor = { ...memberActor, role: 'user' };
const guest: CpActor = { ...memberActor, uid: null, authPending: false, role: 'user', memberClubIds: [] };
const tester: CpActor = { ...memberActor, uid: 'uid_tester', role: 'user' };
const admin: CpActor = { ...adminActor, repClubs: [] };

function repoWith(launch: LaunchDoc | null) {
  return createFakeCpRepo({
    launch,
    testers: ['uid_tester'],
    competitions: [competition({ id: 'open_cup', name: '公開示範盃', hostType: 'personal', hostTeamId: null, hostDisplay: '王示範', feeNote: null })],
  });
}

function wizardNode(actor: CpActor, repo: CompetitionsRepo) {
  const env: CpInjectedEnv = { ...screenEnv('wizard-1'), actor, repo };
  return (
    <LocationProvider>
      <CpEnvProvider value={env}>
        <NewCompetitionPage />
      </CpEnvProvider>
    </LocationProvider>
  );
}

function expectNoForm(container: Element): void {
  expect(screen.queryByText('步驟 1／3')).toBeNull();
  expect(screen.queryByRole('button', { name: '下一步' })).toBeNull();
  expect(container.querySelector('input')).toBeNull();
}

const launchReads = (repo: ReturnType<typeof createFakeCpRepo>) => repo.calls().filter((name) => name === 'getLaunch').length;

describe('建賽頁照開賽閘門', () => {
  it('未登入：不顯示表單、不讀閘門；給登入鈕（回跳是目前這頁）與返回賽事列表', async () => {
    window.history.replaceState(null, '', '/competitions/new');
    const repo = repoWith(INTERNAL);
    const view = render(wizardNode(guest, repo));
    expectNoForm(view.container);
    expect(screen.getByText(NEED_LOGIN)).toBeTruthy();
    expect(launchReads(repo)).toBe(0);
    fireEvent.click(screen.getByRole('button', { name: '登入' }));
    await waitFor(() => expect(box.signIn).toBe(1));
    expect(window.location.pathname).toBe('/competitions/new');
    fireEvent.click(screen.getByRole('button', { name: '返回賽事列表' }));
    expect(window.location.pathname).toBe('/tournaments');
  });

  it('內部期一般會員：一句說明＋返回賽事列表', async () => {
    const repo = repoWith(INTERNAL);
    const view = render(wizardNode(member, repo));
    expect((await screen.findByRole('alert')).textContent).toBe(NOT_OPEN);
    expectNoForm(view.container);
    expect(screen.getByRole('button', { name: '返回賽事列表' })).toBeTruthy();
    expect(repo.calls()).toEqual(['getLaunch', 'getLaunchTester']);
  });

  it('沒有開賽設定（內部期）的一般會員也擋', async () => {
    const repo = repoWith(null);
    const view = render(wizardNode(member, repo));
    expect((await screen.findByRole('alert')).textContent).toBe(NOT_OPEN);
    expectNoForm(view.container);
  });

  it('內部期管理員：直接顯示表單，不讀閘門', () => {
    const repo = repoWith(INTERNAL);
    render(wizardNode(admin, repo));
    expect(screen.getByText('步驟 1／3')).toBeTruthy();
    expect(repo.calls()).toEqual([]);
  });

  it('內部期測試者：顯示表單', async () => {
    const repo = repoWith(INTERNAL);
    render(wizardNode(tester, repo));
    expect(await screen.findByText('步驟 1／3')).toBeTruthy();
    expect(screen.queryByText(NOT_OPEN)).toBeNull();
  });

  it('開放後一般會員：顯示表單，不查測試者名單', async () => {
    const repo = repoWith(PUBLIC);
    render(wizardNode(member, repo));
    expect(await screen.findByText('步驟 1／3')).toBeTruthy();
    expect(repo.calls()).toEqual(['getLaunch']);
  });

  it('登入、角色或閘門還沒定案：只轉圈；角色到了再判定，閘門只讀 1 次', async () => {
    const auth = render(wizardNode({ ...member, uid: null, authPending: true }, repoWith(INTERNAL)));
    expectNoForm(auth.container);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText(NEED_LOGIN)).toBeNull();
    expect(auth.container.querySelector('[data-cp-create="pending"]')).toBeTruthy();
    auth.unmount();

    // 閘門讀取還沒回來
    let release: (doc: LaunchDoc) => void = () => undefined;
    const slow = repoWith(PUBLIC);
    slow.getLaunch = () => new Promise<LaunchDoc | null>((resolve) => { release = resolve; });
    const waiting = render(wizardNode(member, slow));
    expect(waiting.container.querySelector('[data-cp-create="pending"]')).toBeTruthy();
    expectNoForm(waiting.container);
    release(PUBLIC);
    expect(await screen.findByText('步驟 1／3')).toBeTruthy();
    waiting.unmount();

    // 內部期、角色未定：先轉圈；角色確定是一般會員才說不能用
    const repo = repoWith(INTERNAL);
    const pendingRole: CpActor = { ...member, rolePending: true };
    const view = render(wizardNode(pendingRole, repo));
    await waitFor(() => expect(launchReads(repo)).toBe(1));
    expect(view.container.querySelector('[data-cp-create="pending"]')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    expectNoForm(view.container);
    view.rerender(wizardNode({ ...member, rolePending: false }, repo));
    expect((await screen.findByRole('alert')).textContent).toBe(NOT_OPEN);
    expect(launchReads(repo)).toBe(1);

    // 內部期、角色未定，後來確定是管理員
    cleanup();
    const adminRepo = repoWith(INTERNAL);
    const late = render(wizardNode({ ...admin, role: 'user', rolePending: true }, adminRepo));
    await waitFor(() => expect(launchReads(adminRepo)).toBe(1));
    expectNoForm(late.container);
    late.rerender(wizardNode(admin, adminRepo));
    expect(screen.getByText('步驟 1／3')).toBeTruthy();
  });

  it('正式頁：沒過閘門不查代表俱樂部；過了才掛內層去查', async () => {
    box.repo = repoWith(INTERNAL);
    box.actor = member;
    const denied = render(<LocationProvider><NewCompetitionPage /></LocationProvider>);
    expect((await screen.findByRole('alert')).textContent).toBe(NOT_OPEN);
    expectNoForm(denied.container);
    expect(box.loadClubs).not.toContain(true);
    denied.unmount();

    box.loadClubs = [];
    box.actor = guest;
    const login = render(<LocationProvider><NewCompetitionPage /></LocationProvider>);
    expect(screen.getByText(NEED_LOGIN)).toBeTruthy();
    expect(box.loadClubs).not.toContain(true);
    login.unmount();

    box.loadClubs = [];
    box.repo = repoWith(PUBLIC);
    box.actor = { ...member, repClubs: [] };
    render(<LocationProvider><NewCompetitionPage /></LocationProvider>);
    expect(await screen.findByText('步驟 1／3')).toBeTruthy();
    expect(box.loadClubs[0]).toBe(false);
    expect(box.loadClubs).toContain(true);
  });
});

describe('站內清單的「建立賽事」與建賽頁同條件', () => {
  function drawSection(actor: CpActor, launch: LaunchDoc | null) {
    return render(
      <LocationProvider>
        <CpEnvProvider value={{ actor, repo: repoWith(launch), actions: idleActions(), now: NOW }}>
          <InAppSection />
        </CpEnvProvider>
      </LocationProvider>,
    );
  }

  it('內部期管理員、內部期測試者、開放後一般會員看得到，點了進建賽頁', async () => {
    const cases: Array<[CpActor, LaunchDoc]> = [[admin, INTERNAL], [tester, INTERNAL], [member, PUBLIC]];
    for (const [actor, launch] of cases) {
      const view = drawSection(actor, launch);
      expect(await screen.findByText('公開示範盃')).toBeTruthy();
      const button = screen.getByRole('button', { name: '建立賽事' });
      expect(button.className).toContain('ui-button');
      fireEvent.click(button);
      expect(window.location.pathname).toBe('/competitions/new');
      view.unmount();
      window.history.replaceState(null, '', '/');
    }
  });

  it('主辦賽事開關：canHost false 沒有建立鈕，true 有（顧問 §3.612）', async () => {
    const off = drawSection({ ...member, canHost: false }, PUBLIC);
    expect(await screen.findByText('公開示範盃')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '建立賽事' })).toBeNull();
    off.unmount();
    const offAdmin = drawSection({ ...admin, canHost: false }, INTERNAL);
    expect(await screen.findByText('公開示範盃')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '建立賽事' })).toBeNull();
    offAdmin.unmount();
    drawSection({ ...member, canHost: true }, PUBLIC);
    expect(await screen.findByText('公開示範盃')).toBeTruthy();
    expect(screen.getByRole('button', { name: '建立賽事' })).toBeTruthy();
  });

  it('開放後未登入看得到清單但沒有鈕；內部期一般會員與角色未定整區不出現', async () => {
    const open = drawSection(guest, PUBLIC);
    expect(await screen.findByText('公開示範盃')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '建立賽事' })).toBeNull();
    open.unmount();

    for (const actor of [member, { ...member, rolePending: true }]) {
      const view = drawSection(actor, INTERNAL);
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(screen.queryByText('公開示範盃')).toBeNull();
      expect(screen.queryByRole('button', { name: '建立賽事' })).toBeNull();
      view.unmount();
    }
  });
});

describe('建賽頁的主辦賽事開關（顧問 §3.612）', () => {
  const HOST_DISABLED = '你目前不能主辦賽事';

  it('建立模式 canHost false：不顯示精靈，改顯示 hostDisabled＋返回賽事列表', async () => {
    const repo = repoWith(PUBLIC);
    const view = render(wizardNode({ ...member, canHost: false }, repo));
    expect((await screen.findByRole('alert')).textContent).toBe(HOST_DISABLED);
    expect(view.container.querySelector('[data-cp-load="host-disabled"]')).toBeTruthy();
    expectNoForm(view.container);
    expect(screen.getByRole('button', { name: '返回賽事列表' })).toBeTruthy();
  });

  it('管理員也照開關（只有 super_admin 由 canHostCompetition 一律放行）', () => {
    const view = render(wizardNode({ ...admin, canHost: false }, repoWith(INTERNAL)));
    expect(screen.getByRole('alert').textContent).toBe(HOST_DISABLED);
    expectNoForm(view.container);
  });

  it('沒開放時仍先說沒開放，不說不能主辦', async () => {
    render(wizardNode({ ...member, canHost: false }, repoWith(INTERNAL)));
    expect((await screen.findByRole('alert')).textContent).toBe(NOT_OPEN);
  });

  it('canHost true 或省略：照常顯示精靈', async () => {
    render(wizardNode({ ...member, canHost: true }, repoWith(PUBLIC)));
    expect(await screen.findByText('步驟 1／3')).toBeTruthy();
  });

  it('編輯模式不受影響：canHost false 仍可編輯自己的賽事', () => {
    window.history.replaceState(null, '', `/competitions/new?edit=cp_${'A'.repeat(20)}`);
    const env: CpInjectedEnv = {
      actor: { ...hostActor, canHost: false }, repo: createFakeCpRepo(), actions: idleActions(), now: NOW, bundle: editBundle(),
    };
    render(
      <LocationProvider>
        <CpEnvProvider value={env}>
          <NewCompetitionPage />
        </CpEnvProvider>
      </LocationProvider>,
    );
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('編輯賽事');
    expect((document.getElementById('cpf-name') as HTMLInputElement | null)?.value).toBe('示範盃');
    expect(screen.queryByText(HOST_DISABLED)).toBeNull();
  });
});
