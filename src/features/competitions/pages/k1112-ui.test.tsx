// 第 4 步 K11 邀請記分員、K12 管理員下架與檢舉：畫面。
import type { JSX } from 'preact';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocationProvider } from 'preact-iso';
import { toast } from '@/ui/Toast';

const fn = vi.hoisted(() => ({ httpsCallable: vi.fn() }));
vi.mock('firebase/functions', () => ({
  httpsCallable: (...args: unknown[]) => {
    fn.httpsCallable(...args);
    return async () => ({ data: {} });
  },
}));
import type { CpActions } from '../actions';
import { CpCallError } from '../data/cp-callables';
import { INVITE_STORE_KEY } from '../data/invite-link';
import type { InviteDoc, MatchDoc, ReportDoc, StaffAssignment, StaffRole } from '../data/types';
import { taipeiMs } from '../format';
import { loadCompetitionsDict } from '../i18n';
import { CpEnvProvider, type CpInjectedEnv } from '../env';
import { createFakeCpRepo, type FakeCpRepo } from '../testing/fake-cp-repo';
import {
  adminActor,
  coHostActor,
  competition,
  hostActor,
  idleActions,
  memberActor,
  screenEnv,
} from '../testing/screen-fixtures';
import CompetitionDetailPage from './CompetitionDetailPage';
import InviteAcceptPage from './InviteAcceptPage';
import StaffInvitePage from './StaffInvitePage';
import StaffPage from './StaffPage';

const CODE = 'AbCdEfGhIjKlMnOpQrStUv';
const IV = 'iv_aaaaaaaaaaaaaaaaaaaa';
const EXP = taipeiMs(2027, 1, 16, 18, 0);

function match(id: string, hour: number): MatchDoc {
  return {
    id,
    divisionId: 'dv_1',
    stageId: 'group',
    groupId: 'A',
    round: 1,
    matchNo: hour,
    label: null,
    matchKey: null,
    kickoffAt: taipeiMs(2027, 1, 9, hour, 0),
    venueIdx: 0,
    venueName: '1號場',
    home: { teamId: 'en_h', name: '雷霆隊' },
    away: { teamId: 'en_a', name: '海風隊' },
    teamIds: ['en_h', 'en_a'],
    score: { home: 0, away: 0 },
    penaltyScore: null,
    status: 'scheduled',
    rev: 0,
    resetRev: 0,
    lock: { locked: false },
    clockBase: { startedAt: null, pausedSec: 0, running: false, period: 'pre' },
    finishedAt: null,
    confirmedAt: null,
    walkoverSide: null,
    result: null,
    resultSource: null,
    updatedAt: null,
    cancelReason: null,
    cancelledAt: null,
  };
}

const hostRole: StaffRole[] = ['host'];
const coRole: StaffRole[] = ['coHost'];

const ASSIGN: StaffAssignment[] = [
  { uid: 'uid_host', roles: ['host'], matchIds: [], expiresAt: null, memberNo: 1 },
  { uid: 'uid_a', roles: ['scorer'], matchIds: ['mt_9'], expiresAt: EXP, memberNo: 3, displayName: '陳小明' },
  { uid: 'uid_b', roles: ['referee'], matchIds: [], expiresAt: null, memberNo: 4, displayName: null },
  { uid: 'uid_co', roles: ['coHost'], matchIds: [], expiresAt: EXP, memberNo: 2 },
];

const INVITES: InviteDoc[] = [
  { id: 'iv_open1', roles: ['scorer'], matchIds: ['mt_9', 'mt_10'], expiresAt: EXP, status: 'open', createdAt: 2, usedAt: null, usedMemberNo: null },
  { id: 'iv_used1', roles: ['referee'], matchIds: [], expiresAt: EXP, status: 'used', createdAt: 1, usedAt: 3, usedMemberNo: 3 },
];

function staffRepo(): FakeCpRepo {
  return createFakeCpRepo({
    competitions: [competition({ id: 'cup' })],
    staff: { cup: [{ uid: 'uid_host', roles: hostRole }, { uid: 'uid_co', roles: coRole }] },
    assignments: { cup: ASSIGN },
    invites: { cup: INVITES },
    matches: { cup: [match('mt_10', 10), match('mt_9', 9)] },
  });
}

function draw(env: CpInjectedEnv, node: JSX.Element) {
  return render(
    <LocationProvider>
      <CpEnvProvider value={env}>{node}</CpEnvProvider>
    </LocationProvider>,
  );
}

function button(name: string, root: ParentNode = document): HTMLButtonElement {
  const found = [...root.querySelectorAll('button')].find((node) => (node.textContent ?? '').trim() === name);
  if (!found) throw new Error(`找不到按鈕：${name}`);
  return found as HTMLButtonElement;
}

beforeAll(async () => {
  await loadCompetitionsDict('zh-TW');
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  sessionStorage.clear();
  history.replaceState(null, '', '/');
});

describe('工作人員頁（K11）', () => {
  it('名單用 displayName，null 退回成員 N；記分角色有到期才顯示到期', async () => {
    const repo = staffRepo();
    const view = draw({ actor: hostActor, repo, actions: idleActions(), route: { cid: 'cup' } }, <StaffPage />);
    expect(await screen.findByText('陳小明')).toBeTruthy();
    const names = [...view.container.querySelectorAll('.s4b-staff__name')].map((el) => el.textContent);
    expect(names).toEqual(['我自己', '成員 2', '陳小明', '成員 4']);
    const exp = [...view.container.querySelectorAll('.s4b-staff__exp')].map((el) => el.textContent);
    // 只有陳小明（記分員、有到期）。共同主辦沒有記分角色不顯示；裁判 null 不顯示。
    expect(exp).toEqual(['01/16 18:00 到期']);
    expect(repo.calls()).toEqual(['getStaff', 'listStaff', 'listInvites']);
  });

  it('列出尚未使用的邀請，撤銷走確認框並送 {cid, ivId}', async () => {
    const revokeInvite = vi.fn(async () => ({ ivId: 'iv_open1', status: 'revoked' }));
    const actions: CpActions = { ...idleActions(), revokeInvite };
    const view = draw({ actor: coHostActor, repo: staffRepo(), actions, route: { cid: 'cup' } }, <StaffPage />);
    expect(await screen.findByText('尚未使用的邀請')).toBeTruthy();
    const rows = view.container.querySelectorAll('[data-invite]');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.textContent).toContain('記分員');
    expect(rows[0]?.textContent).toContain('2 場');
    expect(rows[0]?.textContent).toContain('01/16 18:00 到期');
    fireEvent.click(button('撤銷', rows[0] as Element));
    expect(await screen.findByText('撤銷邀請？')).toBeTruthy();
    const dialog = document.querySelector('[role="dialog"]') as HTMLElement;
    fireEvent.click(button('撤銷', dialog));
    await waitFor(() => expect(revokeInvite).toHaveBeenCalledWith({ cid: 'cup', ivId: 'iv_open1' }));
    await waitFor(() => expect(view.container.querySelectorAll('[data-invite]')).toHaveLength(0));
    expect(screen.getByText('目前沒有尚未使用的邀請')).toBeTruthy();
  });

  it('撤銷失敗顯示錯誤文字', async () => {
    const actions: CpActions = { ...idleActions(), revokeInvite: async () => { throw new CpCallError('INVITE_NOT_OPEN', {}); } };
    const view = draw({ actor: hostActor, repo: staffRepo(), actions, route: { cid: 'cup' } }, <StaffPage />);
    await screen.findByText('尚未使用的邀請');
    fireEvent.click(button('撤銷', view.container.querySelector('[data-invite]') as Element));
    await screen.findByText('撤銷邀請？');
    fireEvent.click(button('撤銷', document.querySelector('[role="dialog"]') as HTMLElement));
    expect(await screen.findByText('這個邀請已使用或已撤銷')).toBeTruthy();
  });

  it('只列 status open（repo 回混合狀態也篩掉）', async () => {
    const repo = staffRepo();
    const mixed = { ...repo, listInvites: async () => INVITES.map((row) => ({ ...row })) };
    const view = draw({ actor: hostActor, repo: mixed, actions: idleActions(), route: { cid: 'cup' } }, <StaffPage />);
    await screen.findByText('尚未使用的邀請');
    await waitFor(() => expect(view.container.querySelectorAll('[data-invite]')).toHaveLength(1));
    expect(view.container.querySelector('[data-invite="iv_used1"]')).toBeNull();
  });

  it('邀請讀取失敗：顯示讀取失敗與重試，不顯示「沒有」；重試成功列出', async () => {
    const repo = staffRepo();
    let fail = true;
    const flaky = {
      ...repo,
      listInvites: async (cid: string) => {
        if (fail) throw new Error('x');
        return repo.listInvites(cid);
      },
    };
    const view = draw({ actor: hostActor, repo: flaky, actions: idleActions(), route: { cid: 'cup' } }, <StaffPage />);
    expect(await screen.findByText('讀取失敗')).toBeTruthy();
    expect(view.container.textContent).not.toContain('目前沒有尚未使用的邀請');
    expect(screen.getByText('陳小明')).toBeTruthy();
    fail = false;
    fireEvent.click(button('重試'));
    await waitFor(() => expect(view.container.querySelectorAll('[data-invite]')).toHaveLength(1));
    expect(view.container.textContent).not.toContain('讀取失敗');
  });

  it('一般會員看不到，也不讀邀請', async () => {
    const repo = staffRepo();
    draw({ actor: memberActor, repo, actions: idleActions(), route: { cid: 'cup' } }, <StaffPage />);
    expect(await screen.findByText('你沒有這場賽事的管理權限')).toBeTruthy();
    expect(repo.calls()).toEqual(['getStaff']);
  });
});

describe('邀請表單（K11）', () => {
  it('送出角色與依時間排序的場次，成功後顯示 # 格式連結與只顯示一次', async () => {
    const createInvite = vi.fn(async () => ({ ivId: IV, code: CODE, expiresAt: EXP }));
    const view = draw({ actor: hostActor, repo: staffRepo(), actions: { ...idleActions(), createInvite }, route: { cid: 'cup' } }, <StaffInvitePage />);
    await screen.findByText('產生邀請連結');
    expect(view.container.querySelector('select')).toBeNull();
    const boxes = [...view.container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
    expect(boxes).toHaveLength(2);
    fireEvent.click(boxes[1] as HTMLInputElement);
    fireEvent.click(boxes[0] as HTMLInputElement);
    fireEvent.click(screen.getByLabelText('裁判'));
    fireEvent.click(button('產生邀請連結'));
    await waitFor(() => expect(createInvite).toHaveBeenCalledWith({ cid: 'cup', roles: ['referee'], matchIds: ['mt_9', 'mt_10'] }));
    const url = (await screen.findByText(/\/competitions\/cup\/invite#/)).textContent ?? '';
    expect(url).toBe(`${location.origin}/competitions/cup/invite#i=${IV}&c=${CODE}`);
    expect(url).not.toContain('?');
    expect(screen.getByText('連結只顯示這一次，請先複製或分享')).toBeTruthy();
    expect(view.container.textContent).toContain('角色：裁判');
  });

  it('錯誤碼顯示文字（INVITE_LIMIT 帶上限）', async () => {
    const createInvite = vi.fn(async () => { throw new CpCallError('INVITE_LIMIT', { max: 30 }); });
    draw({ actor: hostActor, repo: staffRepo(), actions: { ...idleActions(), createInvite }, route: { cid: 'cup' } }, <StaffInvitePage />);
    fireEvent.click(await screen.findByText('產生邀請連結'));
    expect(await screen.findByText('邀請已達 30 張上限')).toBeTruthy();
  });

  it('一般會員進不來，只讀自己的 staff', async () => {
    const repo = staffRepo();
    draw({ actor: memberActor, repo, actions: idleActions(), route: { cid: 'cup' } }, <StaffInvitePage />);
    expect(await screen.findByText('你沒有這場賽事的管理權限')).toBeTruthy();
    expect(repo.calls()).toEqual(['getStaff']);
  });
});

describe('接受邀請（K11，代碼放 #）', () => {
  let logs: unknown[][];
  beforeEach(() => {
    logs = [];
    for (const level of ['error', 'warn', 'log', 'info'] as const) {
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => { logs.push(args); });
    }
  });

  function acceptEnv(over: Partial<CpInjectedEnv> = {}): CpInjectedEnv {
    return { actor: memberActor, repo: staffRepo(), actions: idleActions(), route: { cid: 'cup' }, ...over };
  }

  function openWithHash(): void {
    history.replaceState(null, '', `/competitions/cup/invite#i=${IV}&c=${CODE}`);
  }

  function noCodeLeak(): void {
    expect(location.href).not.toContain(CODE);
    expect(location.hash).toBe('');
    expect(JSON.stringify(logs)).not.toContain(CODE);
  }

  it('進頁立刻拿掉 #；已登入顯示賽事名，接受送 {cid, ivId, code} 並導到我的場次、清掉暫存', async () => {
    openWithHash();
    const show = vi.spyOn(toast, 'show');
    const acceptInvite = vi.fn(async () => ({ cid: 'cup', roles: ['scorer'], matchCount: 2 }));
    draw(acceptEnv({ actions: { ...idleActions(), acceptInvite } }), <InviteAcceptPage />);
    expect(location.pathname).toBe('/competitions/cup/invite');
    noCodeLeak();
    expect(await screen.findByText('示範盃')).toBeTruthy();
    // 已登入不寫暫存（Opus 審 P3-1）。
    expect(sessionStorage.getItem(INVITE_STORE_KEY)).toBeNull();
    fireEvent.click(button('接受邀請'));
    await waitFor(() => expect(acceptInvite).toHaveBeenCalledWith({ cid: 'cup', ivId: IV, code: CODE }));
    await waitFor(() => expect(location.pathname).toBe('/competitions/cup/my-matches'));
    expect(sessionStorage.getItem(INVITE_STORE_KEY)).toBeNull();
    expect(JSON.stringify(show.mock.calls)).not.toContain(CODE);
    noCodeLeak();
  });

  it('錯誤碼顯示對應文字；toast、console 都不含代碼；暫存清掉', async () => {
    const cases: [string, string][] = [
      ['INVITE_REVOKED', '主辦已撤銷這個邀請'],
      ['INVITE_USED', '這個邀請已經被使用'],
      ['INVITE_EXPIRED', '這個邀請已過期'],
      ['INVITE_INVALID', '邀請連結無效'],
      ['COMPETITION_ENDED', '賽事已結束，邀請無法使用'],
      ['COMPETITION_HIDDEN', '這場賽事目前不公開'],
    ];
    for (const [reason, text] of cases) {
      openWithHash();
      const show = vi.spyOn(toast, 'show');
      const acceptInvite = vi.fn(async () => { throw new CpCallError(reason, {}); });
      draw(acceptEnv({ actions: { ...idleActions(), acceptInvite } }), <InviteAcceptPage />);
      fireEvent.click(await screen.findByText('接受邀請', { selector: 'button *, button' }));
      expect(await screen.findByText(text)).toBeTruthy();
      expect(sessionStorage.getItem(INVITE_STORE_KEY)).toBeNull();
      expect(JSON.stringify(show.mock.calls)).not.toContain(CODE);
      expect(document.body.innerHTML).not.toContain(CODE);
      noCodeLeak();
      cleanup();
    }
  });

  it('未登入：提示登入；按登入才暫存到 sessionStorage 並呼叫 signIn；卸載後清掉', async () => {
    openWithHash();
    const signIn = vi.fn(async () => undefined);
    draw(acceptEnv({ actor: { ...memberActor, uid: null }, signIn }), <InviteAcceptPage />);
    expect(await screen.findByText('登入後才能接受邀請')).toBeTruthy();
    noCodeLeak();
    expect(sessionStorage.getItem(INVITE_STORE_KEY)).toBeNull();
    fireEvent.click(button('登入'));
    await waitFor(() => expect(signIn).toHaveBeenCalledTimes(1));
    expect(JSON.parse(sessionStorage.getItem(INVITE_STORE_KEY) ?? '{}')).toEqual({ cid: 'cup', ivId: IV, code: CODE });
    cleanup();
    expect(sessionStorage.getItem(INVITE_STORE_KEY)).toBeNull();
  });

  it('登入回來（網址沒有 #）從 sessionStorage 接續', async () => {
    history.replaceState(null, '', '/competitions/cup/invite');
    sessionStorage.setItem(INVITE_STORE_KEY, JSON.stringify({ cid: 'cup', ivId: IV, code: CODE }));
    const acceptInvite = vi.fn(async () => ({ cid: 'cup', roles: ['scorer'], matchCount: 1 }));
    draw(acceptEnv({ actions: { ...idleActions(), acceptInvite } }), <InviteAcceptPage />);
    fireEvent.click(await screen.findByText('接受邀請', { selector: 'button *, button' }));
    await waitFor(() => expect(acceptInvite).toHaveBeenCalledWith({ cid: 'cup', ivId: IV, code: CODE }));
    await waitFor(() => expect(sessionStorage.getItem(INVITE_STORE_KEY)).toBeNull());
  });

  it('# 後格式錯誤：仍拿掉 #、查詢字串保留，顯示連結無效', async () => {
    history.replaceState(null, '', '/competitions/cup/invite?from=line#i=bad&c=zz');
    draw(acceptEnv(), <InviteAcceptPage />);
    expect(await screen.findByText('邀請連結無效')).toBeTruthy();
    expect(location.pathname).toBe('/competitions/cup/invite');
    expect(location.search).toBe('?from=line');
    expect(location.hash).toBe('');
  });

  // PM 11-20：CpActions 改回必填，「缺動作」不再可能（型別擋）；改測注入的動作失敗時顯示通用失敗、不退回正式 Functions。
  it('注入的 acceptInvite 失敗（UNKNOWN）：顯示通用失敗，不送任何 Callable', async () => {
    openWithHash();
    fn.httpsCallable.mockClear();
    const acceptInvite = vi.fn(() => Promise.reject(new CpCallError('UNKNOWN', {})));
    draw(acceptEnv({ actions: { ...idleActions(), acceptInvite } }), <InviteAcceptPage />);
    fireEvent.click(await screen.findByText('接受邀請', { selector: 'button *, button' }));
    expect(await screen.findByText('操作失敗，請稍後再試')).toBeTruthy();
    expect(acceptInvite).toHaveBeenCalledTimes(1);
    expect(fn.httpsCallable).not.toHaveBeenCalled();
    noCodeLeak();
  });

  it('顧問 11-20：連線或不明錯誤保留邀請可直接再按（暫存照清）；伺服器明確判定無效、已用、撤銷、過期才整個清掉', async () => {
    for (const reason of ['UNAVAILABLE', 'UNKNOWN', 'DEADLINE_EXCEEDED']) {
      openWithHash();
      sessionStorage.setItem(INVITE_STORE_KEY, JSON.stringify({ cid: 'cup', ivId: IV, code: CODE }));
      const acceptInvite = vi.fn()
        .mockImplementationOnce(() => Promise.reject(new CpCallError(reason, {})))
        .mockImplementationOnce(async () => ({ cid: 'cup', roles: ['scorer'], matchCount: 1 }));
      draw(acceptEnv({ actions: { ...idleActions(), acceptInvite } }), <InviteAcceptPage />);
      fireEvent.click(await screen.findByText('接受邀請', { selector: 'button *, button' }));
      await waitFor(() => expect(acceptInvite).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(button('接受邀請')).toBeTruthy());
      expect(sessionStorage.getItem(INVITE_STORE_KEY)).toBeNull();
      fireEvent.click(button('接受邀請'));
      await waitFor(() => expect(acceptInvite).toHaveBeenCalledTimes(2));
      expect(acceptInvite.mock.calls[1]).toEqual([{ cid: 'cup', ivId: IV, code: CODE }]);
      await waitFor(() => expect(location.pathname).toBe('/competitions/cup/my-matches'));
      noCodeLeak();
      cleanup();
    }
    for (const reason of ['INVITE_INVALID', 'INVITE_USED', 'INVITE_REVOKED', 'INVITE_EXPIRED']) {
      openWithHash();
      const acceptInvite = vi.fn(async () => { throw new CpCallError(reason, {}); });
      draw(acceptEnv({ actions: { ...idleActions(), acceptInvite } }), <InviteAcceptPage />);
      fireEvent.click(await screen.findByText('接受邀請', { selector: 'button *, button' }));
      await waitFor(() => expect(acceptInvite).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(screen.queryByText('接受邀請', { selector: 'button *, button' })).toBeNull());
      cleanup();
    }
  });

  it('顧問 11-20：已登入看到告知句（接受後成為記分人員、主辦會看到顯示名稱）', async () => {
    openWithHash();
    draw(acceptEnv(), <InviteAcceptPage />);
    expect(await screen.findByText('接受後你會成為這場賽事的記分人員，主辦會看到你的顯示名稱。')).toBeTruthy();
  });

  it('顧問 11-20：沒有 # 也沒有暫存（換瀏覽器、LINE 登入回來暫存不見）顯示找不到邀請資料', async () => {
    history.replaceState(null, '', '/competitions/cup/invite');
    sessionStorage.removeItem(INVITE_STORE_KEY);
    draw(acceptEnv(), <InviteAcceptPage />);
    expect(await screen.findByText('找不到邀請資料，請重新點開邀請連結。')).toBeTruthy();
    cleanup();
    history.replaceState(null, '', '/competitions/cup/invite?from=line');
    draw(acceptEnv({ actor: { ...memberActor, uid: null } }), <InviteAcceptPage />);
    expect(await screen.findByText('找不到邀請資料，請重新點開邀請連結。')).toBeTruthy();
  });

  it('別的賽事的暫存不接續；沒有代碼顯示找不到邀請資料', async () => {
    history.replaceState(null, '', '/competitions/cup/invite');
    sessionStorage.setItem(INVITE_STORE_KEY, JSON.stringify({ cid: 'other', ivId: IV, code: CODE }));
    const acceptInvite = vi.fn();
    draw(acceptEnv({ actions: { ...idleActions(), acceptInvite } }), <InviteAcceptPage />);
    expect(await screen.findByText('找不到邀請資料，請重新點開邀請連結。')).toBeTruthy();
    expect(acceptInvite).not.toHaveBeenCalled();
  });
});

const REPORTS = [
  { id: 'rp_aaaaaaaa', reason: 'impersonation', detail: '冒用我們俱樂部的名字', count: 3, lastAt: taipeiMs(2027, 1, 8, 21, 5), status: 'open', reopened: false, reporterUid: 'uid_secret_reporter' },
  { id: 'rp_bbbbbbbb', reason: 'fake', detail: null, count: 1, lastAt: taipeiMs(2027, 1, 7, 9, 0), status: 'resolved', reopened: false, reporterUid: 'uid_secret_two' },
] as unknown as ReportDoc[];

function detailEnv(who: typeof memberActor, actions: CpActions = idleActions(), hidden = false): { env: CpInjectedEnv; repo: FakeCpRepo } {
  const base = screenEnv('real-recruit', actions);
  const repo = createFakeCpRepo({ reports: { cup: REPORTS } });
  const bundle = base.bundle;
  if (!bundle?.competition) throw new Error('fixture');
  return {
    repo,
    env: {
      ...base,
      actor: who,
      actions,
      repo,
      bundle: {
        ...bundle,
        staff: who === hostActor ? { uid: 'uid_host', roles: hostRole } : bundle.staff,
        competition: { ...bundle.competition, hidden, hiddenReason: hidden ? '主辦資料不實' : null },
      },
    },
  };
}

describe('詳情頁管理員區（K12）', () => {
  it('一般會員、主辦看不到下架與檢舉，也不讀檢舉', async () => {
    for (const who of [memberActor, hostActor]) {
      const { env, repo } = detailEnv(who);
      const view = draw(env, <CompetitionDetailPage />);
      await screen.findByText('示範盃');
      expect(view.container.querySelector('[data-admin-panel]')).toBeNull();
      expect(view.container.textContent).not.toContain('檢舉紀錄');
      fireEvent.click(screen.getByLabelText('更多'));
      expect(view.container.textContent).not.toContain('下架');
      expect(repo.calls()).not.toContain('listReports');
      cleanup();
    }
  });

  it('管理員按下才讀檢舉（一次）；DOM 不含 reporterUid；標已處理送 reviewReport', async () => {
    const reviewReport = vi.fn(async () => ({}));
    const { env, repo } = detailEnv(adminActor, { ...idleActions(), reviewReport });
    const view = draw(env, <CompetitionDetailPage />);
    await screen.findByText('管理員');
    expect(repo.calls()).not.toContain('listReports');
    fireEvent.click(button('檢舉紀錄'));
    expect(await screen.findByText('冒用我們俱樂部的名字')).toBeTruthy();
    expect(repo.calls().filter((name) => name === 'listReports')).toHaveLength(1);
    const html = view.container.innerHTML;
    expect(html).not.toContain('uid_secret');
    expect(html).not.toContain('reporterUid');
    const first = view.container.querySelector('[data-report="rp_aaaaaaaa"]') as HTMLElement;
    expect(first.textContent).toContain('冒用單位或個人名義');
    expect(first.textContent).toContain('3 次');
    expect(first.textContent).toContain('最後 01/08 21:05');
    expect(first.textContent).toContain('待處理');
    const second = view.container.querySelector('[data-report="rp_bbbbbbbb"]') as HTMLElement;
    expect(second.textContent).toContain('已處理');
    expect(() => button('重新開啟', second)).not.toThrow();
    fireEvent.click(button('標為已處理', first));
    await waitFor(() => expect(reviewReport).toHaveBeenCalledWith({ cid: 'cup', reportId: 'rp_aaaaaaaa', status: 'resolved' }));
    await waitFor(() => expect(() => button('重新開啟', first)).not.toThrow());
    fireEvent.click(button('檢舉紀錄'));
    fireEvent.click(button('檢舉紀錄'));
    expect(repo.calls().filter((name) => name === 'listReports')).toHaveLength(1);
  });

  it('檢舉處理失敗顯示錯誤文字', async () => {
    const show = vi.spyOn(toast, 'show');
    const reviewReport = vi.fn(async () => { throw new CpCallError('REPORT_NOT_FOUND', {}); });
    const { env } = detailEnv(adminActor, { ...idleActions(), reviewReport });
    const view = draw(env, <CompetitionDetailPage />);
    fireEvent.click(await screen.findByText('檢舉紀錄'));
    await screen.findByText('冒用我們俱樂部的名字');
    fireEvent.click(button('標為不處理', view.container.querySelector('[data-report="rp_aaaaaaaa"]') as HTMLElement));
    await waitFor(() => expect(show).toHaveBeenCalledWith(expect.objectContaining({ message: '找不到這筆檢舉' })));
  });

  it('管理員下架：原因必填；送出 {cid, hidden:true, reason} 後頂部出現下架提示', async () => {
    const moderate = vi.fn(async () => ({ cid: 'cup', hidden: true }));
    const { env } = detailEnv(adminActor, { ...idleActions(), moderate });
    const view = draw(env, <CompetitionDetailPage />);
    await screen.findByText('管理員');
    fireEvent.click(button('下架', view.container.querySelector('[data-admin-panel]') as HTMLElement));
    expect(await screen.findByText('下架賽事')).toBeTruthy();
    const dialog = document.querySelector('[role="dialog"]') as HTMLElement;
    fireEvent.click(button('下架', dialog));
    expect(moderate).not.toHaveBeenCalled();
    expect(dialog.textContent).toMatch(/還有必填項目沒填|字數須介於 2 與 200 之間/);
    const area = dialog.querySelector('textarea') as HTMLTextAreaElement;
    fireEvent.input(area, { target: { value: '  冒用他人名義  ' } });
    fireEvent.click(button('下架', dialog));
    await waitFor(() => expect(moderate).toHaveBeenCalledWith({ cid: 'cup', hidden: true, reason: '冒用他人名義' }));
    expect(await screen.findByText('此賽事已被管理員下架：冒用他人名義')).toBeTruthy();
    expect(() => button('恢復', view.container.querySelector('[data-admin-panel]') as HTMLElement)).not.toThrow();
  });

  it('下架錯誤碼顯示在對話框', async () => {
    const moderate = vi.fn(async () => { throw new CpCallError('NO_CHANGE', {}); });
    const { env } = detailEnv(adminActor, { ...idleActions(), moderate });
    draw(env, <CompetitionDetailPage />);
    fireEvent.click(screen.getByLabelText('更多'));
    fireEvent.click(await screen.findByText('下架', { selector: '[role="menuitem"]' }));
    const dialog = (await screen.findByRole('dialog')) as HTMLElement;
    fireEvent.input(dialog.querySelector('textarea') as HTMLTextAreaElement, { target: { value: '測試原因' } });
    fireEvent.click(button('下架', dialog));
    expect(await screen.findByText('狀態沒有變更')).toBeTruthy();
  });

  it('注入的 moderate 失敗（UNKNOWN）：對話框顯示通用失敗，不送任何 Callable', async () => {
    fn.httpsCallable.mockClear();
    const moderate = vi.fn(() => Promise.reject(new CpCallError('UNKNOWN', {})));
    const { env } = detailEnv(adminActor, { ...idleActions(), moderate });
    draw(env, <CompetitionDetailPage />);
    fireEvent.click(button('下架', (await screen.findByText('管理員')).closest('[data-admin-panel]') as HTMLElement));
    const dialog = (await screen.findByRole('dialog')) as HTMLElement;
    fireEvent.input(dialog.querySelector('textarea') as HTMLTextAreaElement, { target: { value: '測試原因' } });
    fireEvent.click(button('下架', dialog));
    expect(await screen.findByText('操作失敗，請稍後再試')).toBeTruthy();
    expect(moderate).toHaveBeenCalledTimes(1);
    expect(fn.httpsCallable).not.toHaveBeenCalled();
  });

  it('screen-fixtures 的 idleActions 五支 K11／K12 動作都有（CpActions 必填）', () => {
    const a = idleActions();
    for (const k of ['createInvite', 'revokeInvite', 'acceptInvite', 'moderate', 'reviewReport'] as const) {
      expect(typeof a[k]).toBe('function');
    }
  });

  it('主辦打開已下架的賽事看到原因', async () => {
    const { env } = detailEnv(hostActor, idleActions(), true);
    draw(env, <CompetitionDetailPage />);
    expect(await screen.findByText('此賽事已被管理員下架：主辦資料不實')).toBeTruthy();
  });
});
