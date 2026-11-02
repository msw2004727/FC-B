// K4 剔除一般隊員、K6 背號／位置編輯：成員卡互動。
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { appConfirm } from '@/ui/AppConfirm';
import { toast } from '@/ui/Toast';
import type { ClubViewer, TeamDoc, TeamRosterRow } from '../../data/types';
import { LegacyTeamMembersCard } from './LegacyTeamMembersCard';
import { kickTeamMember, saveMemberMatchData } from './member-management-actions';

vi.mock('@/ui/Toast', () => ({ toast: { show: vi.fn(), clear: vi.fn() } }));
vi.mock('@/ui/AppConfirm', () => ({ appConfirm: vi.fn() }));
vi.mock('@/data/user-roles', () => ({ getCachedUserLevel: () => 5 }));
vi.mock('./member-management-actions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./member-management-actions')>();
  return { ...actual, kickTeamMember: vi.fn(), saveMemberMatchData: vi.fn() };
});

const team: TeamDoc = {
  id: 'team-1',
  name: 'FC 測試',
  captainUid: 'manager',
  leaderUids: ['leader'],
  coachUids: ['coach'],
  memberMatchData: { member: { jerseyNumber: '7', position: 'MF', notes: '左腳' } },
};

function row(uid: string, name: string): TeamRosterRow {
  return {
    uid,
    name,
    isMember: true,
    roles: [],
    user: { uid, teamIds: ['team-1'] },
    labelKey: 'clubs.roster.member',
    isMissingName: false,
  };
}

const roster = [row('manager', '球經甲'), row('leader', '領隊乙'), row('coach', '教練丙'), row('member', '隊員丁')];

function viewer(uid: string): ClubViewer {
  return { uid, teamIds: new Set(['team-1']), hasPermission: () => false };
}

function renderCard(v: ClubViewer = viewer('manager')) {
  const onTeamChanged = vi.fn(async () => {});
  const onMemberRemoved = vi.fn();
  const utils = render(
    <LegacyTeamMembersCard
      team={team}
      roster={roster}
      viewer={v}
      onTeamChanged={onTeamChanged}
      onOpenProfile={vi.fn()}
      onMemberRemoved={onMemberRemoved}
    />,
  );
  fireEvent.click(within(utils.container).getByRole('button', { name: '成員管理' }));
  return { ...utils, onTeamChanged, onMemberRemoved };
}

function rowEl(container: Element, uid: string): HTMLElement {
  const el = container.querySelector<HTMLElement>(`[data-member-key="uid:${uid}"]`);
  if (!el) throw new Error(`missing row ${uid}`);
  return el;
}

beforeEach(() => {
  vi.mocked(appConfirm).mockResolvedValue(true);
  vi.mocked(kickTeamMember).mockResolvedValue({ ok: true, alreadyRemoved: false });
  vi.mocked(saveMemberMatchData).mockResolvedValue({ ok: true });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('K4 剔除一般隊員', () => {
  it.each(['manager', 'leader', 'coach'])('%s 管理時，剔除鈕只在一般隊員列', (uid) => {
    const { container } = renderCard(viewer(uid));
    expect(container.querySelectorAll('.td-member-remove-btn')).toHaveLength(1);
    expect(rowEl(container, 'member').querySelector('.td-member-remove-btn')).not.toBeNull();
  });

  it('一般隊員看不到成員管理，也沒有剔除鈕', () => {
    const { container } = render(
      <LegacyTeamMembersCard
        team={team}
        roster={roster}
        viewer={viewer('member')}
        onTeamChanged={vi.fn()}
        onOpenProfile={vi.fn()}
      />,
    );
    expect(container.querySelector('.td-member-edit-btn')).toBeNull();
    expect(container.querySelector('.td-member-remove-btn')).toBeNull();
  });

  it('確認框照 A 文案；確認後呼叫 Callable、就地移除並重讀俱樂部', async () => {
    const { container, onTeamChanged, onMemberRemoved } = renderCard();
    fireEvent.click(within(rowEl(container, 'member')).getByRole('button', { name: '剔除成員' }));
    await waitFor(() => expect(onMemberRemoved).toHaveBeenCalledWith('member'));
    expect(appConfirm).toHaveBeenCalledWith('確定要剔除「隊員丁」？');
    expect(kickTeamMember).toHaveBeenCalledWith(expect.objectContaining({ targetUid: 'member' }));
    expect(onTeamChanged).toHaveBeenCalledTimes(1);
    expect(toast.show).toHaveBeenCalledWith({ message: '已移除隊員「隊員丁」', tone: 'success' });
  });

  it('取消確認框不呼叫 Callable', async () => {
    vi.mocked(appConfirm).mockResolvedValue(false);
    const { container, onMemberRemoved } = renderCard();
    fireEvent.click(within(rowEl(container, 'member')).getByRole('button', { name: '剔除成員' }));
    await waitFor(() => expect(appConfirm).toHaveBeenCalled());
    await Promise.resolve();
    expect(kickTeamMember).not.toHaveBeenCalled();
    expect(onMemberRemoved).not.toHaveBeenCalled();
  });

  it('伺服器回 TARGET_IS_STAFF 時提示「僅可移除一般隊員」，不移除列', async () => {
    vi.mocked(kickTeamMember).mockRejectedValue(Object.assign(new Error('TARGET_IS_STAFF'), { code: 'failed-precondition' }));
    const { container, onMemberRemoved } = renderCard();
    fireEvent.click(within(rowEl(container, 'member')).getByRole('button', { name: '剔除成員' }));
    await waitFor(() => expect(toast.show).toHaveBeenCalledWith({ message: '僅可移除一般隊員', tone: 'error' }));
    expect(onMemberRemoved).not.toHaveBeenCalled();
  });
});

describe('K6 背號／位置編輯', () => {
  it('編輯框帶入現值，儲存後寫入並刷新', async () => {
    const { container, onTeamChanged } = renderCard();
    fireEvent.click(within(rowEl(container, 'member')).getByRole('button', { name: '編輯賽事資料' }));
    const jersey = document.getElementById('td-member-match-jersey') as HTMLInputElement;
    const position = document.getElementById('td-member-match-position') as HTMLInputElement;
    expect(document.getElementById('team-member-match-title')?.textContent).toBe('編輯賽事數據');
    expect(jersey.value).toBe('7');
    expect(position.value).toBe('MF');
    fireEvent.input(jersey, { target: { value: '10' } });
    fireEvent.input(position, { target: { value: 'ST' } });
    const save = Array.from(document.body.querySelectorAll('button')).find((b) => b.textContent === '儲存')!;
    fireEvent.click(save);
    await waitFor(() => expect(onTeamChanged).toHaveBeenCalled());
    expect(saveMemberMatchData).toHaveBeenCalledWith(expect.objectContaining({
      memberKey: 'member',
      jerseyNumber: '10',
      position: 'ST',
      notes: '左腳',
    }));
    expect(toast.show).toHaveBeenCalledWith({ message: '賽事數據已更新', tone: 'success' });
  });
});
