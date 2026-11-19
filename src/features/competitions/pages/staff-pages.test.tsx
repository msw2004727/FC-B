import type { JSX } from 'preact';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { LocationProvider } from 'preact-iso';
import type { CpActions } from '../actions';
import { CpCallError } from '../data/cp-callables';
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
import CompetitionDetailPage from './CompetitionDetailPage';
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
    { uid: 'uid_host', roles: ['host' as const], matchIds: ['mt_1'], expiresAt: null },
    { uid: 'uid_co', roles: ['coHost' as const], matchIds: [] as string[], expiresAt: null },
    { uid: 'uid_a', roles: ['scorer' as const], matchIds: ['mt_1'], expiresAt: null },
    { uid: 'uid_b', roles: ['scorer' as const], matchIds: ['mt_1', 'mt_2'], expiresAt: null },
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
  return [...row.querySelectorAll('button')].find((button) => (button.textContent ?? '').trim() === '移除') ?? null;
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

    const rep = staffRepo();
    draw({
      actor: clubRepActor,
      repo: rep,
      actions: idleActions(),
      route: { cid: 'cup' },
    }, <StaffAssignPage />);
    expect(await screen.findByText('你沒有這場賽事的管理權限')).toBeTruthy();
    expect(rep.calls()).toEqual(['getStaff']);
    expect(rep.calls()).not.toContain('listStaff');
    expect(rep.calls()).not.toContain('listMatches');
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
    const self = rowOf(view, '我自己');
    expect(self?.textContent ?? '').toContain('主辦');
    expect(removeIn(self)).toBeNull();
    const co = [...view.container.querySelectorAll('.s4b-li')].find((el) => (el.textContent ?? '').includes('共同主辦'));
    expect(removeIn(co ?? null)).not.toBeNull();
    expect(view.container.textContent ?? '').toContain('成員 1');
    expect(view.container.textContent ?? '').toContain('成員 2');
    expect(view.container.textContent ?? '').toContain('2 場');
    const scorer = rowOf(view, '成員 1');
    const button = removeIn(scorer);
    if (!button) throw new Error('記分員應有移除鈕');
    fireEvent.click(button);
    expect(await screen.findByText('移除記分角色？')).toBeTruthy();
    expect(screen.getByText('這位成員將不能再記分。')).toBeTruthy();
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
    expect(removeIn(rowOf(view, '成員 1'))).not.toBeNull();
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
    expect(repo.calls()).toEqual(['getStaff', 'listStaff']);
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
    expect(text).toContain('未開賽');
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
    const liveRow = [...view.container.querySelectorAll('.s4b-m')].find((el) => (el.textContent ?? '').includes('進行中'));
    const enter = liveRow?.querySelector('button');
    if (!enter) throw new Error('進行中應有進入記分');
    fireEvent.click(enter);
    await waitFor(() => expect(window.location.pathname).toBe('/competitions/cup/matches/mt_live/score'));
    window.history.pushState(null, '', previous || '/');
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
    expect(scorer.calls()).toContain('getStaffAssignment');
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
    expect(hostOnly.calls()).toContain('getStaffAssignment');
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
    expect(screen.queryByRole('button', { name: '我的場次' })).toBeNull();
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
