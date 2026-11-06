import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/preact';
import { setLocale } from '@/i18n/i18n';
import { AttendanceRosterTable, type AttendanceRosterTableProps } from './AttendanceRosterTable';
import { buildNoShowCountByUid, buildEndedRegCountByUid } from '../data/noshow-roster';

const feature = vi.hoisted(() => ({ enabled: true }));
vi.mock('../data/noshow-roster', async (original) => ({
  ...(await original<typeof import('../data/noshow-roster')>()),
  get NO_SHOW_FEATURE_ENABLED() { return feature.enabled; },
}));

vi.mock('@/data/roster-status-deployed', () => ({ ROSTER_STATUS_CALLABLES_DEPLOYED: true }));

beforeAll(() => setLocale('zh-TW'));
afterEach(() => { cleanup(); feature.enabled = true; });

const stats = {
  u1: { noShowCount: 2, endedRegCount: 3, lastEventWasNoShow: true },
  u2: { noShowCount: 1, endedRegCount: 10, lastEventWasNoShow: true },
};
const data = {
  counts: buildNoShowCountByUid(stats, new Map([['u1', -1], ['u2', -3]])),
  endedCounts: buildEndedRegCountByUid(stats),
};
const base: AttendanceRosterTableProps = {
  event: { id: 'e1', max: 12 },
  registrations: [
    { _docId: 'r1', userId: 'u1', userName: '甲', status: 'confirmed', participantType: 'self' },
    { _docId: 'r2', userId: 'u2', userName: '乙', status: 'confirmed', participantType: 'self' },
  ],
  attendanceRecords: [], roles: {}, onOpenProfile: () => {},
  canManage: true, canViewNoShow: true, editing: true, noShowData: data,
};
// 測試同步更新（站長 11-06 放鴿子／出席率 v2）：一般瀏覽不再染色／紅泡泡，🕊 欄改顯示「放鴿子/計入」。
const title = '放鴿子／計入場次';
const NO_DECORATION = '.uc-att-warn, .uc-recent-noshow';
function cellFor(name: string): HTMLTableCellElement {
  const row = screen.getByText(name).closest('tr')!;
  const index = Array.from(document.querySelectorAll('thead th')).findIndex(th => th.textContent === '🕊');
  return row.cells[index]!;
}

describe('T-073b 名單放鴿子 UI（A oracle）', () => {
  it('編輯模式名字後、簽到前放 🕊 欄；2-1 計入 3 顯示 1/3、1-3 歸零計入 10 顯示 0/10，皆未達標紅門檻', () => {
    render(<AttendanceRosterTable {...base} />);
    const headers = Array.from(document.querySelectorAll('th'));
    const index = headers.findIndex(th => th.textContent === '🕊');
    expect(headers[index - 1]?.textContent).toContain('報名名單');
    expect(headers[index + 1]?.textContent).toBe('簽到');
    expect(headers[index]?.title).toBe(title);
    expect(headers[index]?.style.width).toBe('3rem');
    expect(cellFor('甲').textContent).toBe('1/3');
    expect(cellFor('甲').querySelector('span')?.style.fontWeight).toBe('600');
    expect(cellFor('甲').querySelector('span')?.style.color).toBe('var(--text-muted)');
    expect(cellFor('乙').textContent).toBe('0/10');
    expect(cellFor('乙').querySelector('span')?.style.color).toBe('var(--text-muted)');
    // 一般瀏覽與管理名單都不再出現名字染色或紅色 🕊 泡泡。
    expect(document.querySelector(NO_DECORATION)).toBeNull();
  });

  it('管理名單（編輯模式）的 table 帶 att-roster-managing，一般瀏覽沒有', () => {
    const view = render(<AttendanceRosterTable {...base} />);
    expect(document.querySelector('table')?.classList.contains('att-roster-managing')).toBe(true);
    view.rerender(<AttendanceRosterTable {...base} editing={false} />);
    expect(document.querySelector('table')?.classList.contains('att-roster-managing')).toBe(false);
  });

  it.each([
    { canManage: true, editing: false },
    { canManage: false, editing: true },
  ])('非編輯或非管理者無 🕊 欄，也不染色／不出現泡泡（即使有查看權與資料）：%j', props => {
    render(<AttendanceRosterTable {...base} {...props} />);
    expect(screen.queryByRole('columnheader', { name: '🕊' })).toBeNull();
    expect(document.querySelector(NO_DECORATION)).toBeNull();
    expect(document.querySelector('[title^="放鴿子"]')).toBeNull();
  });

  it.each([{ canViewNoShow: false }, { publicRosterOnly: true }])('守門即使收到資料仍不顯示：%j', props => {
    render(<AttendanceRosterTable {...base} {...props} />);
    expect(screen.queryByRole('columnheader', { name: '🕊' })).toBeNull();
    expect(document.querySelector(NO_DECORATION)).toBeNull();
    expect(document.querySelector('[title^="放鴿子"]')).toBeNull();
  });

  it('旗標關閉不顯示欄', () => {
    feature.enabled = false;
    render(<AttendanceRosterTable {...base} />);
    expect(screen.queryByRole('columnheader', { name: '🕊' })).toBeNull();
    expect(document.querySelector(NO_DECORATION)).toBeNull();
  });

  it('補正未完成／失敗傳 null：欄位空白，沒有 raw 次數或錯誤', () => {
    const view = render(<AttendanceRosterTable {...base} />);
    expect(cellFor('甲').textContent).toBe('1/3');
    view.rerender(<AttendanceRosterTable {...base} noShowData={null} />);
    expect(screen.getByRole('columnheader', { name: '🕊' })).toBeTruthy();
    expect(cellFor('甲').textContent).toBe('');
    expect(cellFor('乙').textContent).toBe('');
    expect(document.querySelector(NO_DECORATION)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it.each([
    [2, 2, '2/2', false],
    [2, 1, '1/2', false],
    [3, 1, '1/3', false],
    [3, 2, '2/3', true],
    [10, 4, '4/10', false],
    [10, 5, '5/10', true],
    [4, 2, '2/4', true],
    [3, 3, '3/3', true],
    [10, 0, '0/10', false],
    [0, 2, '2', false],
    [0, 0, '', false],
  ])('管理名單 🕊：計入 %i 場放鴿子 %i 次 → %s，標紅=%s（計入 ≥3 且比例 ≥50%）', (counted, count, text, red) => {
    render(<AttendanceRosterTable {...base} noShowData={{
      counts: new Map([['u1', count as number]]),
      endedCounts: new Map(counted ? [['u1', counted as number]] : []),
    }} />);
    const span = cellFor('甲').querySelector('span')!;
    expect(cellFor('甲').textContent).toBe(text);
    expect(span.style.color).toBe(red ? 'var(--danger)' : 'var(--text-muted)');
    expect(span.style.fontWeight).toBe(red ? '700' : '600');
    expect(document.querySelector(NO_DECORATION)).toBeNull();
  });

  it.each([
    { canRemoveConfirmed: false, demote: false },
    { canRemoveConfirmed: true, demote: false },
    { canRemoveConfirmed: false, demote: true },
    { canRemoveConfirmed: true, demote: true },
  ])('同行者 —、僅代報／保留席位 --，🕊 與操作欄 colspan 對齊：%j', ({ canRemoveConfirmed, demote }) => {
    render(<AttendanceRosterTable {...base} canRemoveConfirmed={canRemoveConfirmed}
      rosterContext={demote ? {
        uid: 'manager', role: 'admin', rolePermissions: ['event.edit_all'],
        userGrants: null, capabilities: [], customRoles: [],
      } : undefined}
      event={{ ...base.event, teamReservationSummaries: [
        { teamId: 't1', teamName: '測試隊', reservedSlots: 2, usedSlots: 1, remainingSlots: 1 },
      ] }}
      registrations={[
        { ...base.registrations[0], teamReservationTeamId: 't1', teamReservationTeamName: '測試隊' },
        { _docId: 'comp', userId: 'proxy', userName: '代報人', companionId: 'c1', companionName: '同行者', participantType: 'companion', status: 'confirmed' },
      ]}
    />);
    expect(cellFor('↳ 同行者').textContent).toBe('—');
    expect(cellFor('代報人').textContent).toBe('--');
    expect(cellFor('測試隊 保留席位').textContent).toBe('--');
    for (const name of ['↳ 同行者', '代報人', '測試隊 保留席位']) {
      expect(screen.getByText(name).closest('tr')?.querySelector(NO_DECORATION)).toBeNull();
    }
    expect(!!screen.queryByRole('columnheader', { name: '踢' })).toBe(canRemoveConfirmed);
    expect(!!screen.queryByRole('columnheader', { name: '候' })).toBe(demote);
    expect(screen.getByRole('columnheader', { name: '🕊' })).toBeTruthy();
    const columns = document.querySelectorAll('thead th').length;
    expect(columns).toBe(5 + Number(canRemoveConfirmed) + Number(demote));
    for (const row of document.querySelectorAll<HTMLTableRowElement>('tbody tr')) {
      expect(Array.from(row.cells).reduce((sum, cell) => sum + cell.colSpan, 0)).toBe(columns);
    }
    expect(screen.getByText('一般報名').closest('td')?.colSpan).toBe(columns);
    expect(screen.getByText('測試隊').closest('td')?.colSpan).toBe(columns);
  });

  it('同 UID 課程衝突列仍有放鴿子格且不錯位', () => {
    render(<AttendanceRosterTable {...base} registrations={[
      base.registrations[0]!,
      { ...base.registrations[0], _docId: 'course', userName: '課程甲', courseLinkSource: 'eduCourseLesson', courseStudentId: 'student1' },
    ]} />);
    expect(screen.getAllByText('請至課程點名')).toHaveLength(2);
    expect(cellFor('甲').textContent).toBe('1/3');
    expect(cellFor('課程甲').textContent).toBe('1/3');
  });

  it('相同名字不同 UID 不借用另一人的次數', () => {
    render(<AttendanceRosterTable {...base} registrations={[
      { ...base.registrations[0], userId: 'other' },
    ]} />);
    expect(cellFor('甲').textContent).toBe('');
    expect(document.querySelector(NO_DECORATION)).toBeNull();
  });

  it('空名單不畫表頭', () => {
    render(<AttendanceRosterTable {...base} registrations={[]} />);
    expect(screen.queryByRole('columnheader', { name: '🕊' })).toBeNull();
    expect(screen.getByText('尚無報名')).toBeTruthy();
  });
});
