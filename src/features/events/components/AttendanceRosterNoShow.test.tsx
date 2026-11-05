import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/preact';
import { setLocale } from '@/i18n/i18n';
import { AttendanceRosterTable, type AttendanceRosterTableProps } from './AttendanceRosterTable';
import { buildNoShowCountByUid, buildEndedRegCountByUid, buildLastNoShowSet } from '../data/noshow-roster';

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
  recentUids: buildLastNoShowSet(stats),
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
const title = '放鴿子次數（已結束、正式報名且未完成簽到）';
function cellFor(name: string): HTMLTableCellElement {
  const row = screen.getByText(name).closest('tr')!;
  const index = Array.from(document.querySelectorAll('thead th')).findIndex(th => th.textContent === '🕊');
  return row.cells[index]!;
}

describe('T-073b 名單放鴿子 UI（A oracle）', () => {
  it('編輯模式名字後、簽到前放 🕊 欄；2-1 顯示紅色粗體 1，1-3 歸零留白', () => {
    render(<AttendanceRosterTable {...base} />);
    const headers = Array.from(document.querySelectorAll('th'));
    const index = headers.findIndex(th => th.textContent === '🕊');
    expect(headers[index - 1]?.textContent).toContain('報名名單');
    expect(headers[index + 1]?.textContent).toBe('簽到');
    expect(headers[index]?.title).toBe(title);
    expect(headers[index]?.style.width).toBe('3rem');
    expect(cellFor('甲').textContent).toBe('1');
    expect(cellFor('甲').querySelector('span')?.style.fontWeight).toBe('700');
    expect(cellFor('甲').querySelector('span')?.style.color).toBe('var(--danger)');
    expect(cellFor('乙').textContent).toBe('');
    expect(cellFor('乙').querySelector('span')?.style.fontWeight).toBe('600');
    // 最近一場旗標不受補正後累計歸零影響。
    expect(screen.getByText('乙').querySelector('.uc-recent-noshow')).toBeTruthy();
  });

  it.each([
    { canManage: true, editing: false },
    { canManage: false, editing: true },
  ])('非編輯或非管理者無欄，但有查看權仍染色／泡泡：%j', props => {
    render(<AttendanceRosterTable {...base} {...props} />);
    expect(screen.queryByRole('columnheader', { name: '🕊' })).toBeNull();
    expect(document.querySelector('.uc-att-warn')).toBeTruthy();
    expect(document.querySelector('.uc-recent-noshow')).toBeTruthy();
  });

  it.each([{ canViewNoShow: false }, { publicRosterOnly: true }])('守門即使收到資料仍不顯示：%j', props => {
    render(<AttendanceRosterTable {...base} {...props} />);
    expect(screen.queryByRole('columnheader', { name: '🕊' })).toBeNull();
    expect(document.querySelector('.uc-att-warn, .uc-recent-noshow')).toBeNull();
    expect(document.querySelector('[title^="放鴿子"]')).toBeNull();
  });

  it('旗標關閉不顯示欄、染色與泡泡', () => {
    feature.enabled = false;
    render(<AttendanceRosterTable {...base} />);
    expect(screen.queryByRole('columnheader', { name: '🕊' })).toBeNull();
    expect(document.querySelector('.uc-att-warn, .uc-recent-noshow')).toBeNull();
  });

  it('補正未完成／失敗傳 null：欄位空白，沒有 raw 次數、染色、泡泡或錯誤', () => {
    const view = render(<AttendanceRosterTable {...base} />);
    expect(cellFor('甲').textContent).toBe('1');
    view.rerender(<AttendanceRosterTable {...base} noShowData={null} />);
    expect(screen.getByRole('columnheader', { name: '🕊' })).toBeTruthy();
    expect(cellFor('甲').textContent).toBe('');
    expect(cellFor('乙').textContent).toBe('');
    expect(document.querySelector('.uc-att-warn, .uc-recent-noshow')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it.each([
    [2, 1, null, null],
    [3, 2, '67%', 'rgba(220,38,38,.55)'],
    [10, 3, '30%', 'rgba(239,68,68,.45)'],
    [10, 1, '10%', 'rgba(251,146,60,.45)'],
  ])('%i 場 %i 次的膠囊染色門檻、比例及色碼照 A', (ended, count, pct, color) => {
    render(<AttendanceRosterTable {...base} editing={false} noShowData={{
      counts: new Map([['u1', count as number]]),
      endedCounts: new Map([['u1', ended as number]]), recentUids: new Set(),
    }} />);
    const tag = screen.getByText('甲') as HTMLElement;
    expect(tag.classList.contains('uc-att-warn')).toBe(pct !== null);
    expect(tag.style.getPropertyValue('--att-fill-pct')).toBe(pct ?? '');
    expect(tag.style.getPropertyValue('--att-fill-color')).toBe(color ?? '');
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
      expect(screen.getByText(name).closest('tr')?.querySelector('.uc-att-warn, .uc-recent-noshow')).toBeNull();
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
    expect(cellFor('甲').textContent).toBe('1');
    expect(cellFor('課程甲').textContent).toBe('1');
  });

  it('相同名字不同 UID 不借用另一人的次數或泡泡', () => {
    render(<AttendanceRosterTable {...base} registrations={[
      { ...base.registrations[0], userId: 'other' },
    ]} />);
    expect(cellFor('甲').textContent).toBe('');
    expect(document.querySelector('.uc-att-warn, .uc-recent-noshow')).toBeNull();
  });

  it('空名單不畫表頭', () => {
    render(<AttendanceRosterTable {...base} registrations={[]} />);
    expect(screen.queryByRole('columnheader', { name: '🕊' })).toBeNull();
    expect(screen.getByText('尚無報名')).toBeTruthy();
  });
});
