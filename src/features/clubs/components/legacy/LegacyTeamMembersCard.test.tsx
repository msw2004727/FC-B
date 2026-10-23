import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from '@/ui/Toast';
import type { ClubViewer, TeamDoc, TeamRosterRow } from '../../data/types';
import { LegacyTeamMembersCard } from './LegacyTeamMembersCard';
import {
  changeMemberRole,
  saveMemberActivityNote,
  type RoleChangeResult,
} from './member-management-actions';

vi.mock('@/ui/Toast', () => ({
  toast: { show: vi.fn(), clear: vi.fn() },
}));

vi.mock('./member-management-actions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./member-management-actions')>();
  return {
    ...actual,
    changeMemberRole: vi.fn(),
    saveMemberActivityNote: vi.fn(),
  };
});

function makeViewer(uid: string): ClubViewer {
  return {
    uid,
    teamIds: new Set(['team-1']),
    hasPermission: () => false,
  };
}

const memberViewer = makeViewer('u1');
const managerViewer = makeViewer('manager');

function requiredElement<T extends Element>(element: T | null): T {
  if (!element) throw new Error('Expected element');
  return element;
}

function rowElement(container: Element, uid: string): HTMLElement {
  return requiredElement(
    container.querySelector<HTMLElement>(`[data-member-key="uid:${uid}"]`),
  );
}

function enterEditMode(): void {
  fireEvent.click(screen.getByRole('button', { name: '成員管理' }));
}

function dialogButton(pattern: RegExp): HTMLButtonElement {
  // ASSUMPTION: 未附對話框完整 DOM；操作真元件中可見的確認／儲存／取消按鈕。
  const button = Array.from(
    document.body.querySelectorAll<HTMLButtonElement>('button'),
  ).find((candidate) => pattern.test(candidate.textContent?.trim() ?? ''));
  if (!button) throw new Error(`Missing dialog button: ${pattern.source}`);
  return button;
}

function noteEditor(): HTMLTextAreaElement {
  return requiredElement(document.body.querySelector<HTMLTextAreaElement>('textarea'));
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

vi.mock('@/data/user-roles', () => ({
  getCachedUserLevel: () => 5,
}));

function makeRow(overrides: Partial<TeamRosterRow> & { uid: string }): TeamRosterRow {
  return {
    uid: overrides.uid,
    name: overrides.name ?? '王小明',
    isMember: overrides.isMember ?? true,
    roles: overrides.roles ?? [],
    // 測試同步更新
    // ASSUMPTION: 既有有 user 的列原本代表在隊使用者；補齊測試文件的成員資格。
    // 明確傳入的 teamIds／teamId 優先保留，讓離隊與 legacy 案例使用真實輸入。
    user: overrides.user
      ? {
          ...(
            overrides.user.teamIds === undefined && overrides.user.teamId === undefined
              ? { teamIds: ['team-1'] }
              : {}
          ),
          ...overrides.user,
        }
      : null,
    labelKey: overrides.labelKey ?? 'clubs.roster.member',
    isMissingName: overrides.isMissingName ?? false,
  };
}

describe('LegacyTeamMembersCard', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(saveMemberActivityNote).mockResolvedValue({ ok: true });
    vi.mocked(changeMemberRole).mockResolvedValue({
      ok: true,
      target: { key: 'coach', level: 1, direction: 'promote' },
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  const baseTeam: TeamDoc = {
    id: 'team-1',
    name: 'FC 測試',
    type: 'competitive',
    captainUid: 'manager',
  };

  it('輸出 A 的主要 DOM 結構、id、class 與成員總數', () => {
    const roster: TeamRosterRow[] = [
      makeRow({ uid: 'u1', name: '隊長甲', roles: ['clubs.role.captain'] }),
      makeRow({ uid: 'u2', name: '隊員乙' }),
    ];

    const { container } = render(
      <LegacyTeamMembersCard
        team={baseTeam}
        roster={roster}
        viewer={memberViewer}
        onTeamChanged={vi.fn()}
        onOpenProfile={vi.fn()}
      />,
    );

    const section = container.querySelector('section#team-members-section.td-member-management-panel');
    expect(section).not.toBeNull();
    expect(container.querySelector('.td-member-panel-pad')).not.toBeNull();
    expect(container.querySelector('#team-members-toggle.td-member-top')).not.toBeNull();
    expect(container.querySelector('.td-member-total')?.textContent).toBe('2 位成員');
    expect(
      container.querySelector(
        '.td-member-list-shell.td-member-list-shell-summary.td-member-filter-all',
      ),
    ).not.toBeNull();
    expect(container.querySelector('.td-member-list-label')?.textContent).toBe('成員資料');
    expect(container.querySelectorAll('.td-member-row')).toHaveLength(2);
  });

  it('篩選 chip 依 A 規則只在人數 > 0 時出現（全部必出現，學員不出現）並可切換篩選', () => {
    const roster: TeamRosterRow[] = [
      makeRow({ uid: 'u-cap', name: '球經A', roles: ['clubs.role.captain'] }),
      makeRow({ uid: 'u-coach', name: '教練B', roles: ['clubs.role.coach'] }),
      makeRow({ uid: 'u-mem', name: '一般C', roles: [] }),
    ];

    const { container } = render(
      <LegacyTeamMembersCard
        team={baseTeam}
        roster={roster}
        viewer={memberViewer}
        onTeamChanged={vi.fn()}
        onOpenProfile={vi.fn()}
      />,
    );

    const chips = Array.from(container.querySelectorAll('.td-member-filter-chip'));
    expect(chips.map((c) => c.textContent)).toEqual(['全部3', '球經1', '教練1']);

    const coachChip = chips[2]!;
    fireEvent.click(coachChip);

    expect(coachChip.classList.contains('active')).toBe(true);
    expect(coachChip.getAttribute('aria-selected')).toBe('true');
    expect(container.querySelector('.td-member-filter-coach')).not.toBeNull();

    const rows = container.querySelectorAll('.td-member-row');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.getAttribute('data-member-key')).toBe('uid:u-coach');
    expect(rows[0]?.getAttribute('data-member-filter')).toBe('coach');
  });

  it('名字使用 UserTag 膠囊，角色對應正確且點擊觸發 onOpenProfile(uid)', () => {
    const onOpenProfile = vi.fn();
    const roster: TeamRosterRow[] = [
      makeRow({ uid: 'u-leader', name: '領隊甲', roles: ['clubs.role.leader'] }),
    ];

    const { container } = render(
      <LegacyTeamMembersCard
        team={baseTeam}
        roster={roster}
        viewer={memberViewer}
        onTeamChanged={vi.fn()}
        onOpenProfile={onOpenProfile}
      />,
    );

    const wrap = container.querySelector('.td-member-line1 .td-member-name-cell .td-member-name-wrap');
    expect(wrap).not.toBeNull();

    const capsule = wrap?.querySelector('.user-capsule.uc-team-leader');
    expect(capsule).not.toBeNull();
    expect(capsule?.textContent).toContain('領隊甲');

    fireEvent.click(capsule!);
    expect(onOpenProfile).toHaveBeenCalledTimes(1);
    expect(onOpenProfile).toHaveBeenCalledWith('u-leader');
  });

  it('缺名時顯示「未設定暱稱」並加上 missing-name class', () => {
    const roster: TeamRosterRow[] = [
      makeRow({ uid: 'u-missing', name: '', isMissingName: true }),
    ];

    const { container } = render(
      <LegacyTeamMembersCard
        team={baseTeam}
        roster={roster}
        viewer={memberViewer}
        onTeamChanged={vi.fn()}
        onOpenProfile={vi.fn()}
      />,
    );

    const wrap = container.querySelector('.td-member-name-wrap.missing-name');
    expect(wrap).not.toBeNull();
    expect(wrap?.textContent).toContain('未設定暱稱');
  });

  it('讀取背號、位置、加入時間與備註；一般成員不可看，UID 經理可看備註與提示', () => {
    const roster: TeamRosterRow[] = [
      makeRow({
        uid: 'u1',
        name: '球員一號',
        user: {
          uid: 'u1',
          jerseyNumber: '10',
          position: 'FW',
          joinedAt: '2025/03/15',
          activityNotes: '常駐先發',
          matchNotes: '主力前鋒',
        },
      }),
    ];

    const { container, rerender } = render(
      <LegacyTeamMembersCard
        team={baseTeam}
        roster={roster}
        viewer={memberViewer}
        onTeamChanged={vi.fn()}
        onOpenProfile={vi.fn()}
      />,
    );

    expect(container.querySelector('.td-member-roster-no')?.textContent).toBe('#10');
    expect(container.querySelector('.td-member-roster-pos')?.textContent).toBe('FW');
    expect(container.querySelector('.td-member-joined')?.textContent).toBe('加入 2025/03/15');
    expect(container.querySelector('.td-member-list-note-hint')).toBeNull();
    expect(container.querySelector('.td-member-line3')).toBeNull();

    rerender(
      <LegacyTeamMembersCard
        team={baseTeam}
        roster={roster}
        viewer={managerViewer}
        onTeamChanged={vi.fn()}
        onOpenProfile={vi.fn()}
      />,
    );

    expect(container.querySelector('.td-member-list-note-hint')?.textContent).toBe(
      '備註僅職員可見',
    );
    const notes = Array.from(container.querySelectorAll('.td-member-line3 .td-member-note'));
    expect(notes).toHaveLength(2);
    expect(notes[0]?.textContent).toBe('活動常駐先發');
    expect(notes[1]?.textContent).toBe('賽事主力前鋒');
  });

  // 測試同步更新
  it('成員管理按鈕只對 UID 職員顯示，點擊進入編輯模式、再次點擊離開', () => {
    const roster: TeamRosterRow[] = [makeRow({ uid: 'u1', name: '成員' })];
    const { container, rerender } = render(
      <LegacyTeamMembersCard
        team={baseTeam}
        roster={roster}
        viewer={memberViewer}
        onTeamChanged={vi.fn()}
        onOpenProfile={vi.fn()}
      />,
    );

    expect(container.querySelector('.td-member-edit-btn')).toBeNull();

    rerender(
      <LegacyTeamMembersCard
        team={baseTeam}
        roster={roster}
        viewer={managerViewer}
        onTeamChanged={vi.fn()}
        onOpenProfile={vi.fn()}
      />,
    );

    const editBtn = requiredElement(
      container.querySelector<HTMLButtonElement>('button.td-member-edit-btn'),
    );
    expect(editBtn.getAttribute('aria-pressed')).toBe('false');
    expect(editBtn.querySelector('.td-member-edit-text')?.textContent).toBe('成員管理');

    fireEvent.click(editBtn);
    expect(editBtn.getAttribute('aria-pressed')).toBe('true');
    expect(editBtn.classList.contains('is-active')).toBe(true);
    expect(editBtn.querySelector('.td-member-edit-text')?.textContent).toBe('完成');
    expect(editBtn.querySelector('path')?.getAttribute('d')).toBe('M20 6 9 17l-5-5');
    expect(container.querySelector('.td-member-list-shell.is-editing')).not.toBeNull();

    fireEvent.click(editBtn);
    expect(editBtn.getAttribute('aria-pressed')).toBe('false');
    expect(editBtn.classList.contains('is-active')).toBe(false);
    expect(editBtn.querySelector('.td-member-edit-text')?.textContent).toBe('成員管理');
    expect(container.querySelector('.td-member-list-shell.is-editing')).toBeNull();
    expect(container.querySelector('.td-member-action-cell')).toBeNull();
    expect(toast.show).not.toHaveBeenCalled();
  });

  it('空名單時輸出 td-member-empty「無」', () => {
    const { container } = render(
      <LegacyTeamMembersCard
        team={baseTeam}
        roster={[]}
        viewer={memberViewer}
        onTeamChanged={vi.fn()}
        onOpenProfile={vi.fn()}
      />,
    );

    expect(container.querySelector('.td-member-total')?.textContent).toBe('0 位成員');
    const empty = container.querySelector('.td-member-empty');
    expect(empty).not.toBeNull();
    expect(empty?.textContent).toBe('無');
    expect(screen.getByText('無')).toBeTruthy();
  });

  const existingRecord = { notes: '目前活動備註', count: 8, custom: '保留' };
  const managementTeam: TeamDoc = {
    ...baseTeam,
    captain: '同名職員',
    leader: '同名職員',
    leaders: ['同名職員'],
    leaderUids: ['leader'],
    coachUids: ['coach'],
    creatorUid: 'creator',
    ownerUid: 'owner',
    memberActivityData: { member: existingRecord },
  };
  const managementRoster: TeamRosterRow[] = [
    makeRow({
      uid: 'manager',
      name: '球經甲',
      roles: ['clubs.role.captain'],
      user: { uid: 'manager' },
    }),
    makeRow({
      uid: 'leader',
      name: '領隊乙',
      roles: ['clubs.role.leader'],
      user: { uid: 'leader' },
    }),
    makeRow({
      uid: 'coach',
      name: '教練丙',
      roles: ['clubs.role.coach'],
      user: { uid: 'coach' },
    }),
    makeRow({ uid: 'member', name: '隊員丁', user: { uid: 'member' } }),
  ];

  function renderManagement(
    viewer: ClubViewer = managerViewer,
    team: TeamDoc = managementTeam,
    roster: readonly TeamRosterRow[] = managementRoster,
  ) {
    const onTeamChanged = vi.fn<() => void | Promise<void>>();
    const onOpenProfile = vi.fn();
    const result = render(
      <LegacyTeamMembersCard
        team={team}
        roster={roster}
        viewer={viewer}
        onTeamChanged={onTeamChanged}
        onOpenProfile={onOpenProfile}
      />,
    );
    return { ...result, onTeamChanged, onOpenProfile };
  }

  function openMemberNote(container: Element): void {
    enterEditMode();
    fireEvent.click(
      within(rowElement(container, 'member')).getByRole('button', { name: '編輯活動備註' }),
    );
  }

  function openMemberPromotion(container: Element): void {
    enterEditMode();
    fireEvent.click(
      within(rowElement(container, 'member')).getByRole('button', { name: '晉升為教練' }),
    );
  }

  // 測試同步更新：幹部掛名與 row.isMember 不可取代使用者文件的在隊資格。
  it('已離隊的掛名教練沒有升降鈕，但仍依備註權限顯示鉛筆', () => {
    const team: TeamDoc = { ...managementTeam, coachUids: ['coach'] };
    const roster = [
      makeRow({
        uid: 'coach',
        name: '教練丙',
        roles: ['clubs.role.coach'],
        isMember: true,
        user: { uid: 'coach', teamIds: [] },
      }),
    ];
    const { container } = renderManagement(managerViewer, team, roster);
    enterEditMode();

    const coach = rowElement(container, 'coach');
    expect(coach.querySelector('.td-member-role-action-cell')).toBeNull();
    expect(within(coach).queryByRole('button', { name: '晉升為領隊' })).toBeNull();
    expect(within(coach).queryByRole('button', { name: '降級為隊員' })).toBeNull();
    expect(within(coach).getByRole('button', { name: '編輯活動備註' })).toBeTruthy();
    expect(changeMemberRole).not.toHaveBeenCalled();
  });

  // 測試同步更新：確認時必須重讀最新 roster 的 user，不能沿用開框時的文件。
  it.each([
    { buttonName: '晉升為領隊', message: '此成員目前無法晉升' },
    { buttonName: '降級為隊員', message: '此成員目前無法降級' },
  ])('開啟 $buttonName 後目標離隊，確認時拒絕寫入', async ({ buttonName, message }) => {
    const team: TeamDoc = { ...managementTeam, coachUids: ['coach'] };
    const roster = [
      makeRow({
        uid: 'coach',
        name: '教練丙',
        roles: ['clubs.role.coach'],
        user: { uid: 'coach', teamIds: ['team-1'] },
      }),
    ];
    const { container, rerender, onTeamChanged, onOpenProfile } =
      renderManagement(managerViewer, team, roster);
    enterEditMode();
    fireEvent.click(
      within(rowElement(container, 'coach')).getByRole('button', { name: buttonName }),
    );
    expect(dialogButton(/確認/)).toBeTruthy();

    rerender(
      <LegacyTeamMembersCard
        team={team}
        roster={[
          makeRow({
            uid: 'coach',
            name: '教練丙',
            roles: ['clubs.role.coach'],
            isMember: true,
            user: { uid: 'coach', teamIds: ['other-team'] },
          }),
        ]}
        viewer={managerViewer}
        onTeamChanged={onTeamChanged}
        onOpenProfile={onOpenProfile}
      />,
    );
    fireEvent.click(dialogButton(/確認/));

    await waitFor(() => {
      expect(toast.show).toHaveBeenCalledWith({ message, tone: 'error' });
    });
    expect(changeMemberRole).not.toHaveBeenCalled();
    expect(onTeamChanged).not.toHaveBeenCalled();
    expect(rowElement(container, 'coach').querySelector('.td-member-role-action-cell'))
      .toBeNull();
  });

  // 測試同步更新：在隊成員維持成功路徑，且 action 接收最新列的原 user 物件。
  it('在隊成員確認晉升時將最新 roster 的 targetUser 傳給 action', async () => {
    const originalRow = makeRow({
      uid: 'member',
      name: '隊員丁',
      user: { uid: 'member', teamIds: ['team-1'] },
    });
    const { container, rerender, onTeamChanged, onOpenProfile } =
      renderManagement(managerViewer, managementTeam, [originalRow]);
    openMemberPromotion(container);

    const latestRow = makeRow({
      uid: 'member',
      name: '隊員丁',
      user: { uid: 'member', teamIds: ['team-1', 'other-team'] },
    });
    rerender(
      <LegacyTeamMembersCard
        team={managementTeam}
        roster={[latestRow]}
        viewer={managerViewer}
        onTeamChanged={onTeamChanged}
        onOpenProfile={onOpenProfile}
      />,
    );
    fireEvent.click(dialogButton(/確認/));

    await waitFor(() => expect(onTeamChanged).toHaveBeenCalledTimes(1));
    expect(changeMemberRole).toHaveBeenCalledExactlyOnceWith({
      team: managementTeam,
      viewer: managerViewer,
      targetUid: 'member',
      targetUser: latestRow.user,
      displayName: '隊員丁',
      direction: 'promote',
    });
    expect(vi.mocked(changeMemberRole).mock.calls[0]?.[0].targetUser)
      .toBe(latestRow.user);
    expect(toast.show).toHaveBeenCalledWith({
      message: '已晉升為教練',
      tone: 'success',
    });
  });

  it('經理編輯模式依隊員、教練、領隊、球經產出 A action DOM，完全沒有剔除鈕', () => {
    const { container } = renderManagement();
    enterEditMode();

    const member = rowElement(container, 'member');
    expect(within(member).getByRole('button', { name: '編輯活動備註' })).toBeTruthy();
    expect(within(member).getByRole('button', { name: '晉升為教練' }).title).toBe('晉升為教練');
    expect(member.querySelector('.demote')).toBeNull();

    const coach = rowElement(container, 'coach');
    expect(within(coach).getByRole('button', { name: '晉升為領隊' }).title).toBe('晉升為領隊');
    expect(within(coach).getByRole('button', { name: '降級為隊員' }).title).toBe('降級為隊員');

    const leader = rowElement(container, 'leader');
    expect(within(leader).getByRole('button', { name: '降級為教練' }).title).toBe('降級為教練');
    expect(leader.querySelector('.promote')).toBeNull();

    const manager = rowElement(container, 'manager');
    expect(manager.querySelector('.td-member-role-action-cell')).toBeNull();
    expect(within(manager).getByRole('button', { name: '編輯活動備註' })).toBeTruthy();

    const actions = requiredElement(member.querySelector<HTMLElement>('.td-member-action-cell'));
    expect(actions.className).toBe('td-member-action-cell td-mm-actions td-member-manage-actions');
    expect(actions.previousElementSibling?.className).toBe('td-member-row-main');
    expect(actions.children[0]?.className).toBe(
      'td-member-row-edit-btn td-mm-icon-btn td-member-note-edit-btn',
    );
    expect(actions.children[1]?.className).toBe('td-member-role-action-cell td-member-promote-cell');
    expect(member.querySelector('.promote')?.className).toBe(
      'td-member-role-action-btn promote td-mm-icon-btn',
    );
    expect(member.querySelector('.promote .td-mm-sr-only')).toBeNull();
    expect(
      Array.from(member.querySelectorAll('.promote path')).map((path) => path.getAttribute('d')),
    ).toEqual(['M12 19V5', 'M5 12l7-7 7 7']);
    expect(
      Array.from(leader.querySelectorAll('.demote path')).map((path) => path.getAttribute('d')),
    ).toEqual(['M12 5v14', 'M19 12l-7 7-7-7']);
    expect(container.querySelector('.td-member-role-empty')).toBeNull();
    expect(container.querySelector('.td-member-remove-btn')).toBeNull();
    expect(container.querySelector('[aria-label="剔除成員"]')).toBeNull();
    expect(container.querySelector('.td-member-course-edit-btn')).toBeNull();
    expect(container.querySelector('.td-member-match-edit-btn')).toBeNull();
  });

  it.each(['leader', 'coach'])('%s 可管理備註但沒有升降鈕', (uid) => {
    const { container } = renderManagement(makeViewer(uid));
    enterEditMode();
    expect(container.querySelectorAll('.td-member-note-edit-btn')).toHaveLength(4);
    expect(container.querySelector('.td-member-role-action-cell')).toBeNull();
  });

  it('非編輯模式沒有 action cell', () => {
    const { container } = renderManagement();
    expect(container.querySelector('.td-member-action-cell')).toBeNull();
    expect(container.querySelector('.td-member-list-shell.is-editing')).toBeNull();
  });

  it('沒有 user 文件的列不輸出空 action cell；非成員列只可編輯備註', () => {
    const roster = [
      makeRow({ uid: 'missing', user: null }),
      makeRow({ uid: 'staff-only', isMember: false, user: { uid: 'staff-only' } }),
    ];
    const { container } = renderManagement(managerViewer, managementTeam, roster);
    enterEditMode();
    expect(rowElement(container, 'missing').querySelector('.td-member-action-cell')).toBeNull();
    const staff = rowElement(container, 'staff-only');
    expect(staff.querySelector('.td-member-note-edit-btn')).not.toBeNull();
    expect(staff.querySelector('.td-member-role-action-cell')).toBeNull();
  });

  it('備註初始值來自 team，儲存傳原物件、成功關閉並刷新', async () => {
    const { container, onTeamChanged } = renderManagement();
    openMemberNote(container);
    expect(noteEditor().value).toBe('目前活動備註');
    fireEvent.input(noteEditor(), { target: { value: '新的活動備註' } });
    fireEvent.click(dialogButton(/儲存/));

    await waitFor(() => expect(onTeamChanged).toHaveBeenCalledTimes(1));
    expect(saveMemberActivityNote).toHaveBeenCalledExactlyOnceWith({
      team: managementTeam,
      viewer: managerViewer,
      memberKey: 'member',
      notes: '新的活動備註',
      existingRecord,
    });
    expect(vi.mocked(saveMemberActivityNote).mock.calls[0]?.[0].existingRecord).toBe(existingRecord);
    expect(toast.show).toHaveBeenCalledWith({ message: '活動備註已更新', tone: 'success' });
    expect(document.body.querySelector('textarea')).toBeNull();
  });

  it('沒有 team 活動備註時初始值為空，非物件 existingRecord 傳 null', async () => {
    const team: TeamDoc = { ...managementTeam, memberActivityData: { member: 'legacy' } };
    const roster = [
      makeRow({ uid: 'member', user: { uid: 'member', activityNotes: '不作為編輯初始值' } }),
    ];
    const { container } = renderManagement(managerViewer, team, roster);
    openMemberNote(container);
    expect(noteEditor().value).toBe('');
    fireEvent.click(dialogButton(/儲存/));
    await waitFor(() => expect(saveMemberActivityNote).toHaveBeenCalledTimes(1));
    expect(saveMemberActivityNote).toHaveBeenCalledWith({
      team,
      viewer: managerViewer,
      memberKey: 'member',
      notes: '',
      existingRecord: null,
    });
  });

  it.each([
    ['forbidden', '您沒有編輯隊員的權限'],
    ['invalid', '更新失敗，請稍後再試'],
  ] as const)('備註回傳 %s 保持對話框，解鎖後可重試', async (reason, message) => {
    vi.mocked(saveMemberActivityNote).mockResolvedValueOnce({ ok: false, reason });
    const { container, onTeamChanged } = renderManagement();
    openMemberNote(container);
    fireEvent.click(dialogButton(/儲存/));
    await waitFor(() => expect(toast.show).toHaveBeenCalledWith({ message, tone: 'error' }));
    expect(noteEditor().value).toBe('目前活動備註');
    expect(dialogButton(/儲存/).disabled).toBe(false);
    expect(onTeamChanged).not.toHaveBeenCalled();
    fireEvent.click(dialogButton(/儲存/));
    await waitFor(() => expect(onTeamChanged).toHaveBeenCalledTimes(1));
  });

  it('備註拋錯顯示失敗、保持對話框並解除鎖', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(saveMemberActivityNote).mockRejectedValueOnce(new Error('write failed'));
    const { container, onTeamChanged } = renderManagement();
    openMemberNote(container);
    fireEvent.click(dialogButton(/儲存/));
    await waitFor(() => expect(toast.show).toHaveBeenCalledWith({
      message: '更新失敗，請稍後再試',
      tone: 'error',
    }));
    expect(errorLog).toHaveBeenCalled();
    expect(noteEditor()).toBeTruthy();
    expect(dialogButton(/儲存/).disabled).toBe(false);
    expect(onTeamChanged).not.toHaveBeenCalled();
    fireEvent.click(dialogButton(/儲存/));
    await waitFor(() => expect(onTeamChanged).toHaveBeenCalledTimes(1));
  });

  // 測試同步更新：使用附件既有的 ./member-management-actions mock。
  it.each(['移除', '非成員', '無 user'] as const)(
    '開框後最新 roster 為%s時拒絕升級並關閉',
    async (state) => {
      const { container, rerender, onTeamChanged, onOpenProfile } = renderManagement();
      openMemberPromotion(container);

      const roster = state === '移除'
        ? managementRoster.filter((row) => row.uid !== 'member')
        : managementRoster.map((row) => row.uid !== 'member'
          ? row
          : {
              ...row,
              ...(state === '非成員' ? { isMember: false } : { user: null }),
            });

      rerender(
        <LegacyTeamMembersCard
          team={managementTeam}
          roster={roster}
          viewer={managerViewer}
          onTeamChanged={onTeamChanged}
          onOpenProfile={onOpenProfile}
        />,
      );
      expect(screen.getByText('晉升確認')).toBeTruthy();
      fireEvent.click(dialogButton(/確認/));

      await waitFor(() => {
        expect(toast.show).toHaveBeenCalledExactlyOnceWith({
          message: '找不到成員資料',
          tone: 'error',
        });
        expect(screen.queryByText('俱樂部成員層級調整')).toBeNull();
      });
      expect(changeMemberRole).not.toHaveBeenCalled();
      expect(onTeamChanged).not.toHaveBeenCalled();
    },
  );

  // 測試同步更新
  it('開框後成員已成為教練，不得把原確認改成晉升領隊', async () => {
    const { container, rerender, onTeamChanged, onOpenProfile } = renderManagement();
    openMemberPromotion(container);

    rerender(
      <LegacyTeamMembersCard
        team={{
          ...managementTeam,
          coachUids: ['coach', 'member'],
        }}
        roster={managementRoster}
        viewer={managerViewer}
        onTeamChanged={onTeamChanged}
        onOpenProfile={onOpenProfile}
      />,
    );
    fireEvent.click(dialogButton(/確認/));

    await waitFor(() => {
      expect(toast.show).toHaveBeenCalledExactlyOnceWith({
        message: '此成員層級已是最新狀態',
        tone: 'error',
      });
      expect(screen.queryByText('俱樂部成員層級調整')).toBeNull();
    });
    expect(changeMemberRole).not.toHaveBeenCalled();
    expect(onTeamChanged).not.toHaveBeenCalled();
  });

  // 測試同步更新
  it('開框後同 UID 經理變成領隊，確認時拒絕晉升', async () => {
    const { container, rerender, onTeamChanged, onOpenProfile } = renderManagement();
    openMemberPromotion(container);

    // ASSUMPTION: 失去經理權指同一帳號變為領隊；切換 UID 仍依既有契約立即關框。
    const managerUid = managerViewer.uid;
    expect(managerUid).not.toBeNull();
    if (managerUid === null) throw new Error('經理測試資料缺少 UID');
    const leaderViewer = makeViewer(managerUid);
    rerender(
      <LegacyTeamMembersCard
        team={{
          ...managementTeam,
          captainUid: 'replacement',
          leaderUids: ['leader', managerViewer.uid],
        }}
        roster={managementRoster}
        viewer={leaderViewer}
        onTeamChanged={onTeamChanged}
        onOpenProfile={onOpenProfile}
      />,
    );
    expect(screen.getByText('晉升確認')).toBeTruthy();
    fireEvent.click(dialogButton(/確認/));

    await waitFor(() => {
      expect(toast.show).toHaveBeenCalledExactlyOnceWith({
        message: '此成員目前無法晉升',
        tone: 'error',
      });
      expect(screen.queryByText('俱樂部成員層級調整')).toBeNull();
    });
    expect(changeMemberRole).not.toHaveBeenCalled();
    expect(onTeamChanged).not.toHaveBeenCalled();
  });

  // 測試同步更新
  it('開框後角色不變，寫入使用最新 roster 的顯示名稱', async () => {
    const { container, rerender, onTeamChanged, onOpenProfile } = renderManagement();
    openMemberPromotion(container);
    const roster = managementRoster.map((row) => row.uid === 'member'
      ? { ...row, name: '最新隊員名稱' }
      : row);

    rerender(
      <LegacyTeamMembersCard
        team={managementTeam}
        roster={roster}
        viewer={managerViewer}
        onTeamChanged={onTeamChanged}
        onOpenProfile={onOpenProfile}
      />,
    );
    fireEvent.click(dialogButton(/確認/));

    await waitFor(() => expect(onTeamChanged).toHaveBeenCalledTimes(1));
    expect(changeMemberRole).toHaveBeenCalledExactlyOnceWith({
      team: managementTeam,
      viewer: managerViewer,
      targetUid: 'member',
      // 測試同步更新
      targetUser: expect.objectContaining({ uid: 'member' }),
      displayName: '最新隊員名稱',
      direction: 'promote',
    });
    expect(screen.queryByText('俱樂部成員層級調整')).toBeNull();
  });

  // 測試同步更新：保留狀態不變時的成功回歸。
  it('升級確認使用真對話框，成功寫入、通知並刷新', async () => {
    const { container, onTeamChanged } = renderManagement();
    openMemberPromotion(container);
    expect(screen.getByText('俱樂部成員層級調整')).toBeTruthy();
    expect(screen.getByText('晉升確認')).toBeTruthy();
    fireEvent.click(dialogButton(/確認/));
    await waitFor(() => expect(onTeamChanged).toHaveBeenCalledTimes(1));
    expect(changeMemberRole).toHaveBeenCalledExactlyOnceWith({
      team: managementTeam,
      viewer: managerViewer,
      targetUid: 'member',
      // 測試同步更新
      targetUser: expect.objectContaining({ uid: 'member' }),
      displayName: '隊員丁',
      direction: 'promote',
    });
    expect(toast.show).toHaveBeenCalledWith({ message: '已晉升為教練', tone: 'success' });
    expect(screen.queryByText('俱樂部成員層級調整')).toBeNull();
  });

  it('取消升級不寫入、不刷新', () => {
    const { container, onTeamChanged } = renderManagement();
    openMemberPromotion(container);
    fireEvent.click(dialogButton(/取消/));
    expect(changeMemberRole).not.toHaveBeenCalled();
    expect(onTeamChanged).not.toHaveBeenCalled();
    expect(screen.queryByText('俱樂部成員層級調整')).toBeNull();
  });

  it.each([
    ['no-target', '此成員目前無法晉升'],
    ['forbidden', '只有俱樂部經理可調整成員層級'],
  ] as const)('升級回傳 %s 顯示指定文案並關閉', async (reason, message) => {
    vi.mocked(changeMemberRole).mockResolvedValueOnce({ ok: false, reason });
    const { container, onTeamChanged } = renderManagement();
    openMemberPromotion(container);
    fireEvent.click(dialogButton(/確認/));
    await waitFor(() => expect(toast.show).toHaveBeenCalledWith({ message, tone: 'error' }));
    expect(onTeamChanged).not.toHaveBeenCalled();
    expect(screen.queryByText('俱樂部成員層級調整')).toBeNull();
  });

  it('升級拋錯顯示指定文案並關閉、解除鎖', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(changeMemberRole).mockRejectedValueOnce(new Error('write failed'));
    const { container, onTeamChanged } = renderManagement();
    openMemberPromotion(container);
    fireEvent.click(dialogButton(/確認/));
    await waitFor(() => expect(toast.show).toHaveBeenCalledWith({
      message: '晉升失敗，請稍後再試',
      tone: 'error',
    }));
    expect(errorLog).toHaveBeenCalled();
    expect(onTeamChanged).not.toHaveBeenCalled();
    expect(screen.queryByText('俱樂部成員層級調整')).toBeNull();

    fireEvent.click(
      within(rowElement(container, 'member')).getByRole('button', { name: '晉升為教練' }),
    );
    fireEvent.click(dialogButton(/確認/));
    await waitFor(() => expect(onTeamChanged).toHaveBeenCalledTimes(1));
  });

  it('busy 期間確認按鈕 disabled，重複點擊不會重複寫入', async () => {
    const pending = deferred<RoleChangeResult>();
    vi.mocked(changeMemberRole).mockReturnValueOnce(pending.promise);
    const { container, onTeamChanged } = renderManagement();
    openMemberPromotion(container);
    const confirm = dialogButton(/確認/);
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    expect(confirm.disabled).toBe(true);
    expect(changeMemberRole).toHaveBeenCalledTimes(1);
    fireEvent.click(confirm);
    expect(changeMemberRole).toHaveBeenCalledTimes(1);
    pending.resolve({
      ok: true,
      target: { key: 'coach', level: 1, direction: 'promote' },
    });
    await waitFor(() => expect(onTeamChanged).toHaveBeenCalledTimes(1));
  });

  it('降級傳 direction，成功訊息使用回傳 target', async () => {
    vi.mocked(changeMemberRole).mockResolvedValueOnce({
      ok: true,
      target: { key: 'member', level: 0, direction: 'demote' },
    });
    const { container, onTeamChanged } = renderManagement();
    enterEditMode();
    fireEvent.click(
      within(rowElement(container, 'coach')).getByRole('button', { name: '降級為隊員' }),
    );
    fireEvent.click(dialogButton(/確認/));
    await waitFor(() => expect(onTeamChanged).toHaveBeenCalledTimes(1));
    expect(changeMemberRole).toHaveBeenCalledWith({
      team: managementTeam,
      viewer: managerViewer,
      targetUid: 'coach',
      // 測試同步更新
      targetUser: expect.objectContaining({ uid: 'coach' }),
      displayName: '教練丙',
      direction: 'demote',
    });
    expect(toast.show).toHaveBeenCalledWith({ message: '已降級為隊員', tone: 'success' });
  });

  it.each(['manager', 'leader', 'coach', 'creator', 'owner'])(
    'UID 身分 %s 可看備註與提示',
    (uid) => {
      const { container } = renderManagement(makeViewer(uid));
      expect(container.querySelector('.td-member-list-note-hint')?.textContent).toBe(
        '備註僅職員可見',
      );
      expect(rowElement(container, 'member').querySelector('.td-member-line3')?.textContent).toBe(
        '活動目前活動備註',
      );
    },
  );

  it.each(['member', 'different-uid'])('一般成員或同名但不同 UID 的 %s 不可看備註', (uid) => {
    const viewer: ClubViewer & { displayName: string } = {
      ...makeViewer(uid),
      displayName: '同名職員',
    };
    const { container } = renderManagement(viewer);
    expect(container.querySelector('.td-member-list-note-hint')).toBeNull();
    expect(container.querySelector('.td-member-line3')).toBeNull();
    expect(container.querySelector('.td-member-edit-btn')).toBeNull();
  });

  it('同 UID 失去管理權後立即移除有效編輯狀態與對話框', () => {
    const { container, rerender, onTeamChanged, onOpenProfile } = renderManagement();
    openMemberNote(container);
    rerender(
      <LegacyTeamMembersCard
        team={{ ...managementTeam, captainUid: 'replacement' }}
        roster={managementRoster}
        viewer={managerViewer}
        onTeamChanged={onTeamChanged}
        onOpenProfile={onOpenProfile}
      />,
    );
    expect(container.querySelector('.td-member-list-shell.is-editing')).toBeNull();
    expect(container.querySelector('.td-member-action-cell')).toBeNull();
    expect(document.body.querySelector('textarea')).toBeNull();
  });

  it('viewer.uid 改變即關閉對話框；前一身分的非同步結果不通知或刷新', async () => {
    const pending = deferred<RoleChangeResult>();
    vi.mocked(changeMemberRole).mockReturnValueOnce(pending.promise);
    const { container, rerender, onTeamChanged, onOpenProfile } = renderManagement();
    openMemberPromotion(container);
    fireEvent.click(dialogButton(/確認/));
    rerender(
      <LegacyTeamMembersCard
        team={managementTeam}
        roster={managementRoster}
        viewer={makeViewer('coach')}
        onTeamChanged={onTeamChanged}
        onOpenProfile={onOpenProfile}
      />,
    );
    expect(screen.queryByText('俱樂部成員層級調整')).toBeNull();
    pending.resolve({
      ok: true,
      target: { key: 'coach', level: 1, direction: 'promote' },
    });
    await pending.promise;
    expect(onTeamChanged).not.toHaveBeenCalled();
    expect(toast.show).not.toHaveBeenCalled();
  });

  it('卸載後忽略尚未完成的寫入結果', async () => {
    const pending = deferred<RoleChangeResult>();
    vi.mocked(changeMemberRole).mockReturnValueOnce(pending.promise);
    const { container, unmount, onTeamChanged } = renderManagement();
    openMemberPromotion(container);
    fireEvent.click(dialogButton(/確認/));
    unmount();
    pending.resolve({
      ok: true,
      target: { key: 'coach', level: 1, direction: 'promote' },
    });
    await pending.promise;
    expect(onTeamChanged).not.toHaveBeenCalled();
    expect(toast.show).not.toHaveBeenCalled();
  });

  it('刷新拋錯不把已成功的備註寫入改判為失敗', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { container, onTeamChanged } = renderManagement();
    onTeamChanged.mockRejectedValueOnce(new Error('refresh failed'));
    openMemberNote(container);
    fireEvent.click(dialogButton(/儲存/));
    await waitFor(() => expect(errorLog).toHaveBeenCalled());
    expect(toast.show).toHaveBeenCalledExactlyOnceWith({
      message: '活動備註已更新',
      tone: 'success',
    });
    expect(document.body.querySelector('textarea')).toBeNull();
  });

  it('刷新拋錯不把已成功的升級改判為失敗', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { container, onTeamChanged } = renderManagement();
    onTeamChanged.mockRejectedValueOnce(new Error('refresh failed'));
    openMemberPromotion(container);
    fireEvent.click(dialogButton(/確認/));
    await waitFor(() => expect(errorLog).toHaveBeenCalled());
    expect(toast.show).toHaveBeenCalledExactlyOnceWith({
      message: '已晉升為教練',
      tone: 'success',
    });
    expect(screen.queryByText('俱樂部成員層級調整')).toBeNull();
  });
});
