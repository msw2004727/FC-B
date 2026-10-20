import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getToasts, toast } from '@/ui/Toast';
import type { TeamDoc, TeamRosterRow } from '../../data/types';
import { LegacyTeamMembersCard } from './LegacyTeamMembersCard';

vi.mock('@/data/user-roles', () => ({
  getCachedUserLevel: () => 5,
}));

function makeRow(overrides: Partial<TeamRosterRow> & { uid: string }): TeamRosterRow {
  return {
    uid: overrides.uid,
    name: overrides.name ?? '王小明',
    isMember: overrides.isMember ?? true,
    roles: overrides.roles ?? [],
    user: overrides.user ?? null,
    labelKey: overrides.labelKey ?? 'clubs.roster.member',
    isMissingName: overrides.isMissingName ?? false,
  };
}

describe('LegacyTeamMembersCard', () => {
  afterEach(() => {
    cleanup();
    toast.clear();
  });

  const baseTeam: TeamDoc = {
    id: 'team-1',
    name: 'FC 測試',
    type: 'competitive',
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
        canManageMembers={false}
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
        canManageMembers={false}
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
        canManageMembers={false}
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
        canManageMembers={false}
        onOpenProfile={vi.fn()}
      />,
    );

    const wrap = container.querySelector('.td-member-name-wrap.missing-name');
    expect(wrap).not.toBeNull();
    expect(wrap?.textContent).toContain('未設定暱稱');
  });

  it('讀取背號、位置、加入時間與備註；備註與提示只在 canManageMembers 為真時顯示', () => {
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
        canManageMembers={false}
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
        canManageMembers={true}
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

  it('成員管理按鈕只在 canManageMembers 為真時顯示，點擊顯示尚未開放 toast', () => {
    const roster: TeamRosterRow[] = [makeRow({ uid: 'u1', name: '成員' })];

    const { container, rerender } = render(
      <LegacyTeamMembersCard
        team={baseTeam}
        roster={roster}
        canManageMembers={false}
        onOpenProfile={vi.fn()}
      />,
    );

    expect(container.querySelector('.td-member-edit-btn')).toBeNull();

    rerender(
      <LegacyTeamMembersCard
        team={baseTeam}
        roster={roster}
        canManageMembers={true}
        onOpenProfile={vi.fn()}
      />,
    );

    const editBtn = container.querySelector<HTMLButtonElement>('button.td-member-edit-btn');
    expect(editBtn).not.toBeNull();
    expect(editBtn?.getAttribute('aria-pressed')).toBe('false');
    expect(editBtn?.querySelector('.td-member-edit-text')?.textContent).toBe('成員管理');

    fireEvent.click(editBtn!);
    const currentToasts = getToasts();
    expect(currentToasts).toHaveLength(1);
    expect(currentToasts[0]?.message).toBe('此功能尚未開放，請先使用舊版');
  });

  it('空名單時輸出 td-member-empty「無」', () => {
    const { container } = render(
      <LegacyTeamMembersCard
        team={baseTeam}
        roster={[]}
        canManageMembers={false}
        onOpenProfile={vi.fn()}
      />,
    );

    expect(container.querySelector('.td-member-total')?.textContent).toBe('0 位成員');
    const empty = container.querySelector('.td-member-empty');
    expect(empty).not.toBeNull();
    expect(empty?.textContent).toBe('無');
    expect(screen.getByText('無')).toBeTruthy();
  });
});
