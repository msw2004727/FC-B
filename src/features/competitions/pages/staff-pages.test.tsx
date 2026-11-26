import type { JSX } from 'preact';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { LocationProvider } from 'preact-iso';
import type { CpActions } from '../actions';
import { CpCallError } from '../data/cp-callables';
import { forgetCompNames, rememberCompName } from '../data/comp-name-hint';
import type { MatchDoc, StaffRole } from '../data/types';
import { taipeiMs } from '../format';
import { loadCompetitionsDict } from '../i18n';
import { CpEnvProvider, type CpActor, type CpInjectedEnv } from '../env';
import { createFakeCpRepo, type FakeCpRepo } from '../testing/fake-cp-repo';
import {
  adminActor,
  clubRepActor,
  coHostActor,
  competition,
  hostActor,
  idleActions,
  memberActor,
  screenEnv,
} from '../testing/screen-fixtures';
import CompetitionDetailPage, { FOREGROUND_RELOAD_MIN_MS } from './CompetitionDetailPage';
import CompetitionManagePage from './CompetitionManagePage';
import ScorerMatchesPage from './ScorerMatchesPage';
import StaffAssignPage from './StaffAssignPage';
import StaffPage from './StaffPage';

const NOW = taipeiMs(2027, 1, 9, 18, 0);

function match(id: string, partial: Partial<MatchDoc> = {}): MatchDoc {
  return {
    id,
    divisionId: 'dv_1',
    stageId: 'group',
    groupId: 'A',
    round: 1,
    matchNo: 1,
    label: null,
    matchKey: null,
    kickoffAt: taipeiMs(2027, 1, 9, 9, 0),
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
    ...partial,
  };
}

const hostRole: StaffRole[] = ['host'];
const coRole: StaffRole[] = ['coHost'];

const STAFF_SEED = {
  cup: [
    { uid: 'uid_host', roles: hostRole },
    { uid: 'uid_co', roles: coRole },
  ],
};

const ASSIGNMENTS = {
  cup: [
    { uid: 'uid_host', roles: ['host' as const], matchIds: ['mt_1'], expiresAt: null, memberNo: 1 },
    { uid: 'uid_co', roles: ['coHost' as const], matchIds: [] as string[], expiresAt: null, memberNo: 2 },
    { uid: 'uid_b', roles: ['scorer' as const], matchIds: ['mt_1', 'mt_2'], expiresAt: null, memberNo: 4 },
    { uid: 'uid_a', roles: ['scorer' as const], matchIds: ['mt_1'], expiresAt: null, memberNo: 3 },
    { uid: 'uid_ref', roles: ['referee' as const], matchIds: [] as string[], expiresAt: null },
  ],
};

function staffRepo(): FakeCpRepo {
  return createFakeCpRepo({
    competitions: [competition({ id: 'cup' })],
    staff: STAFF_SEED,
    assignments: ASSIGNMENTS,
    matches: {
      cup: [
        match('mt_1'),
        match('mt_2', { kickoffAt: taipeiMs(2027, 1, 10, 5, 0), venueName: '2號場' }),
      ],
    },
  });
}

function draw(env: CpInjectedEnv, node: JSX.Element) {
  return render(
    <LocationProvider>
      <CpEnvProvider value={env}>{node}</CpEnvProvider>
    </LocationProvider>,
  );
}

function rowOf(view: { container: Element }, name: string): Element | null {
  return [...view.container.querySelectorAll('.s4b-li')].find((el) => (el.textContent ?? '').includes(name)) ?? null;
}

function removeIn(row: Element | null): HTMLButtonElement | null {
  if (!row) return null;
  // 新外觀卡 4-D：移除改成垃圾桶圖示鈕，報讀名稱帶對象（「移除 成員 3」），用 aria-label 開頭找。
  return [...row.querySelectorAll('button')].find((button) => (button.getAttribute('aria-label') ?? '').startsWith('移除')) ?? null;
}

function staffNames(view: { container: Element }): string[] {
  return [...view.container.querySelectorAll('.s4b-staff__name')].map((el) => el.textContent ?? '');
}

beforeAll(async () => {
  await loadCompetitionsDict('zh-TW');
});

afterEach(() => {
  cleanup();
});

describe('指派頁與我的場次', () => {
  it('非主辦、共同主辦與未登入看不到人員清單，也不讀清單', async () => {
    const member = staffRepo();
    const memberView = draw({
      actor: memberActor,
      repo: member,
      actions: idleActions(),
      route: { cid: 'cup' },
    }, <StaffPage />);
    expect(await screen.findByText('你沒有這場賽事的管理權限')).toBeTruthy();
    expect(member.calls()).toEqual(['getStaff']);
    expect(memberView.container.textContent ?? '').toContain('回賽事頁');
    cleanup();

    // 前代表（換人後代表清單沒有這隊）：不讀賽事、不讀清單
    const former = staffRepo();
    draw({
      actor: { ...clubRepActor, repClubs: [] },
      repo: former,
      actions: idleActions(),
      route: { cid: 'cup' },
    }, <StaffAssignPage />);
    expect(await screen.findByText('你沒有這場賽事的管理權限')).toBeTruthy();
    expect(former.calls()).toEqual(['getStaff']);
    cleanup();

    // 別隊代表：多讀 1 次賽事確認不是這隊代表，之後不讀清單與場次
    const other = staffRepo();
    draw({
      actor: { ...clubRepActor, repClubs: [{ id: 'club_other', name: '別隊' }] },
      repo: other,
      actions: idleActions(),
      route: { cid: 'cup' },
    }, <StaffAssignPage />);
    expect(await screen.findByText('你沒有這場賽事的管理權限')).toBeTruthy();
    expect(other.calls()).toEqual(['getStaff', 'getCompetition']);
    cleanup();

    const guest = staffRepo();
    draw({
      actor: { ...memberActor, uid: null },
      repo: guest,
      actions: idleActions(),
      route: { cid: 'cup' },
    }, <StaffPage />);
    expect(await screen.findByText('你沒有這場賽事的管理權限')).toBeTruthy();
    expect(guest.calls()).toEqual([]);
  });

  it('俱樂部目前代表看得到人員清單，自己那一列是主辦', async () => {
    const repo = staffRepo();
    const view = draw({
      actor: clubRepActor,
      repo,
      actions: idleActions(),
      route: { cid: 'cup' },
    }, <StaffPage />);
    expect(await screen.findByText('我自己')).toBeTruthy();
    expect(repo.calls()).toEqual(['getStaff', 'getCompetition', 'listStaff', 'listInvites']);
    expect(staffNames(view)[0]).toBe('我自己');
    const self = rowOf(view, '我自己');
    expect(self?.querySelector('.s4b-staff__roles')).toBeNull();
    expect(self?.textContent ?? '').toContain('主辦');
    expect(removeIn(self)).toBeNull();
    // 主辦（primary）可以移除共同主辦以外的記分角色，與個人主辦相同
    expect(removeIn(rowOf(view, '成員 3'))).not.toBeNull();
    expect(view.container.textContent ?? '').toContain('指派記分員');
    // 新外觀卡 4-D：垃圾桶報讀名稱帶對象；代表那條路已讀到賽事，頁首放賽事名小字（不多讀）
    expect(removeIn(rowOf(view, '成員 3'))?.getAttribute('aria-label')).toBe('移除 成員 3');
    expect(view.container.querySelector('.cps-top__ctx')?.textContent ?? '').not.toBe('');
  });

  it('頁首賽事名小字：主辦那條路不讀賽事，用報隊管理、排賽程記下的名稱；沒記過就不畫（第 4 批 3.2）', async () => {
    rememberCompName('cup', '記憶示範盃');
    const repo = staffRepo();
    const view = draw({ actor: hostActor, repo, actions: idleActions(), route: { cid: 'cup' } }, <StaffPage />);
    expect(await screen.findByText('我自己')).toBeTruthy();
    expect(repo.calls()).toEqual(['getStaff', 'listStaff', 'listInvites']);
    expect(view.container.querySelector('.cps-top__ctx')?.textContent).toBe('記憶示範盃');
    view.unmount();
    forgetCompNames();
    const bare = draw({ actor: hostActor, repo: staffRepo(), actions: idleActions(), route: { cid: 'cup' } }, <StaffPage />);
    expect(await screen.findByText('我自己')).toBeTruthy();
    expect(bare.container.querySelector('.cps-top__ctx')).toBeNull();
  });

  it('代表指派自己當記分員後，staff 只有記分角色，標籤顯示主辦＋記分員', async () => {
    const repo = createFakeCpRepo({
      competitions: [competition({ id: 'cup' })],
      staff: STAFF_SEED,
      assignments: {
        cup: [
          ...ASSIGNMENTS.cup,
          { uid: 'uid_cap', roles: ['scorer' as const], matchIds: ['mt_1'], expiresAt: taipeiMs(2027, 1, 20, 0, 0), memberNo: 6 },
        ],
      },
    });
    const view = draw({
      actor: clubRepActor,
      repo,
      actions: idleActions(),
      route: { cid: 'cup' },
    }, <StaffPage />);
    expect(await screen.findByText('我自己')).toBeTruthy();
    const self = rowOf(view, '我自己');
    const tags = [...(self?.querySelectorAll('.s4b-staff__roles > *') ?? [])].map((el) => (el.textContent ?? '').trim());
    expect(tags.slice(0, 2)).toEqual(['主辦', '記分員']);
    expect(self?.textContent ?? '').toContain('1 場');
    expect(self?.textContent ?? '').toContain('到期');
    expect(removeIn(self)).toBeNull();
    // 只出現一次，不另外多一列「成員 6」
    expect(staffNames(view).filter((name) => name === '我自己')).toHaveLength(1);
    expect(staffNames(view)).not.toContain('成員 6');
  });

  it('共同主辦、管理員看代表那一列：只顯示記分員（與後端一致，不讀別人的代表身分）', async () => {
    const seed = {
      competitions: [competition({ id: 'cup' })],
      staff: STAFF_SEED,
      assignments: {
        cup: [
          ...ASSIGNMENTS.cup,
          { uid: 'uid_cap', roles: ['scorer' as const], matchIds: ['mt_1'], expiresAt: null, memberNo: 6 },
        ],
      },
    };
    for (const who of [coHostActor, adminActor]) {
      const repo = createFakeCpRepo(seed);
      const view = draw({ actor: who, repo, actions: idleActions(), route: { cid: 'cup' } }, <StaffPage />);
      expect(await screen.findByText('成員 6')).toBeTruthy();
      const row = rowOf(view, '成員 6');
      expect(row?.textContent ?? '', who.uid ?? '').toContain('記分員');
      expect(row?.textContent ?? '', who.uid ?? '').not.toContain('主辦');
      expect(repo.calls(), who.uid ?? '').not.toContain('getCompetition');
      cleanup();
    }
  });

  it('個人主辦賽事：代表身分不算主辦，主辦不多讀賽事', async () => {
    const personal = createFakeCpRepo({
      competitions: [competition({ id: 'cup', hostType: 'personal', hostTeamId: null })],
      staff: STAFF_SEED,
      assignments: ASSIGNMENTS,
    });
    draw({ actor: clubRepActor, repo: personal, actions: idleActions(), route: { cid: 'cup' } }, <StaffPage />);
    expect(await screen.findByText('你沒有這場賽事的管理權限')).toBeTruthy();
    expect(personal.calls()).not.toContain('listStaff');
    cleanup();

    const host = staffRepo();
    draw({ actor: hostActor, repo: host, actions: idleActions(), route: { cid: 'cup' } }, <StaffPage />);
    expect(await screen.findByText('我自己')).toBeTruthy();
    expect(host.calls()).not.toContain('getCompetition');
    cleanup();

    const admin = staffRepo();
    draw({ actor: adminActor, repo: admin, actions: idleActions(), route: { cid: 'cup' } }, <StaffPage />);
    expect(await screen.findByText('成員 2')).toBeTruthy();
    expect(admin.calls()).not.toContain('getCompetition');
  });

  it('代表清單還在讀時不發讀取、不先顯示沒有權限', async () => {
    const repo = staffRepo();
    draw({
      actor: { ...clubRepActor, repClubs: [], repClubsPending: true },
      repo,
      actions: idleActions(),
      route: { cid: 'cup' },
    }, <StaffPage />);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(repo.calls()).toEqual([]);
    expect(screen.queryByText('你沒有這場賽事的管理權限')).toBeNull();
  });

  it('代表在指派頁可以指派自己，沿用已讀的賽事', async () => {
    const assignStaff = vi.fn<CpActions['assignStaff']>(async () => ({}));
    const repo = staffRepo();
    draw({
      actor: clubRepActor,
      repo,
      actions: { ...idleActions(), assignStaff },
      route: { cid: 'cup', uid: 'uid_cap' },
    }, <StaffAssignPage />);
    expect(await screen.findByRole('button', { name: '儲存' })).toBeTruthy();
    expect(repo.calls().filter((name) => name === 'getCompetition')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: '儲存' }));
    await waitFor(() => expect(assignStaff).toHaveBeenCalled());
    expect(assignStaff.mock.calls[0]?.[0]).toMatchObject({ cid: 'cup', uid: 'uid_cap', roles: ['scorer'] });
    // 儲存成功會換頁；換回來，避免影響後面檢查網址的案例
    await waitFor(() => expect(window.location.pathname).toBe('/competitions/cup/staff'));
    window.history.pushState(null, '', '/');
  });

  it('主辦清單用我自己與成員編號，移除鈕照角色，成功後重讀', async () => {
    const repo = staffRepo();
    const removeStaff = vi.fn<CpActions['removeStaff']>(async () => ({}));
    const view = draw({
      actor: hostActor,
      repo,
      actions: { ...idleActions(), removeStaff },
      route: { cid: 'cup' },
    }, <StaffPage />);
    expect(await screen.findByText('我自己')).toBeTruthy();
    expect(view.container.textContent ?? '').toContain('指派記分員');
    expect(view.container.textContent ?? '').not.toContain('產生邀請連結');
    expect(staffNames(view)).toEqual(['我自己', '成員 2', '成員 3', '成員 4', '成員']);
    const self = rowOf(view, '我自己');
    expect(self?.textContent ?? '').toContain('主辦');
    expect(removeIn(self)).toBeNull();
    const co = [...view.container.querySelectorAll('.s4b-li')].find((el) => (el.textContent ?? '').includes('共同主辦'));
    expect(removeIn(co ?? null)).toBeNull();
    expect(removeIn(rowOf(view, '裁判'))).not.toBeNull();
    expect(view.container.textContent ?? '').toContain('2 場');
    const scorer = rowOf(view, '成員 3');
    const button = removeIn(scorer);
    if (!button) throw new Error('記分員應有移除鈕');
    fireEvent.click(button);
    expect(await screen.findByText('移除記分角色？')).toBeTruthy();
    expect(screen.getByText('這位成員會從記分員與裁判移除，不能再記分。')).toBeTruthy();
    const dialog = document.body.querySelector('[role="dialog"]');
    const confirm = [...(dialog?.querySelectorAll('button') ?? [])].find((el) => (el.textContent ?? '').trim() === '移除');
    if (!confirm) throw new Error('確認框應有移除');
    fireEvent.click(confirm);
    await waitFor(() => expect(removeStaff).toHaveBeenCalledWith({ cid: 'cup', uid: 'uid_a' }));
    expect(removeStaff.mock.calls[0]?.[0]).not.toHaveProperty('roles');
    await waitFor(() => expect(repo.calls().filter((name) => name === 'listStaff')).toHaveLength(2));
  });

  it('共同主辦看不到共同主辦列的移除鈕', async () => {
    const view = draw({
      actor: coHostActor,
      repo: staffRepo(),
      actions: idleActions(),
      route: { cid: 'cup' },
    }, <StaffPage />);
    expect(await screen.findByText('我自己')).toBeTruthy();
    const self = rowOf(view, '我自己');
    expect(self?.textContent ?? '').toContain('共同主辦');
    expect(removeIn(self)).toBeNull();
    const host = [...view.container.querySelectorAll('.s4b-li')].find((el) => (el.textContent ?? '').includes('主辦') && !(el.textContent ?? '').includes('共同'));
    expect(removeIn(host ?? null)).toBeNull();
    expect(removeIn(rowOf(view, '成員 3'))).not.toBeNull();
    expect(removeIn(rowOf(view, '裁判'))).not.toBeNull();
  });

  it('共同主辦加記分員有移除鈕，按下只拿記分角色', async () => {
    const rows = [
      { uid: 'uid_host', roles: ['host' as const], matchIds: ['mt_1'], expiresAt: null, memberNo: 1 },
      { uid: 'uid_co', roles: ['coHost' as const], matchIds: [] as string[], expiresAt: null, memberNo: 2 },
      { uid: 'uid_mix', roles: ['coHost' as const, 'scorer' as const], matchIds: ['mt_1'], expiresAt: null, memberNo: 5 },
      { uid: 'uid_ref', roles: ['referee' as const], matchIds: [] as string[], expiresAt: null },
    ];
    const removeStaff = vi.fn<CpActions['removeStaff']>(async () => ({}));
    const view = draw({
      actor: hostActor,
      repo: createFakeCpRepo({
        competitions: [competition({ id: 'cup' })],
        staff: STAFF_SEED,
        assignments: { cup: rows },
      }),
      actions: { ...idleActions(), removeStaff },
      route: { cid: 'cup' },
    }, <StaffPage />);
    expect(await screen.findByText('成員 5')).toBeTruthy();
    expect(removeIn(rowOf(view, '成員 2'))).toBeNull();
    const mix = rowOf(view, '成員 5');
    expect(mix?.textContent ?? '').toContain('共同主辦');
    const button = removeIn(mix);
    if (!button) throw new Error('共同主辦兼記分員應有移除鈕');
    fireEvent.click(button);
    expect(await screen.findByText('移除記分角色？')).toBeTruthy();
    expect(screen.getByText('這位成員會從記分員與裁判移除，不能再記分。')).toBeTruthy();
    const dialog = document.body.querySelector('[role="dialog"]');
    const confirm = [...(dialog?.querySelectorAll('button') ?? [])].find((el) => (el.textContent ?? '').trim() === '移除');
    if (!confirm) throw new Error('確認框應有移除');
    fireEvent.click(confirm);
    await waitFor(() => expect(removeStaff).toHaveBeenCalledWith({ cid: 'cup', uid: 'uid_mix' }));
    expect(removeStaff.mock.calls[0]?.[0]).not.toHaveProperty('roles');
    expect(removeIn(rowOf(view, '裁判'))).not.toBeNull();
  });

  it('共同主辦可移除自己的記分角色，不能移除其他共同主辦', async () => {
    const rows = [
      { uid: 'uid_host', roles: ['host' as const], matchIds: [] as string[], expiresAt: null, memberNo: 1 },
      { uid: 'uid_co', roles: ['coHost' as const, 'scorer' as const], matchIds: ['mt_1'], expiresAt: null, memberNo: 2 },
      { uid: 'uid_peer', roles: ['coHost' as const, 'referee' as const], matchIds: [] as string[], expiresAt: null, memberNo: 5 },
      { uid: 'uid_only', roles: ['coHost' as const], matchIds: [] as string[], expiresAt: null, memberNo: 6 },
      { uid: 'uid_ref', roles: ['referee' as const], matchIds: [] as string[], expiresAt: null },
    ];
    const view = draw({
      actor: coHostActor,
      repo: createFakeCpRepo({
        competitions: [competition({ id: 'cup' })],
        staff: STAFF_SEED,
        assignments: { cup: rows },
      }),
      actions: idleActions(),
      route: { cid: 'cup' },
    }, <StaffPage />);
    expect(await screen.findByText('我自己')).toBeTruthy();
    const self = rowOf(view, '我自己');
    expect(self?.textContent ?? '').toContain('共同主辦');
    expect(removeIn(self)).not.toBeNull();
    expect(removeIn(rowOf(view, '成員 5'))).toBeNull();
    expect(removeIn(rowOf(view, '成員 6'))).toBeNull();
    // 顧問 11-20 雙標籤後「成員 5」那列也顯示「裁判」，改用位置取最後一列（純裁判 uid_ref）。
    expect(rowOf(view, '成員 5')?.textContent ?? '').toContain('裁判');
    const all = [...view.container.querySelectorAll('.s4b-staff-list > .s4b-li')];
    expect(removeIn(all[all.length - 1] ?? null)).not.toBeNull();
  });

  it('移除記分員後成員 3 仍是 3，重新整理號碼不變', async () => {
    const rows = ASSIGNMENTS.cup.map((row) => ({
      ...row,
      roles: [...row.roles],
      matchIds: [...row.matchIds],
    }));
    const repo = createFakeCpRepo({
      competitions: [competition({ id: 'cup' })],
      staff: STAFF_SEED,
      assignments: { cup: rows },
      matches: {
        cup: [
          match('mt_1'),
          match('mt_2', { kickoffAt: taipeiMs(2027, 1, 10, 5, 0), venueName: '2號場' }),
        ],
      },
    });
    const removeStaff = vi.fn<CpActions['removeStaff']>(async ({ uid }) => {
      const index = rows.findIndex((row) => row.uid === uid);
      if (index >= 0) rows.splice(index, 1);
      return {};
    });
    const env = {
      actor: hostActor,
      repo,
      actions: { ...idleActions(), removeStaff },
      route: { cid: 'cup' },
    };
    const view = draw(env, <StaffPage />);
    expect(await screen.findByText('成員 3')).toBeTruthy();
    expect(staffNames(view)).toEqual(['我自己', '成員 2', '成員 3', '成員 4', '成員']);
    expect(removeIn(rowOf(view, '成員 2'))).toBeNull();
    const button = removeIn(rowOf(view, '成員 4'));
    if (!button) throw new Error('記分員應有移除鈕');
    fireEvent.click(button);
    const dialog = document.body.querySelector('[role="dialog"]');
    expect(dialog?.textContent ?? '').toContain('移除記分角色？');
    expect(staffNames(view)).toEqual(['我自己', '成員 2', '成員 3', '成員 4', '成員']);
    const confirm = [...(dialog?.querySelectorAll('button') ?? [])].find((el) => (el.textContent ?? '').trim() === '移除');
    if (!confirm) throw new Error('確認框應有移除');
    fireEvent.click(confirm);
    await waitFor(() => expect(removeStaff).toHaveBeenCalledWith({ cid: 'cup', uid: 'uid_b' }));
    await waitFor(() => expect(staffNames(view)).toEqual(['我自己', '成員 2', '成員 3', '成員']));
    view.unmount();
    const again = draw(env, <StaffPage />);
    expect(await screen.findByText('成員 3')).toBeTruthy();
    expect(staffNames(again)).toEqual(['我自己', '成員 2', '成員 3', '成員']);
    expect(again.container.textContent ?? '').not.toContain('成員 1');
    expect(again.container.textContent ?? '').not.toContain('成員 4');
  });

  it('管理員沒有 staff 文件仍可進清單', async () => {
    const repo = staffRepo();
    draw({
      actor: adminActor,
      repo,
      actions: idleActions(),
      route: { cid: 'cup' },
    }, <StaffPage />);
    expect(await screen.findByText('指派記分員')).toBeTruthy();
    expect(repo.calls()).toEqual(['getStaff', 'listStaff', 'listInvites']);
  });

  it('指派沿用既有場次、預勾已指派的場，送出單一角色', async () => {
    const repo = staffRepo();
    const assignStaff = vi.fn<CpActions['assignStaff']>(async () => ({}));
    const previous = `${window.location.pathname}${window.location.search}`;
    draw({
      actor: hostActor,
      repo,
      actions: { ...idleActions(), assignStaff },
      route: { cid: 'cup', uid: 'uid_a' },
    }, <StaffAssignPage />);
    const select = await screen.findByLabelText('人員') as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe('uid_a'));
    expect([...select.options].map((option) => option.label)).toEqual([
      '我自己',
      '成員 2',
      '成員 3',
      '成員 4',
      '成員',
    ]);
    await waitFor(() => {
      const box = screen.getByRole('checkbox', { name: /09:00/ }) as HTMLInputElement;
      expect(box.checked).toBe(true);
    });
    expect(repo.calls()).toEqual(['getStaff', 'listStaff', 'listMatches']);
    fireEvent.click(screen.getByRole('button', { name: '儲存' }));
    await waitFor(() => expect(assignStaff).toHaveBeenCalledWith({
      cid: 'cup',
      uid: 'uid_a',
      roles: ['scorer'],
      matchIds: ['mt_1'],
    }));
    expect(assignStaff.mock.calls[0]?.[0]).not.toHaveProperty('expiresAt');
    await waitFor(() => expect(window.location.pathname).toBe('/competitions/cup/staff'));
    window.history.pushState(null, '', previous || '/');
  });

  it('指派失敗把原因顯示在按鈕上方', async () => {
    const assignStaff = vi.fn(async () => {
      throw new CpCallError('STAFF_NOT_FOUND', {});
    });
    draw({
      actor: hostActor,
      repo: staffRepo(),
      actions: { ...idleActions(), assignStaff },
      route: { cid: 'cup' },
    }, <StaffAssignPage />);
    const save = await screen.findByRole('button', { name: '儲存' });
    fireEvent.click(save);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('找不到這位成員');
    expect(alert.className).toContain('s4b-err');
    expect(window.location.pathname).not.toBe('/competitions/cup/staff');
  });

  it('我的場次依比賽日分組，只有未開賽、進行中、中場、已結束 180 秒內有按鈕', async () => {
    const repo = createFakeCpRepo({
      competitions: [competition({ id: 'cup' })],
      assignments: {
        cup: [{
          uid: 'uid_member',
          roles: ['scorer'],
          matchIds: ['mt_live', 'mt_half', 'mt_old', 'mt_new', 'mt_cancel', 'mt_night', 'mt_miss'],
          expiresAt: null,
        }],
      },
      matches: {
        cup: [
          match('mt_live', { status: 'live', kickoffAt: taipeiMs(2027, 1, 9, 9, 0) }),
          match('mt_half', { status: 'halftime', kickoffAt: taipeiMs(2027, 1, 9, 10, 0) }),
          match('mt_old', { status: 'finished', finishedAt: NOW - 180_000, kickoffAt: taipeiMs(2027, 1, 9, 14, 0) }),
          match('mt_new', { status: 'finished', finishedAt: NOW - 179_000, kickoffAt: taipeiMs(2027, 1, 10, 5, 0) }),
          match('mt_cancel', { status: 'cancelled', kickoffAt: taipeiMs(2027, 1, 9, 16, 0) }),
          match('mt_night', { status: 'scheduled', kickoffAt: taipeiMs(2027, 1, 10, 0, 20) }),
        ],
      },
    });
    const previous = `${window.location.pathname}${window.location.search}`;
    const view = draw({
      actor: memberActor,
      repo,
      actions: idleActions(),
      now: NOW,
      route: { cid: 'cup' },
    }, <ScorerMatchesPage />);
    expect(await screen.findByRole('heading', { name: '我的場次' })).toBeTruthy();
    const text = view.container.textContent ?? '';
    expect(text).toContain('1/9（');
    expect(text).toContain('1/10（');
    // 新外觀卡 3-3：未開賽不放標籤（共同裁定第 12 條），取代原本「含『未開賽』」
    expect(text).not.toContain('未開賽');
    expect(text).toContain('進行中');
    expect(text).toContain('中場');
    expect(text).toContain('已結束');
    expect(text).toContain('已取消');
    expect(text).toContain('雷霆隊對海風隊');
    const enters = screen.getAllByRole('button', { name: '進入記分' });
    expect(enters).toHaveLength(4);
    expect(repo.calls()[0]).toBe('getStaffAssignment');
    expect(repo.calls().filter((name) => name === 'getMatch')).toHaveLength(7);
    expect(repo.calls()).not.toContain('getCompetition');
    // 板卡＝進行中那一場（亮燈），全頁只有它是實心主要鈕
    const boards = view.container.querySelectorAll('.s4b-mb');
    expect(boards).toHaveLength(1);
    expect(boards[0]?.textContent).toContain('進行中');
    expect(boards[0]?.querySelector('.d2-sb--lit')).toBeTruthy();
    expect(view.container.querySelectorAll('button.ui-button--primary')).toHaveLength(1);
    const liveRow = [...view.container.querySelectorAll('.s4b-m')].find((el) => (el.textContent ?? '').includes('進行中'));
    const enter = liveRow?.querySelector('button');
    if (!enter) throw new Error('進行中應有進入記分');
    fireEvent.click(enter);
    await waitFor(() => expect(window.location.pathname).toBe('/competitions/cup/matches/mt_live/score'));
    window.history.pushState(null, '', previous || '/');
  });

  it('新外觀卡 3-3：沒有進行中時板卡是最早一場未開賽（不亮燈）；全部結束時沒有板、沒有主要鈕', async () => {
    const draft = (ids: string[], matches: MatchDoc[]) => createFakeCpRepo({
      competitions: [competition({ id: 'cup' })],
      assignments: { cup: [{ uid: 'uid_member', roles: ['scorer'], matchIds: ids, expiresAt: null }] },
      matches: { cup: matches },
    });
    const pre = draft(['mt_b', 'mt_a', 'mt_done'], [
      match('mt_b', { status: 'scheduled', kickoffAt: taipeiMs(2027, 1, 9, 16, 0) }),
      match('mt_a', { status: 'scheduled', kickoffAt: taipeiMs(2027, 1, 9, 14, 0) }),
      match('mt_done', { status: 'confirmed', finishedAt: NOW - 3_600_000, kickoffAt: taipeiMs(2027, 1, 9, 9, 0) }),
    ]);
    const view = draw({ actor: memberActor, repo: pre, actions: idleActions(), now: NOW, route: { cid: 'cup' } }, <ScorerMatchesPage />);
    await screen.findByRole('heading', { name: '我的場次' });
    const boards = view.container.querySelectorAll('.s4b-mb');
    expect(boards).toHaveLength(1);
    expect(boards[0]?.querySelector('.d2-sb--lit')).toBeNull();
    expect(boards[0]?.textContent).toContain('14:00');
    expect(view.container.querySelectorAll('button.ui-button--primary')).toHaveLength(1);
    expect(view.container.textContent).not.toContain('未開賽');
    cleanup();

    const done = draft(['mt_x', 'mt_y'], [
      match('mt_x', { status: 'confirmed', finishedAt: NOW - 3_600_000, kickoffAt: taipeiMs(2027, 1, 9, 9, 0) }),
      match('mt_y', { status: 'cancelled', kickoffAt: taipeiMs(2027, 1, 9, 10, 0) }),
    ]);
    const after = draw({ actor: memberActor, repo: done, actions: idleActions(), now: NOW, route: { cid: 'cup' } }, <ScorerMatchesPage />);
    await screen.findByRole('heading', { name: '我的場次' });
    expect(after.container.querySelector('.s4b-mb')).toBeNull();
    expect(after.container.querySelector('button.ui-button--primary')).toBeNull();
    expect(after.container.querySelector('.d2-tag--cancelled')?.textContent).toContain('已取消');
  });

  it('沒有指派或未登入時我的場次是空狀態，未登入不讀', async () => {
    const empty = createFakeCpRepo({ competitions: [competition({ id: 'cup' })] });
    const view = draw({
      actor: memberActor,
      repo: empty,
      actions: idleActions(),
      route: { cid: 'cup' },
    }, <ScorerMatchesPage />);
    expect(await screen.findByText('目前沒有被指派的場次')).toBeTruthy();
    expect(empty.calls()).toEqual(['getStaffAssignment']);
    expect(view.container.querySelector('button.ui-button--primary')).toBeNull();
    cleanup();

    const guestRepo = createFakeCpRepo({ competitions: [competition({ id: 'cup' })] });
    draw({
      actor: { ...memberActor, uid: null } satisfies CpActor,
      repo: guestRepo,
      actions: idleActions(),
      route: { cid: 'cup' },
    }, <ScorerMatchesPage />);
    expect(await screen.findByText('目前沒有被指派的場次')).toBeTruthy();
    expect(guestRepo.calls()).toEqual([]);
  });

  it('詳情頁的我的場次只在有記分角色時出現，未登入不讀', async () => {
    const scorer = createFakeCpRepo({
      competitions: [competition({ id: 'cup' })],
      assignments: {
        cup: [{ uid: 'uid_member', roles: ['referee'], matchIds: ['mt_1'], expiresAt: null }],
      },
    });
    const previous = `${window.location.pathname}${window.location.search}`;
    const withRole = draw({
      actor: memberActor,
      repo: scorer,
      actions: idleActions(),
      now: taipeiMs(2026, 12, 1, 12, 0),
      route: { cid: 'cup' },
    }, <CompetitionDetailPage />);
    expect(await screen.findByRole('button', { name: '我的場次' })).toBeTruthy();
    // CP-DETAIL-SPEED d1：指派跟職員合併成一次讀，不再另打 getStaff／getStaffAssignment。
    expect(scorer.calls().filter((name) => name === 'getStaffWithAssignment')).toHaveLength(1);
    expect(scorer.calls()).not.toContain('getStaffAssignment');
    expect(scorer.calls()).not.toContain('getStaff');
    fireEvent.click(screen.getByRole('button', { name: '我的場次' }));
    expect(window.location.pathname).toBe('/competitions/cup/my-matches');
    window.history.pushState(null, '', previous || '/');
    cleanup();

    const hostOnly = createFakeCpRepo({
      competitions: [competition({ id: 'cup' })],
      staff: { cup: [{ uid: 'uid_member', roles: ['host'] }] },
    });
    const plain = draw({
      actor: memberActor,
      repo: hostOnly,
      actions: idleActions(),
      now: taipeiMs(2026, 12, 1, 12, 0),
      route: { cid: 'cup' },
    }, <CompetitionDetailPage />);
    expect(await screen.findByText('示範盃')).toBeTruthy();
    expect(hostOnly.calls()).toContain('getStaffWithAssignment');
    expect(hostOnly.calls()).not.toContain('getStaffAssignment');
    expect(plain.container.querySelector('button') && screen.queryByRole('button', { name: '我的場次' })).toBeNull();
    cleanup();

    const guest = createFakeCpRepo({ competitions: [competition({ id: 'cup' })] });
    draw({
      actor: { ...memberActor, uid: null },
      repo: guest,
      actions: idleActions(),
      now: taipeiMs(2026, 12, 1, 12, 0),
      route: { cid: 'cup' },
    }, <CompetitionDetailPage />);
    expect(await screen.findByText('示範盃')).toBeTruthy();
    expect(guest.calls()).not.toContain('getStaff');
    expect(guest.calls()).not.toContain('getStaffAssignment');
    expect(guest.calls()).not.toContain('getStaffWithAssignment');
    expect(screen.queryByRole('button', { name: '我的場次' })).toBeNull();
  });

  it('詳情頁登入才讀自己的 staff，重新渲染與切換分頁不重讀', async () => {
    const repo = createFakeCpRepo({
      // 換 cid 要讀得到賽事根才會合併讀指派（賽事不存在就不讀職員）。
      competitions: [competition({ id: 'cup' }), competition({ id: 'other' })],
      assignments: {
        cup: [{ uid: 'uid_member', roles: ['scorer'], matchIds: ['mt_1'], expiresAt: null, memberNo: 4 }],
      },
    });
    const base = {
      actor: memberActor,
      repo,
      actions: idleActions(),
      now: taipeiMs(2027, 1, 9, 12, 0),
      route: { cid: 'cup' as const },
    };
    const clock = 1_700_000_000_000;
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(clock);
    const view = draw(base, <CompetitionDetailPage />);
    try {
      expect(await screen.findByRole('tab', { name: '積分' })).toBeTruthy();
      // CP-DETAIL-SPEED d1：第一次跟職員合併讀；之後指派走頁內快取，回前景只重讀 getStaff。
      const assignment = () => repo.calls().filter((name) => name === 'getStaffWithAssignment' || name === 'getStaffAssignment');
      const staffOnly = () => repo.calls().filter((name) => name === 'getStaff');
      expect(assignment()).toHaveLength(1);
      expect(staffOnly()).toHaveLength(0);

      const again = (env: CpInjectedEnv) => {
        view.rerender(
          <LocationProvider>
            <CpEnvProvider value={env}>
              <CompetitionDetailPage />
            </CpEnvProvider>
          </LocationProvider>,
        );
      };
      again(base);
      again({ ...base, now: base.now });
      fireEvent.click(screen.getByRole('tab', { name: '積分' }));
      fireEvent.click(screen.getByRole('tab', { name: '賽程' }));
      expect(assignment()).toHaveLength(1);

      nowSpy.mockReturnValue(clock + FOREGROUND_RELOAD_MIN_MS);
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
      document.dispatchEvent(new Event('visibilitychange'));
      await waitFor(() => expect(repo.calls().filter((name) => name === 'getCompetition').length).toBeGreaterThan(1));
      await waitFor(() => expect(staffOnly()).toHaveLength(1));
      expect(assignment()).toHaveLength(1);

      again({ ...base, actor: { ...memberActor, uid: 'uid_other' } });
      await waitFor(() => expect(assignment()).toHaveLength(2));
      again({ ...base, route: { cid: 'other' } });
      await waitFor(() => expect(assignment()).toHaveLength(3));
      expect(repo.calls()).not.toContain('getStaffAssignment');
      expect(staffOnly()).toHaveLength(1);
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('詳情頁未登入不讀自己的 staff', async () => {
    const guest = createFakeCpRepo({ competitions: [competition({ id: 'cup' })] });
    draw({
      actor: { ...memberActor, uid: null },
      repo: guest,
      actions: idleActions(),
      now: taipeiMs(2027, 1, 9, 12, 0),
      route: { cid: 'cup' },
    }, <CompetitionDetailPage />);
    expect(await screen.findByText('示範盃')).toBeTruthy();
    expect(guest.calls().filter((name) => name === 'getStaffAssignment')).toHaveLength(0);
    expect(guest.calls().filter((name) => name === 'getStaffWithAssignment')).toHaveLength(0);
    expect(guest.calls().filter((name) => name === 'getStaff')).toHaveLength(0);
  });

  it('管理頁有指派記分員連結', async () => {
    const previous = `${window.location.pathname}${window.location.search}`;
    draw(screenEnv('host-pending'), <CompetitionManagePage />);
    const link = await screen.findByRole('button', { name: '指派記分員' });
    fireEvent.click(link);
    expect(window.location.pathname).toBe('/competitions/cup/staff');
    window.history.pushState(null, '', previous || '/');
  });
});
